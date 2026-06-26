//! Windows 窗口监听与截图模块（Task 4）
//!
//! 实现 `03_CORE_ARCHITECTURE.md` §2.1 的捕获管线与 `05_INTERACTION.md` §1 的记录状态机。
//!
//! ## 平台策略
//! - **Windows**：使用 Win32 API（`GetForegroundWindow` / `GetWindowTextW` / `BitBlt` +
//!   `GetDIBits` / `GetLastInputInfo`）实现真实的前台窗口监听、GDI 截图与空闲检测。
//! - **非 Windows**：提供 stub 实现，返回固定默认值，保证 `lib.rs` 能在 Linux 沙箱上
//!   通过 `cargo check`（stub 使用默认值/tokio sleep 模拟，不调用任何 Windows API）。
//!
//! ## 硬约束
//! - 截图仅内存流转，不写磁盘（除非 `settings.saveScreenshots=true`，本任务留 TODO 注释）
//! - 禁止键盘记录器，只感知前台窗口和窗口标题
//! - 隐私命中只存 `is_private=1, ocr_status='skipped'`，不存任何像素与 OCR 文本
//! - 180s Idle 检测必须停止轮询截图
//! - pHash 95% 相似度触发 Merge（不重复创建 Segment）
//!
//! ## 状态机（`05_INTERACTION.md` §1）
//! `Recording` → `Paused`（用户暂停） / `PrivacyMode`（命中隐私规则） / `Idle`（180s 无输入）
//! 上述任一非 Recording 状态在条件解除后回到 `Recording`。

use tauri::{Emitter, Manager};

// ============================================================
// 常量
// ============================================================

/// 轮询间隔（毫秒）
const POLL_INTERVAL_MS: u64 = 1000;
/// Idle 阈值（秒）：超过则进入 Idle 停止截图
const IDLE_THRESHOLD_SECS: u64 = 180;
/// 窗口标题/进程变化后的稳定阈值（秒）：稳定后才捕获，避免快速切换抖动
const STABLE_THRESHOLD_SECS: u64 = 3;
/// pHash 相似度阈值：>= 该值触发 Merge
const PHASH_MERGE_SIMILARITY: f64 = 0.95;

// ============================================================
// 公共类型
// ============================================================

/// 捕获动作分发结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureAction {
    /// 新建 Segment（截图 + pHash + 入库 + 广播 + OCR 入队）
    Create,
    /// 合并到上一个 Segment（pHash 相似度 >= 95%，仅延长 duration）
    Merge,
    /// 跳过本轮（窗口未稳定 / 截图失败 / 暂停 / Idle）
    Skip,
}

/// 前台窗口信息
#[derive(Debug, Clone)]
pub struct ForegroundInfo {
    /// 窗口句柄（Windows HWND 的指针宽度整数）
    pub hwnd: usize,
    /// 进程名，如 `WeChat.exe`
    pub process_name: String,
    /// 窗口标题
    pub window_title: String,
    /// 应用友好名（去掉 `.exe` 后缀）
    pub app_name: String,
}

/// 截图捕获结果（RGBA8 像素 + 尺寸）
#[derive(Debug, Clone)]
pub struct CapturedImage {
    /// RGBA8 像素缓冲（length = width * height * 4）
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// 轮询管线状态（对应 `05_INTERACTION.md` §1 捕获上下文）
pub struct CaptureState {
    /// 上一个 Segment 的 pHash 基准
    pub last_image_hash: String,
    pub last_window_title: String,
    pub last_process_name: String,
    pub last_change_time: std::time::Instant,
    pub last_input_time: u64,
    pub recorder_state: String,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            last_image_hash: String::new(),
            last_window_title: String::new(),
            last_process_name: String::new(),
            last_change_time: std::time::Instant::now(),
            last_input_time: 0,
            recorder_state: "Recording".to_string(),
        }
    }
}

// ============================================================
// 记录状态机：Recording / Paused / PrivacyMode / Idle
// ============================================================

static RECORDER_STATE: std::sync::OnceLock<std::sync::Mutex<String>> = std::sync::OnceLock::new();

fn recorder_state_storage() -> &'static std::sync::Mutex<String> {
    RECORDER_STATE.get_or_init(|| std::sync::Mutex::new("Recording".to_string()))
}

