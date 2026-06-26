// WorkMemory 应用库入口
// 模块声明对应 03_CORE_ARCHITECTURE.md §1 物理工程目录布局
pub mod models;
pub mod db;
pub mod core;
pub mod ipc;

use tauri::Manager;

/// 应用主入口：注册命令、初始化数据库、启动后台管线
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    log::info!("WorkMemory 启动中...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::init())
        .setup(|app| {
            // 初始化数据库（WAL + 外键 + 迁移）
            let app_data_dir = app.path().app_data_dir().expect("无法获取 app_data_dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("workmemory.db");
            log::info!("数据库路径: {:?}", db_path);

            let conn = db::connection::init(&db_path).expect("数据库初始化失败");
            db::migrations::run(&conn).expect("数据库迁移失败");
            app.manage(std::sync::Mutex::new(conn));

            // 显示 Mascot 透明窗口
            if let Some(mascot) = app.get_webview_window("mascot") {
                let _ = mascot.show();
                core::mascot::apply_no_activate(&mascot);
            }

            // 启动后台管线
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                core::capture::start_polling(app_handle.clone()).await;
            });

            let app_handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                core::distill::start_hourly_scheduler(app_handle2).await;
            });

            // 注册全部 IPC 命令与事件
            ipc::events::register_event_listeners(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::get_recorder_state,
            ipc::commands::set_recorder_state,
            ipc::commands::trigger_manual_capture,
            ipc::commands::get_today_summary,
            ipc::commands::get_episodes_by_date,
            ipc::commands::update_episode_title_summary,
            ipc::commands::search_memories,
            ipc::commands::generate_report,
            ipc::commands::save_to_wiki,
            ipc::commands::get_settings,
            ipc::commands::update_settings,
            ipc::commands::get_mascot_id,
            ipc::commands::set_mascot_id,
            ipc::commands::get_calendar_month,
            ipc::commands::get_insights,
            ipc::commands::get_wiki_pages,
            ipc::commands::get_wiki_page,
            ipc::commands::get_review_queue,
            ipc::commands::get_graph_data,
            ipc::commands::get_episode_by_id,
            ipc::commands::list_mascots,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 启动失败");
}
