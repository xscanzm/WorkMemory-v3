//! WinRT OCR 引擎封装与后台队列
//!
//! 严格遵循：
//! - `03_CORE_ARCHITECTURE.md` §2.1：OCR 后台队列，并发上限 = 2
//! - `01_ARCHITECTURAL_DECISIONS.md` §2：仅使用 Windows 原生 WinRT Media.Ocr，
//!   **完全禁用 PaddleOCR**
//!
//! 平台策略：
//! - Windows：调用 `windows::Media::Ocr::OcrEngine` 真实识别
//! - 非 Windows：提供 stub，保证 `cargo check` 通过

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{mpsc, Semaphore};

/// OCR 队列并发上限（硬约束：严格 = 2）
const OCR_CONCURRENCY: usize = 2;

/// OCR 任务单元：由 capture 模块捕获截图后入队
pub struct OcrTask {
    pub segment_id: String,
    pub image_rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// 单个 OCR 单词的几何信息
#[derive(Debug, Clone)]
pub struct OcrWordInfo {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 单行 OCR 单词集合（保留原始行分组，便于后续双栏重建）
#[derive(Debug, Clone)]
pub struct OcrLineInfo {
    pub words: Vec<OcrWordInfo>,
}

/// 启动 OCR worker，返回 `Sender` 供 capture 模块入队
///
/// 内部创建容量 64 的 mpsc channel，并 spawn `run_ocr_queue` 消费队列。
pub fn spawn_ocr_worker(app: tauri::AppHandle) -> mpsc::Sender<OcrTask> {
    let (tx, rx) = mpsc::channel::<OcrTask>(64);
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_ocr_queue(app_handle, rx).await;
    });
    tx
}

/// 消费 OCR 队列：用 `Semaphore` 限制并发 = 2，对每个任务执行
/// `recognize` → `clean_text` → 写回 `segments.ocr_text` / `ocr_status`
///
/// DB 访问通过 `app.state::<std::sync::Mutex<rusqlite::Connection>>()`。
pub async fn run_ocr_queue(app: tauri::AppHandle, mut rx: mpsc::Receiver<OcrTask>) {
    let semaphore = Arc::new(Semaphore::new(OCR_CONCURRENCY));
    log::info!("OCR 队列启动，并发上限 = {}", OCR_CONCURRENCY);

    while let Some(task) = rx.recv().await {
        // 在派发前获取许可：天然背压，保证全局并发严格 <= OCR_CONCURRENCY
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                log::error!("OCR 信号量已关闭，丢弃 segment={}", task.segment_id);
                continue;
            }
        };

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // _permit 持有至任务结束，结束时自动释放，唤醒下一个排队任务
            let _permit = permit;

            log::debug!(
                "OCR 开始 segment={} {}x{}",
                task.segment_id, task.width, task.height
            );

            match recognize(&task.image_rgba, task.width, task.height).await {
                Some(lines) => {
                    // 双栏几何重建 → 文本清洗 → 写回 DB
                    let raw = reconstruct_columns(&lines);
                    let cleaned = clean_text(&raw);
                    persist_ocr_result(&app_handle, &task.segment_id, &cleaned, "done");
                    log::info!(
                        "OCR 完成 segment={} 清洗后文本长度={}",
                        task.segment_id,
                        cleaned.len()
                    );
                }
                None => {
                    persist_ocr_result(&app_handle, &task.segment_id, "", "failed");
                    log::warn!("OCR 失败 segment={}", task.segment_id);
                }
            }
        });
    }

    log::info!("OCR 队列接收端关闭，worker 退出");
}

