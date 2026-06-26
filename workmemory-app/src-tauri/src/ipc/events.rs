// IPC 事件广播 (对应 03_CORE_ARCHITECTURE.md §3.2)
//
// 设计：事件由各 core 模块在状态变更时直接 `app.emit()` 广播给前端。
// 本模块提供：
//   1. 6 个事件 payload 结构体（前端按 camelCase 消费）
//   2. register_event_listeners 占位入口（lib.rs setup 阶段调用）
//   3. 一组 emit_* 辅助函数，供 core 模块或命令统一构造 payload 并广播
//
// 事件名约定（与前端 invoke/on 字符串完全一致）：
//   recorder-state-changed / segment-captured / privacy-triggered /
//   distill-completed / focus-remind / report-ready

#![allow(dead_code)]

use tauri::Emitter;

// ============================================================
// 事件 Payload 结构体
// ============================================================

/// `recorder-state-changed` 事件载荷
#[derive(Clone, serde::Serialize)]
pub struct RecorderStateChangedPayload {
    pub state: String,
}

/// `segment-captured` 事件载荷
#[derive(Clone, serde::Serialize)]
pub struct SegmentCapturedPayload {
    pub id: String,
    pub app_name: String,
    pub window_title: String,
}

/// `privacy-triggered` 事件载荷
#[derive(Clone, serde::Serialize)]
pub struct PrivacyTriggeredPayload {
    pub app_name: String,
}

/// `distill-completed` 事件载荷
#[derive(Clone, serde::Serialize)]
pub struct DistillCompletedPayload {
    pub date: String,
    pub hour_bucket: String,
}

/// `focus-remind` 事件载荷
#[derive(Clone, serde::Serialize)]
pub struct FocusRemindPayload {
    pub minutes: u32,
}

/// `report-ready` 事件载荷（无字段，仅作为前端触发 Mascot jump 的信号）
#[derive(Clone, serde::Serialize)]
pub struct ReportReadyPayload {}

// ============================================================
// 事件监听器注册（占位）
// ============================================================

/// 注册事件监听器入口。
///
/// 当前 core 模块（capture/distill/report）在状态变更时直接 `app.emit()` 广播，
/// 因此本函数无需额外订阅。后续若需托盘菜单事件转发、跨窗口同步等，可在此扩展。
pub fn register_event_listeners(_app: tauri::AppHandle) {
    log::info!("事件监听器已注册");
}

// ============================================================
// 事件广播辅助函数
// ============================================================

/// 广播 `recorder-state-changed` 事件。
pub fn emit_recorder_state(app: &tauri::AppHandle, state: &str) {
    let _ = app.emit(
        "recorder-state-changed",
        RecorderStateChangedPayload {
            state: state.to_string(),
        },
    );
}

/// 广播 `segment-captured` 事件。
pub fn emit_segment_captured(app: &tauri::AppHandle, id: &str, app_name: &str, title: &str) {
    let _ = app.emit(
        "segment-captured",
        SegmentCapturedPayload {
            id: id.to_string(),
            app_name: app_name.to_string(),
            window_title: title.to_string(),
        },
    );
}

/// 广播 `privacy-triggered` 事件。
pub fn emit_privacy(app: &tauri::AppHandle, app_name: &str) {
    let _ = app.emit(
        "privacy-triggered",
        PrivacyTriggeredPayload {
            app_name: app_name.to_string(),
        },
    );
}

/// 广播 `distill-completed` 事件。
pub fn emit_distill_completed(app: &tauri::AppHandle, date: &str, hour: &str) {
    let _ = app.emit(
        "distill-completed",
        DistillCompletedPayload {
            date: date.to_string(),
            hour_bucket: hour.to_string(),
        },
    );
}

/// 广播 `focus-remind` 事件。
pub fn emit_focus_remind(app: &tauri::AppHandle, minutes: u32) {
    let _ = app.emit("focus-remind", FocusRemindPayload { minutes });
}

/// 广播 `report-ready` 事件（触发 Mascot jump 动画）。
pub fn emit_report_ready(app: &tauri::AppHandle) {
    let _ = app.emit("report-ready", ReportReadyPayload {});
}