/// 设置记录状态；状态发生变化时广播 `recorder-state-changed` 事件。
pub fn set_recorder_state(app: &tauri::AppHandle, state: String) {
    let changed = {
        let mut guard = recorder_state_storage()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let prev = guard.clone();
        *guard = state.clone();
        prev != state
    };
    if changed {
        log::info!("记录状态变更: {}", state);
        let _ = app.emit(
            "recorder-state-changed",
            serde_json::json!({ "state": state }),
        );
    }
}

/// 读取当前记录状态。
pub fn get_recorder_state(_app: &tauri::AppHandle) -> String {
    recorder_state_storage()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

// ============================================================
// DB 访问辅助（通过 app.state::<Mutex<Connection>>() 获取并快速释放锁）
// ============================================================

fn with_db<F, R>(app: &tauri::AppHandle, f: F) -> Option<R>
where
    F: FnOnce(&rusqlite::Connection) -> R,
{
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let guard = state.lock().ok()?;
    Some(f(&guard))
}

fn now_local() -> chrono::DateTime<chrono::Local> {
    chrono::Local::now()
}

/// 插入普通 Segment（capture_source = auto/manual），ocr_status='pending'。
fn insert_segment(
    app: &tauri::AppHandle,
    fg: &ForegroundInfo,
    image_hash: &str,
    capture_source: &str,
) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_local();
    let date = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M:%S").to_string();
    let created_at = now.format("%+").to_string();

    let _ = with_db(app, |conn| {
        conn.execute(
            "INSERT INTO segments
                (id, date, start_time, end_time, duration_seconds, app_name, process_name,
                 window_title, ocr_text, ocr_status, image_hash, screenshot_path,
                 is_important, is_private, is_deleted, capture_source, browser_url,
                 activity_type, created_at)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, '', 'pending', ?8, '', 0, 0, 0, ?9, NULL, NULL, ?10)",
            rusqlite::params![
                id,
                date,
                time_str,
                (POLL_INTERVAL_MS / 1000) as i64,
                fg.app_name,
                fg.process_name,
                fg.window_title,
                image_hash,
                capture_source,
                created_at,
            ],
        )
    });
    id
}

/// 插入隐私 Segment：`is_private=1, ocr_status='skipped'`，不存像素、pHash、OCR 文本。
fn insert_private_segment(app: &tauri::AppHandle, fg: &ForegroundInfo) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_local();
    let date = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M:%S").to_string();
    let created_at = now.format("%+").to_string();

    let _ = with_db(app, |conn| {
        conn.execute(
            "INSERT INTO segments
                (id, date, start_time, end_time, duration_seconds, app_name, process_name,
                 window_title, ocr_text, ocr_status, image_hash, screenshot_path,
                 is_important, is_private, is_deleted, capture_source, browser_url,
                 activity_type, created_at)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, '', 'skipped', '', '', 0, 1, 0, 'auto', NULL, NULL, ?8)",
            rusqlite::params![
                id,
                date,
                time_str,
                (POLL_INTERVAL_MS / 1000) as i64,
                fg.app_name,
                fg.process_name,
                fg.window_title,
                created_at,
            ],
        )
    });
    id
}

/// Merge：延长指定 Segment 的 end_time 与 duration_seconds。
fn merge_segment_duration(app: &tauri::AppHandle, segment_id: &str) {
    let now = now_local();
    let time_str = now.format("%H:%M:%S").to_string();
    let _ = with_db(app, |conn| {
        conn.execute(
            "UPDATE segments
             SET end_time = ?1,
                 duration_seconds = duration_seconds + ?2
             WHERE id = ?3",
            rusqlite::params![time_str, (POLL_INTERVAL_MS / 1000) as i64, segment_id],
        )
    });
}

/// 回写 OCR 文本到指定 Segment（trigger_manual_capture 占位用）。
fn update_segment_ocr(app: &tauri::AppHandle, segment_id: &str, ocr_text: &str) {
    let _ = with_db(app, |conn| {
        conn.execute(
            "UPDATE segments SET ocr_text = ?1, ocr_status = 'done' WHERE id = ?2",
            rusqlite::params![ocr_text, segment_id],
        )
    });
}