/// 将 OCR 结果写回 `segments` 表（`ocr_text` + `ocr_status`）
fn persist_ocr_result(app: &tauri::AppHandle, segment_id: &str, ocr_text: &str, status: &str) {
    let state = app.state::<std::sync::Mutex<rusqlite::Connection>>();
    let conn = match state.lock() {
        Ok(guard) => guard,
        Err(e) => {
            log::error!("DB Mutex poisoned，无法写回 OCR 结果: {}", e);
            return;
        }
    };

    let sql = "UPDATE segments SET ocr_text = ?1, ocr_status = ?2 WHERE id = ?3";
    match conn.execute(sql, rusqlite::params![ocr_text, status, segment_id]) {
        Ok(affected) => log::debug!(
            "写回 segment={} status={} 影响行数={}",
            segment_id,
            status,
            affected
        ),
        Err(e) => log::error!("写回 OCR 结果失败 segment={}: {}", segment_id, e),
    }
}

// ============================================================================
// 文本清洗（跨平台）
// ============================================================================

/// 清洗 OCR 原始文本：
/// 1. 逐行修剪（保留空行）
/// 2. 丢弃仅含 OCR 噪音字符的行（□ ■ ● 等）
/// 3. 丢弃纯符号分隔行（--- === *** 等）
/// 4. 去除单字符噪点行（保留空行用于段落结构）
/// 5. 合并被换行打断的句子：行尾无终止标点 **且** 下一行首字符非「大写字母 / 中文」时拼接
/// 6. 3+ 连续空行折叠为 1 个空行（保留段落结构）
/// 「确定」「取消」等 2 字按钮标签因长度 > 1 自然保留
pub fn clean_text(raw: &str) -> String {
    // 1. 逐行修剪（保留空行用于后续段落结构处理）
    let mut lines: Vec<String> = raw
        .lines()
        .map(|l| l.trim().to_string())
        .collect();

    // 2. 丢弃仅含 OCR 噪音字符的行
    lines.retain(|l| !is_noise_only_line(l));

    // 3. 丢弃纯符号分隔行
    lines.retain(|l| !is_pure_separator_line(l));

    // 4. 去除单字符噪点行（保留空行）
    lines.retain(|l| l.is_empty() || l.chars().count() > 1);

    // 5. 合并被换行打断的句子
    let mut merged: Vec<String> = Vec::with_capacity(lines.len());
    for line in lines {
        let do_merge = match merged.last() {
            Some(prev) => !ends_with_terminal_punct(prev) && !starts_with_upper_or_cjk(&line),
            None => false,
        };
        if do_merge {
            if let Some(prev) = merged.last_mut() {
                // 两侧均为 ASCII（非中文）时补一个空格以还原英文换行丢失的词间距；
                // 涉及中文的衔接直接拼接（中文不需要空格）
                let both_ascii = matches!(
                    (prev.chars().last(), line.chars().next()),
                    (Some(a), Some(b)) if !is_cjk(a) && !is_cjk(b)
                );
                if both_ascii {
                    prev.push(' ');
                }
                prev.push_str(&line);
            }
        } else {
            merged.push(line);
        }
    }

    // 6. 3+ 连续空行折叠为 1 个空行（保留段落结构）
    let mut result: Vec<String> = Vec::with_capacity(merged.len());
    let mut i = 0;
    let n = merged.len();
    while i < n {
        if merged[i].is_empty() {
            let mut run_end = i;
            while run_end < n && merged[run_end].is_empty() {
                run_end += 1;
            }
            let run_len = run_end - i;
            if run_len >= 3 {
                result.push(String::new());
            } else {
                for _ in 0..run_len {
                    result.push(String::new());
                }
            }
            i = run_end;
        } else {
            result.push(merged[i].clone());
            i += 1;
        }
    }

    result.join("\n")
}

/// 行内是否仅含 OCR 噪音字符（□ ■ ● ˇ ￣ ◇ ◆ ★ ☆ ♪ ♫ 等）
fn is_noise_only_line(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }
    line.chars().all(|c| {
        matches!(c, '□' | '■' | '●' | 'ˇ' | '￣' | '◇' | '◆' | '★' | '☆'
            | '♪' | '♫' | '▪' | '▫' | '◦' | '○' | '◎' | '•' | '‧' | '※'
            | '☆' | '✦' | '✧' | '✩' | '✪' | '✫' | '✬' | '✭' | '✮')
        || c.is_whitespace()
    })
}

