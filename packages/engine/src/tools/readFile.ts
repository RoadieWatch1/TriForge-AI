import fs from 'fs';
import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const readFileDef: ToolDefinition = {
  name: 'read_file',
  description: 'Read the text contents of a file from the local filesystem.',
  category: 'files',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    path:     { type: 'string', description: 'Absolute path to the file to read' },
    maxChars: { type: 'number', description: 'Max characters to return (default 50000)' },
  },
};

export async function runReadFile(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const { path: filePath, maxChars = 50_000 } = args as { path: string; maxChars?: number };

  if (!filePath?.trim()) throw new Error('read_file: "path" is required');

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`read_file: file not found: ${filePath}`);
  }

  if (!stat.isFile()) throw new Error(`read_file: path is not a file: ${filePath}`);

  const MAX_BYTES = Number(maxChars) || 50_000;

  // Binary file guard — check first 512 bytes for null bytes
  if (stat.size > 0) {
    const sample = Buffer.alloc(Math.min(512, stat.size));
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, sample, 0, sample.length, 0);
    fs.closeSync(fd);
    if (sample.includes(0)) {
      throw new Error(`read_file: "${filePath}" appears to be a binary file`);
    }
  }

  const raw = fs.readFileSync(filePath, { encoding: 'utf8' });
  const truncated = raw.length > MAX_BYTES;

  return {
    path:      filePath,
    content:   truncated ? raw.slice(0, MAX_BYTES) : raw,
    truncated,
    size:      raw.length,
  };
}
