// councilPipeline.ts — Legacy Council Pipeline + code-application helpers, extracted from panel.ts.

import * as vscode from 'vscode';
import * as path from 'path';
import { type ProviderName } from '@triforge/engine';
import { LS_CHECKOUT } from '../core/license';
import { checkLedgerConsent, saveLedgerRecord } from './ledger';
import { getRelPath } from './gitHandlers';
import {
  INTENSITY_POLICY,
  type RiskLevel, type ConsensusState, type DeadlockResolution,
  type IntensityLevel, type VersionCandidate,
  type DraftResult, type RiskAnalysis, type SeatVerdict, type CouncilDebate,
  type AlternativeProposal,
} from './panelTypes';
import type { PanelContext } from './panelContext';

const VALID_PROVIDERS: ProviderName[] = ['openai', 'grok', 'claude'];
function isValidProvider(v: unknown): v is ProviderName {
  return typeof v === 'string' && VALID_PROVIDERS.includes(v as ProviderName);
}

// ── Main entry ────────────────────────────────────────────────────────────

export async function runCouncilPipeline(
  ctx: PanelContext,
  prompt: string, originalCode: string, intensity: string
): Promise<void> {
  const allProviders = await ctx.providerManager.getActiveProviders();
  if (allProviders.length >= 2) {
    const lic = await ctx.licenseManager.getStatus();
    if (!lic.isCouncilAllowed) {
      ctx.send({
        type: 'license-gate',
        message: 'Your 1-day trial has ended. Subscribe to TriForge AI Code Council to unlock full multi-model deliberation. Solo mode (1 provider) is always free.',
        checkoutUrl: LS_CHECKOUT,
      });
      return;
    }
  }

  ctx.getAbortController()?.abort();
  ctx.setAbortController(new AbortController());
  const signal = ctx.getAbortController()!.signal;

  const prevSession = ctx.getSession();
  ctx.setSession({
    id: Date.now().toString(36), prompt,
    originalCode: originalCode ?? '',
    phase: 'DRAFTING', intensity: ctx.getIntensityState().level.toLowerCase(), viewMode: 'SUMMARY',
    contextFiles: prevSession?.contextFiles ?? {},
    filePath: prevSession?.filePath,
    fullFileContent: prevSession?.fullFileContent,
  });

  ctx.setLastActiveMode('council');

  ctx.getUnavailableProviders().clear();
  const activeProviders = await ctx.providerManager.getActiveProviders();
  const councilMode =
    activeProviders.length >= 3 ? 'FULL' :
    activeProviders.length === 2 ? 'PARTIAL' : 'SOLO';
  ctx.setCouncilMode(councilMode);
  ctx.send({ type: 'council-mode', mode: councilMode });

  try {
    ctx.send({ type: 'phase', phase: 'DRAFTING', message: 'Generating fast draft\u2026' });
    const draft = await generateFastDraft(ctx, prompt, originalCode, signal);
    if (signal.aborted) { return; }
    const session = ctx.getSession()!;
    session.draft = draft;
    ctx.send({ type: 'draft-ready', draft });

    ctx.send({ type: 'phase', phase: 'RISK_CHECK', message: 'Analysing risk\u2026' });
    const risk = analyzeRisk(draft.code);
    session.risk = risk;
    ctx.send({ type: 'risk-result', risk });

    if (ctx.getIntensityState().mode === 'ADAPTIVE') {
      const fp = vscode.window.activeTextEditor?.document.fileName ?? '';
      ctx.getIntensityState().level = determineIntensity(fp, risk);
      ctx.send({
        type: 'intensity-resolved',
        level: ctx.getIntensityState().level,
        reason: buildIntensityReason(fp, risk),
      });
      session.intensity = ctx.getIntensityState().level.toLowerCase();
    }
    const effectiveIntensity = ctx.getIntensityState().level.toLowerCase();
    const policy = INTENSITY_POLICY[ctx.getIntensityState().level];

    if (councilMode === 'SOLO') {
      session.phase = 'COMPLETE';
      session.consensus = 'UNANIMOUS';
      session.finalCode = draft.code;
      ctx.send({ type: 'session-complete', consensus: 'UNANIMOUS', finalCode: draft.code, verdicts: [] });
      checkLedgerConsent(ctx.getLedger());
      saveLedgerRecord(ctx.getLedger(), {
        timestamp: Date.now(), prompt, draftAuthor: draft.provider,
        councilMode: 'SOLO', riskLevel: risk.level,
        confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
        consensus: 'UNANIMOUS', intensity: effectiveIntensity,
      });
      return;
    }

    if (!policy.requireVote && risk.level === 'LOW') {
      session.phase = 'COMPLETE';
      session.consensus = 'UNANIMOUS';
      session.finalCode = draft.code;
      ctx.send({ type: 'session-complete', consensus: 'UNANIMOUS', finalCode: draft.code, verdicts: [] });
      checkLedgerConsent(ctx.getLedger());
      saveLedgerRecord(ctx.getLedger(), {
        timestamp: Date.now(), prompt, draftAuthor: draft.provider,
        councilMode, riskLevel: risk.level,
        confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
        consensus: 'UNANIMOUS', intensity: effectiveIntensity,
      });
      return;
    }

    ctx.send({ type: 'phase', phase: 'CRITIQUE', message: 'Council review initiated\u2026' });
    let verdicts = await runCrossCritique(ctx, prompt, draft, originalCode, signal);
    if (signal.aborted) { return; }

    if (policy.critiquePasses >= 2 && verdicts.length > 0 && !signal.aborted) {
      ctx.send({ type: 'phase', phase: 'CRITIQUE', message: 'Second critique pass\u2026' });
      verdicts = await runSecondCritiquePass(ctx, prompt, draft, verdicts, originalCode, signal);
      if (signal.aborted) { return; }
    }
    session.verdicts = verdicts;

    let interimConsensus = computeConsensus(verdicts);

    if (ctx.getIntensityState().level === 'RUTHLESS' && hasCriticalObjection(verdicts)) {
      await handleCriticalObjection(ctx, prompt, draft, verdicts, originalCode, signal);
      return;
    }

    let deadlockResolution: DeadlockResolution | undefined;
    let userOverride = false;
    if (interimConsensus === 'SPLIT' || interimConsensus === 'BLOCKED') {
      const versions: VersionCandidate[] = [{ provider: draft.provider, code: draft.code, reasoning: draft.reasoning }];
      for (const v of verdicts.filter(v2 => !v2.agrees)) {
        const alt = await generateAlternativeQuiet(ctx, v.provider, prompt, draft.code, originalCode, signal);
        if (alt) { versions.push(alt); }
      }
      if (signal.aborted) { return; }
      ctx.send({ type: 'deadlock', versions });

      const resolution = await waitForDeadlockResolution(ctx, signal);
      if (signal.aborted) { return; }
      deadlockResolution = resolution.action;

      let finalCode = draft.code;
      if (resolution.action === 'ESCALATE') {
        const lvls: IntensityLevel[] = ['COOPERATIVE', 'ANALYTICAL', 'CRITICAL', 'RUTHLESS'];
        const ci = lvls.indexOf(ctx.getIntensityState().level);
        if (ci < lvls.length - 1) { ctx.getIntensityState().level = lvls[ci + 1]; }
        ctx.send({ type: 'phase', phase: 'CRITIQUE', message: 'Escalated intensity. Re-reviewing\u2026' });
        verdicts = await runCrossCritique(ctx, prompt, draft, originalCode, signal);
        if (signal.aborted) { return; }
        session.verdicts = verdicts;
        interimConsensus = computeConsensus(verdicts);
        finalCode = draft.code;
      } else if (resolution.action === 'USER_DECIDES') {
        const chosen = versions.find(v => v.provider === resolution.selectedVersion);
        finalCode = chosen?.code ?? draft.code;
        userOverride = true;
        interimConsensus = 'MAJORITY';
      } else if (resolution.action === 'SYNTHESIS') {
        finalCode = await runForceSynthesis(ctx, prompt, versions, signal);
        if (signal.aborted) { return; }
        interimConsensus = 'MAJORITY';
      } else if (resolution.action === 'EXTENDED_DEBATE') {
        finalCode = await runExtendedDebate(ctx, prompt, versions, signal);
        if (signal.aborted) { return; }
        interimConsensus = 'MAJORITY';
      }

      session.phase = 'COMPLETE';
      session.finalCode = finalCode;
      session.consensus = interimConsensus;
      ctx.send({ type: 'session-complete', consensus: interimConsensus, finalCode, verdicts });
      checkLedgerConsent(ctx.getLedger());
      saveLedgerRecord(ctx.getLedger(), {
        timestamp: Date.now(), prompt, draftAuthor: draft.provider,
        councilMode, riskLevel: risk.level,
        confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
        consensus: interimConsensus, intensity: effectiveIntensity,
        deadlockResolution, userOverride,
      });
      return;
    }

    const avgConf = verdicts.length
      ? verdicts.reduce((s, v) => s + v.confidence, 0) / verdicts.length : 100;
    let finalCode = draft.code;
    if (
      verdicts.length >= 2 &&
      (interimConsensus === 'MAJORITY' ||
       effectiveIntensity === 'critical' || effectiveIntensity === 'ruthless' ||
       (policy.confidenceThreshold > 0 && avgConf < policy.confidenceThreshold))
    ) {
      ctx.send({ type: 'phase', phase: 'DEBATE', message: 'Strategist revising implementation\u2026' });
      const debate = await runDebatePipeline(ctx, prompt, draft, verdicts, originalCode, signal);
      if (!signal.aborted && debate) {
        session.debate = debate;
        ctx.send({ type: 'debate-complete', debate });
        finalCode = debate.finalCode || draft.code;
      }
    }

    if (signal.aborted) { return; }

    session.phase = 'COMPLETE';
    session.finalCode = finalCode;
    const finalConsensus = computeConsensus(verdicts);
    session.consensus = finalConsensus;
    ctx.send({ type: 'session-complete', consensus: finalConsensus, finalCode, verdicts });
    checkLedgerConsent(ctx.getLedger());
    saveLedgerRecord(ctx.getLedger(), {
      timestamp: Date.now(), prompt, draftAuthor: draft.provider,
      councilMode, riskLevel: risk.level,
      confidenceInitial: draft.confidence,
      confidenceFinal: session.debate?.confidenceFinal ?? draft.confidence,
      consensus: finalConsensus, intensity: effectiveIntensity,
      deadlockResolution, userOverride,
    });

  } catch (err: any) {
    if (err?.name === 'AbortError' || signal.aborted) { return; }
    ctx.send({ type: 'error', message: err?.message ?? 'Council pipeline failed.' });
  } finally {
    ctx.setAbortController(null);
  }
}