/// 行内是否仅由 ≤ 2 种分隔符号重复组成且长度 ≥ 3（如 --- === ***）
fn is_pure_separator_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.len() < 3 {
        return false;
    }
    let mut distinct_symbols: std::collections::HashSet<char> = std::collections::HashSet::new();
    for c in trimmed.chars() {
        if matches!(c, '-' | '=' | '*' | '_' | '~' | '·' | '•' | '^' | '#' | '+' | '|') {
            distinct_symbols.insert(c);
        } else if !c.is_whitespace() {
            return false;
        }
    }
    distinct_symbols.len() <= 2 && !distinct_symbols.is_empty()
}

/// 行尾是否为终止标点（中英文句末标点）
fn ends_with_terminal_punct(s: &str) -> bool {
    match s.chars().last() {
        Some(c) => matches!(
            c,
            '。' | '！' | '？' | '；' | '：' | '，' | '、' | '．' | '…'
                | '.' | '!' | '?' | ';' | ':' | ','
        ),
        None => true,
    }
}

/// 行首是否为「大写 ASCII 字母 或 中文字符」——若是则视为新句 / 新段，不与前文拼接
fn starts_with_upper_or_cjk(s: &str) -> bool {
    match s.chars().next() {
        Some(c) => c.is_ascii_uppercase() || is_cjk(c),
        None => true,
    }
}

/// 是否为 CJK 统一表意文字（基本区 U+4E00..U+9FFF）
fn is_cjk(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c)
}

// ============================================================================
// 双栏布局重建（跨平台）
// ============================================================================

/// 按 X 坐标直方图判定单栏/双栏，重建 OCR 文本布局
///
/// 算法（spec §五 WinRT OCR 双栏布局重建）：
/// 1. 展平所有 `OcrWordInfo`，按 50px 分桶统计 X 坐标直方图
/// 2. 扫描直方图寻找满足条件的空白带（>= 2 个连续空桶且像素宽度 >= 80px，
///    两侧均有 word）→ 双栏；否则单栏
/// 3. 单栏：按 Y 升序逐行输出（同一 Y 容差 20px 内的 word 合并为一行）
/// 4. 双栏：左组按 Y 排序输出，加 `[左栏]` 标记；右组同理，加 `[右栏]` 标记，
///    栏间用空行隔离
pub fn reconstruct_columns(lines: &[OcrLineInfo]) -> String {
    // 1. 展平所有 word
    let all_words: Vec<&OcrWordInfo> = lines.iter().flat_map(|l| l.words.iter()).collect();
    if all_words.is_empty() {
        return String::new();
    }

    // 2. 构建 X 坐标直方图（50px 分桶）
    let mut max_bucket: usize = 0;
    let mut bucket_counts: std::collections::HashMap<usize, usize> =
        std::collections::HashMap::new();
    for w in &all_words {
        let bucket = (w.x / 50.0).floor() as usize;
        *bucket_counts.entry(bucket).or_insert(0) += 1;
        if bucket > max_bucket {
            max_bucket = bucket;
        }
    }

    // 3. 扫描直方图寻找满足条件的空白带
    let mut gap_start_pixel: Option<f64> = None;
    let mut gap_end_pixel: Option<f64> = None;
    let mut i = 0usize;
    while i <= max_bucket {
        let count = *bucket_counts.get(&i).unwrap_or(&0);
        if count == 0 {
            // 找到一段连续空桶 [run_start, run_end]
            let run_start = i;
            let mut run_end = i;
            while run_end + 1 <= max_bucket
                && *bucket_counts.get(&(run_end + 1)).unwrap_or(&0) == 0
            {
                run_end += 1;
            }
            let empty_count = run_end - run_start + 1;
            let pixel_span = (empty_count * 50) as f64;
            // 空白带不能位于边缘：两侧均需有 word
            let has_before = (0..run_start).any(|b| *bucket_counts.get(&b).unwrap_or(&0) > 0);
            let has_after = ((run_end + 1)..=max_bucket)
                .any(|b| *bucket_counts.get(&b).unwrap_or(&0) > 0);
            if empty_count >= 2 && pixel_span >= 80.0 && has_before && has_after {
                gap_start_pixel = Some((run_start * 50) as f64);
                gap_end_pixel = Some(((run_end + 1) * 50) as f64);
                break;
            }
            i = run_end + 1;
        } else {
            i += 1;
        }
    }

    match (gap_start_pixel, gap_end_pixel) {
        (Some(start_px), Some(end_px)) => {
            // 双栏：左组 x < start_px，右组 x >= end_px（空白带内无 word）
            let left: Vec<&OcrWordInfo> = all_words
                .iter()
                .copied()
                .filter(|w| w.x < start_px)
                .collect();
            let right: Vec<&OcrWordInfo> = all_words
                .iter()
                .copied()
                .filter(|w| w.x >= end_px)
                .collect();
            let left_text = group_words_into_rows(&left).join("\n");
            let right_text = group_words_into_rows(&right).join("\n");
            format!("[左栏]\n{}\n\n[右栏]\n{}", left_text, right_text)
        }
        _ => {
            // 单栏：按 Y 升序逐行输出
            group_words_into_rows(&all_words).join("\n")
        }
    }
}

