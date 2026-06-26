/**
 * WorkMemory 前端入口
 * 严格遵循 03_CORE_ARCHITECTURE.md §1 工程目录约定。
 */
import './styles/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