// ── Code application ──────────────────────────────────────────────────────

export async function applyFinalCode(ctx: PanelContext): Promise<void> {
  if (!ctx.getSession()?.finalCode) {
    ctx.send({ type: 'error', message: 'No final code to apply.' });
    return;
  }
  await applyCode(ctx, ctx.getSession()!.finalCode!);
}

export async function applyDraftCode(ctx: PanelContext): Promise<void> {
  if (!ctx.getSession()?.draft?.code) {
    ctx.send({ type: 'error', message: 'No draft code to apply.' });
    return;
  }
  ctx.getAbortController()?.abort();
  ctx.setAbortController(null);
  const session = ctx.getSession();
  if (session) { session.phase = 'BYPASSED'; }
  ctx.send({ type: 'phase', phase: 'BYPASSED', message: 'Draft applied \u2014 council bypassed.' });
  await applyCode(ctx, ctx.getSession()!.draft!.code);
}

export async function applyCode(ctx: PanelContext, code: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('TriForge AI: Open a file in the editor to apply code.');
    return;
  }

  const newDoc = await vscode.workspace.openTextDocument({ content: code, language: editor.document.languageId });
  await vscode.commands.executeCommand('vscode.diff', editor.document.uri, newDoc.uri, 'TriForge AI \u2014 Proposed Changes');

  const risk      = ctx.getSession()?.risk?.level ?? '\u2014';
  const consensus = ctx.getSession()?.consensus ?? '\u2014';
  const conf      = ctx.getSession()?.draft?.confidence ?? '\u2014';
  const choice = await vscode.window.showInformationMessage(
    `Apply TriForge patch?\n\nRisk: ${risk}  |  Consensus: ${consensus}  |  Confidence: ${conf}%  |  Council: ${ctx.getCouncilMode()}`,
    { modal: true }, 'Apply', 'Cancel'
  );
  if (choice !== 'Apply') {
    ctx.send({ type: 'apply-cancelled' });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    return;
  }

  if (ctx.getIntensityState().level === 'RUTHLESS') {
    const second = await vscode.window.showWarningMessage(
      `RUTHLESS mode \u2014 final confirmation.\n\nRisk: ${risk}  |  Council: ${ctx.getCouncilMode()}\nThis code passed adversarial scrutiny. Apply anyway?`,
      { modal: true }, 'Confirm Apply', 'Cancel'
    );
    if (second !== 'Confirm Apply') {
      ctx.send({ type: 'apply-cancelled' });
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      return;
    }
  }

  await vscode.window.showTextDocument(editor.document);
  await editor.edit(b => {
    const doc = editor.document;
    b.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), code);
  });
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  const fp = path.basename(editor.document.fileName);
  ctx.send({ type: 'apply-done', filePath: fp });
  vscode.window.showInformationMessage(`TriForge AI: Code applied to ${fp}`);
}