// ============================================================
// pHash 计算（跨平台，基于 image crate）
// ============================================================

/// 对 RGBA8 像素计算 64-bit pHash，返回 16 位十六进制字符串。
///
/// 流程：RGBA → 8x8 缩放 → 灰度 → 与均值比较生成 64-bit hash。
fn compute_phash(rgba: &[u8], width: u32, height: u32) -> String {
    let img = match image::ImageBuffer::from_raw(width, height, rgba.to_vec()) {
        Some(i) => i,
        None => return String::new(),
    };
    let dyn_img = image::DynamicImage::ImageRgba8(img);
    // 缩放到 8x8（Nearest 足够 pHash 使用），再转灰度
    let small = dyn_img.resize(8, 8, image::imageops::FilterType::Nearest);
    let gray = small.to_luma8();
    let pixels = gray.as_raw();
    if pixels.is_empty() {
        return String::new();
    }
    let avg: f64 = pixels.iter().map(|&p| p as f64).sum::<f64>() / pixels.len() as f64;
    let mut hash: u64 = 0;
    for (i, &p) in pixels.iter().enumerate() {
        if (p as f64) > avg {
            hash |= 1u64 << i;
        }
    }
    format!("{:016x}", hash)
}

/// 计算两个 pHash 的相似度（0.0 ~ 1.0），基于汉明距离。
fn phash_similarity(hash1: &str, hash2: &str) -> f64 {
    let h1 = match u64::from_str_radix(hash1, 16) {
        Ok(v) => v,
        Err(_) => return 0.0,
    };
    let h2 = match u64::from_str_radix(hash2, 16) {
        Ok(v) => v,
        Err(_) => return 0.0,
    };
    let distance = (h1 ^ h2).count_ones();
    1.0 - (distance as f64 / 64.0)
}

// ============================================================
// 隐私守卫（跨平台，纯 SQL）
// ============================================================

/// 查询 `privacy_rules` 表，命中即返回 true。
///
/// 规则类型：`app`（进程名匹配）、`keyword`（窗口标题匹配）、`url`（浏览器 URL 匹配）。
/// pattern 中的 `*` 视作通配符占位，剥离后做大小写不敏感包含匹配。
fn matches_privacy_rules(
    conn: &rusqlite::Connection,
    process: &str,
    title: &str,
    url: Option<&str>,
) -> bool {
    let mut stmt = match conn.prepare("SELECT rule_type, pattern FROM privacy_rules WHERE enabled = 1") {
        Ok(s) => s,
        Err(_) => return false,
    };
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    for (rule_type, pattern) in rows {
        let needle = pattern.replace('*', "");
        if needle.is_empty() {
            continue;
        }
        let needle = needle.to_lowercase();
        let hit = match rule_type.as_str() {
            "app" => process.to_lowercase().contains(&needle),
            "keyword" => title.to_lowercase().contains(&needle),
            "url" => url
                .map(|u| u.to_lowercase().contains(&needle))
                .unwrap_or(false),
            _ => false,
        };
        if hit {
            return true;
        }
    }
    false
}

// ============================================================
// OCR 入队占位（OCR 队列由 Task 5 / core/ocr.rs 实现）
// ============================================================

/// 异步入队 OCR。当前为占位：截图像素在函数返回后即释放（仅内存流转，不写盘）。
///
/// TODO: Task 5 完成后改为调用 `core::ocr::enqueue(segment_id, image).await`。
fn enqueue_ocr(_app: &tauri::AppHandle, segment_id: &str, _image: CapturedImage) {
    log::debug!("OCR 入队占位（待 Task 5 接入）: segment_id={}", segment_id);
}

// ============================================================
// 轮询主循环（跨平台，依赖 cfg 守卫的平台函数）
// ============================================================

