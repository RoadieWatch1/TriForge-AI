import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ErrorBoundary } from './App';
import './styles/global.css';
import { AUTONOMY_FLAGS } from '../core/config/autonomyFlags';
import { VoiceCommandBridge } from './voice/VoiceCommandBridge';
import { voiceService } from './voice/VoiceService';

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

// Start wake listening immediately on app boot — independent of UI interaction.
// VoiceService owns the VoiceCommandBridge singleton and fires
// `triforge:council-wake` when the wake word is detected.
voiceService.start();

// Boot wake bridge if offline mode is enabled (flag off by default — Chat.tsx boots it for online mode)
if (AUTONOMY_FLAGS.enableOfflineWake) {
  const _offlineBridge = new VoiceCommandBridge();
  _offlineBridge.start();
}
