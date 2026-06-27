//! 事件总线：模块间解耦通信
//!
//! 严格遵循 analysis_results.md 优化 13 要求：
//! - TaskCompleted → PetEngine 处理 XP/hunger → AnalyticsEngine 更新统计
//! - FocusCompleted → PetEngine +XP/energy → AnalyticsEngine 累加 focus_time
//! - 降低模块间耦合度

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// 事件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum AppEvent {
    /// 任务完成（task_id）
    TaskCompleted { task_id: String },
    /// 专注会话完成（focus_seconds）
    FocusCompleted { focus_seconds: i64 },
    /// 宠物交互（action: feed/play/rest/clean）
    PetInteraction { action: String },
    /// 宠物升级（new_level）
    PetLevelUp { new_level: i64 },
}

/// 事件总线句柄
#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
}

impl EventBus {
    /// 创建新的事件总线（容量 256）
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }

    /// 发布事件
    pub fn publish(&self, event: AppEvent) {
        // 忽略无订阅者的错误
        let _ = self.sender.send(event);
    }

    /// 获取订阅者
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

/// 全局事件总线（OnceLock 单例）
static EVENT_BUS: std::sync::OnceLock<EventBus> = std::sync::OnceLock::new();

/// 获取全局事件总线
pub fn global_event_bus() -> &'static EventBus {
    EVENT_BUS.get_or_init(EventBus::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_and_subscribe() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        bus.publish(AppEvent::TaskCompleted { task_id: "t1".to_string() });
        let event = rx.try_recv().unwrap();
        match event {
            AppEvent::TaskCompleted { task_id } => assert_eq!(task_id, "t1"),
            _ => panic!("预期 TaskCompleted 事件"),
        }
    }

    #[test]
    fn publish_no_subscriber_ok() {
        let bus = EventBus::new();
        // 无订阅者发布不应 panic
        bus.publish(AppEvent::PetLevelUp { new_level: 2 });
    }
}
