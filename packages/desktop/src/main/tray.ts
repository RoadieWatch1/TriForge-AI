import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

let tray: Tray | null = null;

export function setupTray(onShow: () => void, onQuit?: () => void): void {
  // Use a simple generated icon if the PNG asset isn't ready yet
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createFromDataURL(FALLBACK_ICON);
    }
  } catch {
    icon = nativeImage.createFromDataURL(FALLBACK_ICON);
  }

  // Resize for tray (16x16 on Windows, 18x18 on macOS)
  const size = process.platform === 'darwin' ? 18 : 16;
  icon = icon.resize({ width: size, height: size });

  tray = new Tray(icon);
  tray.setToolTip('TriForge AI — Your personal think tank');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open TriForge AI',
      click: onShow,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        onQuit?.();
        app.exit(0);
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', onShow); // single click opens window on Windows
}

// 16x16 base64 PNG — simple "T" icon fallback
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABSSURBVDiNY2AYBfQDTAz/GRj+M+AATAybDgsYGBjOM2BXyECsAUQbQLQBRBtAtAFEG0C0AUQbQLQBRBtAtAFEG0C0AUQbQLQBRBtANGoAAHNaBFl03Pz2AAAAAElFTkSuQmCC';
