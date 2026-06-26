//! WinRT OCR 引擎封装与后台队列
//!
//! 严格遵循：
//! - `03_CORE_ARCHITECTURE.md` §2.1：OCR 后台队列，并发上限 = 2
//! - `01_ARCHITECTURAL_DECISIONS.md` §2：仅使用 Windows 原生 WinRT Media.Ocr，
//!   **完全禁用 PaddleOCR**
//!
//! 平台策略：
//! - Windows：调用 `windows::Media::Ocr::OcrEngine` 真实识别
//! - 非 Windows：提供 stub，保证 `cargo check` 通过

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{mpsc, Semaphore};

/// OCR 队列并发上限（硬约束：严格 = 2）
const OCR_CONCURRENCY: usize = 2;

/// OCR 任务单元：由 capture 模块捕获截图后入队
pub struct OcrTask {
    pub segment_id: String,
    pub image_rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// 启动 OCR worker，返回 `Sender` 供 capture 模块入队
///
/// 内部创建容量 64 的 mpsc channel，并 spawn `run_ocr_queue` 消费队列。
pub fn spawn_ocr_worker(app: tauri::AppHandle) -> mpsc::Sender<OcrTask> {
    let (tx, rx) = mpsc::channel::<OcrTask>(64);
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_ocr_queue(app_handle, rx).await;
    });
    tx
}

/// 消费 OCR 队列：用 `Semaphore` 限制并发 = 2，对每个任务执行
/// `recognize` → `clean_text` → 写回 `segments.ocr_text` / `ocr_status`
///
/// DB 访问通过 `app.state::<std::sync::Mutex<rusqlite::Connection>>()`。
pub async fn run_ocr_queue(app: tauri::AppHandle, mut rx: mpsc::Receiver<OcrTask>) {
    let semaphore = Arc::new(Semaphore::new(OCR_CONCURRENCY));
    log::info!("OCR 队列启动，并发上限 = {}", OCR_CONCURRENCY);

    while let Some(task) = rx.recv().await {
        // 在派发前获取许可：天然背压，保证全局并发严格 <= OCR_CONCURRENCY
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                log::error!("OCR 信号量已关闭，丢弃 segment={}", task.segment_id);
                continue;
            }
        };

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // _permit 持有至任务结束，结束时自动释放，唤醒下一个排队任务
            let _permit = permit;

            log::debug!(
                "OCR 开始 segment={} {}x{}",
                task.segment_id, task.width, task.height
            );

            match recognize(&task.image_rgba, task.width, task.height).await {
                Some(raw) => {
                    let cleaned = clean_text(&raw);
                    persist_ocr_result(&app_handle, &task.segment_id, &cleaned, "done");
                    log::info!(
                        "OCR 完成 segment={} 清洗后文本长度={}",
                        task.segment_id,
                        cleaned.len()
                    );
                }
                None => {
                    persist_ocr_result(&app_handle, &task.segment_id, "", "failed");
                    log::warn!("OCR 失败 segment={}", task.segment_id);
                }
            }
        });
    }

    log::info!("OCR 队列接收端关闭，worker 退出");
}

/// 将 OCR 结果写回 `segments` 表（`ocr_text` + `ocr_status`）
fn persist_ocr_result(app: &tauri::AppHandle, segment_id: &str, ocr_text: &str, status: &str) {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = match state.lock() {
        Ok(guard) => guard,
        Err(e) => {
            log::error!("DB Mutex poisoned，无法写回 OCR 结果: {}", e);
            return;
        }
    };

    let sql = "UPDATE segments SET ocr_text = ?1, ocr_status = ?2 WHERE id = ?3";
    match conn.execute(sql, rusqlite::params![ocr_text, status, segment_id]) {
        Ok(affected) => log::debug!(
            "写回 segment={} status={} 影响行数={}",
            segment_id,
            status,
            affected
        ),
        Err(e) => log::error!("写回 OCR 结果失败 segment={}: {}", segment_id, e),
    }
}

// ============================================================================
// 文本清洗（跨平台）
// ============================================================================

/// 清洗 OCR 原始文本：
/// 1. 去重连续空行（修剪后丢弃空行）
/// 2. 去除单字符噪点行
/// 3. 合并被换行打断的句子：行尾无终止标点 **且** 下一行首字符非「大写字母 / 中文」时拼接
/// 4. 单字符碎片被规则 2 过滤；「确定」「取消」等 2 字按钮标签因长度 > 1 自然保留
pub fn clean_text(raw: &str) -> String {
    // 1. 逐行修剪并丢弃空行（同时去重连续空行）
    let mut lines: Vec<String> = raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    // 2. 去除单字符噪点行
    lines.retain(|l| l.chars().count() > 1);

    // 3. 合并被换行打断的句子
    let mut merged: Vec<String> = Vec::with_capacity(lines.len());
    for line in lines {
        let do_merge = match merged.last() {
            Some(prev) => !ends_with_terminal_punct(prev) && !starts_with_upper_or_cjk(&line),
            None => false,
        };
        if do_merge {
            if let Some(prev) = merged.last_mut() {
                // 两侧均为 ASCII（非中文）时补一个空格以还原英文换行丢失的词间距；
                // 涉及中文的衔接直接拼接（中文不需要空格）
                let both_ascii = matches!(
                    (prev.chars().last(), line.chars().next()),
                    (Some(a), Some(b)) if !is_cjk(a) && !is_cjk(b)
                );
                if both_ascii {
                    prev.push(' ');
                }
                prev.push_str(&line);
            }
        } else {
            merged.push(line);
        }
    }

    merged.join("\n")
}

