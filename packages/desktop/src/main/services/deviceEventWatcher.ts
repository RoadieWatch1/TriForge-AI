// ── deviceEventWatcher.ts ─────────────────────────────────────────────────────
//
// HID Device Event Watcher (Keyboard / Mouse Attach & Detach)
//
// Monitors for physical keyboard and mouse devices connecting or disconnecting.
// When a keyboard is detected, TriForge can:
//   - Suggest switching to the on-screen keyboard instead
//   - Log the device for session awareness
//   - Alert the operator that a new input device is present
//
// Platform implementations:
//   macOS:   Polls `system_profiler SPUSBDataType -json` every 5s
//            Also checks `system_profiler SPBluetoothDataType -json` for BT keyboards
//   Windows: Polls `Get-PnpDevice -Class Keyboard` via PowerShell every 5s
//
// Why polling instead of event subscription?
//   macOS IOKit event subscription requires native addons (not in this build).
//   Windows WMI event subscription via PowerShell is unreliable in Electron contexts.
//   Polling at 5s gives acceptable latency with zero native dependencies.

import { exec }  from 'child_process';
import { eventBus } from '@triforge/engine';

const IS_MACOS   = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InputDevice {
  id:        string;    // unique identifier (USB product ID or PnP instance)
  name:      string;
  type:      'keyboard' | 'mouse' | 'other';
  transport: 'usb' | 'bluetooth' | 'unknown';
  connected: boolean;
}

export interface DeviceChangeEvent {
  timestamp:  number;
  added:      InputDevice[];
  removed:    InputDevice[];
  current:    InputDevice[];
}

// ── Watcher state ─────────────────────────────────────────────────────────────

let _timer:   ReturnType<typeof setInterval> | null = null;
let _running  = false;
let _known    = new Map<string, InputDevice>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) =>
      resolve(err ? '' : (stdout ?? '').trim()),
    );
  });
}

function runPs(script: string, timeoutMs = 8000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve => {
    exec(
      `powershell.exe -NonInteractive -NoProfile -EncodedCommand ${encoded}`,
      { timeout: timeoutMs },
      (err, stdout) => resolve(err ? '' : (stdout ?? '').trim()),
    );
  });
}

// ── macOS device scan ─────────────────────────────────────────────────────────

const MACOS_KEYBOARD_KEYWORDS = ['keyboard', 'kbd', 'keypad'];
const MACOS_MOUSE_KEYWORDS    = ['mouse', 'trackpad', 'trackball', 'pointer'];

async function scanMacOSDevices(): Promise<InputDevice[]> {
  const devices: InputDevice[] = [];

  // USB devices
  try {
    const raw = await run(`system_profiler SPUSBDataType -json 2>/dev/null`, 10_000);
    if (raw) {
      const data = JSON.parse(raw) as { SPUSBDataType?: Array<Record<string, unknown>> };
      const usbItems = data.SPUSBDataType ?? [];
      flattenUSBItems(usbItems, devices, 'usb');
    }
  } catch { /* skip */ }

  // Bluetooth devices
  try {
    const raw = await run(`system_profiler SPBluetoothDataType -json 2>/dev/null`, 10_000);
    if (raw) {
      const data = JSON.parse(raw) as { SPBluetoothDataType?: unknown[] };
      extractBluetoothDevices(data.SPBluetoothDataType ?? [], devices);
    }
  } catch { /* skip */ }

  return devices;
}

function flattenUSBItems(
  items: Array<Record<string, unknown>>,
  out:   InputDevice[],
  transport: 'usb' | 'bluetooth',
): void {
  for (const item of items) {
    const name = String(item._name ?? item.name ?? '');
    if (!name) continue;

    const nameLower = name.toLowerCase();
    const isKeyboard = MACOS_KEYBOARD_KEYWORDS.some(k => nameLower.includes(k));
    const isMouse    = MACOS_MOUSE_KEYWORDS.some(k => nameLower.includes(k));
    if (!isKeyboard && !isMouse) {
      // recurse into _items
      const sub = (item._items ?? []) as Array<Record<string, unknown>>;
      if (sub.length) flattenUSBItems(sub, out, transport);
      continue;
    }

    const id = String(item.vendor_id ?? '') + ':' + String(item.product_id ?? name);
    out.push({
      id,
      name,
      type:      isKeyboard ? 'keyboard' : 'mouse',
      transport,
      connected: true,
    });

    const sub = (item._items ?? []) as Array<Record<string, unknown>>;
    if (sub.length) flattenUSBItems(sub, out, transport);
  }
}