/// 启动 1000ms 轮询前台窗口的捕获管线。
///
/// 管线顺序（`03_CORE_ARCHITECTURE.md` §2.1）：
/// get_foreground_window → check_idle(180s) → 隐私守卫 →
/// 标题/进程变化检测 + 3s 稳定 → CaptureAction 分发（Create/Merge/Skip）→
/// 广播事件 / 异步入队 OCR
pub async fn start_polling(app: tauri::AppHandle) {
    log::info!("启动窗口轮询（间隔 {}ms）", POLL_INTERVAL_MS);

    let mut last_image_hash = String::new();
    let mut last_window_title = String::new();
    let mut last_process_name = String::new();
    let mut last_change_time = std::time::Instant::now();
    let mut last_segment_id: Option<String> = None;
    // 隐私窗口进程名：仅首次进入隐私模式时广播 `privacy-triggered`（首闪）
    let mut last_privacy_process: Option<String> = None;

    set_recorder_state(&app, "Recording".to_string());

    loop {
        tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;

        // 1. 获取前台窗口
        let fg = match get_foreground_window() {
            Some(f) => f,
            None => continue,
        };

        // 2. Idle 检测（180s 无输入）
        let current_tick = get_current_tick_ms();
        let last_input = get_last_input_time();
        let idle_secs = current_tick.saturating_sub(last_input) / 1000;
        let current_state = get_recorder_state(&app);

        if idle_secs >= IDLE_THRESHOLD_SECS {
            if current_state != "Idle" {
                set_recorder_state(&app, "Idle".to_string());
                log::info!("进入 Idle（{}s 无输入），停止截图", idle_secs);
            }
            // Idle 期间停止截图，但仍轮询以检测唤醒
            continue;
        } else if current_state == "Idle" {
            set_recorder_state(&app, "Recording".to_string());
            log::info!("从 Idle 唤醒，恢复记录");
        }

        // 暂停状态不截图
        if get_recorder_state(&app) == "Paused" {
            continue;
        }

        // 3. 隐私守卫
        let is_private = with_db(&app, |conn| {
            matches_privacy_rules(conn, &fg.process_name, &fg.window_title, None)
        })
        .unwrap_or(false);

        if is_private {
            if get_recorder_state(&app) != "PrivacyMode" {
                set_recorder_state(&app, "PrivacyMode".to_string());
            }
            // 隐私命中：只存 is_private=1, ocr_status='skipped'，不存像素与 OCR 文本
            insert_private_segment(&app, &fg);
            // 仅首次闪烁广播 privacy-triggered
            if last_privacy_process.as_deref() != Some(fg.process_name.as_str()) {
                let _ = app.emit(
                    "privacy-triggered",
                    serde_json::json!({
                        "process_name": fg.process_name,
                        "window_title": fg.window_title,
                    }),
                );
                last_privacy_process = Some(fg.process_name.clone());
            }
            continue;
        } else if get_recorder_state(&app) == "PrivacyMode" {
            // 离开隐私窗口，恢复记录
            set_recorder_state(&app, "Recording".to_string());
            last_privacy_process = None;
        }

        // 4. 标题/进程变化检测 + 3s 稳定
        let title_changed = fg.window_title != last_window_title;
        let process_changed = fg.process_name != last_process_name;
        if title_changed || process_changed {
            last_window_title = fg.window_title.clone();
            last_process_name = fg.process_name.clone();
            last_change_time = std::time::Instant::now();
            // 窗口切换重置 pHash 基准，强制下一次 Create
            last_image_hash.clear();
            continue; // 等待稳定
        }
        if last_change_time.elapsed() < std::time::Duration::from_secs(STABLE_THRESHOLD_SECS) {
            continue; // 未稳定
        }

        // 5. 截图 + pHash
        let img = match capture_window_screenshot(fg.hwnd) {
            Some(i) => i,
            None => continue, // 截图失败 → Skip
        };
        let cur_hash = compute_phash(&img.rgba, img.width, img.height);

        // 6. CaptureAction 分发
        let action = if last_image_hash.is_empty() || last_segment_id.is_none() {
            CaptureAction::Create
        } else if !cur_hash.is_empty()
            && phash_similarity(&last_image_hash, &cur_hash) >= PHASH_MERGE_SIMILARITY
        {
            CaptureAction::Merge
        } else {
            CaptureAction::Create
        };

        match action {
            CaptureAction::Skip => continue,
            CaptureAction::Merge => {
                if let Some(sid) = last_segment_id.as_deref() {
                    merge_segment_duration(&app, sid);
                }
                // 保持 last_image_hash 基准不变，仅延长 duration
            }
            CaptureAction::Create => {
                // TODO: 磁盘保存分支——仅当 settings.saveScreenshots=true 时写盘
                // （本任务不实现，截图仅内存流转）
                let sid = insert_segment(&app, &fg, &cur_hash, "auto");
                if sid.is_empty() {
                    continue;
                }
                last_image_hash = cur_hash.clone();
                last_segment_id = Some(sid.clone());
                let _ = app.emit(
                    "segment-captured",
                    serde_json::json!({
                        "id": sid,
                        "app_name": fg.app_name,
                        "window_title": fg.window_title,
                        "image_hash": cur_hash,
                        "capture_source": "auto",
                    }),
                );
                // 异步入队 OCR（ocr 模块由 Task 5 提供）
                enqueue_ocr(&app, &sid, img);
            }
        }
    }
}