// ── Intensity / Alternative / Vote ────────────────────────────────────────

export function escalateIntensity(ctx: PanelContext): void {
  const session = ctx.getSession();
  if (!session) { return; }
  const levels = ['analytical', 'combative', 'ruthless'];
  const idx = levels.indexOf(session.intensity);
  if (idx < levels.length - 1) {
    session.intensity = levels[idx + 1];
    ctx.send({ type: 'escalated', intensity: session.intensity });
  } else {
    ctx.send({ type: 'error', message: 'Already at maximum intensity (ruthless).' });
  }
}

export async function generateAlternative(ctx: PanelContext, provider: string): Promise<void> {
  const session = ctx.getSession();
  if (!session || !isValidProvider(provider)) { return; }
  const p = await ctx.providerManager.getProvider(provider as ProviderName);
  if (!p) {
    ctx.send({ type: 'error', message: `${provider} is not configured.` });
    return;
  }
  const dissenting = session.verdicts?.find(v => v.provider === provider && !v.agrees);
  const objectionText = dissenting ? dissenting.objections.join('; ') : 'General dissent with proposed implementation';

  try {
    ctx.setAbortController(new AbortController());
    const raw = await p.chat([
      { role: 'system', content:
        'You raised objections to the proposed implementation. Now provide your alternative.\n' +
        'Return ONLY valid JSON \u2014 no markdown fences:\n' +
        '{"reasoning":"why your approach is better (2-3 sentences)","implementation":"...complete code...",' +
        '"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100}' },
      { role: 'user', content:
        `Task: ${session.prompt}\n\nRejected implementation:\n\`\`\`\n${session.draft?.code ?? ''}\n\`\`\`\n\n` +
        `Your objections: ${objectionText}\n\nNow provide your complete alternative implementation.` },
    ], ctx.getAbortController()!.signal);

    const parsed = parseJson<{ reasoning: string; implementation: string; riskLevel: string; confidence: number }>(raw);
    const alt: AlternativeProposal = {
      provider,
      reasoning:      parsed.reasoning      ?? '',
      implementation: parsed.implementation ?? '',
      riskLevel:      (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
      confidence:     typeof parsed.confidence === 'number' ? parsed.confidence : 70,
    };
    const s = ctx.getSession();
    if (s) { s.alternative = alt; }
    ctx.send({ type: 'alternative-ready', alternative: alt });
  } catch (err: any) {
    if (!ctx.getAbortController()?.signal.aborted) {
      ctx.send({ type: 'error', message: err?.message ?? 'Failed to generate alternative.' });
    }
  } finally {
    ctx.setAbortController(null);
  }
}

export async function voteOnAlternative(ctx: PanelContext): Promise<void> {
  const session = ctx.getSession();
  if (!session?.alternative) { return; }
  const alt = session.alternative;
  const altDraft: DraftResult = {
    code: alt.implementation, reasoning: alt.reasoning,
    provider: alt.provider, confidence: alt.confidence,
    preliminaryRisk: alt.riskLevel,
  };
  session.draft = altDraft;
  session.alternative = undefined;
  ctx.send({ type: 'draft-ready', draft: altDraft });

  ctx.setAbortController(new AbortController());
  try {
    const verdicts = await runCrossCritique(ctx, session.prompt, altDraft, session.originalCode, ctx.getAbortController()!.signal);
    session.verdicts = verdicts;
    const consensus = computeConsensus(verdicts);
    session.consensus = consensus;
    session.finalCode = alt.implementation;
    ctx.send({ type: 'session-complete', consensus, finalCode: alt.implementation, verdicts });
  } catch (err: any) {
    if (!ctx.getAbortController()?.signal.aborted) {
      ctx.send({ type: 'error', message: err?.message ?? 'Vote on alternative failed.' });
    }
  } finally {
    ctx.setAbortController(null);
  }
}

export async function adoptAlternative(ctx: PanelContext): Promise<void> {
  const session = ctx.getSession();
  if (!session?.alternative) { return; }
  const code = session.alternative.implementation;
  session.finalCode = code;
  await applyCode(ctx, code);
}

// ── Internal helpers ──────────────────────────────────────────────────────

function parseJson<T>(raw: string): Partial<T> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { text = fence[1].trim(); }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) { text = text.slice(start, end + 1); }
  try { return JSON.parse(text) as T; } catch { return {} as Partial<T>; }
}