function extractBluetoothDevices(
  items: unknown[],
  out:   InputDevice[],
): void {
  // BT data has nested structure: [{connected_devices: {hand_free_device: {…}}}]
  function recurse(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(recurse); return; }
    const record = obj as Record<string, unknown>;
    const name   = String(record.device_name ?? record._name ?? '');
    if (name) {
      const lower = name.toLowerCase();
      const isKeyboard = MACOS_KEYBOARD_KEYWORDS.some(k => lower.includes(k));
      const isMouse    = MACOS_MOUSE_KEYWORDS.some(k => lower.includes(k));
      if (isKeyboard || isMouse) {
        out.push({ id: `bt:${name}`, name, type: isKeyboard ? 'keyboard' : 'mouse', transport: 'bluetooth', connected: true });
      }
    }
    Object.values(record).forEach(recurse);
  }
  recurse(items);
}

// ── Windows device scan ───────────────────────────────────────────────────────

async function scanWindowsDevices(): Promise<InputDevice[]> {
  const script = `
$devices = Get-PnpDevice -Class Keyboard,Mouse -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'OK' }
foreach ($d in $devices) {
  $transport = if ($d.InstanceId -like '*BTHENUM*' -or $d.InstanceId -like '*BTHLE*') { 'bluetooth' } else { 'usb' }
  Write-Output "$($d.InstanceId)|$($d.FriendlyName)|$($d.Class)|$transport"
}
  `.trim();

  const out = await runPs(script, 10_000);
  const devices: InputDevice[] = [];

  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [id, name, cls, transport] = line.split('|');
    if (!id || !name) continue;
    const clsLower = (cls ?? '').toLowerCase();
    devices.push({
      id,
      name,
      type:      clsLower === 'keyboard' ? 'keyboard' : clsLower === 'mouse' ? 'mouse' : 'other',
      transport: (transport as 'usb' | 'bluetooth') ?? 'unknown',
      connected: true,
    });
  }

  return devices;
}

// ── Diff + emit ────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  const current = IS_MACOS
    ? await scanMacOSDevices()
    : IS_WINDOWS
      ? await scanWindowsDevices()
      : [];

  const currentMap = new Map(current.map(d => [d.id, d]));

  const added:   InputDevice[] = [];
  const removed: InputDevice[] = [];

  // Find newly connected
  for (const [id, dev] of currentMap) {
    if (!_known.has(id)) added.push(dev);
  }

  // Find disconnected
  for (const [id, dev] of _known) {
    if (!currentMap.has(id)) removed.push({ ...dev, connected: false });
  }

  _known = currentMap;

  if (added.length === 0 && removed.length === 0) return;

  const changeEvent: DeviceChangeEvent = {
    timestamp: Date.now(),
    added,
    removed,
    current,
  };

  eventBus.emit({
    type: 'INPUT_DEVICE_CHANGED' as never,
    ...changeEvent,
  } as never);

  // If a physical keyboard was added, emit OSK suggestion
  const keyboardAdded = added.some(d => d.type === 'keyboard');
  if (keyboardAdded) {
    eventBus.emit({
      type:    'KEYBOARD_DEVICE_CONNECTED' as never,
      device:  added.find(d => d.type === 'keyboard'),
      message: 'Physical keyboard detected. TriForge recommends using the on-screen keyboard for visible, approval-gated input.',
    } as never);
  }

  const keyboardRemoved = removed.some(d => d.type === 'keyboard');
  if (keyboardRemoved) {
    eventBus.emit({
      type:   'KEYBOARD_DEVICE_DISCONNECTED' as never,
      device: removed.find(d => d.type === 'keyboard'),
    } as never);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Start polling for device changes every 5 seconds. */
export function startDeviceWatcher(intervalMs = 5000): void {
  if (_running) return;
  _running = true;

  // Initial scan to populate baseline
  poll().catch(() => { /* non-critical */ });

  _timer = setInterval(() => {
    poll().catch(() => { /* swallow */ });
  }, intervalMs);
}

/** Stop the device watcher. */
export function stopDeviceWatcher(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _running = false;
  _known.clear();
}

/** Get the current list of connected input devices. */
export async function getConnectedDevices(): Promise<InputDevice[]> {
  if (IS_MACOS)   return scanMacOSDevices();
  if (IS_WINDOWS) return scanWindowsDevices();
  return [];
}

/** Check if any keyboard is currently connected. */
export async function hasPhysicalKeyboard(): Promise<boolean> {
  const devices = await getConnectedDevices();
  return devices.some(d => d.type === 'keyboard');
}
