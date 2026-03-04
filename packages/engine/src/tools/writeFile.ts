import fs from 'fs';
import path from 'path';
import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const writeFileDef: ToolDefinition = {
  name: 'write_file',
  description: 'Write text content to a file on the local filesystem. Creates parent directories as needed.',
  category: 'files',
  riskLevel: 'medium',
  estimatedCostCents: 0,
  inputSchema: {
    path:    { type: 'string', description: 'Absolute path of the file to write' },
    content: { type: 'string', description: 'Text content to write' },
  },
};

export async function runWriteFile(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const { path: filePath, content } = args as { path: string; content: string };

  if (!filePath?.trim()) throw new Error('write_file: "path" is required');
  if (typeof content !== 'string') throw new Error('write_file: "content" must be a string');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    path:         filePath,
    bytesWritten: Buffer.byteLength(content, 'utf8'),
  };
}