async function withTimeout<T>(ctx: PanelContext, fn: () => Promise<T>, provider: string, signal: AbortSignal, ms = 8000): Promise<T | null> {
  if (ctx.getUnavailableProviders().has(provider)) { return null; }
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      ctx.getUnavailableProviders().add(provider);
      ctx.send({ type: 'provider-offline', provider });
      resolve(null);
    }, ms);
    fn().then(v => { clearTimeout(timer); resolve(v); })
       .catch(err => { clearTimeout(timer); if (err?.name === 'AbortError' || signal.aborted) { resolve(null); } else { resolve(null); } });
  });
}

function buildContextBlock(ctx: PanelContext): string {
  const parts: string[] = [];
  const session = ctx.getSession();
  if (session?.fullFileContent && session.filePath) {
    const rel = getRelPath(session.filePath);
    const lines = session.fullFileContent.split('\n').slice(0, 200).join('\n');
    parts.push(`### Current File: ${rel}\n\`\`\`\n${lines}\n\`\`\``);
  }
  for (const [rel, content] of Object.entries(session?.contextFiles ?? {})) {
    parts.push(`### Context: ${rel}\n\`\`\`\n${content}\n\`\`\``);
  }
  return parts.length ? '\n\n## Workspace Context\n' + parts.join('\n\n') : '';
}

function getProviderDirective(provider: string, intensity: IntensityLevel): string {
  if (provider === 'grok') {
    const m: Record<IntensityLevel, string> = {
      COOPERATIVE: 'Light edge-case suggestions only. Do not reject.',
      ANALYTICAL:  'Moderate skepticism. Identify structural weaknesses and flag performance issues.',
      CRITICAL:    'Actively search for failure cases. Challenge assumptions. Identify scaling risks. Question architectural decisions.',
      RUTHLESS:    'Assume adversarial conditions. Attempt to break this implementation. Simulate misuse scenarios. Reject if fundamental flaws exist. Provide concrete fixes for every objection.',
    };
    return `\nIntensity directive for your role as challenger: ${m[intensity]}`;
  }
  if (provider === 'claude') {
    const m: Record<IntensityLevel, string> = {
      COOPERATIVE: 'Minimal critique. Accept if generally sound.',
      ANALYTICAL:  'Moderate architectural depth. Flag structural concerns and maintainability issues.',
      CRITICAL:    'Deep multi-layer structural and scalability analysis. Long-term maintainability focus.',
      RUTHLESS:    'Maximum reasoning depth. Model long-term scaling and systemic risk. Remain calm and precise.',
    };
    return `\nIntensity directive for your role as architect: ${m[intensity]}`;
  }
  return '\nProvide balanced, structured engineering review.';
}

