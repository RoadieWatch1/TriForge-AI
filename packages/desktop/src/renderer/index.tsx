import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App';
import './styles/global.css';
import { AUTONOMY_FLAGS } from '../core/config/autonomyFlags';
import { VoiceCommandBridge } from './voice/VoiceCommandBridge';

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

// Boot offline wake bridge — only when flag is explicitly enabled.
// The online wake engine is owned by App.tsx (started after the UI is visible).
let _offlineBridge: VoiceCommandBridge | null = null;
if (AUTONOMY_FLAGS.enableOfflineWake) {
  _offlineBridge = new VoiceCommandBridge();
  _offlineBridge.start();
  window.addEventListener('beforeunload', () => _offlineBridge?.stop());
}
