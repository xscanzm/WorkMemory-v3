// 国际化类型定义（Task 19）
// 支持的语言枚举与翻译字典结构。
export type Locale = 'zh-CN' | 'en-US';

export interface TranslationMap {
  [key: string]: string;
}
