//! URL 域名/路径解析工具
//!
//! 从完整 URL 提取 domain + path（不含 query/fragment），
//! 用于 distill.rs 在 AI Prompt 中注入"网页上下文：{domain}{path}"前缀。
//!
//! 不依赖外部 crate（如 url），纯字符串解析，覆盖常见浏览器 URL 形态。

/// 从完整 URL 提取 (domain, path)，剥离 query（?...）与 fragment（#...）。
///
/// 返回 `None` 的情形：
/// - 空字符串
/// - `about:blank` 等浏览器内部协议（无 domain）
/// - 无法识别的格式
///
/// # 示例
/// ```
/// # use workmemory_app_lib::core::url_util;
/// assert_eq!(
///     url_util::parse_domain_path("https://github.com/my-org/checkout-core/pull/421/files?diff=1#L10"),
///     Some(("github.com".to_string(), "/my-org/checkout-core/pull/421/files".to_string()))
/// );
/// assert_eq!(
///     url_util::parse_domain_path("http://localhost:3000/dashboard"),
///     Some(("localhost:3000".to_string(), "/dashboard".to_string()))
/// );
/// assert_eq!(
///     url_util::parse_domain_path("chrome-extension://abc123/options.html"),
///     Some(("abc123".to_string(), "/options.html".to_string()))
/// );
/// assert_eq!(
///     url_util::parse_domain_path("about:blank"),
///     None
/// );
/// ```
pub fn parse_domain_path(url: &str) -> Option<(String, String)> {
    // 1. Trim leading/trailing whitespace.
    let url = url.trim();
    // 2. If empty, return None.
    if url.is_empty() {
        return None;
    }
    // 3. Strip query: find first `?`, take substring before it.
    let url = url.split('?').next().unwrap_or(url);
    // 4. Strip fragment: find first `#`, take substring before it.
    let url = url.split('#').next().unwrap_or(url);
    // 5. Handle `about:` 浏览器内部协议（无 domain）→ None。
    if url.starts_with("about:") {
        return None;
    }
    // 6. Handle `file://` URLs → None（无 domain，本地文件）。
    if url.starts_with("file://") {
        return None;
    }
    // 7. Handle `chrome-extension://` URLs：扩展 ID 作为 domain。
    if let Some(rest) = url.strip_prefix("chrome-extension://") {
        return split_domain_path(rest);
    }
    // 8. Handle standard `scheme://` URLs（http, https, ftp, ws, wss）。
    if let Some(idx) = url.find("://") {
        let after = &url[idx + 3..];
        return split_domain_path(after);
    }
    // 9. Fallback（无 `://`）：直接当作 `domain/path` 处理。
    split_domain_path(url)
}

/// 将 `domain/path`（或仅 `domain`）拆分为 (domain, path)。
/// 无 `/` 时 path 默认为 "/"；输入为空或 domain 为空时返回 None。
fn split_domain_path(s: &str) -> Option<(String, String)> {
    if s.is_empty() {
        return None;
    }
    match s.find('/') {
        Some(idx) => {
            let domain = &s[..idx];
            let path = &s[idx..];
            if domain.is_empty() {
                return None;
            }
            Some((domain.to_string(), path.to_string()))
        }
        None => Some((s.to_string(), "/".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_domain_path;

    #[test]
    fn https_with_query_and_fragment() {
        assert_eq!(
            parse_domain_path("https://github.com/path?query#fragment"),
            Some(("github.com".to_string(), "/path".to_string()))
        );
    }

    #[test]
    fn https_no_path() {
        assert_eq!(
            parse_domain_path("https://github.com"),
            Some(("github.com".to_string(), "/".to_string()))
        );
    }

    #[test]
    fn https_root_path() {
        assert_eq!(
            parse_domain_path("https://github.com/"),
            Some(("github.com".to_string(), "/".to_string()))
        );
    }

    #[test]
    fn http_with_port() {
        assert_eq!(
            parse_domain_path("http://localhost:3000/dashboard"),
            Some(("localhost:3000".to_string(), "/dashboard".to_string()))
        );
    }

    #[test]
    fn chrome_extension() {
        assert_eq!(
            parse_domain_path("chrome-extension://abc/options.html"),
            Some(("abc".to_string(), "/options.html".to_string()))
        );
    }

    #[test]
    fn about_blank() {
        assert_eq!(parse_domain_path("about:blank"), None);
    }

    #[test]
    fn file_url() {
        assert_eq!(parse_domain_path("file:///home/user/file.txt"), None);
    }

    #[test]
    fn empty_string() {
        assert_eq!(parse_domain_path(""), None);
    }

    #[test]
    fn no_scheme_with_path() {
        assert_eq!(
            parse_domain_path("github.com/foo/bar"),
            Some(("github.com".to_string(), "/foo/bar".to_string()))
        );
    }

    #[test]
    fn no_scheme_no_path() {
        assert_eq!(
            parse_domain_path("github.com"),
            Some(("github.com".to_string(), "/".to_string()))
        );
    }

    #[test]
    fn whitespace_trimmed() {
        assert_eq!(
            parse_domain_path("  https://example.com/path  "),
            Some(("example.com".to_string(), "/path".to_string()))
        );
    }

    #[test]
    fn spec_example_pr_url() {
        assert_eq!(
            parse_domain_path("https://github.com/my-org/checkout-core/pull/421/files?diff=1#L10"),
            Some((
                "github.com".to_string(),
                "/my-org/checkout-core/pull/421/files".to_string()
            ))
        );
    }

    #[test]
    fn chrome_extension_no_path() {
        assert_eq!(
            parse_domain_path("chrome-extension://abc123"),
            Some(("abc123".to_string(), "/".to_string()))
        );
    }

    #[test]
    fn about_other_internal_protocol() {
        assert_eq!(parse_domain_path("about:settings"), None);
    }

    #[test]
    fn fragment_only_no_path() {
        assert_eq!(
            parse_domain_path("https://example.com#section"),
            Some(("example.com".to_string(), "/".to_string()))
        );
    }

    #[test]
    fn query_only_no_path() {
        assert_eq!(
            parse_domain_path("https://example.com?q=1"),
            Some(("example.com".to_string(), "/".to_string()))
        );
    }
}
