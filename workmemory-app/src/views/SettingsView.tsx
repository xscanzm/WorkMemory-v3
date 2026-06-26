/**
 * 设置视图 (SettingsView) - 04_UI_SPEC.md §5.6 + 01_ARCHITECTURAL_DECISIONS.md
 *
 * - 通用设置分组（卡片）：OpenAI Key / Base URL / Model / 保留天数 / 截图开关 /
 *   向量检索 / Mascot 透明度 / Mascot 活跃频率
 * - 伙伴 (Companion) 分组：9 张形象缩略图 3×3，点击即时写入无需保存
 * - 隐私规则管理：简单新增/删除（本地态）
 * - 初始加载 getSettings / getMascotId
 */
import { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import * as Slider from '@radix-ui/react-slider';
import * as Select from '@radix-ui/react-select';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Check, ChevronDown, Trash2, Plus, Save } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { api } from '@/src-tauri/api';
import type { AppSetting, PrivacyRule } from '@/types';
import MascotSprite from '@/components/mascot/MascotSprite';

/** 扩展 AppSetting，容纳 openai_api_key（KV 扩展字段，AppSetting 类型未含） */
type AppSettingExt = AppSetting & { openai_api_key?: string };

const DEFAULT_SETTINGS: AppSettingExt = {
  saveScreenshots: true,
  retentionDays: 30,
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  embeddingEnabled: true,
  mascotOpacity: 0.9,
  mascotActiveFrequency: 'normal',
  onboardingCompleted: false,
  openai_api_key: '',
};

/** 9 个伙伴形象（04_UI_SPEC.md §5.1） */
const MASCOTS: Array<{ id: number; en: string; zh: string }> = [
  { id: 1, en: 'Boba', zh: '奶茶杯' },
  { id: 2, en: 'Doubao', zh: '豆包少女' },
  { id: 3, en: 'Nyanko v2', zh: '猫咪' },
  { id: 4, en: 'Bolt', zh: '机器人' },
  { id: 5, en: 'Doraemon', zh: '哆啦A梦' },
  { id: 6, en: 'Mochi', zh: '猫咪' },
  { id: 7, en: 'Sabo', zh: '绅士' },
  { id: 8, en: 'EVE', zh: '机器人' },
  { id: 9, en: 'Boxcat', zh: '盒子里的猫' },
];

const MODEL_OPTIONS = [
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
];

const FREQUENCY_OPTIONS = [
  { value: 'high', label: '高频' },
  { value: 'normal', label: '常规' },
  { value: 'low', label: '低频' },
  { value: 'off', label: '关闭' },
];

