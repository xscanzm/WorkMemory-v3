/**
 * WorkMemory 应用根组件
 * - HashRouter（03_CORE_ARCHITECTURE.md 要求，匹配 tauri.conf.json mascot 窗口 url `index.html#/mascot`）
 * - 主窗口三栏布局：TopBar + Sidebar(72) + Main(860) + ContextPanel(348)
 * - Mascot 透明窗口独立路由 `/mascot`
 * 严格遵循 04_UI_SPEC.md §2 与 06_DESIGN_GOVERNANCE.md §2.1。
 */
import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './src-tauri/api';
import { useTaskStore } from './store/taskStore';
import { usePetStore } from './store/petStore';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ContextPanel from './components/ContextPanel';
import MascotWindow from './components/MascotWindow';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/Toast';
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
              <Route path="/home" element={<HomeView />} />
              <Route path="/tasks" element={<TasksView />} />
              <Route path="/focus" element={<FocusView />} />
              <Route path="/pet" element={<PetView />} />
              {/* 记忆子导航路由（保留） */}
              <Route path="/today" element={<TodayView />} />
              <Route path="/calendar" element={<CalendarView />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/insights" element={<InsightsView />} />
              <Route path="/wiki" element={<WikiView />} />
              <Route path="/graph" element={<GraphView />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/settings" element={<SettingsView />} />
              {/* 默认重定向到仪表盘（5-Tab 主导航首页） */}
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </main>
        </div>
        <ContextPanel />
      </div>
      <ToastContainer />
      {/* Task 23.4：首次启动引导向导（内部按 localStorage 决定是否显示） */}
      <OnboardingWizard />
    </div>
  );
}

export default function App(): JSX.Element {
  // 初始化时注册 Tauri 事件监听（recorder-state-changed 等），更新 useAppStore
  // 同时启动加载任务 / 宠物状态（优化 1：数据持久化修复，App 启动即拉取持久化数据）
  useEffect(() => {
    void api.initListeners();
    void useTaskStore.getState().loadTasks();
    void usePetStore.getState().loadPetState();
  }, []);

  return (
    <I18nProvider>
      <HashRouter>
        <Routes>
          {/* Mascot 透明窗口独立渲染 */}
          <Route path="/mascot" element={<MascotWindow />} />
          {/* 主窗口三栏布局 */}
          <Route path="/*" element={<ErrorBoundary><MainLayout /></ErrorBoundary>} />
        </Routes>
      </HashRouter>
    </I18nProvider>
  );
}
