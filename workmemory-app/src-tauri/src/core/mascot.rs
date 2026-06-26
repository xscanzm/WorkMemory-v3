// Mascot 透明窗口控制器
// 实现 05_INTERACTION.md §2.1 的 Mascot 窗口硬约束：
//   - skip_taskbar + WS_EX_NOACTIVATE + decorations:false + transparent:true + always_on_top:true
//   - 绝对禁止主动夺焦
//   - 贴边磁吸优先右下角
//   - 全屏/演示/专业软件前台时降透明度至 0.15
// 窗口静态配置已在 tauri.conf.json 完成，本模块只做运行时控制。

use tauri::{Emitter, Manager};

/// Windows 专属：为 Mascot 窗口叠加 `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` 扩展样式，
/// 确保点击 Mascot 不会导致当前前台应用失焦，且不出现在 Alt+Tab / 任务栏中。
#[cfg(target_os = "windows")]
pub fn apply_no_activate(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(_) => return,
    };
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = ex_style
            | (WS_EX_NOACTIVATE.0 as isize)
            | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
    }
}

/// 非 Windows 平台 stub：保持编译通过。
#[cfg(not(target_os = "windows"))]
pub fn apply_no_activate(window: &tauri::WebviewWindow) {
    let _ = window;
}

/// 贴边磁吸：根据当前窗口位置吸附到最近的工作区边缘，优先右下角。
/// `monitor_work_area` 为 `(left, top, right, bottom)` 逻辑像素坐标。
/// 若当前窗口 x 中点 > 屏幕中点则贴右边，y 中点 > 中点则贴下边。
pub fn snap_to_edge(
    window: &tauri::WebviewWindow,
    monitor_work_area: Option<(i32, i32, i32, i32)>,
) {
    let (left, top, right, bottom) = match monitor_work_area {
        Some(area) => area,
        None => return,
    };
    let work_w = (right - left) as f64;
    let work_h = (bottom - top) as f64;
    let mid_x = left as f64 + work_w / 2.0;
    let mid_y = top as f64 + work_h / 2.0;

    // outer_position / outer_size 返回物理像素，按缩放因子换算回逻辑像素
    let scale = window.scale_factor().unwrap_or(1.0);
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return,
    };
    let size = match window.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    let cur_x = pos.x as f64 / scale;
    let cur_y = pos.y as f64 / scale;
    let w = size.width as f64 / scale;
    let h = size.height as f64 / scale;

    // 优先右下角
    let new_x = if cur_x + w / 2.0 > mid_x {
        right as f64 - w
    } else {
        left as f64
    };
    let new_y = if cur_y + h / 2.0 > mid_y {
        bottom as f64 - h
    } else {
        top as f64
    };

    let _ = window.set_position(tauri::LogicalPosition::new(new_x, new_y));
}

/// 跨平台调整 Mascot 透明度。Mascot 全屏/演示/专业软件前台时调 0.15。
/// 通过广播 `mascot-opacity` 事件让前端调整 Mascot 容器的 CSS opacity，
/// 这是 Tauri 2.0 下最可靠的跨平台降透明度方案（原生 set_effects 仅控制材质，不控制 alpha）。
pub fn set_opacity(window: &tauri::WebviewWindow, opacity: f64) {
    let clamped = opacity.clamp(0.0, 1.0);
    let _ = window.emit("mascot-opacity", serde_json::json!({ "opacity": clamped }));
}

/// 显示 Mascot 窗口。绝不主动夺焦：仅 show，不 set_focus，
/// 并在 Windows 上重新应用 WS_EX_NOACTIVATE 以防样式丢失。
pub fn show_mascot(app: &tauri::AppHandle) {
    if let Some(mascot) = app.get_webview_window("mascot") {
        let _ = mascot.show();
        apply_no_activate(&mascot);
    }
}

/// 隐藏 Mascot 窗口。`duration` 用于"隐藏伙伴 1 小时"——
/// 传入后将在指定时长后自动重新显示。
pub fn hide_mascot(app: &tauri::AppHandle, duration: Option<chrono::Duration>) {
    if let Some(mascot) = app.get_webview_window("mascot") {
        let _ = mascot.hide();
    }
    if let Some(dur) = duration {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let ms = dur.num_milliseconds().max(0) as u64;
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            show_mascot(&app_handle);
        });
    }
}

/// 判断当前前台进程是否为需要降透明度的专业软件。
/// 匹配 devenv.exe / idea64.exe / Photoshop.exe 等（进程名小写匹配）。
/// 注意：全屏/演示模式的判定应由调用方根据窗口覆盖率完成，本函数只做进程名匹配。
pub fn is_focus_app(process_name: &str) -> bool {
    const FOCUS_APPS: &[&str] = &[
        "devenv.exe",
        "idea64.exe",
        "idea.exe",
        "pycharm64.exe",
        "webstorm64.exe",
        "clion64.exe",
        "goland64.exe",
        "rider64.exe",
        "phpstorm64.exe",
        "datagrip.exe",
        "photoshop.exe",
        "illustrator.exe",
        "afterfx.exe",
        "premiere.exe",
        "indesign.exe",
        "lightroom.exe",
        "xd.exe",
    ];
    let name = process_name.to_lowercase();
    FOCUS_APPS.iter().any(|app| name.ends_with(app))
}

/// 广播 `report-ready` 事件，触发前端 Mascot jump 动画（前端监听）。
pub fn emit_jump(app: &tauri::AppHandle) {
    let _ = app.emit("report-ready", serde_json::json!({}));
}
