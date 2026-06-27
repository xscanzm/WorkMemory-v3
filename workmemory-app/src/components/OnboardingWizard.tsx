/**
 * 引导向导 (OnboardingWizard) - Task 23.4
 *
 * 多步骤模态（4 步）：欢迎 → 选择宠物形象 → 创建首个任务 → 体验专注计时
 * - 使用 Radix Dialog（已在 deps）
 * - 完成后写入 localStorage('workmemory.onboardingComplete') = 'true'，首次启动后不再自动弹出
 * - 暴露 reopenOnboarding() 供 SettingsView "重新引导" 按钮触发重放
 * - App/MainLayout 挂载一次即可；自动检测 localStorage 决定是否显示
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { usePetStore } from '@/store/petStore';
import { useTaskStore } from '@/store/taskStore';
import { useAppStore } from '@/store/useAppStore';
import { api } from '@/src-tauri/api';
import { toast } from '@/store/toastStore';

const STORAGE_KEY = 'workmemory.onboardingComplete';
const REOPEN_EVENT = 'workmemory:reopen-onboarding';

/** 触发重新引导（SettingsView 调用） */
export function reopenOnboarding(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REOPEN_EVENT));
  }
}

/** 9 个可选形象（与 PetView / SettingsView 一致） */
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

const STEP_TITLES = ['欢迎', '选择伙伴', '创建首个任务', '体验专注'];

export default function OnboardingWizard(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) !== 'true';
  });
  const [step, setStep] = useState(0);

  // 监听重新引导事件
  useEffect(() => {
    const handler = (): void => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(REOPEN_EVENT, handler);
    return () => window.removeEventListener(REOPEN_EVENT, handler);
  }, []);

  const finish = (): void => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    setOpen(false);
  };

  const next = (): void => setStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
  const back = (): void => setStep((s) => Math.max(s - 1, 0));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content
          aria-describedby={undefined}
          style={contentStyle}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <Dialog.Title style={titleStyle}>
            {STEP_TITLES[step]}
            <span style={stepBadgeStyle}>
              {step + 1} / {STEP_TITLES.length}
            </span>
          </Dialog.Title>

          <div style={bodyStyle}>
            {step === 0 && <WelcomeStep />}
            {step === 1 && <SpeciesStep />}
            {step === 2 && <CreateTaskStep />}
            {step === 3 && <FocusStep />}
          </div>

          <div style={footerStyle}>
            <button
              type="button"
              onClick={finish}
              style={skipBtnStyle}
              aria-label="跳过引导"
            >
              跳过
            </button>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              {step > 0 && (
                <button type="button" onClick={back} style={secondaryBtnStyle}>
                  上一步
                </button>
              )}
              {step < STEP_TITLES.length - 1 ? (
                <button type="button" onClick={next} style={primaryBtnStyle}>
                  下一步
                </button>
              ) : (
                <button type="button" onClick={finish} style={primaryBtnStyle}>
                  完成
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ===== 步骤 0：欢迎 ===== */
function WelcomeStep(): JSX.Element {
  return (
    <Dialog.Description style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.7 }}>
      <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 'var(--space-md)' }}>👋</div>
      欢迎来到 WorkMemory！你的本地优先工作记忆伙伴。
      <br />
      接下来用几步带你熟悉核心功能：领养宠物、创建任务、体验专注计时。
    </Dialog.Description>
  );
}

