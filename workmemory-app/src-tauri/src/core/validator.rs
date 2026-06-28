//! IPC 参数统一校验层
//! 在数据进入 Repository 前完成边界过滤，非法参数返回 AppError::ValidationError

use crate::core::error::{AppError, AppResult};

/// 标题长度校验：1-200 字符
pub fn validate_title(s: &str) -> AppResult<()> {
    let len = s.chars().count();
    if len == 0 {
        return Err(AppError::ValidationError("标题不能为空".to_string()));
    }
    if len > 200 {
        return Err(AppError::ValidationError(format!("标题长度不能超过 200 字符，当前: {}", len)));
    }
    Ok(())
}

/// 内容长度校验：0-50000 字符
pub fn validate_content(s: &str) -> AppResult<()> {
    let len = s.chars().count();
    if len > 50000 {
        return Err(AppError::ValidationError(format!("内容长度不能超过 50000 字符，当前: {}", len)));
    }
    Ok(())
}

/// 分页参数校验：offset >= 0, limit in 1..=500
pub fn validate_pagination(offset: Option<i64>, limit: Option<i64>) -> AppResult<()> {
    if let Some(o) = offset {
        if o < 0 {
            return Err(AppError::ValidationError(format!("offset 不能为负数，收到: {}", o)));
        }
    }
    if let Some(l) = limit {
        if l < 1 {
            return Err(AppError::ValidationError(format!("limit 必须 >= 1，收到: {}", l)));
        }
        if l > 500 {
            return Err(AppError::ValidationError(format!("limit 不能超过 500，收到: {}", l)));
        }
    }
    Ok(())
}

/// UUID 格式校验（uuid v4 格式：8-4-4-4-12 hex）
pub fn validate_uuid(s: &str) -> AppResult<()> {
    if s.is_empty() {
        return Err(AppError::ValidationError("UUID 不能为空".to_string()));
    }
    // 使用 uuid crate 解析验证
    if uuid::Uuid::parse_str(s).is_err() {
        return Err(AppError::ValidationError(format!("无效的 UUID 格式: {}", s)));
    }
    Ok(())
}

/// 月份校验：1-12
pub fn validate_month(m: i32) -> AppResult<()> {
    if !(1..=12).contains(&m) {
        return Err(AppError::ValidationError(format!("月份必须在 1-12 范围，收到: {}", m)));
    }
    Ok(())
}

/// 年份校验：1900-2100
pub fn validate_year(y: i32) -> AppResult<()> {
    if !(1900..=2100).contains(&y) {
        return Err(AppError::ValidationError(format!("年份必须在 1900-2100 范围，收到: {}", y)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_valid() {
        assert!(validate_title("hello").is_ok());
        assert!(validate_title(&"a".repeat(200)).is_ok());
    }

    #[test]
    fn title_empty_rejected() {
        assert!(validate_title("").is_err());
    }

    #[test]
    fn title_too_long_rejected() {
        assert!(validate_title(&"a".repeat(201)).is_err());
    }

    #[test]
    fn content_boundary() {
        assert!(validate_content("").is_ok());
        assert!(validate_content(&"a".repeat(50000)).is_ok());
        assert!(validate_content(&"a".repeat(50001)).is_err());
    }

    #[test]
    fn pagination_valid() {
        assert!(validate_pagination(Some(0), Some(100)).is_ok());
        assert!(validate_pagination(None, None).is_ok());
    }

    #[test]
    fn pagination_negative_offset_rejected() {
        assert!(validate_pagination(Some(-1), Some(10)).is_err());
    }

    #[test]
    fn pagination_limit_boundary() {
        assert!(validate_pagination(Some(0), Some(500)).is_ok());
        assert!(validate_pagination(Some(0), Some(501)).is_err());
        assert!(validate_pagination(Some(0), Some(0)).is_err());
    }

    #[test]
    fn uuid_valid() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn uuid_invalid() {
        assert!(validate_uuid("not-a-uuid").is_err());
        assert!(validate_uuid("").is_err());
    }

    #[test]
    fn month_valid() {
        for m in 1..=12 {
            assert!(validate_month(m).is_ok());
        }
    }

    #[test]
    fn month_invalid() {
        assert!(validate_month(0).is_err());
        assert!(validate_month(13).is_err());
        assert!(validate_month(-1).is_err());
    }
}