function determineIntensity(filePath: string, risk: RiskAnalysis): IntensityLevel {
  if (risk.level === 'CRITICAL') { return 'RUTHLESS'; }
  if (/auth|token|jwt|payment|secret|vault/i.test(filePath)) { return 'CRITICAL'; }
  if (risk.level === 'HIGH') { return 'CRITICAL'; }
  if (/\.test\.|\.spec\.|__tests__|\.stories\.|\.md$|\.txt$/i.test(filePath)) { return 'COOPERATIVE'; }
  return 'ANALYTICAL';
}

function buildIntensityReason(filePath: string, risk: RiskAnalysis): string {
  if (risk.level === 'CRITICAL') { return 'Risk level is CRITICAL \u2014 maximum scrutiny required.'; }
  if (/auth|token|jwt|payment|secret|vault/i.test(filePath)) { return 'Security-sensitive file detected in path.'; }
  if (risk.level === 'HIGH') { return 'Risk level is HIGH \u2014 elevated scrutiny applied.'; }
  if (/\.test\.|\.spec\.|__tests__|\.stories\./i.test(filePath)) { return 'Test/story file \u2014 cooperative review.'; }
  if (/\.md$|\.txt$/i.test(filePath)) { return 'Documentation file \u2014 cooperative review.'; }
  return 'Standard analytical review.';
}

