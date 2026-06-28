//! Windows UI Automation (UIA) 客户端封装
//!
//! 用于从浏览器 HWND 读取地址栏 URL，无需浏览器插件。
//! 严格遵循 04_PRODUCT_VISION.md 隐私红线：仅读取前台浏览器地址栏文本，
//! 不读取页面内容、不模拟输入、不截屏。
//!
//! 平台策略：
//! - Windows：使用 `windows::UI::UIAutomation` 真实实现（对应 windows-rs feature `UI_UIAutomation`）
//! - 非 Windows：stub 返回 None，保证 cargo check 通过

// ============================================================
// 跨平台常量与判断函数（供 capture.rs 在所有平台使用）
// ============================================================

/// 浏览器进程白名单（小写匹配）。仅这些进程会触发 UIA 地址栏读取。
pub const BROWSER_PROCESSES: &[&str] = &["msedge.exe", "chrome.exe", "firefox.exe"];

/// 判断进程是否为浏览器（按 process_name 小写匹配白名单）
pub fn is_browser_process(process_name: &str) -> bool {
    let lower = process_name.to_lowercase();
    BROWSER_PROCESSES.iter().any(|p| *p == lower)
}

// ============================================================
// Windows 实现（基于 windows::UI::Automation）
// ============================================================

#[cfg(target_os = "windows")]
pub fn extract_browser_url(hwnd_usize: usize) -> Option<String> {
    use windows::Win32::Foundation::HWND;
    use windows::UI::UIAutomation::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IValueProvider,
    };

    // UIA pattern/property/control type 常量（与 windows::UI::Automation 中的字面值等价）。
    // 使用字面值避免依赖具体常量名是否在该版本 windows-rs 中导出。
    const UIA_VALUE_PATTERN_ID: i32 = 10002;
    const UIA_EDIT_CONTROL_TYPE_ID: i32 = 50004;
    // DFS 最大深度，防止极端情况下遍历整个 UIA 树消耗过多 CPU。
    const MAX_DEPTH: u32 = 5;

    // 包裹 catch_unwind：UIA 系统调用 panic 不应杀死捕获循环
    let result = std::panic::catch_unwind(|| unsafe {
        // 1. 创建 IUIAutomation 实例。
        //    CUIAutomation 是 IUIAutomation 的默认 coclass；其 new() 内部调用
        //    CoCreateInstance。若该 coclass 在当前 windows-rs 版本中未导出，
        //    可改为显式 CoCreateInstance(&CLSID_CUIAutomation, None, CLSCTX_ALL)。
        let uia: IUIAutomation = match CUIAutomation::new() {
            Ok(u) => u,
            Err(e) => {
                log::warn!("UIA 读 URL 失败: {}", e);
                return None;
            }
        };

        // 2. 通过 HWND 创建根 IUIAutomationElement
        let hwnd = HWND(hwnd_usize as *mut std::ffi::c_void);
        let root: IUIAutomationElement = match uia.ElementFromHandle(hwnd) {
            Ok(e) => e,
            Err(e) => {
                log::warn!("UIA 读 URL 失败: {}", e);
                return None;
            }
        };

        // 3. Chrome 地址栏：ClassName == "OmniboxViewViews"
        if let Some(elem) = dfs_find(&root, MAX_DEPTH, &|e| {
            matches_classname(e, "OmniboxViewViews")
        }) {
            if let Some(url) = read_value_pattern(&elem, UIA_VALUE_PATTERN_ID) {
                return Some(url);
            }
        }

        // 4. Edge 地址栏：ClassName == "AriaEdit"
        if let Some(elem) = dfs_find(&root, MAX_DEPTH, &|e| {
            matches_classname(e, "AriaEdit")
        }) {
            if let Some(url) = read_value_pattern(&elem, UIA_VALUE_PATTERN_ID) {
                return Some(url);
            }
        }

        // 5. Edge 退避：ControlType == Edit && AutomationId 包含 "url"
        if let Some(elem) = dfs_find(&root, MAX_DEPTH, &|e| {
            matches_edit_with_automationid(e, "url", UIA_EDIT_CONTROL_TYPE_ID)
        }) {
            if let Some(url) = read_value_pattern(&elem, UIA_VALUE_PATTERN_ID) {
                return Some(url);
            }
        }

        // 6. 通用退避：第一个支持 ValuePattern 的 Edit 控件
        if let Some(elem) = dfs_find(&root, MAX_DEPTH, &|e| {
            matches_edit_with_value_pattern(e, UIA_EDIT_CONTROL_TYPE_ID, UIA_VALUE_PATTERN_ID)
        }) {
            if let Some(url) = read_value_pattern(&elem, UIA_VALUE_PATTERN_ID) {
                return Some(url);
            }
        }

        None
    });
    match result {
        Ok(v) => v,
        Err(payload) => {
            log::error!("uia extract_browser_url 系统调用 panic: {:?}", payload);
            None
        }
    }
}

