import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App';
import './styles/global.css';
import { AUTONOMY_FLAGS } from '../core/config/autonomyFlags';
import { VoskWakeEngine } from './voice/VoskWakeEngine';

// Declare window.triforge type
declare global {
  interface Window {
    triforge: import('../preload/index').TriforgeAPI;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Boot offline wake engine if enabled (flag off by default — vosk-browser via VoiceCommandBridge is the default path)
if (AUTONOMY_FLAGS.enableOfflineWake) {
  const _offlineWake = new VoskWakeEngine();
  _offlineWake.start().catch(err => console.warn('[VoskWakeEngine] boot failed:', err));
}
