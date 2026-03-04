import fs from 'fs';
import path from 'path';
import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const appendFileDef: ToolDefinition = {
  name: 'append_file',
  description: 'Append text content to an existing file (or create it if it does not exist).',
  category: 'files',
  riskLevel: 'medium',
  estimatedCostCents: 0,
  inputSchema: {
    path:    { type: 'string', description: 'Absolute path of the file to append to' },
    content: { type: 'string', description: 'Text content to append' },
  },
};

export async function runAppendFile(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const { path: filePath, content } = args as { path: string; content: string };

  if (!filePath?.trim()) throw new Error('append_file: "path" is required');
  if (typeof content !== 'string') throw new Error('append_file: "content" must be a string');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, content, 'utf8');

  const stat = fs.statSync(filePath);

  return {
    path:          filePath,
    bytesAppended: Buffer.byteLength(content, 'utf8'),
    newSize:       stat.size,
  };
}