/// 将 word 按 Y 容差（20px）聚合成行，行内按 X 升序拼接
fn group_words_into_rows(words: &[&OcrWordInfo]) -> Vec<String> {
    if words.is_empty() {
        return Vec::new();
    }
    let mut sorted: Vec<&OcrWordInfo> = words.to_vec();
    sorted.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut rows: Vec<Vec<&OcrWordInfo>> = Vec::new();
    for w in sorted {
        // 与当前行锚点（首词 Y）差值 > 20px 则新起一行
        let start_new = match rows.last().and_then(|r| r.first()) {
            Some(anchor) => (w.y - anchor.y).abs() > 20.0,
            None => true,
        };
        if start_new {
            rows.push(vec![w]);
        } else if let Some(row) = rows.last_mut() {
            row.push(w);
        }
    }

    rows.into_iter()
        .map(|mut row| {
            row.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
            row.iter()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

// ============================================================================
// Windows：WinRT Media.Ocr 真实实现
// ============================================================================
#[cfg(target_os = "windows")]
mod winrt_impl {
    use super::{OcrLineInfo, OcrWordInfo};
    use windows::core::Interface;
    use windows::Foundation::{IBuffer, IMemoryBufferByteAccess, MemoryBuffer};
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;

    /// 调用 WinRT Media.Ocr 识别 RGBA 像素，返回 word 级几何信息（按行分组）
    pub(super) async fn recognize_inner(
        rgba: &[u8],
        width: u32,
        height: u32,
    ) -> windows::core::Result<Vec<OcrLineInfo>> {
        // 1) RGBA → BGRA：WinRT SoftwareBitmap 使用 Bgra8 格式，逐像素交换 R / B 通道
        let mut bgra = rgba.to_vec();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        // 2) 装入 MemoryBuffer（实现 IBuffer），经 IMemoryBufferByteAccess 写入像素字节
        let len = bgra.len();
        let memory_buffer = MemoryBuffer::new(len as u32)?;
        let reference = memory_buffer.CreateReference()?;
        let byte_access: IMemoryBufferByteAccess = reference.cast()?;
        let mut data_ptr: *mut u8 = std::ptr::null_mut();
        let mut capacity: u32 = 0;
        unsafe {
            byte_access.GetBuffer(&mut data_ptr, &mut capacity)?;
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), data_ptr, len);
        }

        // 3) 创建带 Alpha 的 SoftwareBitmap（Bgra8，每像素 4 字节，同步拷贝）
        let ibuffer: IBuffer = memory_buffer.cast()?;
        let software_bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &ibuffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )?;

        // 4) 获取 OCR 引擎：优先 zh-Hans-CN（支持中文），失败回退用户配置语言（覆盖英文 OS）
        let engine = (|| {
            let lang_id = windows::core::HSTRING::from("zh-Hans-CN");
            let lang = Language::CreateLanguage(&lang_id)?;
            OcrEngine::TryCreateFromLanguage(&lang)
        })()
        .or_else(|e| {
            log::warn!("zh-Hans-CN OCR 引擎不可用（{}），回退用户配置语言", e);
            OcrEngine::TryCreateFromUserProfileLanguages()
        })?;

        // 5) 异步识别：IAsyncOperation<OcrResult> 由 windows-rs 转为 Future，可直接 await
        let result = engine.RecognizeAsync(&software_bitmap).await?;

        // 6) 遍历 Lines → Words，提取 word 级几何信息
        let mut lines: Vec<OcrLineInfo> = Vec::new();
        for line in result.Lines()? {
            let mut words: Vec<OcrWordInfo> = Vec::new();
            for word in line.Words()? {
                let text = word.Text()?.to_string();
                let rect = word.BoundingRect()?;
                words.push(OcrWordInfo {
                    text,
                    x: rect.X as f64,
                    y: rect.Y as f64,
                    width: rect.Width as f64,
                    height: rect.Height as f64,
                });
            }
            lines.push(OcrLineInfo { words });
        }

        Ok(lines)
    }
}

