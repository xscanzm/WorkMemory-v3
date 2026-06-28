//! 后台调度器：定时执行宠物衰减、每日摘要
//!
//! 严格遵循 analysis_results.md 优化 12/13 要求：
//! - 每小时触发宠物属性衰减（hunger -5%/hr, energy -3%/hr）
//! - 每日 23:00 触发每日摘要生成（占位，实际摘要由 distill 模块负责）
//! - 不阻塞主线程（tokio spawn）
//!
//! TODO(Task 14/15): 当前 scheduler 尚未订阅 EventBus 事件。
//!   需在 start_scheduler 中订阅 AppEvent::TaskCompleted / FocusCompleted，
//!   调用 analytics_engine::on_task_completed / on_focus_completed 更新 daily_stats。
//!   目前 focus_engine 直接调用 pet_engine::on_focus_completed（宠物侧），
//!   但 analytics_engine 侧未接入，daily_stats 的 tasks_completed/total_focus_time
//!   仅在显式调用对应 Tauri 命令时才会更新。

use std::time::Duration;
use tauri::Manager;

/// 启动后台调度器
pub fn start_scheduler(app: tauri::AppHandle) {
    // 1. 每小时宠物衰减 + WAL checkpoint
    let app_hourly = app.clone();
    tauri::async_runtime::spawn(async move {
        // 启动后先等 1 小时再首次执行
        loop {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            run_pet_decay(&app_hourly);
            run_wal_checkpoint(&app_hourly);
        }
    });

    // 2. 每分钟检查是否到 23:00 触发每日摘要
    let app_daily = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let now = chrono::Local::now();
            if now.format("%H:%M").to_string() == "23:00" {
                run_daily_summary(&app_daily);
                // 触发后睡眠 1 小时避免重复
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        }
    });

    log::info!("后台调度器已启动（每小时宠物衰减 + WAL checkpoint / 每日 23:00 摘要）");
}

/// 执行宠物衰减
fn run_pet_decay(app: &tauri::AppHandle) {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    // 注意：必须将连接绑定到变量，否则 Deref 临时引用在 if let 中生命周期不足
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };
    // 衰减 1 小时（hunger -5%/hr, energy -3%/hr）
    match crate::core::pet_engine::decay(&conn, 1.0) {
        Ok(pet) => log::debug!("宠物衰减完成：hunger={}, energy={}", pet.hunger, pet.energy),
        Err(e) => log::warn!("宠物衰减失败: {}", e),
    }
}

/// 执行 WAL checkpoint（每小时，TRUNCATE 模式将 WAL 文件截断至最小）
///
/// Task 5.1：避免长期运行下 WAL 文件无限膨胀。与 run_pet_decay 共用同一连接池
/// （Task 1 连接池合并后通过 `pool.get()` 取连接，SQL 不变）。
fn run_wal_checkpoint(app: &tauri::AppHandle) {
    let pool = app.state::<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>>();
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };
    match conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        Ok(_) => log::debug!("WAL checkpoint 完成"),
        Err(e) => log::warn!("WAL checkpoint 失败: {}", e),
    }
}

/// 执行每日摘要（占位，实际由 distill 模块处理）
fn run_daily_summary(app: &tauri::AppHandle) {
    log::info!("触发每日摘要生成（23:00）");
    // TODO: 调用 distill 模块的每日摘要生成逻辑
    // 当前 distill 已有 start_hourly_scheduler，此处可触发当日最终蒸馏
    let _ = app;
}
