/**
 * 浏览器文件下载工具 (Task 24.2 / 24.3)
 *
 * 在 Tauri WebView 中通过 Blob + 临时 <a download> 触发下载。
 * 注意：Tauri 2.x 的 webview 支持 <a download> 属性，文件会落到用户默认下载目录。
 */

/**
 * 将文本内容作为文件下载。
 *
 * @param filename 下载文件名（含扩展名，如 `workmemory-export.json`）
 * @param content 文件文本内容
 * @param mimeType MIME 类型，如 `application/json` / `text/csv`
 */
export function downloadText(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // 清理：移除节点并释放 ObjectURL
  document.body.removeChild(a);
  // 延迟释放，确保下载已触发
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 当前时间戳，用于生成带日期的导出文件名 */
export function timestampForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}`;
}