/* ===== 步骤 1：选择伙伴形象 ===== */
function SpeciesStep(): JSX.Element {
  const mascotId = useAppStore((s) => s.mascotId);
  const setStoreMascotId = useAppStore((s) => s.setMascotId);
  const petState = usePetStore((s) => s.petState);

  const pick = async (id: number): Promise<void> => {
    const m = MASCOTS.find((x) => x.id === id);
    if (!m) return;
    setStoreMascotId(id);
    try {
      await api.setMascotId(id);
    } catch (err) {
      console.error('[Onboarding] setMascotId 失败', err);
    }
    // 若已有宠物则同步 species；无宠物则在后续领养时使用
    if (petState) {
      await usePetStore.getState().savePetState({ ...petState, species: m.en });
    } else {
      toast.success(`已选择伙伴：${m.en}`);
    }
  };

  return (
    <div>
      <Dialog.Description style={{ margin: '0 0 var(--space-md)', color: 'var(--color-text-muted)', fontSize: 13 }}>
        选一只喜欢的桌面伙伴，它会陪你一起完成任务、专注与成长。
      </Dialog.Description>
      <div style={speciesGridStyle}>
        {MASCOTS.map((m) => {
          const selected = m.id === mascotId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => void pick(m.id)}
              aria-pressed={selected}
              style={{
                ...speciesBtnStyle,
                border: selected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                background: selected ? 'var(--color-primary-soft)' : 'var(--color-surface)',
              }}
            >
              <span style={{ fontSize: 20 }}>{m.id}</span>
              <span style={{ fontSize: 11, color: selected ? 'var(--color-primary)' : 'var(--color-text-main)' }}>
                {m.en}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ===== 步骤 2：创建首个任务 ===== */
function CreateTaskStep(): JSX.Element {
  const [title, setTitle] = useState('');
  const [created, setCreated] = useState(false);

  const handleCreate = async (): Promise<void> => {
    const t = title.trim();
    if (!t) {
      toast.error('请输入任务标题');
      return;
    }
    const saved = await useTaskStore.getState().saveTask({ title: t, status: 'todo' });
    if (saved) {
      setCreated(true);
    }
  };

  return (
    <div>
      <Dialog.Description style={{ margin: '0 0 var(--space-md)', color: 'var(--color-text-muted)', fontSize: 13 }}>
        创建你的第一个任务，开启高效一天。完成后可在「任务」页管理。
      </Dialog.Description>
      {created ? (
        <div style={{ padding: 'var(--space-md)', background: 'var(--color-success-soft)', borderRadius: 'var(--radius-md)', color: 'var(--color-success)', fontSize: 13 }}>
          ✓ 已创建任务，去「任务」页查看吧！
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：完成项目周报"
            style={inputStyle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
          <button type="button" onClick={() => void handleCreate()} style={primaryBtnStyle}>
            创建
          </button>
        </div>
      )}
    </div>
  );
}

/* ===== 步骤 3：体验专注 ===== */
function FocusStep(): JSX.Element {
  const navigate = useNavigate();
  return (
    <div>
      <Dialog.Description style={{ margin: '0 0 var(--space-md)', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.7 }}>
        专注计时帮你保持深度工作。番茄钟 25 分钟 + 5 分钟休息，完成后宠物还能获得经验值。
      </Dialog.Description>
      <button
        type="button"
        onClick={() => {
          navigate('/focus');
        }}
        style={{ ...primaryBtnStyle, width: '100%' }}
      >
        前往专注页
      </button>
    </div>
  );
}

/* ===== 样式 ===== */
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  zIndex: 10002,
};

const contentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90%',
  maxWidth: 480,
  maxHeight: '85vh',
  overflow: 'auto',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-overlay)',
  padding: 'var(--space-xl)',
  zIndex: 10003,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-lg)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--color-text-main)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const stepBadgeStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-primary)',
  background: 'var(--color-primary-soft)',
  padding: '2px 10px',
  borderRadius: 'var(--radius-round)',
};

const bodyStyle: React.CSSProperties = {
  minHeight: 140,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const skipBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  color: 'var(--color-text-main)',
  background: 'var(--color-surface-subtle)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-on-primary)',
  background: 'var(--color-primary)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 36,
  padding: '0 12px',
  fontSize: 13,
  color: 'var(--color-text-main)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
};

const speciesGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'var(--space-sm)',
};

const speciesBtnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 'var(--space-sm) var(--space-xs)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  transition:
    'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo)',
};