/// Windows 平台：调用 WinRT Media.Ocr，返回 word 级几何信息
#[cfg(target_os = "windows")]
pub async fn recognize(rgba: &[u8], width: u32, height: u32) -> Option<Vec<OcrLineInfo>> {
    match winrt_impl::recognize_inner(rgba, width, height).await {
        Ok(lines) => Some(lines),
        Err(e) => {
            log::warn!("WinRT OCR 识别失败: {}", e);
            None
        }
    }
}

// ============================================================================
// 非 Windows 平台：stub，保证 cargo check 通过
// ============================================================================
#[cfg(not(target_os = "windows"))]
pub async fn recognize(_rgba: &[u8], _width: u32, _height: u32) -> Option<Vec<OcrLineInfo>> {
    Some(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_text_drops_noise_line() {
        assert_eq!(clean_text("□ □ □\nhello"), "hello");
    }

    #[test]
    fn test_clean_text_drops_separator_line_dash() {
        assert_eq!(clean_text("---\nhello"), "hello");
    }

    #[test]
    fn test_clean_text_drops_separator_line_equals() {
        assert_eq!(clean_text("=== === ===\nhello"), "hello");
    }

    #[test]
    fn test_clean_text_preserves_2char_lines() {
        assert_eq!(clean_text("确定\n取消"), "确定\n取消");
    }

    #[test]
    fn test_clean_text_collapses_5_newlines_to_1_empty() {
        assert_eq!(clean_text("line1\n\n\n\n\nline2"), "line1\n\nline2");
    }

    #[test]
    fn test_clean_text_preserves_single_empty_line() {
        assert_eq!(clean_text("line1\n\nline2"), "line1\n\nline2");
    }

    #[test]
    fn test_is_noise_only_line_noise() {
        assert!(is_noise_only_line("□ □ □"));
    }

    #[test]
    fn test_is_noise_only_line_text() {
        assert!(!is_noise_only_line("hello"));
    }

    #[test]
    fn test_is_pure_separator_line_dash() {
        assert!(is_pure_separator_line("---"));
    }

    #[test]
    fn test_is_pure_separator_line_equals() {
        assert!(is_pure_separator_line("==="));
    }

    #[test]
    fn test_is_pure_separator_line_asterisk() {
        assert!(is_pure_separator_line("***"));
    }

    #[test]
    fn test_is_pure_separator_line_text() {
        assert!(!is_pure_separator_line("hello"));
    }

    #[test]
    fn test_is_pure_separator_line_short() {
        assert!(!is_pure_separator_line("--"));
    }

    #[test]
    fn test_is_pure_separator_line_3_distinct() {
        // Spec test case lists "---===---" (2 distinct separators) → false
        // with description "(3 distinct symbols)". The input only has 2 distinct
        // separators, so per the spec helper (<= 2) it would return true.
        // Using "---===***" (3 distinct separators) to match the "3 distinct
        // symbols → false" intent described in the task spec.
        assert!(!is_pure_separator_line("---===***"));
    }

    fn make_word(text: &str, x: f64, y: f64) -> OcrWordInfo {
        OcrWordInfo {
            text: text.to_string(),
            x,
            y,
            width: 10.0,
            height: 10.0,
        }
    }

    fn make_line(words: Vec<OcrWordInfo>) -> OcrLineInfo {
        OcrLineInfo { words }
    }

    #[test]
    fn test_reconstruct_columns_empty() {
        assert_eq!(reconstruct_columns(&[]), "");
    }

    #[test]
    fn test_reconstruct_columns_single_column() {
        // 所有 word 的 X 都在 [0..400]，单峰分布
        let lines = vec![
            make_line(vec![
                make_word("Hello", 10.0, 10.0),
                make_word("World", 100.0, 10.0),
            ]),
            make_line(vec![make_word("Foo", 50.0, 50.0)]),
            make_line(vec![
                make_word("Bar", 20.0, 90.0),
                make_word("Baz", 200.0, 90.0),
            ]),
        ];
        let result = reconstruct_columns(&lines);
        assert!(!result.contains("[左栏]"));
        assert!(!result.contains("[右栏]"));
        // Y=10 行：Hello World（X 升序 10, 100）；Y=50 行：Foo；Y=90 行：Bar Baz
        assert_eq!(result, "Hello World\nFoo\nBar Baz");
    }

    #[test]
    fn test_reconstruct_columns_dual_column() {
        // 左簇 X [0..400]，右簇 X [500..1000]，中间存在稳定空白带
        let lines = vec![
            make_line(vec![
                make_word("Left1", 10.0, 10.0),
                make_word("Right1", 510.0, 10.0),
            ]),
            make_line(vec![
                make_word("Left2", 100.0, 50.0),
                make_word("Right2", 600.0, 50.0),
            ]),
            make_line(vec![
                make_word("Left3", 200.0, 90.0),
                make_word("Right3", 700.0, 90.0),
            ]),
        ];
        let result = reconstruct_columns(&lines);
        assert!(result.contains("[左栏]"));
        assert!(result.contains("[右栏]"));
        // 左栏 word 必须出现在 [左栏] 之后、[右栏] 之前
        let left_idx = result.find("[左栏]").unwrap();
        let right_idx = result.find("[右栏]").unwrap();
        let left_section = &result[left_idx..right_idx];
        assert!(left_section.contains("Left1"));
        assert!(left_section.contains("Left2"));
        assert!(left_section.contains("Left3"));
        assert!(!left_section.contains("Right1"));
        let right_section = &result[right_idx..];
        assert!(right_section.contains("Right1"));
        assert!(right_section.contains("Right2"));
        assert!(right_section.contains("Right3"));
    }

    #[test]
    fn test_reconstruct_columns_row_grouping_y_tolerance() {
        // Y=10, Y=15（容差 20px 内，同一行），Y=50（新行）
        let lines = vec![make_line(vec![
            make_word("a", 10.0, 10.0),
            make_word("b", 50.0, 15.0),
            make_word("c", 90.0, 50.0),
        ])];
        let result = reconstruct_columns(&lines);
        assert!(!result.contains("[左栏]"));
        // 应形成 2 行："a b" 与 "c"
        assert_eq!(result, "a b\nc");
    }

    #[test]
    fn test_reconstruct_columns_row_word_ordering_by_x() {
        // 同一行内 X=100, X=50, X=200 → 排序后 "word50 word100 word200"
        let lines = vec![make_line(vec![
            make_word("word100", 100.0, 10.0),
            make_word("word50", 50.0, 10.0),
            make_word("word200", 200.0, 10.0),
        ])];
        let result = reconstruct_columns(&lines);
        assert_eq!(result, "word50 word100 word200");
    }
}
