/**
 * WorkMemory 应用根组件
 * - HashRouter（03_CORE_ARCHITECTURE.md 要求，匹配 tauri.conf.json mascot 窗口 url `index.html#/mascot`）
 * - 主窗口三栏布局：TopBar + Sidebar(72) + Main(860) + ContextPanel(348)
 * - Mascot 透明窗口独立路由 `/mascot`
 * 严格遵循 04_UI_SPEC.md §2 与 06_DESIGN_GOVERNANCE.md §2.1。
 */
import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate, useBlocker } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';
import { api } from './src-tauri/api';
import { useTaskStore } from './store/taskStore';
import { usePetStore } from './store/petStore';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ContextPanel from './components/ContextPanel';
import MascotWindow from './components/MascotWindow';
import ErrorBoundary from './components/ErrorBoundary';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import ToastContainer from './components/Toast';
import CommandPalette from './components/CommandPalette';
import AchievementUnlockModal from './components/AchievementUnlockModal';
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog';
import {
  checkDirty,
  getDirtyReasons,
  clearAllDirty,
} from './hooks/useDirtyGuard';
import { useHotkeys } from './hooks/useHotkeys';
import { initAchievementListener } from './store/achievementStore';
import HomeView from './views/HomeView';
import TodayView from './views/TodayView';
import TasksView from './views/TasksView';
import CalendarView from './views/CalendarView';
import SearchView from './views/SearchView';
import InsightsView from './views/InsightsView';
import WikiView from './views/WikiView';
import GraphView from './views/GraphView';
import ReportsView from './views/ReportsView';
import SettingsView from './views/SettingsView';
import PetView from './views/PetView';
import FocusView from './views/FocusView';
import QuickCaptureView from './views/QuickCaptureView';
import TagManagementView from './views/TagManagementView';
import OnboardingWizard from './components/OnboardingWizard';
import { I18nProvider } from './i18n';

/** 主窗口三栏布局（04_UI_SPEC.md §2: 72 + 860 + 348） */
function MainLayout(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <Titlebar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        <div
          style={{
            width: 860,
            flex: '0 0 860px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: 'var(--color-bg-base)',
          }}
        >
          <TopBar />
          <main
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 'var(--space-xl)',
            }}
          >
            <Routes>
              {/* 主导航 5-Tab：仪表盘/任务/专注/宠物（Task 11 仪表盘已实现） */}
              {/* Task 22：视图切换 300ms ease-out 过渡，view-transition 在 mount 时自动播放 */}
              <Route path="/home" element={<div className="view-transition"><ViewErrorBoundary><HomeView /></ViewErrorBoundary></div>} />
              <Route path="/tasks" element={<div className="view-transition"><ViewErrorBoundary><TasksView /></ViewErrorBoundary></div>} />
              <Route path="/focus" element={<div className="view-transition"><ViewErrorBoundary><FocusView /></ViewErrorBoundary></div>} />
              <Route path="/pet" element={<div className="view-transition"><ViewErrorBoundary><PetView /></ViewErrorBoundary></div>} />
              {/* 记忆子导航路由（保留） */}
              <Route path="/today" element={<div className="view-transition"><ViewErrorBoundary><TodayView /></ViewErrorBoundary></div>} />
              <Route path="/calendar" element={<div className="view-transition"><ViewErrorBoundary><CalendarView /></ViewErrorBoundary></div>} />
              <Route path="/search" element={<div className="view-transition"><ViewErrorBoundary><SearchView /></ViewErrorBoundary></div>} />
              <Route path="/insights" element={<div className="view-transition"><ViewErrorBoundary><InsightsView /></ViewErrorBoundary></div>} />
              <Route path="/wiki" element={<div className="view-transition"><ViewErrorBoundary><WikiView /></ViewErrorBoundary></div>} />
              <Route path="/graph" element={<div className="view-transition"><ViewErrorBoundary><GraphView /></ViewErrorBoundary></div>} />
              <Route path="/reports" element={<div className="view-transition"><ViewErrorBoundary><ReportsView /></ViewErrorBoundary></div>} />
              {/* Task 15：标签管理面板 */}
              <Route path="/tags" element={<div className="view-transition"><ViewErrorBoundary><TagManagementView /></ViewErrorBoundary></div>} />
              <Route path="/settings" element={<div className="view-transition"><ViewErrorBoundary><SettingsView /></ViewErrorBoundary></div>} />
              {/* 默认重定向到仪表盘（5-Tab 主导航首页） */}
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </main>
        </div>
        <ContextPanel />
      </div>
      <ToastContainer />
      {/* Task 11：命令面板（Ctrl+K 唤出，挂载在 MainLayout 内确保 useNavigate 可用） */}
      <CommandPalette />
      {/* Task 17：成就解锁特效弹窗（无 props，从 achievementStore 读取 pendingUnlock） */}
      <AchievementUnlockModal />
      {/* Task 23.4：首次启动引导向导（内部按 localStorage 决定是否显示） */}
      <OnboardingWizard />
    </div>
  );
}