function analyzeRisk(code: string): RiskAnalysis {
  const triggers: string[] = [];
  if (/eval\(|execSync|child_process/.test(code))          triggers.push('Security: code execution pattern');
  if (/password|apiKey|secret|privateKey/i.test(code) && /=\s*['"]/.test(code))
                                                            triggers.push('Security: potential secret hardcoding');
  if (/SELECT|INSERT|UPDATE|DELETE/i.test(code) && /\+/.test(code))
                                                            triggers.push('Security: SQL concatenation risk');
  if (/export\s+(default\s+)?(class|function|const|interface)/.test(code))
                                                            triggers.push('Public API surface change');
  if (/rm\s+-rf|DROP\s+TABLE|delete\s+\w+\s*\(/i.test(code)) triggers.push('Destructive operation');
  if (code.split('\n').length > 120)                        triggers.push(`High complexity: ${code.split('\n').length} lines`);
  if (/\.then\(.*\.then\(/s.test(code))                     triggers.push('Async: nested promise chains');
  const level: RiskLevel =
    triggers.length === 0 ? 'LOW' :
    triggers.length <= 2  ? 'MEDIUM' :
    triggers.length <= 4  ? 'HIGH' : 'CRITICAL';
  return { level, triggers };
}

function computeConsensus(verdicts: SeatVerdict[]): ConsensusState {
  if (verdicts.length === 0) { return 'UNANIMOUS'; }
  const agrees    = verdicts.filter(v => v.agrees).length;
  const disagrees = verdicts.length - agrees;
  if (disagrees === 0)      { return 'UNANIMOUS'; }
  if (agrees > disagrees)   { return 'MAJORITY';  }
  if (agrees === disagrees) { return 'SPLIT';     }
  return 'BLOCKED';
}

function hasCriticalObjection(verdicts: SeatVerdict[]): boolean {
  return verdicts.some(v => !v.agrees || v.riskLevel === 'CRITICAL');
}

function waitForDeadlockResolution(ctx: PanelContext, signal: AbortSignal): Promise<{ action: DeadlockResolution; selectedVersion?: string }> {
  return new Promise((resolve) => {
    ctx.setDeadlockResolve(resolve);
    signal.addEventListener('abort', () => {
      ctx.setDeadlockResolve(null);
      resolve({ action: 'ESCALATE' });
    }, { once: true });
  });
}

async function generateFastDraft(ctx: PanelContext, prompt: string, originalCode: string, signal: AbortSignal): Promise<DraftResult> {
  const providers = await ctx.providerManager.getActiveProviders();
  if (providers.length === 0) { throw new Error('No API keys configured. Add at least one provider key in Settings.'); }

  const systemPrompt =
    'You are the Strategist. Generate a production-ready implementation.\n' +
    'Return ONLY valid JSON \u2014 no markdown fences, no text outside the JSON object:\n' +
    '{"code":"...","reasoning":"2-3 sentences","confidence":0-100,' +
    '"preliminaryRisk":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"}';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Task: ${prompt}\n\nOriginal context:\n${originalCode || '(empty \u2014 new implementation)'}${buildContextBlock(ctx)}` },
  ];

  const ordered = [
    providers.find(p => p.name === 'grok'),
    providers.find(p => p.name === 'openai'),
    providers.find(p => p.name === 'claude'),
    ...providers,
  ].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i) as typeof providers;

  let raw: string | null = null;
  let chosenProvider = providers[0];
  for (const p of ordered) {
    if (ctx.getUnavailableProviders().has(p.name)) { continue; }
    raw = await withTimeout(ctx, () => p.chat(messages as any, signal), p.name, signal);
    if (raw !== null) { chosenProvider = p; break; }
  }
  if (raw === null) { throw new Error('All providers timed out. Check your connection and API keys.'); }

  const parsed = parseJson<{ code: string; reasoning: string; confidence: number; preliminaryRisk: string }>(raw);
  return {
    code:            parsed.code ?? '',
    reasoning:       parsed.reasoning ?? '',
    provider:        chosenProvider.name,
    confidence:      typeof parsed.confidence === 'number' ? parsed.confidence : 75,
    preliminaryRisk: (parsed.preliminaryRisk as RiskLevel) ?? 'MEDIUM',
  };
}

async function runCrossCritique(ctx: PanelContext, prompt: string, draft: DraftResult, originalCode: string, signal: AbortSignal): Promise<SeatVerdict[]> {
  const providers = await ctx.providerManager.getActiveProviders();
  let critics = providers.filter(p => p.name !== draft.provider);
  if (critics.length === 0) { critics = [...providers]; }

  const systemPromptBase =
    'You are reviewing code proposed by another AI. Return ONLY valid JSON \u2014 no markdown fences:\n' +
    '{"agrees":true|false,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100,' +
    '"objections":["..."],"suggestedChanges":["..."]}\n' +
    'Be concise. Only set "agrees":false for genuine problems.';

  const userMessage =
    `Original task: ${prompt}\n\nProposed implementation:\n\`\`\`\n${draft.code}\n\`\`\`\n\n` +
    `Original code:\n${originalCode || '(new implementation)'}${buildContextBlock(ctx)}`;

  const results = await Promise.all(critics.map(async (critic): Promise<SeatVerdict | null> => {
    if (ctx.getUnavailableProviders().has(critic.name)) { return null; }
    const systemPrompt = systemPromptBase + getProviderDirective(critic.name, ctx.getIntensityState().level);
    try {
      const raw = await withTimeout(ctx, () => critic.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ] as any, signal), critic.name, signal);
      if (raw === null) { return null; }
      const parsed = parseJson<{ agrees: boolean; riskLevel: string; confidence: number; objections: string[]; suggestedChanges: string[] }>(raw);
      const verdict: SeatVerdict = {
        provider:         critic.name,
        agrees:           typeof parsed.agrees === 'boolean' ? parsed.agrees : true,
        riskLevel:        (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
        confidence:       typeof parsed.confidence === 'number' ? parsed.confidence : 70,
        objections:       Array.isArray(parsed.objections)       ? parsed.objections       : [],
        suggestedChanges: Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [],
      };
      ctx.send({ type: 'verdict', verdict });
      return verdict;
    } catch (err: any) {
      if (signal.aborted) { throw err; }
      const fallback: SeatVerdict = { provider: critic.name, agrees: true, riskLevel: 'LOW', confidence: 60, objections: [], suggestedChanges: [] };
      ctx.send({ type: 'verdict', verdict: fallback });
      return fallback;
    }
  }));
  return results.filter((v): v is SeatVerdict => v !== null);
}

async function runDebatePipeline(ctx: PanelContext, prompt: string, draft: DraftResult, verdicts: SeatVerdict[], originalCode: string, signal: AbortSignal): Promise<CouncilDebate | null> {
  const providers = await ctx.providerManager.getActiveProviders();
  if (providers.length === 0) { return null; }

  const disagreeing = verdicts.filter(v => !v.agrees);
  const critiqueText = disagreeing.length > 0
    ? disagreeing.map(v => `${v.provider}: ${v.objections.join('; ')}`).join('\n')
    : verdicts.map(v => `${v.provider} (suggestions): ${v.suggestedChanges.join('; ')}`).join('\n');

  const strategist = providers.find(p => p.name === draft.provider) ?? providers[0];
  const strategistDirective = getProviderDirective(strategist.name, ctx.getIntensityState().level)
    .replace('challenger', 'strategist').replace('architect', 'strategist');
  const systemPrompt =
    'You are the Strategist revising your implementation based on council feedback.\n' +
    'Return ONLY valid JSON \u2014 no markdown fences:\n' +
    '{"proposal":"...","critique":"...","revision":"...","final":"...",' +
    '"finalCode":"...full revised code...","confidenceInitial":0-100,' +
    '"confidenceAfterCritique":0-100,"confidenceFinal":0-100}' +
    strategistDirective;

  try {
    const raw = await strategist.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content:
        `Original task: ${prompt}\n\nYour original implementation:\n\`\`\`\n${draft.code}\n\`\`\`\n\n` +
        `Council critique:\n${critiqueText}\n\nRevise addressing the concerns. ` +
        `If objections are invalid, explain why and keep original.${buildContextBlock(ctx)}` },
    ], signal);
    const parsed = parseJson<CouncilDebate>(raw);
    return {
      proposal:                parsed.proposal                ?? '',
      critique:                parsed.critique                ?? '',
      revision:                parsed.revision                ?? '',
      final:                   parsed.final                   ?? '',
      finalCode:               parsed.finalCode               ?? draft.code,
      confidenceInitial:       typeof parsed.confidenceInitial       === 'number' ? parsed.confidenceInitial       : draft.confidence,
      confidenceAfterCritique: typeof parsed.confidenceAfterCritique === 'number' ? parsed.confidenceAfterCritique : draft.confidence - 5,
      confidenceFinal:         typeof parsed.confidenceFinal         === 'number' ? parsed.confidenceFinal         : draft.confidence + 5,
    };
  } catch (err: any) {
    if (signal.aborted) { throw err; }
    return null;
  }
}

async function runSecondCritiquePass(ctx: PanelContext, prompt: string, draft: DraftResult, firstVerdicts: SeatVerdict[], originalCode: string, signal: AbortSignal): Promise<SeatVerdict[]> {
  const providers = await ctx.providerManager.getActiveProviders();
  let critics = providers.filter(p => p.name !== draft.provider);
  if (critics.length === 0) { critics = [...providers]; }

  const firstVerdictSummary = firstVerdicts.map(v =>
    `${v.provider}: ${v.agrees ? 'AGREE' : 'DISAGREE'} (${v.confidence}%)${v.objections.length ? ' — ' + v.objections.slice(0, 2).join('; ') : ''}`
  ).join('\n');

  const systemPrompt =
    'You are reviewing code in a second critique pass. The council has already provided first-pass verdicts.\n' +
    'Return ONLY valid JSON \u2014 no markdown fences:\n' +
    '{"agrees":true|false,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100,' +
    '"objections":["..."],"suggestedChanges":["..."]}\n' +
    'Refine your analysis based on the collective first-pass findings.';

  const userMessage =
    `Original task: ${prompt}\n\nProposed implementation:\n\`\`\`\n${draft.code}\n\`\`\`\n\n` +
    `Original code:\n${originalCode || '(new implementation)'}\n\n` +
    `First-pass council verdicts:\n${firstVerdictSummary}\n\n` +
    `Provide your final verdict accounting for the council's prior analysis.${buildContextBlock(ctx)}`;

  const results = await Promise.all(critics.map(async (critic): Promise<SeatVerdict | null> => {
    if (ctx.getUnavailableProviders().has(critic.name)) { return null; }
    const sp = systemPrompt + getProviderDirective(critic.name, ctx.getIntensityState().level);
    try {
      const raw = await withTimeout(ctx, () => critic.chat([
        { role: 'system', content: sp },
        { role: 'user', content: userMessage },
      ] as any, signal), critic.name, signal);
      if (raw === null) { return null; }
      const parsed = parseJson<{ agrees: boolean; riskLevel: string; confidence: number; objections: string[]; suggestedChanges: string[] }>(raw);
      const verdict: SeatVerdict = {
        provider:         critic.name,
        agrees:           typeof parsed.agrees === 'boolean' ? parsed.agrees : true,
        riskLevel:        (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
        confidence:       typeof parsed.confidence === 'number' ? parsed.confidence : 70,
        objections:       Array.isArray(parsed.objections) ? parsed.objections : [],
        suggestedChanges: Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [],
      };
      ctx.send({ type: 'verdict', verdict });
      return verdict;
    } catch (err: any) {
      if (signal.aborted) { throw err; }
      return null;
    }
  }));
  const filtered = results.filter((v): v is SeatVerdict => v !== null);
  return filtered.length > 0 ? filtered : firstVerdicts;
}

async function handleCriticalObjection(ctx: PanelContext, prompt: string, draft: DraftResult, verdicts: SeatVerdict[], originalCode: string, signal: AbortSignal): Promise<void> {
  const objector = verdicts.find(v => !v.agrees || v.riskLevel === 'CRITICAL');
  const objectionSummary = objector?.objections?.slice(0, 3).join('; ') ?? 'Critical risk detected in implementation.';
  const versions: VersionCandidate[] = [{ provider: draft.provider, code: draft.code, reasoning: draft.reasoning }];
  for (const v of verdicts.filter(v2 => !v2.agrees)) {
    const alt = await generateAlternativeQuiet(ctx, v.provider, prompt, draft.code, originalCode, signal);
    if (alt) { versions.push(alt); }
  }
  if (signal.aborted) { return; }
  ctx.send({ type: 'critical-objection', objector: objector?.provider ?? '', objectionSummary, versions });
  const resolution = await waitForDeadlockResolution(ctx, signal);
  if (signal.aborted) { return; }
  let finalCode = draft.code;
  const userOverride = resolution.action === 'USER_DECIDES';
  if (resolution.action === 'USER_DECIDES') {
    finalCode = versions.find(v => v.provider === resolution.selectedVersion)?.code ?? draft.code;
  } else if (resolution.action === 'SYNTHESIS') {
    finalCode = await runForceSynthesis(ctx, prompt, versions, signal);
  } else if (resolution.action === 'EXTENDED_DEBATE') {
    finalCode = await runExtendedDebate(ctx, prompt, versions, signal);
  }
  if (signal.aborted) { return; }
  const session = ctx.getSession();
  if (session) { session.finalCode = finalCode; session.consensus = 'MAJORITY'; }
  ctx.send({ type: 'session-complete', consensus: 'MAJORITY', finalCode, verdicts });
  checkLedgerConsent(ctx.getLedger());
  saveLedgerRecord(ctx.getLedger(), {
    timestamp: Date.now(), prompt, draftAuthor: draft.provider,
    councilMode: ctx.getCouncilMode(), riskLevel: ctx.getSession()?.risk?.level ?? 'HIGH',
    confidenceInitial: draft.confidence, confidenceFinal: draft.confidence,
    consensus: 'MAJORITY', intensity: ctx.getIntensityState().level.toLowerCase(),
    deadlockResolution: resolution.action, userOverride,
  });
}

async function generateAlternativeQuiet(ctx: PanelContext, provider: string, prompt: string, draftCode: string, originalCode: string, signal: AbortSignal): Promise<VersionCandidate | null> {
  if (!isValidProvider(provider)) { return null; }
  const p = await ctx.providerManager.getProvider(provider as ProviderName);
  if (!p || ctx.getUnavailableProviders().has(provider)) { return null; }
  try {
    const raw = await withTimeout(ctx, () => p.chat([
      { role: 'system', content:
        'You objected to the proposed implementation. Now provide your alternative.\n' +
        'Return ONLY valid JSON \u2014 no markdown fences:\n' +
        '{"reasoning":"why better (1-2 sentences)","code":"...complete implementation..."}' },
      { role: 'user', content:
        `Task: ${prompt}\n\nRejected:\n\`\`\`\n${draftCode}\n\`\`\`\n\nOriginal:\n${originalCode || '(new)'}\n\nYour alternative:` },
    ] as any, signal), provider, signal);
    if (!raw) { return null; }
    const parsed = parseJson<{ reasoning: string; code: string }>(raw);
    return { provider, code: parsed.code ?? draftCode, reasoning: parsed.reasoning ?? '' };
  } catch { return null; }
}

async function runForceSynthesis(ctx: PanelContext, prompt: string, versions: VersionCandidate[], signal: AbortSignal): Promise<string> {
  const providers = await ctx.providerManager.getActiveProviders();
  const synthesizer = providers.find(p => !ctx.getUnavailableProviders().has(p.name));
  if (!synthesizer) { return versions[0]?.code ?? ''; }

  const versionList = versions.map((v, i) =>
    `Version ${String.fromCharCode(65 + i)} (${v.provider}):\n\`\`\`\n${v.code}\n\`\`\`\nReasoning: ${v.reasoning}`
  ).join('\n\n');

  const raw = await withTimeout(ctx, () => synthesizer.chat([
    { role: 'system', content:
      'You are synthesizing competing implementations. Identify the strengths of each version.\n' +
      'Merge the best structural elements into a unified implementation.\n' +
      'Return ONLY valid JSON \u2014 no markdown fences:\n' +
      '{"finalCode":"...complete merged implementation...","rationale":"what was merged and why"}' },
    { role: 'user', content: `Task: ${prompt}\n\n${versionList}\n\nProduce a unified best-of-all implementation.` },
  ] as any, signal), synthesizer.name, signal, 12000);

  if (!raw) { return versions[0]?.code ?? ''; }
  const parsed = parseJson<{ finalCode: string; rationale: string }>(raw);
  if (parsed.rationale) { ctx.send({ type: 'synthesis-ready', rationale: parsed.rationale }); }
  return parsed.finalCode ?? versions[0]?.code ?? '';
}

async function runExtendedDebate(ctx: PanelContext, prompt: string, versions: VersionCandidate[], signal: AbortSignal): Promise<string> {
  const providers = await ctx.providerManager.getActiveProviders();
  const available = providers.filter(p => !ctx.getUnavailableProviders().has(p.name));
  if (available.length === 0) { return versions[0]?.code ?? ''; }

  const versionList = versions.map((v, i) =>
    `Version ${String.fromCharCode(65 + i)} (${v.provider}):\n\`\`\`\n${v.code}\n\`\`\`\nReasoning: ${v.reasoning}`
  ).join('\n\n');

  const updatedVerdicts = await Promise.all(available.map(async (p): Promise<SeatVerdict | null> => {
    const raw = await withTimeout(ctx, () => p.chat([
      { role: 'system', content:
        'You are reviewing competing implementations in an extended debate. ' +
        'You must directly address and refute the weaknesses of other proposals. Justify why yours is superior.\n' +
        'Return ONLY valid JSON \u2014 no markdown fences:\n' +
        '{"agrees":true|false,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","confidence":0-100,' +
        '"objections":["..."],"suggestedChanges":["..."]}' },
      { role: 'user', content: `Task: ${prompt}\n\n${versionList}\n\nAnalyse all versions. Identify the best approach and justify it.` },
    ] as any, signal), p.name, signal, 12000);
    if (!raw) { return null; }
    const parsed = parseJson<{ agrees: boolean; riskLevel: string; confidence: number; objections: string[]; suggestedChanges: string[] }>(raw);
    const verdict: SeatVerdict = {
      provider:         p.name,
      agrees:           typeof parsed.agrees === 'boolean' ? parsed.agrees : true,
      riskLevel:        (parsed.riskLevel as RiskLevel) ?? 'MEDIUM',
      confidence:       typeof parsed.confidence === 'number' ? parsed.confidence : 70,
      objections:       Array.isArray(parsed.objections) ? parsed.objections : [],
      suggestedChanges: Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [],
    };
    ctx.send({ type: 'verdict', verdict });
    return verdict;
  }));
  const filteredVerdicts = updatedVerdicts.filter((v): v is SeatVerdict => v !== null);
  const session = ctx.getSession();
  if (session) { session.verdicts = filteredVerdicts; }

  return runForceSynthesis(ctx, prompt, versions, signal);
}