export default function SettingsView(): JSX.Element {
  const setStoreSettings = useAppStore((s) => s.setSettings);
  const setStoreMascotId = useAppStore((s) => s.setMascotId);
  const storeMascotId = useAppStore((s) => s.mascotId);

  const [form, setForm] = useState<AppSettingExt>(DEFAULT_SETTINGS);
  const [mascotId, setMascotId] = useState<number>(storeMascotId);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loading, setLoading] = useState(true);

  const [rules, setRules] = useState<PrivacyRule[]>([]);
  const [ruleType, setRuleType] = useState<PrivacyRule['ruleType']>('app');
  const [rulePattern, setRulePattern] = useState('');

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getSettings(), api.getMascotId()])
      .then(([s, mid]) => {
        if (cancelled) return;
        setForm({ ...DEFAULT_SETTINGS, ...(s as AppSettingExt) });
        setMascotId(mid);
        setStoreSettings(s);
        setStoreMascotId(mid);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[SettingsView] 加载设置失败', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setStoreSettings, setStoreMascotId]);

  const update = <K extends keyof AppSettingExt>(key: K, value: AppSettingExt[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 将扩展字段 openai_api_key 一并写入（后端按 KV 处理）
      await api.updateSettings(form as AppSetting);
      setStoreSettings(form as AppSetting);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SettingsView] 保存设置失败', err);
    } finally {
      setSaving(false);
    }
  };

  const handlePickMascot = async (id: number) => {
    setMascotId(id);
    setStoreMascotId(id);
    try {
      await api.setMascotId(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SettingsView] setMascotId 失败', err);
    }
  };

  const addRule = () => {
    const pattern = rulePattern.trim();
    if (!pattern) return;
    setRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}`,
        ruleType,
        pattern,
        enabled: true,
      },
    ]);
    setRulePattern('');
  };

  const removeRule = (id: string) =>
    setRules((prev) => prev.filter((r) => r.id !== id));

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: 80, borderRadius: 12, marginBottom: 12 }}
          />
        ))}
      </div>
    );
  }

  return (
    <ScrollArea.Root style={{ height: '100%', overflow: 'hidden' }}>
      <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
        <div
          style={{
            padding: '4px 4px var(--space-2xl) 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-xl)',
            maxWidth: 760,
          }}
        >
          {/* 通用设置 */}
          <Card title="通用设置" subtitle="OpenAI 与本地存储">
            <Field label="OpenAI API Key" hint="存储于本地 settings.openai_api_key">
              <input
                type="password"
                value={form.openai_api_key ?? ''}
                onChange={(e) => update('openai_api_key', e.target.value)}
                placeholder="sk-..."
                style={inputStyle}
              />
            </Field>
            <Field label="OpenAI Base URL">
              <input
                type="text"
                value={form.openaiBaseUrl}
                onChange={(e) => update('openaiBaseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
                style={inputStyle}
              />
            </Field>
            <Field label="OpenAI Model">
              <StyledSelect
                value={form.openaiModel}
                onChange={(v) => update('openaiModel', v)}
                options={MODEL_OPTIONS}
              />
            </Field>
            <Field label="保留天数 (retentionDays)">
              <input
                type="number"
                min={1}
                max={365}
                value={form.retentionDays}
                onChange={(e) =>
                  update('retentionDays', Number(e.target.value) || 0)
                }
                style={{ ...inputStyle, width: 120 }}
              />
            </Field>
            <Field label="保存截图" hint="捕获时是否落盘截图文件">
              <SwitchRow
                checked={form.saveScreenshots}
                onChange={(v) => update('saveScreenshots', v)}
              />
            </Field>
            <Field label="启用向量检索" hint="Embedding 索引，关闭后仅全文检索">
              <SwitchRow
                checked={form.embeddingEnabled}
                onChange={(v) => update('embeddingEnabled', v)}
              />
            </Field>
            <Field label="Mascot 透明度">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <SliderRow
                  value={form.mascotOpacity}
                  onChange={(v) => update('mascotOpacity', v)}
                />
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 40 }}>
                  {form.mascotOpacity.toFixed(2)}
                </span>
              </div>
            </Field>
            <Field label="Mascot 活跃频率">
              <StyledSelect
                value={form.mascotActiveFrequency}
                onChange={(v) =>
                  update(
                    'mascotActiveFrequency',
                    v as AppSetting['mascotActiveFrequency'],
                  )
                }
                options={FREQUENCY_OPTIONS}
              />
            </Field>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: saving ? 'var(--color-border)' : 'var(--color-primary)',
                  color: '#FFFFFF',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                <Save size={14} />
                {saving ? '保存中…' : '保存设置'}
              </button>
              {savedFlash && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--color-success)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Check size={14} /> 已保存
                </span>
              )}
            </div>
          </Card>

          {/* 伙伴选择 */}
          <Card title="伙伴 (Companion)" subtitle="点击即时切换，无需保存">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-md)',
              }}
            >
              {MASCOTS.map((m) => {
                const selected = m.id === mascotId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handlePickMascot(m.id)}
                    title={`${m.en} · ${m.zh}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      padding: 'var(--space-sm) var(--space-xs)',
                      border: selected
                        ? '2px solid var(--color-primary)'
                        : '2px solid transparent',
                      borderRadius: 'var(--radius-md)',
                      background: selected
                        ? 'var(--color-primary-soft)'
                        : 'var(--color-surface-subtle)',
                      cursor: 'pointer',
                      transition:
                        'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo)',
                    }}
                  >
                    <div
                      style={{
                        width: 96,
                        height: 104,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <MascotSprite
                        mascotId={m.id}
                        state="idle"
                        scale={0.5}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: selected
                          ? 'var(--color-primary)'
                          : 'var(--color-text-main)',
                      }}
                    >
                      {m.en}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {m.zh}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* 隐私规则 */}
          <Card title="隐私规则" subtitle="敏感词 / 应用黑名单 / URL 过滤（本地管理）">
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
              <StyledSelect
                value={ruleType}
                onChange={(v) => setRuleType(v as PrivacyRule['ruleType'])}
                options={[
                  { value: 'app', label: '应用' },
                  { value: 'url', label: 'URL' },
                  { value: 'keyword', label: '关键词' },
                ]}
              />
              <input
                type="text"
                value={rulePattern}
                onChange={(e) => setRulePattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRule();
                  }
                }}
                placeholder="输入应用名 / URL / 关键词后回车添加"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="button" onClick={addRule} style={addBtn} title="添加规则">
                <Plus size={14} /> 添加
              </button>
            </div>
            {rules.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-light)',
                  padding: 'var(--space-sm) 0',
                }}
              >
                暂无隐私规则。添加后，匹配的内容将被标记为隐私窗口。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rules.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-sm)',
                      padding: '6px 10px',
                      background: 'var(--color-surface-subtle)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--color-private)',
                        background: 'var(--color-private-soft)',
                        padding: '1px 8px',
                        borderRadius: 'var(--radius-round)',
                        flexShrink: 0,
                      }}
                    >
                      {r.ruleType}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        color: 'var(--color-text-main)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.pattern}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRule(r.id)}
                      title="删除"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--color-text-light)',
                        cursor: 'pointer',
                        padding: 4,
                        display: 'inline-flex',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        orientation="vertical"
        style={{ width: 6, padding: 2, background: 'transparent' }}
      >
        <ScrollArea.Thumb style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 3 }} />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner />
    </ScrollArea.Root>
  );
}

