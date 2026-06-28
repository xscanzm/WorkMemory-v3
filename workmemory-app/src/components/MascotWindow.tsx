/**
 * Mascot 透明窗口独立渲染组件（路由 `/mascot`，对应 tauri.conf.json mascot 窗口）
 *
 * 严格遵循 04_UI_SPEC.md §5.5 / 05_INTERACTION.md §2.4：
 * - 全屏透明 div，居中放置 MascotSprite
 * - 从 useAppStore 读 mascotId/mascotState
 * - 监听 recorder-state-changed / privacy-triggered / report-ready，更新 mascotState
 *   · recorder-state-changed → recorderStateToMascotState 映射
 *   · report-ready → 播 jump 一次性动画，onAnimationEnd 后恢复
 * - 拖拽：pointerdown 进入 drag，pointermove 改窗口位置，pointerup 播 fall + 磁吸贴边
 * - 右键菜单：Radix DropdownMenu，10 项 + 3 分隔符（05_INTERACTION.md §2.4）
 * - 气泡：useBubbleThrottle 频控 + 6 秒淡出 + × 当日同类禁推
 * - 主动智能：下班复盘 / 专注休息 / 碎片降噪 / 隐私首闪（05_INTERACTION.md §3）
 * - 专业软件前台：Mascot 容器降透明度 0.15（§2.1）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AppWindow,
  Pause,
  Play,
  Shield,
  ShieldOff,
  Camera,
  FileText,
  Eye,
  Clock,
  EyeOff,
  RefreshCw,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import { getCurrentWindow, getAllWindows, LogicalPosition, PhysicalPosition, currentMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { api } from '@/src-tauri/api';
import { useAppStore } from '@/store/useAppStore';
import { recorderStateToMascotState } from '@/store/mascotStore';
import { useBubbleThrottle } from '@/hooks/useBubbleThrottle';
import type { MascotStateName, RecorderState } from '@/types';
import MascotSprite from './mascot/MascotSprite';

/**
 * 专业软件进程名清单（05_INTERACTION.md §2.1）
 * 命中时 Mascot 容器降透明度至 0.15，恢复时回到 1.0。
 */
const PRO_APP_PROCESSES = new Set([
  // IDE / 编辑器
  'devenv', 'idea64', 'idea', 'idea.exe',
  'pycharm64', 'pycharm', 'webstorm64', 'webstorm',
  'goland64', 'goland', 'clion64', 'clion',
  'rust-rover', 'rider64', 'rider',
  'code', 'code-insiders', 'fleet',
  // 设计 / 创意
  'photoshop', 'illustrator', 'indesign', 'premiere', 'premierepro', 'afterfx',
  'lightroom', 'xd', 'figma', 'sketch', 'blender', 'maya', 'cinema4d', 'davinci',
  // 引擎 / 其他
  'unity', 'unreal', 'substance', 'houdini',
]);

/** 气泡颜色变体 */
type BubbleColor = 'default' | 'private';

interface BubbleAction {
  label: string;
  onClick: () => void;
}

interface BubbleData {
  id: number;
  text: string;
  category: string;
  color: BubbleColor;
  action?: BubbleAction;
  visible: boolean; // 控制 6 秒淡出过渡
}

/** 本地日期 YYYY-MM-DD（用于跨日重置判断） */
function formatLocalDateForReset(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DragState {
  startClientX: number;
  startClientY: number;
  startWinX: number; // logical
  startWinY: number; // logical
}

interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  separatorAfter?: boolean;
}