/**
 * 路由脏状态守卫 (审计意见 2.4)
 *
 * 使用 react-router-dom 的 useBlocker 拦截 pathname 变更：
 * 当全局 dirty 注册表非空时阻塞导航，弹出 UnsavedChangesDialog。
 * - 丢弃并离开：clearAllDirty + blocker.proceed()
 * - 取消：blocker.reset()
 */
function RouteGuard({ children }: { children: ReactNode }): JSX.Element {
  const [reasons, setReasons] = useState<string[]>([]);
  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        currentLocation.pathname !== nextLocation.pathname && checkDirty(),
      [],
    ),
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setReasons(getDirtyReasons());
    }
  }, [blocker.state, blocker.location]);

  const handleDiscard = () => {
    clearAllDirty();
    if (blocker.state === 'blocked') blocker.proceed();
  };

  const handleCancel = () => {
    if (blocker.state === 'blocked') blocker.reset();
  };

  return (
    <>
      {children}
      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        reasons={reasons}
        onDiscard={handleDiscard}
        onCancel={handleCancel}
      />
    </>
  );
}

export default function App(): JSX.Element {
  // 初始化时注册 Tauri 事件监听（recorder-state-changed 等），更新 useAppStore
  // 同时启动加载任务 / 宠物状态（优化 1：数据持久化修复，App 启动即拉取持久化数据）
  useEffect(() => {
    void api.initListeners();
    void useTaskStore.getState().loadTasks();
    void usePetStore.getState().loadPetState();
    // Task 17.3：订阅 achievement-unlocked 事件 → AchievementUnlockModal 弹窗
    void initAchievementListener();
  }, []);

  // 全局快捷键矩阵（Task 13）：Ctrl+K/N/S/F + Esc，仅在根组件挂载一次
  useHotkeys();

  // Task 12：Ctrl+Shift+C 全局快捷键唤出快速捕获窗口（由 useHotkeys 派发 'toggle-quick-capture' 事件）
  useEffect(() => {
    const handler = (): void => {
      void api.invoke('show_quick_capture').catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[App] show_quick_capture failed', err);
      });
    };
    window.addEventListener('toggle-quick-capture', handler);
    return () => {
      window.removeEventListener('toggle-quick-capture', handler);
    };
  }, []);

  // MascotWindow 通过 emit('navigate-main', { hash }) 通知主窗口修改路由
  // （Tauri 2.x WebviewWindow 无 eval 方法，改用事件系统跨窗口导航）
  useEffect(() => {
    void api.listen('navigate-main', (payload: { hash?: string }) => {
      if (payload?.hash) {
        window.location.hash = payload.hash;
      }
    });
  }, []);

  return (
    <I18nProvider>
      <HashRouter>
        <RouteGuard>
          <Routes>
            {/* Mascot 透明窗口独立渲染 */}
            <Route path="/mascot" element={<MascotWindow />} />
            {/* Task 12：快速捕获悬浮窗口独立渲染（不包裹 Sidebar/TopBar） */}
            <Route path="/quick-capture" element={<QuickCaptureView />} />
            {/* 主窗口三栏布局 */}
            <Route path="/*" element={<ErrorBoundary><MainLayout /></ErrorBoundary>} />
          </Routes>
        </RouteGuard>
      </HashRouter>
    </I18nProvider>
  );
}