// ============================================================
// Ghost Capture（Ctrl+Shift+C 快速捕捉）
// ============================================================

/// 手动快速捕捉：截图 + OCR，返回 OCR 纯文本。
///
/// 对应 `05_INTERACTION.md` 的 Ghost Capture（Ctrl+Shift+C）。
/// OCR 模块由 Task 5 提供；当前以窗口标题作为占位纯文本返回。
pub async fn trigger_manual_capture(app: tauri::AppHandle) -> String {
    log::info!("触发 Ghost Capture（手动捕捉）");

    let fg = match get_foreground_window() {
        Some(f) => f,
        None => return String::new(),
    };
    let img = match capture_window_screenshot(fg.hwnd) {
        Some(i) => i,
        None => return String::new(),
    };
    let cur_hash = compute_phash(&img.rgba, img.width, img.height);

    let segment_id = insert_segment(&app, &fg, &cur_hash, "manual");

    let _ = app.emit(
        "segment-captured",
        serde_json::json!({
            "id": segment_id,
            "app_name": fg.app_name,
            "window_title": fg.window_title,
            "image_hash": cur_hash,
            "capture_source": "manual",
        }),
    );

    // TODO: Task 5 完成后改为 `core::ocr::recognize(&img).await` 返回真实 OCR 文本。
    let ocr_text = format!("[Ghost Capture] {}", fg.window_title);
    update_segment_ocr(&app, &segment_id, &ocr_text);
    ocr_text
}

// ============================================================
// Windows 平台实现（Win32 API）
// ============================================================
// 注意：本块仅在 target_os = "windows" 下编译，Linux 沙箱不编译。
// windows-rs 0.58 API 签名遵循官方约定；个别 BOOL/Result 返回类型在 Windows
// 构建时可按编译器提示微调。

#[cfg(target_os = "windows")]
fn get_current_tick_ms() -> u64 {
    // GetTickCount64 位于 Win32_System_SystemInformation（需在 Cargo.toml 启用该 feature）
    unsafe { windows::Win32::System::SystemInformation::GetTickCount64() }
}

#[cfg(target_os = "windows")]
fn get_last_input_time() -> u64 {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut lii: LASTINPUTINFO = std::mem::zeroed();
        lii.cbSize = std::mem::size_of::<LASTINPUTINFO>() as u32;
        if GetLastInputInfo(&mut lii).as_bool() {
            lii.dwTime as u64
        } else {
            get_current_tick_ms()
        }
    }
}

#[cfg(target_os = "windows")]
fn get_foreground_window() -> Option<ForegroundInfo> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::PWSTR;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        // 窗口标题
        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, PWSTR(title_buf.as_mut_ptr()), title_buf.len() as i32);
        let window_title = if len > 0 {
            String::from_utf16_lossy(&title_buf[..len as usize])
        } else {
            String::new()
        };

        // PID
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid == 0 {
            return None;
        }

        // 进程映像路径 → 进程名
        let process_name = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => {
                let mut path_buf = [0u16; 1024];
                let mut size = path_buf.len() as u32;
                let _ = QueryFullProcessImageNameW(
                    handle,
                    0,
                    PWSTR(path_buf.as_mut_ptr()),
                    &mut size,
                );
                let _ = windows::Win32::Foundation::CloseHandle(handle);
                let path = String::from_utf16_lossy(&path_buf[..size as usize]);
                path.rsplit('\\').next().unwrap_or(&path).to_string()
            }
            Err(_) => String::new(),
        };

        let app_name = process_name.trim_end_matches(".exe").to_string();

        Some(ForegroundInfo {
            hwnd: hwnd.0 as usize,
            process_name,
            window_title,
            app_name,
        })
    }
}

