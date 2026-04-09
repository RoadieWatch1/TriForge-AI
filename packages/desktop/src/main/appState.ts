// Shared app-level flags — separate module to avoid circular imports
export let isQuitting = false;
export function markQuitting() { isQuitting = true; }