/// 行尾是否为终止标点（中英文句末标点）
fn ends_with_terminal_punct(s: &str) -> bool {
    match s.chars().last() {
        Some(c) => matches!(
            c,
            '。' | '！' | '？' | '；' | '：' | '，' | '、' | '．' | '…'
                | '.' | '!' | '?' | ';' | ':' | ','
        ),
        None => true,
    }
}

/// 行首是否为「大写 ASCII 字母 或 中文字符」——若是则视为新句 / 新段，不与前文拼接
fn starts_with_upper_or_cjk(s: &str) -> bool {
    match s.chars().next() {
        Some(c) => c.is_ascii_uppercase() || is_cjk(c),
        None => true,
    }
}

/// 是否为 CJK 统一表意文字（基本区 U+4E00..U+9FFF）
fn is_cjk(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c)
}

// ============================================================================
// Windows：WinRT Media.Ocr 真实实现
// ============================================================================
#[cfg(target_os = "windows")]
mod winrt_impl {
    use windows::core::Interface;
    use windows::Foundation::{IBuffer, IMemoryBufferByteAccess, MemoryBuffer};
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;

    /// 调用 WinRT Media.Ocr 识别 RGBA 像素，返回按行 `\n` 拼接的文本
    pub(super) async fn recognize_inner(
        rgba: &[u8],
        width: u32,
        height: u32,
    ) -> windows::core::Result<String> {
        // 1) RGBA → BGRA：WinRT SoftwareBitmap 使用 Bgra8 格式，逐像素交换 R / B 通道
        let mut bgra = rgba.to_vec();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        // 2) 装入 MemoryBuffer（实现 IBuffer），经 IMemoryBufferByteAccess 写入像素字节
        let len = bgra.len();
        let memory_buffer = MemoryBuffer::new(len as u32)?;
        let reference = memory_buffer.CreateReference()?;
        let byte_access: IMemoryBufferByteAccess = reference.cast()?;
        let mut data_ptr: *mut u8 = std::ptr::null_mut();
        let mut capacity: u32 = 0;
        unsafe {
            byte_access.GetBuffer(&mut data_ptr, &mut capacity)?;
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), data_ptr, len);
        }

        // 3) 创建带 Alpha 的 SoftwareBitmap（Bgra8，每像素 4 字节，同步拷贝）
        let ibuffer: IBuffer = memory_buffer.cast()?;
        let software_bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &ibuffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )?;

        // 4) 获取 OCR 引擎：优先 zh-Hans-CN（支持中文），失败回退用户配置语言（覆盖英文 OS）
        let engine = (|| {
            let lang_id = windows::core::HSTRING::from("zh-Hans-CN");
            let lang = Language::CreateLanguage(&lang_id)?;
            OcrEngine::TryCreateFromLanguage(&lang)
        })()
        .or_else(|e| {
            log::warn!("zh-Hans-CN OCR 引擎不可用（{}），回退用户配置语言", e);
            OcrEngine::TryCreateFromUserProfileLanguages()
        })?;

        // 5) 异步识别：IAsyncOperation<OcrResult> 由 windows-rs 转为 Future，可直接 await
        let result = engine.RecognizeAsync(&software_bitmap).await?;

        // 6) 遍历 Lines（IIterable 实现 IntoIterator），行间用 \n 拼接
        let mut texts: Vec<String> = Vec::new();
        for line in result.Lines()? {
            texts.push(line.Text()?.to_string());
        }

        Ok(texts.join("\n"))
    }
}

/// Windows 平台：调用 WinRT Media.Ocr
#[cfg(target_os = "windows")]
pub async fn recognize(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    match winrt_impl::recognize_inner(rgba, width, height).await {
        Ok(text) => Some(text),
        Err(e) => {
            log::warn!("WinRT OCR 识别失败: {}", e);
            None
        }
    }
}

// ============================================================================
// 非 Windows 平台：stub，保证 cargo check 通过
// ============================================================================
#[cfg(not(target_os = "windows"))]
pub async fn recognize(_rgba: &[u8], _width: u32, _height: u32) -> Option<String> {
    Some("[stub] OCR not available on non-Windows".into())
}
