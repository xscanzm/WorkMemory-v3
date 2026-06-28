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
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 初始化数据库（WAL + 外键 + 迁移）—— r2d2 连接池
            let app_data_dir = app.path().app_data_dir().expect("无法获取 app_data_dir");
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("workmemory.db");
            log::info!("数据库路径: {:?}", db_path);

            // 连接池：min_idle=2 / max_size=8，每个新连接应用 PRAGMA(WAL+外键+同步+忙等待)
            let manager = r2d2_sqlite::SqliteConnectionManager::file(&db_path)
                .with_init(|c| {
                    c.execute_batch(
                        "PRAGMA journal_mode = WAL;
                         PRAGMA foreign_keys = ON;
                         PRAGMA synchronous = NORMAL;",
                    )?;
                    c.busy_timeout(std::time::Duration::from_millis(5000))?;
                    Ok(())
                });
            let pool = r2d2::Pool::builder()
                .max_size(8)
                .min_idle(Some(2))
                .build(manager)
                .expect("Failed to create SQLite connection pool");

            // 在一个池连接上运行一次迁移（DDL 幂等，可安全重复执行）
            {
                let conn = pool.get().expect("无法从连接池获取连接以执行迁移");
                db::migrations::run(&conn).expect("数据库迁移失败");
            }

            app.manage(pool);

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

            // 启动后台调度器（宠物衰减 / 每日摘要）
            core::scheduler::start_scheduler(app.handle().clone());

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
            ipc::commands::get_daily_stats,
            ipc::commands::get_today_stats,
            ipc::commands::get_pet_state,
            ipc::commands::save_pet_state,
            ipc::commands::feed_pet,
            ipc::commands::play_pet,
            ipc::commands::rest_pet,
            ipc::commands::clean_pet,
            ipc::commands::save_task,
            ipc::commands::get_all_tasks,
            ipc::commands::get_task,
            ipc::commands::update_task,
            ipc::commands::delete_task,
            ipc::commands::search_tasks,
            ipc::commands::start_focus_session,
            ipc::commands::complete_focus_session,
            ipc::commands::interrupt_focus_session,
            ipc::commands::get_today_focus_sessions,
            ipc::commands::get_soundscape_packs,
            ipc::commands::get_all_soundscape_packs,
            ipc::commands::toggle_soundscape_pack,
            ipc::commands::get_weekly_stats,
            ipc::commands::calculate_streak,
            ipc::commands::productivity_score,
            // Task 24: 数据导入/导出 + 用户偏好
            ipc::commands::export_data_json,
            ipc::commands::export_tasks_csv,
            ipc::commands::import_data_json,
            ipc::commands::clear_all_data,
            ipc::commands::get_preference,
            ipc::commands::set_preference,
            // Task 23: 成就引擎
            ipc::commands::get_all_achievements,
            ipc::commands::unlock_achievement,
            ipc::commands::recalculate_achievements,
            // Task 12: 快速捕获窗口
            ipc::commands::show_quick_capture,
            ipc::commands::hide_quick_capture,
            // Task 15: 标签管理面板
            ipc::commands::list_tags,
            ipc::commands::rename_tag,
            ipc::commands::merge_tags,
            ipc::commands::set_tag_color,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 启动失败");
}