function MascotWindow(): JSX.Element {
  const mascotId = useAppStore((s) => s.mascotId);
  const mascotState = useAppStore((s) => s.mascotState);
  const setMascotState = useAppStore((s) => s.setMascotState);
  const setRecorderState = useAppStore((s) => s.setRecorderState);
  const recorderState = useAppStore((s) => s.recorderState);

  // 一次性动画覆盖状态（jump / fall），null 时回落到 store 的 mascotState
  const [transient, setTransient] = useState<MascotStateName | null>(null);
  const effectiveState: MascotStateName = transient ?? mascotState;

  const [menuOpen, setMenuOpen] = useState(false);

  // ===== 气泡状态（BubbleData | null，visible 控制 6 秒淡出过渡） =====
  const [bubble, setBubble] = useState<BubbleData | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== 气泡频控算法（05_INTERACTION.md §2.3） =====
  const { canShowBubble, onBubbleDismissed } = useBubbleThrottle();

  // ===== 主动智能：当日只弹一次 / 同 app 只闪一次 的标记（跨日重置） =====
  const shownDailyWrapRef = useRef(false);
  const privacyFlashedAppsRef = useRef<Set<string>>(new Set());

  // ===== 碎片切换：10 分钟滚动窗口的 segment 时间戳（§3.3） =====
  const segmentTimestampsRef = useRef<number[]>([]);
  const fragmentedCooldownRef = useRef(false);

  // ===== 专业软件前台 → 容器降透明度（§2.1） =====
  const [containerOpacity, setContainerOpacity] = useState(1);
  const proAppPollFailedRef = useRef(false);

  const dragRef = useRef<DragState | null>(null);

  // ===== 拖拽 RAF 节流：避免 pointermove 高频调用 setPosition =====
  const dragTargetRef = useRef<{ x: number; y: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);

  // ===== 跨窗口导航主窗口（show + setFocus + 改 hash 路由） =====
  const navigateMain = useCallback(async (path: string, hash?: string) => {
    if (!api.isTauri()) return;
    try {
      const main = await WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
        // HashRouter：通过 emit 事件通知主窗口修改 location.hash
        // （Tauri 2.x WebviewWindow 无 eval 方法，改用事件系统）
        const newHash = hash ? `#${path}#${hash}` : `#${path}`;
        await main.emit('navigate-main', { hash: newHash });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[navigateMain] 失败', err);
    }
  }, []);

  // ===== 气泡：内部统一渲染入口（6 秒后淡出 300ms） =====
  const showBubbleInternal = useCallback(
    (data: Omit<BubbleData, 'visible' | 'id'>) => {
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      if (bubbleTimer.current) {
        clearTimeout(bubbleTimer.current);
        bubbleTimer.current = null;
      }
      setBubble({ ...data, id: Date.now(), visible: true });
      // 6 秒后开始淡出
      bubbleTimer.current = setTimeout(() => {
        setBubble((b) => (b ? { ...b, visible: false } : null));
        // 淡出过渡 300ms 后移除 DOM
        fadeTimer.current = setTimeout(() => setBubble(null), 300);
      }, 6000);
    },
    [],
  );

  /** 用户动作反馈气泡：绕过频控（直接响应用户点击，不占用主动智能额度） */
  const showBubble = useCallback(
    (text: string) => {
      showBubbleInternal({ text, category: '__feedback__', color: 'default' });
    },
    [showBubbleInternal],
  );

  /**
   * 主动智能气泡：受频控约束（05_INTERACTION.md §2.3）。
   * 返回是否真正弹出（false 表示被频控拦截）。
   */
  const showProactiveBubble = useCallback(
    (
      category: string,
      text: string,
      opts?: { color?: BubbleColor; action?: BubbleAction },
    ): boolean => {
      if (!canShowBubble(category)) return false;
      showBubbleInternal({
        text,
        category,
        color: opts?.color ?? 'default',
        action: opts?.action,
      });
      return true;
    },
    [canShowBubble, showBubbleInternal],
  );

  /** 隐藏气泡（仅视觉移除，不触发频控的 dismissed 计数） */
  const hideBubble = useCallback(() => {
    if (bubbleTimer.current) {
      clearTimeout(bubbleTimer.current);
      bubbleTimer.current = null;
    }
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
    setBubble((b) => (b ? { ...b, visible: false } : null));
    fadeTimer.current = setTimeout(() => setBubble(null), 300);
  }, []);

  /**
   * 用户点击 × 关闭气泡：
   * - 非反馈类（主动智能）→ 调 onBubbleDismissed(category) 计入频控
   * - 反馈类 → 仅隐藏
   */
  const dismissBubble = useCallback(
    (category: string) => {
      if (category !== '__feedback__') {
        onBubbleDismissed(category);
      }
      hideBubble();
    },
    [onBubbleDismissed, hideBubble],
  );

  // ===== 事件监听 =====
  useEffect(() => {
    const unlistens: Array<() => void> = [];

    // recorder-state-changed → 映射为 mascot 状态
    api
      .listen('recorder-state-changed', (rs: RecorderState) => {
        setRecorderState(rs);
        const ms = recorderStateToMascotState(rs);
        setMascotState(ms);
        // 中断任何进行中的一次性动画
        setTransient(null);
      })
      .then((u) => unlistens.push(u));

    // privacy-triggered → special 状态 + 隐私首闪（§2.3，同一 app 当日只闪一次）
    api
      .listen('privacy-triggered', (payload: { app_name?: string }) => {
        setRecorderState('PrivacyMode');
        setMascotState('special');
        setTransient(null);

        const appName = payload?.app_name ?? 'unknown';
        // 同一 app 当日只闪一次（无论是否被频控拦截，都标记为已闪）
        if (privacyFlashedAppsRef.current.has(appName)) return;
        privacyFlashedAppsRef.current.add(appName);
        // 首次命中：弹紫色气泡（受 canShowBubble('privacy') 频控约束）
        showProactiveBubble(
          'privacy',
          '🔒 已进入隐私保护，小记不会记录这个窗口。',
          { color: 'private' },
        );
      })
      .then((u) => unlistens.push(u));

    // report-ready → 播 jump 一次性动画 + 反馈气泡
    api
      .listen('report-ready', () => {
        setTransient('jump');
        showBubble('日报已生成 📄');
      })
      .then((u) => unlistens.push(u));

    return () => {
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          /* noop */
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 一次性动画结束 → 恢复到映射状态 =====
  const handleAnimEnd = useCallback(() => {
    setTransient(null);
  }, []);

  // ===== 气泡定时器清理 =====
  useEffect(() => {
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  // ===== 主动智能 §3.1：每日下班复盘（17:30-19:30 + 当日 episodes ≥3） =====
  useEffect(() => {
    let cancelled = false;
    const checkDailyWrap = async () => {
      if (cancelled) return;
      if (shownDailyWrapRef.current) return;
      const now = new Date();
      const minutesOfDay = now.getHours() * 60 + now.getMinutes();
      // 17:30 - 19:30
      if (minutesOfDay < 17 * 60 + 30 || minutesOfDay > 19 * 60 + 30) return;
      try {
        const today = useAppStore.getState().activeDate;
        const episodes = await api.getEpisodesByDate(today);
        if (cancelled) return;
        if (episodes.length < 3) return;
        const shown = showProactiveBubble(
          'daily_wrap',
          '今天的记忆已经整理好了，要现在生成日报吗？',
          {
            action: {
              label: '生成',
              onClick: () => {
                void navigateMain('/reports');
              },
            },
          },
        );
        if (shown) {
          // 当天只弹一次 + Mascot 播 jump 一次性动画后弹气泡
          shownDailyWrapRef.current = true;
          setTransient('jump');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[daily wrap] 检查失败', err);
      }
    };
    void checkDailyWrap();
    const interval = setInterval(() => {
      void checkDailyWrap();
    }, 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showProactiveBubble, navigateMain]);

  // ===== 主动智能 §3.2：深度专注休息提醒（监听 focus-remind 事件） =====
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    api
      .listen('focus-remind', (payload: { minutes?: number }) => {
        void payload; // 分钟数仅作信号，文案固定
        // Mascot 保持 idle 动画，不切换状态
        showProactiveBubble(
          'focus_remind',
          '专注很久了，小记建议你站起来活动一下，喝杯水。需要我 10 分钟后提醒你回来吗？',
          {
            action: {
              label: '10 分钟后提醒',
              onClick: () => {
                // 10 分钟后再弹一次"该回来工作啦"反馈气泡
                setTimeout(() => {
                  showBubble('该回来工作啦');
                }, 10 * 60 * 1000);
              },
            },
          },
        );
      })
      .then((u) => {
        unlisten = u;
      });
    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 主动智能 §3.3：碎片切换降噪建议（10 分钟内 segment > 30） =====
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    api.listen('segment-captured', () => {
      const now = Date.now();
      const tenMinAgo = now - 10 * 60 * 1000;
      const arr = segmentTimestampsRef.current;
      arr.push(now);
      // 移除超过 10 分钟的时间戳
      while (arr.length > 0 && arr[0] < tenMinAgo) {
        arr.shift();
      }
      if (arr.length > 30 && !fragmentedCooldownRef.current) {
        const shown = showProactiveBubble(
          'fragmented',
          '刚刚的信息流有些碎，需要我帮你把这些临时沟通片段合并成一条"日常事务整理"，方便稍后写日报吗？',
          {
            action: {
              label: '好的',
              onClick: () => {
                void navigateMain('/insights');
              },
            },
          },
        );
        if (shown) {
          // 30 分钟冷却，避免短时间内重复触发
          fragmentedCooldownRef.current = true;
          setTimeout(() => {
            fragmentedCooldownRef.current = false;
          }, 30 * 60 * 1000);
        }
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 专业软件前台 → 容器降透明度 0.15（§2.1，非 Tauri 跳过） =====
  useEffect(() => {
    if (!api.isTauri()) return;
    if (proAppPollFailedRef.current) return;
    let cancelled = false;
    const checkForeground = async () => {
      if (cancelled || proAppPollFailedRef.current) return;
      try {
        const procName = await api.invoke<string>('get_foreground_app');
        if (cancelled) return;
        const isPro = PRO_APP_PROCESSES.has(String(procName).toLowerCase());
        setContainerOpacity(isPro ? 0.15 : 1);
      } catch {
        // 后端未实现 get_foreground_app 命令 → 停止轮询，保持 opacity 1
        proAppPollFailedRef.current = true;
      }
    };
    void checkForeground();
    const interval = setInterval(() => {
      void checkForeground();
    }, 30 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ===== 跨日重置：MascotWindow 自有的"当日只弹一次"标记 =====
  useEffect(() => {
    let lastDate = formatLocalDateForReset(new Date());
    const interval = setInterval(() => {
      const today = formatLocalDateForReset(new Date());
      if (today !== lastDate) {
        lastDate = today;
        shownDailyWrapRef.current = false;
        privacyFlashedAppsRef.current = new Set();
        fragmentedCooldownRef.current = false;
        segmentTimestampsRef.current = [];
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ===== 拖拽 + 贴边磁吸 =====
  const onPointerDown = async (e: React.PointerEvent) => {
    if (e.button === 2) return; // 右键交给 onContextMenu
    if (e.button !== 0) return; // 仅左键拖拽
    // 阻止 Radix Trigger 默认左键打开菜单，并抑制兼容性 mouse 事件
    e.preventDefault();

    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWinX: 0,
      startWinY: 0,
    };

    if (api.isTauri()) {
      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const pos = await win.outerPosition(); // PhysicalPosition
        if (dragRef.current) {
          dragRef.current.startWinX = pos.x / scale;
          dragRef.current.startWinY = pos.y / scale;
        }
        // 捕获指针，确保后续 pointermove/up 仍路由到当前元素
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[mascot drag start] 失败', err);
      }
    }

    setTransient('drag');
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    if (!api.isTauri()) return;
    const dx = e.clientX - ds.startClientX;
    const dy = e.clientY - ds.startClientY;
    const newX = ds.startWinX + dx;
    const newY = ds.startWinY + dy;
    // RAF 节流：仅记录目标坐标，下一帧统一 flush，避免高频 setPosition
    dragTargetRef.current = { x: newX, y: newY };
    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        const target = dragTargetRef.current;
        if (target) {
          void getCurrentWindow().setPosition(
            new LogicalPosition(target.x, target.y),
          );
        }
      });
    }
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const wasDragging = dragRef.current !== null;
    dragRef.current = null;
    if (!wasDragging) return;

    // 取消尚未 flush 的 RAF，避免抬手后窗口再跳一次
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    // 贴边磁吸
    if (api.isTauri()) {
      await snapToNearestCorner();
    }

    // 播 fall 一次性动画，结束后恢复
    setTransient('fall');
  };

  /** 计算最近屏幕边角并吸附（右下角优先） */
  const snapToNearestCorner = async () => {
    try {
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) return;
      const pos = await win.outerPosition(); // PhysicalPosition
      const winSize = await win.outerSize(); // PhysicalSize
      const monPos = monitor.position;
      const monSize = monitor.size;

      const maxX = monPos.x + monSize.width - winSize.width;
      const maxY = monPos.y + monSize.height - winSize.height;
      const minX = monPos.x;
      const minY = monPos.y;

      const corners: Array<{ name: string; x: number; y: number }> = [
        { name: 'bottom-right', x: maxX, y: maxY },
        { name: 'top-right', x: maxX, y: minY },
        { name: 'bottom-left', x: minX, y: maxY },
        { name: 'top-left', x: minX, y: minY },
      ];

      let nearest = corners[0];
      let minDist = Infinity;
      for (const c of corners) {
        const d = Math.hypot(pos.x - c.x, pos.y - c.y);
        // 用 <= 让后遍历的 right-bottom 优先（已置首，< 即可）
        if (d < minDist) {
          minDist = d;
          nearest = c;
        }
      }
      await win.setPosition(new PhysicalPosition(nearest.x, nearest.y));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[snapToNearestCorner] 失败', err);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  };

  // ===== 右键菜单动作 =====
  const openMainWindow = async () => {
    if (!api.isTauri()) return;
    try {
      const allWindows = await getAllWindows();
      const main = allWindows.find((w) => w.label === 'main');
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[openMainWindow] 失败', err);
    }
  };

  const togglePause = async () => {
    const next: RecorderState =
      recorderState === 'Recording' ? 'Paused' : 'Recording';
    await api.setRecorderState(next);
    setRecorderState(next);
    setMascotState(recorderStateToMascotState(next));
    showBubble(next === 'Paused' ? '已暂停记录 ⏸' : '已恢复记录 ▶');
  };

  const togglePrivacy = async () => {
    const next: RecorderState =
      recorderState === 'PrivacyMode' ? 'Recording' : 'PrivacyMode';
    await api.setRecorderState(next);
    setRecorderState(next);
    setMascotState(recorderStateToMascotState(next));
    showBubble(next === 'PrivacyMode' ? '已进入隐私模式 🛡' : '已退出隐私模式');
  };

  const quickCapture = async () => {
    try {
      await api.triggerManualCapture();
      showBubble('已快速捕捉 📸');
    } catch (err) {
      showBubble('捕捉失败');
      // eslint-disable-next-line no-console
      console.error('[quickCapture] 失败', err);
    }
  };

  const navigateToReports = async () => {
    await navigateMain('/reports');
  };

  const navigateToToday = async () => {
    await navigateMain('/today');
  };

  const hideForOneHour = async () => {
    if (!api.isTauri()) return;
    try {
      await getCurrentWindow().hide();
      showBubble('1 小时后回来 ⏰');
      setTimeout(() => {
        void getCurrentWindow().show();
      }, 60 * 60 * 1000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[hideForOneHour] 失败', err);
    }
  };

  const hideForToday = async () => {
    if (!api.isTauri()) return;
    try {
      await getCurrentWindow().hide();
      showBubble('今天休息 👋');
      // 次日 0 点恢复（简化为 24 小时后）
      setTimeout(() => {
        void getCurrentWindow().show();
      }, 24 * 60 * 60 * 1000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[hideForToday] 失败', err);
    }
  };

  const navigateToCompanionSettings = async () => {
    // 跳转 /settings#companion（更换伙伴形象）
    await navigateMain('/settings', 'companion');
  };

  const navigateToSettings = async () => {
    await navigateMain('/settings');
  };

  const menuItems: MenuItem[] = [
    {
      key: 'open-main',
      label: '打开 WorkMemory 主窗口',
      icon: AppWindow,
      onSelect: openMainWindow,
      separatorAfter: true,
    },
    {
      key: 'pause',
      label: recorderState === 'Recording' ? '暂停记录' : '恢复记录',
      icon: recorderState === 'Recording' ? Pause : Play,
      onSelect: togglePause,
    },
    {
      key: 'privacy',
      label: recorderState === 'PrivacyMode' ? '退出隐私模式' : '进入隐私模式',
      icon: recorderState === 'PrivacyMode' ? ShieldOff : Shield,
      onSelect: togglePrivacy,
    },
    {
      key: 'capture',
      label: '快速捕捉当前屏幕文字',
      icon: Camera,
      onSelect: quickCapture,
      separatorAfter: true,
    },
    {
      key: 'report',
      label: '生成今日日报',
      icon: FileText,
      onSelect: navigateToReports,
    },
    {
      key: 'summary',
      label: '查看今日总结',
      icon: Eye,
      onSelect: navigateToToday,
      separatorAfter: true,
    },
    {
      key: 'hide-1h',
      label: '隐藏伙伴 1 小时',
      icon: Clock,
      onSelect: hideForOneHour,
    },
    {
      key: 'hide-today',
      label: '隐藏伙伴今天',
      icon: EyeOff,
      onSelect: hideForToday,
    },
    {
      key: 'change-mascot',
      label: '更换伙伴形象…',
      icon: RefreshCw,
      onSelect: navigateToCompanionSettings,
    },
    {
      key: 'settings',
      label: '设置',
      icon: Settings,
      onSelect: navigateToSettings,
    },
  ];

  // ===== 渲染 =====
  const isPrivateBubble = bubble?.color === 'private';
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
        // 专业软件前台时降低透明度（§2.1）
        opacity: containerOpacity,
        transition: 'opacity var(--duration-slow) var(--ease-out-expo)',
      }}
    >
      {/* relative 包裹层：让气泡可定位在 Mascot 头顶，且独立于 DropdownMenu.Trigger */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onContextMenu={onContextMenu}
              style={{ display: 'inline-block', cursor: 'grab' }}
            >
              <MascotSprite
                mascotId={mascotId}
                state={effectiveState}
                scale={1.0}
                onAnimationEnd={handleAnimEnd}
              />
            </div>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={6}
              align="center"
              style={{
                minWidth: 200,
                padding: 6,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-overlay)',
                userSelect: 'none',
              }}
            >
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.key}>
                    <DropdownMenu.Item
                      onSelect={item.onSelect}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 13,
                        color: 'var(--color-text-main)',
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          'var(--color-primary-soft)';
                        e.currentTarget.style.color = 'var(--color-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-main)';
                      }}
                    >
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </DropdownMenu.Item>
                    {item.separatorAfter && (
                      <DropdownMenu.Separator
                        style={{
                          height: 1,
                          background: 'var(--color-border)',
                          margin: '4px 0',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* 气泡：浮现于 Mascot 头顶，毛玻璃 + 6 秒淡出 + × 关闭 */}
        {bubble && (
          <div
            key={bubble.id}
            style={{
              position: 'absolute',
              top: 2,
              left: '50%',
              transform: 'translateX(-50%)',
              // 规格期望 240px，但 mascot 透明窗口仅 192px 宽，按窗口宽度收敛避免裁剪
              maxWidth: 184,
              padding: '8px 12px',
              background: isPrivateBubble
                ? 'var(--color-private-glass)'
                : 'var(--color-surface-glass)',
              backdropFilter: 'var(--blur-acrylic)',
              WebkitBackdropFilter: 'var(--blur-acrylic)',
              border: `1px solid ${
                isPrivateBubble
                  ? 'var(--color-private)'
                  : 'var(--color-border)'
              }`,
              color: isPrivateBubble ? 'var(--color-on-primary)' : 'var(--color-text-main)',
              fontSize: 13,
              lineHeight: 1.4,
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-overlay)',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              opacity: bubble.visible ? 1 : 0,
              transition: 'opacity 300ms var(--ease-out-expo)',
              pointerEvents: 'auto',
            }}
          >
            {/* 右上角 × 关闭按钮 */}
            <button
              type="button"
              aria-label="关闭气泡"
              onClick={() => dismissBubble(bubble.category)}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: isPrivateBubble
                  ? 'var(--color-on-private-soft)'
                  : 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isPrivateBubble
                  ? 'var(--color-on-private-hover)'
                  : 'var(--color-surface-subtle)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <X size={12} />
            </button>

            <div style={{ paddingRight: 14 }}>{bubble.text}</div>

            {/* 动作按钮（如"生成"/"10 分钟后提醒"/"好的"） */}
            {bubble.action && (
              <button
                type="button"
                onClick={() => {
                  bubble.action!.onClick();
                  hideBubble();
                }}
                style={{
                  marginTop: 6,
                  padding: '4px 12px',
                  background: isPrivateBubble
                    ? 'var(--color-on-private-action)'
                    : 'var(--color-primary)',
                  color: 'var(--color-on-primary)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {bubble.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MascotWindow;
