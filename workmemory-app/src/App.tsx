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
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ContextPanel from './components/ContextPanel';
import MascotWindow from './components/MascotWindow';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/Toast';
import TodayView from './views/TodayView';
import CalendarView from './views/CalendarView';
import SearchView from './views/SearchView';
import InsightsView from './views/InsightsView';
import WikiView from './views/WikiView';
import GraphView from './views/GraphView';
import ReportsView from './views/ReportsView';
import SettingsView from './views/SettingsView';

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
              <Route path="/today" element={<TodayView />} />
              <Route path="/calendar" element={<CalendarView />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/insights" element={<InsightsView />} />
              <Route path="/wiki" element={<WikiView />} />
              <Route path="/graph" element={<GraphView />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/settings" element={<SettingsView />} />
              {/* 默认重定向到今日 */}
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </main>
        </div>
        <ContextPanel />
      </div>
      <ToastContainer />
    </div>
  );
}

export default function App(): JSX.Element {
  // 初始化时注册 Tauri 事件监听（recorder-state-changed 等），更新 useAppStore
  useEffect(() => {
    void api.initListeners();
  }, []);

  return (
    <HashRouter>
      <Routes>
        {/* Mascot 透明窗口独立渲染 */}
        <Route path="/mascot" element={<MascotWindow />} />
        {/* 主窗口三栏布局 */}
        <Route path="/*" element={<ErrorBoundary><MainLayout /></ErrorBoundary>} />
      </Routes>
    </HashRouter>
  );
}
