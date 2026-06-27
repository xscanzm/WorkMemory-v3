// 国际化上下文与 Hook（Task 19）
// 轻量级方案：React Context + localStorage 持久化，零外部依赖。
// 翻译查找失败时回退到 key 本身；支持 {name} 占位符插值。
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Locale, TranslationMap } from './types';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

const LOCALE_MAP: Record<Locale, TranslationMap> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'workmemory.locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved =
      typeof localStorage !== 'undefined'
        ? (localStorage.getItem(STORAGE_KEY) as Locale | null)
        : null;
    return saved && saved in LOCALE_MAP ? saved : 'zh-CN';
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const map = LOCALE_MAP[locale];
      let str = map[key] ?? key; // 找不到则回退到 key 本身
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
