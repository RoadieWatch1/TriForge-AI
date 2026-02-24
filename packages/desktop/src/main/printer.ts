import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status: string;
}

// ── List available printers ───────────────────────────────────────────────────

export async function listPrinters(): Promise<PrinterInfo[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'powershell -Command "Get-Printer | Select-Object Name,Default,PrinterStatus | ConvertTo-Json -Compress"',
        { timeout: 10000 },
      );
      const raw = JSON.parse(stdout.trim());
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.map((p: Record<string, unknown>) => ({
        name: String(p['Name'] ?? ''),
        isDefault: p['Default'] === true,
        status: String(p['PrinterStatus'] ?? 'Ready'),
      }));
    }

    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('lpstat -p 2>/dev/null || true', { timeout: 5000 });
      const defaultResult = await execAsync('lpstat -d 2>/dev/null || true', { timeout: 5000 });
      const defaultName = defaultResult.stdout.replace('system default destination:', '').trim();
      return stdout.split('\n')
        .filter(l => l.startsWith('printer '))
        .map(l => {
          const name = l.split(' ')[1] ?? '';
          return { name, isDefault: name === defaultName, status: 'Ready' };
        });
    }

    // Linux
    const { stdout } = await execAsync('lpstat -p 2>/dev/null || true', { timeout: 5000 });
    return stdout.split('\n')
      .filter(l => l.startsWith('printer '))
      .map(l => ({ name: l.split(' ')[1] ?? '', isDefault: false, status: 'Ready' }));

  } catch {
    return [];
  }
}

// ── Print a file ─────────────────────────────────────────────────────────────

export async function printFile(filePath: string, printerName?: string): Promise<{ ok: boolean; error?: string }> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  try {
    if (process.platform === 'win32') {
      const safe = filePath.replace(/'/g, "''");
      const printerArg = printerName ? `-PrinterName '${printerName.replace(/'/g, "''")}'` : '';
      await execAsync(
        `powershell -Command "Start-Process -FilePath '${safe}' -Verb Print ${printerArg} -PassThru | Out-Null"`,
        { timeout: 30000 },
      );
    } else {
      const printerArg = printerName ? `-d "${printerName}"` : '';
      await execAsync(`lp ${printerArg} "${filePath}"`, { timeout: 30000 });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Print plain text ──────────────────────────────────────────────────────────

export async function printText(content: string, printerName?: string): Promise<{ ok: boolean; error?: string }> {
  const tmpFile = path.join(os.tmpdir(), `triforge-print-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    return await printFile(tmpFile, printerName);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
  }
}
