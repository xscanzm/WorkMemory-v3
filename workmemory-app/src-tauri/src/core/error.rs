//! 应用统一错误类型
//!
//! 替代 Tauri 命令中裸用的 `Result<T, String>`，提供结构化错误分类，
//! 便于前端根据 error kind 做差异化处理（如 NotFound 显示空态、Validation 高亮字段）。

use serde::Serialize;

/// 应用统一错误类型
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    /// 数据库错误
    DbError(String),
    /// IO 错误
    IoError(String),
    /// 资源未找到
    NotFoundError(String),
    /// 输入校验失败
    ValidationError(String),
    /// 其他内部错误
    Internal(String),
}

impl AppError {
    /// 从字符串消息快速构造 Internal 错误
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }

    /// 从字符串消息快速构造 ValidationError
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::ValidationError(msg.into())
    }

    /// 从字符串消息快速构造 NotFoundError
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFoundError(msg.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::DbError(m) => write!(f, "数据库错误: {}", m),
            AppError::IoError(m) => write!(f, "IO 错误: {}", m),
            AppError::NotFoundError(m) => write!(f, "未找到: {}", m),
            AppError::ValidationError(m) => write!(f, "校验失败: {}", m),
            AppError::Internal(m) => write!(f, "内部错误: {}", m),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::DbError(e.to_string())
    }
}

impl From<r2d2::Error> for AppError {
    fn from(e: r2d2::Error) -> Self {
        AppError::Internal(format!("数据库连接池错误: {}", e))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(format!("JSON 序列化错误: {}", e))
    }
}

/// 便捷类型别名
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_with_tag() {
        let err = AppError::NotFoundError("任务不存在".to_string());
        let json = serde_json::to_string(&err).unwrap();
        // 应序列化为 {"kind":"NotFoundError","message":"任务不存在"}
        assert!(json.contains("NotFoundError"));
        assert!(json.contains("任务不存在"));
    }

    #[test]
    fn from_rusqlite_error() {
        let sqlite_err = rusqlite::Error::InvalidQuery;
        let app_err: AppError = sqlite_err.into();
        assert!(matches!(app_err, AppError::DbError(_)));
    }

    #[test]
    fn internal_helper() {
        let err = AppError::internal("oops");
        assert!(matches!(err, AppError::Internal(_)));
    }
}