/// 判断元素的 CurrentClassName 是否等于 target。
#[cfg(target_os = "windows")]
unsafe fn matches_classname(elem: &IUIAutomationElement, target: &str) -> bool {
    match elem.CurrentClassName() {
        Ok(class) => class.to_string() == target,
        Err(_) => false,
    }
}

/// 判断元素是否为 Edit 控件且 AutomationId（小写）包含 substr。
#[cfg(target_os = "windows")]
unsafe fn matches_edit_with_automationid(
    elem: &IUIAutomationElement,
    substr: &str,
    edit_control_type: i32,
) -> bool {
    if elem.CurrentControlType().unwrap_or(0) != edit_control_type {
        return false;
    }
    match elem.CurrentAutomationId() {
        Ok(aid) => aid.to_string().to_lowercase().contains(substr),
        Err(_) => false,
    }
}

/// 判断元素是否为 Edit 控件且支持 ValuePattern（GetCurrentPattern 成功即可）。
#[cfg(target_os = "windows")]
unsafe fn matches_edit_with_value_pattern(
    elem: &IUIAutomationElement,
    edit_control_type: i32,
    value_pattern_id: i32,
) -> bool {
    if elem.CurrentControlType().unwrap_or(0) != edit_control_type {
        return false;
    }
    elem.GetCurrentPattern(value_pattern_id).is_ok()
}

/// 读取元素的 ValuePattern.Value 字符串。失败返回 None。
#[cfg(target_os = "windows")]
unsafe fn read_value_pattern(
    elem: &IUIAutomationElement,
    value_pattern_id: i32,
) -> Option<String> {
    use windows::core::Interface;
    let unknown = elem.GetCurrentPattern(value_pattern_id).ok()?;
    let provider: IValueProvider = unknown.cast().ok()?;
    let value = provider.Value().ok()?;
    Some(value.to_string())
}

/// 通用 DFS 遍历：先判断根节点，再递归直接子节点（GetCurrentChildren）。
/// 返回第一个满足 predicate 的元素。max_depth 为 0 时只判断根节点。
///
/// 使用 `&dyn Fn` 避免递归泛型单态化，并保证 dfs_find 可作为递归入口。
#[cfg(target_os = "windows")]
unsafe fn dfs_find(
    root: &IUIAutomationElement,
    max_depth: u32,
    predicate: &dyn Fn(&IUIAutomationElement) -> bool,
) -> Option<IUIAutomationElement> {
    if predicate(root) {
        return Some(root.clone());
    }
    if max_depth == 0 {
        return None;
    }
    let children = match root.GetCurrentChildren() {
        Ok(c) => c,
        Err(_) => return None,
    };
    let count = children.Length().unwrap_or(0);
    for i in 0..count {
        if let Ok(child) = children.GetElement(i) {
            if let Some(found) = dfs_find(&child, max_depth - 1, predicate) {
                return Some(found);
            }
        }
    }
    None
}

// ============================================================
// 非 Windows stub
// ============================================================
// 固定返回 None，保证 lib.rs 在 Linux 沙箱上通过 cargo check。

#[cfg(not(target_os = "windows"))]
pub fn extract_browser_url(_hwnd_usize: usize) -> Option<String> {
    None
}

// ============================================================
// 单元测试（跨平台：BROWSER_PROCESSES / is_browser_process / stub 路径）
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_browser_process_lowercase_match() {
        assert!(is_browser_process("chrome.exe"));
        assert!(is_browser_process("msedge.exe"));
        assert!(is_browser_process("firefox.exe"));
    }

    #[test]
    fn is_browser_process_case_insensitive() {
        assert!(is_browser_process("CHROME.EXE"));
        assert!(is_browser_process("Chrome.Exe"));
        assert!(is_browser_process("MSEDGE.EXE"));
    }

    #[test]
    fn is_browser_process_non_browser() {
        assert!(!is_browser_process("code.exe"));
        assert!(!is_browser_process("wechat.exe"));
        assert!(!is_browser_process(""));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn stub_returns_none() {
        assert_eq!(extract_browser_url(0), None);
        assert_eq!(extract_browser_url(12345), None);
    }
}