/* ===== 卡片容器 ===== */
function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-lg) var(--space-xl)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-main)' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {children}
      </div>
    </section>
  );
}

/* ===== 字段行 ===== */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-lg)',
        minHeight: 32,
      }}
    >
      <div style={{ minWidth: 0, flex: '0 0 auto' }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-main)' }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--color-text-light)', marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--color-text-main)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  width: '100%',
  maxWidth: 320,
};

/* ===== Radix Switch 封装 ===== */
function SwitchRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      style={{
        width: 36,
        height: 20,
        borderRadius: 9999,
        background: checked ? 'var(--color-primary)' : 'var(--color-border)',
        border: 'none',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <Switch.Thumb
        style={{
          position: 'absolute',
          left: 2,
          top: 2,
          width: 16,
          height: 16,
          borderRadius: 9999,
          background: '#FFFFFF',
          transition: 'transform 150ms var(--ease-out-expo)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          boxShadow: 'var(--shadow-subtle)',
        }}
      />
    </Switch.Root>
  );
}

/* ===== Radix Slider 封装 ===== */
function SliderRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <Slider.Root
      value={[value]}
      min={0}
      max={1}
      step={0.05}
      onValueChange={(v) => onChange(v[0] ?? 0)}
      style={{ flex: 1, height: 20, display: 'flex', alignItems: 'center' }}
    >
      <Slider.Track
        style={{
          position: 'relative',
          flex: 1,
          height: 4,
          background: 'var(--color-border)',
          borderRadius: 2,
        }}
      >
        <Slider.Range
          style={{
            position: 'absolute',
            height: 4,
            background: 'var(--color-primary)',
            borderRadius: 2,
          }}
        />
      </Slider.Track>
      <Slider.Thumb
        style={{
          display: 'block',
          width: 16,
          height: 16,
          borderRadius: 9999,
          background: '#FFFFFF',
          border: '2px solid var(--color-primary)',
          marginLeft: -8,
          cursor: 'grab',
        }}
      />
    </Slider.Root>
  );
}

/* ===== Radix Select 封装 ===== */
function StyledSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}): JSX.Element {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          height: 32,
          minWidth: 140,
          padding: '0 10px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)',
          color: 'var(--color-text-main)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          style={{
            zIndex: 50,
            minWidth: 'var(--radix-select-trigger-width)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-overlay)',
            overflow: 'hidden',
          }}
        >
          <Select.Viewport style={{ padding: 4 }}>
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 10px',
                  fontSize: 13,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  outline: 'none',
                  color: 'var(--color-text-main)',
                }}
              >
                <Select.ItemText>{o.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} style={{ color: 'var(--color-primary)' }} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

const addBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 32,
  padding: '0 12px',
  fontSize: 13,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  flexShrink: 0,
};
