// WorkMemory 今日记忆 - 应用入口
// 严格遵循 03_CORE_ARCHITECTURE.md §1 目录布局
// 防止 Windows Debug 构建额外弹窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    workmemory_app_lib::run()
}