#[cfg(target_os = "windows")]
fn capture_window_screenshot(hwnd_usize: usize) -> Option<CapturedImage> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    unsafe {
        let hwnd = HWND(hwnd_usize as *mut std::ffi::c_void);

        // 窗口矩形
        let mut rect: RECT = std::mem::zeroed();
        let _ = GetWindowRect(hwnd, &mut rect);
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        if width <= 0 || height <= 0 {
            return None;
        }

        // GDI 截图：GetDC → CreateCompatibleDC → CreateCompatibleBitmap →
        // SelectObject → BitBlt → GetDIBits → 清理
        let hdc_window = GetDC(Some(hwnd))?;
        let hdc_mem = CreateCompatibleDC(Some(hdc_window))?;
        let hbitmap = CreateCompatibleBitmap(hdc_window, width, height);
        if hbitmap.0.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(hwnd, hdc_window);
            return None;
        }
        let old_obj = SelectObject(hdc_mem, hbitmap);
        let _ = BitBlt(
            hdc_mem,
            0,
            0,
            width,
            height,
            hdc_window,
            0,
            0,
            SRCCOPY,
        );

        // BITMAPINFO：32-bit BGRA，top-down（biHeight 取负避免垂直翻转）
        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let mut buffer = vec![0u8; (width as usize) * (height as usize) * 4];
        let got = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr() as *mut std::ffi::c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // 清理 GDI 资源
        let _ = SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap);
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(hwnd, hdc_window);

        if got == 0 {
            return None;
        }

        // BGRA → RGBA（交换 R 与 B 通道）
        for chunk in buffer.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        Some(CapturedImage {
            rgba: buffer,
            width: width as u32,
            height: height as u32,
        })
    }
}

// ============================================================
// 非 Windows 平台 stub 实现
// ============================================================
// 固定返回 Some/默认值，保证 lib.rs 在 Linux 沙箱上通过 cargo check。

#[cfg(not(target_os = "windows"))]
fn get_current_tick_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(not(target_os = "windows"))]
fn get_last_input_time() -> u64 {
    // stub：返回当前 tick，使 idle 永远为 0（不触发 Idle）
    get_current_tick_ms()
}

#[cfg(not(target_os = "windows"))]
fn get_foreground_window() -> Option<ForegroundInfo> {
    Some(ForegroundInfo {
        hwnd: 0,
        process_name: "stub.exe".to_string(),
        window_title: "Stub Window".to_string(),
        app_name: "Stub".to_string(),
    })
}

#[cfg(not(target_os = "windows"))]
fn capture_window_screenshot(_hwnd: usize) -> Option<CapturedImage> {
    // stub：返回 10x10 透明像素，保证 compute_phash 可正常运行
    Some(CapturedImage {
        rgba: vec![0u8; 10 * 10 * 4],
        width: 10,
        height: 10,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phash_similarity_identical() {
        assert!((phash_similarity("0000000000000000", "0000000000000000") - 1.0).abs() < 1e-9);
        assert!((phash_similarity("ffffffffffffffff", "ffffffffffffffff") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn phash_similarity_opposite() {
        // 全 0 与全 1：64 位全不同 → 相似度 0
        assert!((phash_similarity("0000000000000000", "ffffffffffffffff") - 0.0).abs() < 1e-9);
    }

    #[test]
    fn phash_similarity_invalid() {
        assert!((phash_similarity("notahex", "0000000000000000") - 0.0).abs() < 1e-9);
    }

    #[test]
    fn compute_phash_blank_image() {
        // 10x10 全透明像素 → 像素值全相等（==avg），不大于 avg → hash 全 0
        let rgba = vec![0u8; 10 * 10 * 4];
        let hash = compute_phash(&rgba, 10, 10);
        assert_eq!(hash, "0000000000000000");
    }

    #[test]
    fn capture_state_default_is_recording() {
        let s = CaptureState::default();
        assert_eq!(s.recorder_state, "Recording");
        assert!(s.last_image_hash.is_empty());
    }
}
