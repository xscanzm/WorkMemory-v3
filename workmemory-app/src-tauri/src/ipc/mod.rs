// IPC 模块 (对应 03_CORE_ARCHITECTURE.md §3)
// - commands: 暴露给前端的全部 #[tauri::command]
// - events:   事件广播 payload 与辅助函数
pub mod commands;
pub mod events;
