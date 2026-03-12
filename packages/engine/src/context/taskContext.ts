// ── taskContext.ts ────────────────────────────────────────────────────────────
//
// Session-scoped active task tracker.
// Detects task-creating messages by keyword presence + length heuristic.
// Injects context into AI prompts to keep council responses aligned with the
// user's current project.

const TASK_KEYWORDS = [
  'build', 'design', 'create', 'develop', 'plan', 'write', 'research',
  'make', 'launch', 'improve', 'fix', 'implement', 'generate', 'help me',
];

const TASK_RESET_COMMANDS = [
  'new task', 'clear task', 'start over', 'reset task',
];

let _activeTask: string | null = null;

/**
 * Analyse a user message. If it looks like a task-defining statement, store it
 * as the active context. If it is a reset command, clear the context.
 */
export function updateTaskContext(message: string): void {
  const lower = message.toLowerCase();

  if (TASK_RESET_COMMANDS.some(cmd => lower.includes(cmd))) {
    _activeTask = null;
    return;
  }

  if (message.length > 40 && TASK_KEYWORDS.some(k => lower.includes(k))) {
    _activeTask = message.slice(0, 200);
  }
}

/** Return the current active task, or null if none is set. */
export function getTaskContext(): string | null {
  return _activeTask;
}

/** Explicitly set the active task (e.g. from an external context loader). */
export function setTaskContext(task: string | null): void {
  _activeTask = task;
}

/** Clear the active task. */
export function clearTaskContext(): void {
  _activeTask = null;
}

/**
 * Build the system-prompt addendum for the active task.
 * Returns an empty string when no task is active.
 */
export function buildTaskContextAddendum(): string {
  if (!_activeTask) return '';
  return `\n\n--- ACTIVE TASK CONTEXT ---\nThe user is currently working on: "${_activeTask}"\nAll responses should help advance this task.`;
}
