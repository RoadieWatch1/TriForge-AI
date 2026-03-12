import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const fileOrganizeDef: ToolDefinition = {
  name: 'file_organize',
  description: 'Preview how files would be reorganized. DryRun only — does NOT move files.',
  category: 'files',
  riskLevel: 'medium',
  estimatedCostCents: 0,
  inputSchema: {
    dirHint: { type: 'string', description: 'Directory or file type hint (e.g. "downloads folder", "*.pdf")' },
    dryRun: { type: 'boolean', description: 'Always true in MVP — only preview changes' },
  },
};

interface FileOrganizeArgs {
  dirHint: string;
  dryRun?: boolean;
}

interface FileMovePreview {
  from: string;
  to: string;
}

interface FileOrganizeResult {
  preview: FileMovePreview[];
  totalFiles: number;
  estimatedTimeMs: number;
  note: string;
}

// Simulated file organization — shows a preview of what would happen
export async function runFileOrganize(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<FileOrganizeResult> {
  const { dirHint = 'files' } = args as unknown as FileOrganizeArgs;

  const categories = ['Documents', 'Images', 'Archives', 'Misc'];
  const extensions = ['.pdf', '.png', '.zip', '.txt'];
  const count = 6;

  const preview: FileMovePreview[] = Array.from({ length: count }, (_, i) => {
    const cat = categories[i % categories.length];
    const ext = extensions[i % extensions.length];
    return {
      from: `${dirHint}/file_${i + 1}${ext}`,
      to: `${dirHint}/${cat}/file_${i + 1}${ext}`,
    };
  });

  return {
    preview,
    totalFiles: count,
    estimatedTimeMs: count * 50,
    note: 'DRY RUN — no files were moved. Review and confirm to execute.',
  };
}
