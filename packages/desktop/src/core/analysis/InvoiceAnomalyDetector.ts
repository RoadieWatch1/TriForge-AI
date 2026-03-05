// ── InvoiceAnomalyDetector.ts — Detects anomalous costs in invoice files ───────
//
// Triggered by WorkspaceObserver 'file_added' / 'file_changed' events when the
// changed file resembles an invoice or receipt. Extracts monetary amounts via
// regex, compares against stored targets in CouncilMemoryGraph, and fires an
// 'autonomy:cost_anomaly' event if variance exceeds the configured threshold.
//
// Safety: read-only analysis — never writes files, never calls external services.
// Integration: hook into AutonomyController._scheduleScan or WorkspaceObserver
// 'file_added' event in ipc.ts startup block.

import fs from 'fs';
import path from 'path';
import { createLogger } from '../logging/log';

const log = createLogger('InvoiceAnomalyDetector');

// ── Configuration ──────────────────────────────────────────────────────────────

/** Percentage variance above stored target that triggers an anomaly alert. */
const ANOMALY_THRESHOLD_PCT = 15;

/** Maximum file size to read (avoid reading huge PDFs as text). */
const MAX_FILE_BYTES = 512_000;

/** Extensions considered invoice-like. */
const INVOICE_EXTENSIONS = new Set(['.txt', '.csv', '.json', '.html', '.htm', '.xml']);

/** Keywords that suggest a file is invoice/cost-related. */
const INVOICE_KEYWORDS = [
  'invoice', 'receipt', 'billing', 'payment', 'amount due', 'total due',
  'subtotal', 'grand total', 'purchase order', 'vendor', 'po#', 'inv#',
];

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AnomalyResult {
  filePath:       string;
  amounts:        number[];
  largestAmount:  number;
  targetAmount:   number | null;
  variancePct:    number | null;
  isAnomaly:      boolean;
  reason:         string;
}

// ── Amount extraction ──────────────────────────────────────────────────────────

/**
 * Extracts monetary amounts from raw text.
 * Handles: $1,234.56 | USD 1234.56 | 1,234.56 USD | 1234.56
 */
function extractAmounts(text: string): number[] {
  const pattern = /(?:USD|CAD|EUR|GBP|\$|£|€)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:USD|CAD|EUR|GBP)?/gi;
  const amounts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].replace(/,/g, '');
    const value = parseFloat(raw);
    if (!isNaN(value) && value >= 1) {  // ignore amounts < $1 (likely percentages or counts)
      amounts.push(value);
    }
  }
  // Deduplicate and sort descending
  return [...new Set(amounts)].sort((a, b) => b - a);
}

// ── Invoice detection ──────────────────────────────────────────────────────────

function isInvoiceLike(filePath: string, content: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!INVOICE_EXTENSIONS.has(ext)) return false;
  const lower = content.toLowerCase();
  return INVOICE_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Target amount lookup ───────────────────────────────────────────────────────

/**
 * Looks up the stored target amount for a vendor/file from architecture memory.
 * Key format: "invoice_target:<vendor>" where vendor is inferred from filename.
 * Returns null if no target is stored.
 */
function lookupTarget(filePath: string, architectureMemory: string): number | null {
  const vendor = path.basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');

  // Search memory context for a line like: invoice_target:<vendor> = <amount>
  const pattern = new RegExp(`invoice_target[:\\s]+${vendor}[:\\s]+(\\d+(?:\\.\\d+)?)`, 'i');
  const match = architectureMemory.match(pattern);
  if (match) return parseFloat(match[1]);

  // Fallback: look for any stored target in memory
  const genericPattern = /invoice_target\w*[:\s]+([\d]+(?:\.\d+)?)/i;
  const generic = architectureMemory.match(genericPattern);
  return generic ? parseFloat(generic[1]) : null;
}

// ── Main analysis ──────────────────────────────────────────────────────────────

/**
 * Analyzes a file for cost anomalies.
 * @param filePath    Absolute path to the file to analyze
 * @param memoryContext  Formatted output from CouncilMemoryGraph.buildMissionContext() —
 *                       used to look up stored target amounts.
 * @returns AnomalyResult, or null if the file is not invoice-like or unreadable.
 */
export function analyzeInvoiceFile(
  filePath: string,
  memoryContext: string,
): AnomalyResult | null {
  // Read file
  let content: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) return null;
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    log.warn(`Cannot read file "${filePath}":`, err);
    return null;
  }

  if (!isInvoiceLike(filePath, content)) return null;

  const amounts = extractAmounts(content);
  if (amounts.length === 0) return null;

  const largestAmount = amounts[0];
  const targetAmount  = lookupTarget(filePath, memoryContext);

  let variancePct: number | null = null;
  let isAnomaly = false;
  let reason = '';

  if (targetAmount !== null && targetAmount > 0) {
    variancePct = ((largestAmount - targetAmount) / targetAmount) * 100;
    isAnomaly   = Math.abs(variancePct) > ANOMALY_THRESHOLD_PCT;
    reason = isAnomaly
      ? `Amount $${largestAmount.toFixed(2)} is ${variancePct > 0 ? '+' : ''}${variancePct.toFixed(1)}% vs expected $${targetAmount.toFixed(2)}`
      : `Amount $${largestAmount.toFixed(2)} is within ${ANOMALY_THRESHOLD_PCT}% of expected $${targetAmount.toFixed(2)}`;
  } else {
    // No target stored — flag unusually large single amounts (> $10,000) as advisory
    isAnomaly = largestAmount > 10_000;
    reason = isAnomaly
      ? `Large amount detected ($${largestAmount.toFixed(2)}) with no stored target to compare against`
      : `No target stored for this vendor`;
  }

  log.info(
    `Analyzed "${path.basename(filePath)}" — largest: $${largestAmount.toFixed(2)}, anomaly: ${isAnomaly}`,
  );

  return { filePath, amounts, largestAmount, targetAmount, variancePct, isAnomaly, reason };
}

// ── Batch scanner ──────────────────────────────────────────────────────────────

/**
 * Scans a directory for invoice files and returns all anomaly results.
 * Called by AutonomyController or WorkspaceObserver handlers.
 */
export function scanDirectoryForAnomalies(
  dirPath: string,
  memoryContext: string,
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const result = analyzeInvoiceFile(path.join(dirPath, entry.name), memoryContext);
      if (result?.isAnomaly) anomalies.push(result);
    }
  } catch (err) {
    log.warn(`Cannot scan directory "${dirPath}":`, err);
  }
  return anomalies;
}
