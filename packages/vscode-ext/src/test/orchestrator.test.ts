import * as assert from 'assert';
import * as os from 'os';
import { TriForgeOrchestrator, AIProvider, ReviewResult, ProviderName } from '@triforge/engine';

// ─── Mock Provider ─────────────────────────────────────────────────────────────

type PlanFile = { filePath: string; action: 'create' | 'modify' | 'delete'; reason: string };

class MockProvider implements AIProvider {
  readonly name: ProviderName;
  private _draftContent = 'mock file content';
  private _planFiles: PlanFile[] = [];
  private _verdictQueue: ('APPROVE' | 'REQUEST_CHANGES')[] = [];
  private _verdictIndex = 0;
  private _generateResponse = 'mock response';

  constructor(name: ProviderName) {
    this.name = name;
  }

  setPlan(files: PlanFile[]): this {
    this._planFiles = files;
    return this;
  }

  setDraft(content: string): this {
    this._draftContent = content;
    return this;
  }

  setVerdicts(...verdicts: ('APPROVE' | 'REQUEST_CHANGES')[]): this {
    this._verdictQueue = verdicts;
    this._verdictIndex = 0;
    return this;
  }

  setGenerateResponse(text: string): this {
    this._generateResponse = text;
    return this;
  }

  async generateResponse(_prompt: string, _context?: string): Promise<string> {
    return this._generateResponse;
  }

  async generateResponseStream(
    _history: Array<{ role: 'user' | 'assistant'; content: string }>,
    _context: string | undefined,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    onChunk(this._generateResponse);
    return this._generateResponse;
  }

  async generateDraft(): Promise<string> {
    return this._draftContent;
  }

  async reviewFile(
    _userRequest: string,
    filePath: string,
    _proposedContent: string,
    fileHash: string,
  ): Promise<ReviewResult> {
    const verdict = this._verdictQueue[this._verdictIndex++] ?? 'APPROVE';
    return {
      provider: this.name,
      filePath,
      fileHash: verdict === 'APPROVE' ? fileHash : 'mismatched-hash',
      verdict,
      issues: verdict === 'REQUEST_CHANGES'
        ? [{ severity: 'minor', message: 'Needs improvement' }]
        : [],
      requiredChanges: verdict === 'REQUEST_CHANGES' ? ['Please revise'] : [],
      reasoning: verdict === 'APPROVE' ? 'Looks good' : 'Needs work',
      timestamp: new Date(),
    };
  }

  async planTask(): Promise<{ files: PlanFile[] }> {
    return { files: this._planFiles };
  }

  async validateConnection(): Promise<boolean> {
    return true;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeOrchestrator(
  providers: AIProvider[],
  maxIterations = 4,
  signal?: AbortSignal
): TriForgeOrchestrator {
  return new TriForgeOrchestrator(providers, {
    maxIterations,
    workspacePath: os.tmpdir(),
    signal,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

suite('TriForgeOrchestrator', () => {

  // --- singleResponse ---

  test('singleResponse: returns provider output', async () => {
    const p = new MockProvider('openai').setGenerateResponse('hello world');
    const result = await makeOrchestrator([p]).singleResponse('say hi', '');
    assert.strictEqual(result, 'hello world');
  });

  // --- pairReview ---

  test('pairReview: builder responds, reviewer adds critique', async () => {
    const builder = new MockProvider('openai').setGenerateResponse('builder answer');
    const reviewer = new MockProvider('gemini').setGenerateResponse('reviewer critique');
    const result = await makeOrchestrator([builder, reviewer]).pairReview('help me', '');
    assert.strictEqual(result.builder, 'builder answer');
    assert.strictEqual(result.reviewer, 'reviewer critique');
  });

  // --- orchestrate: empty plan ---

  test('orchestrate: planner returns no files → empty result, no debates', async () => {
    const p = new MockProvider('openai').setPlan([]);
    const result = await makeOrchestrator([p]).orchestrate('do nothing', '');
    assert.strictEqual(result.approvedFiles.length, 0);
    assert.strictEqual(result.fileDebates.length, 0);
    assert.strictEqual(result.hasDisagreements, false);
  });

  // --- orchestrate: delete action ---

  test('orchestrate: delete action is approved immediately without review', async () => {
    const builder = new MockProvider('openai').setPlan([
      { filePath: 'old.ts', action: 'delete', reason: 'unused' },
    ]);
    const reviewer = new MockProvider('gemini');
    const result = await makeOrchestrator([builder, reviewer]).orchestrate('remove old.ts', '');
    assert.strictEqual(result.fileDebates.length, 1);
    assert.strictEqual(result.fileDebates[0].status, 'approved');
    assert.strictEqual(result.fileDebates[0].rounds[0].reviews.length, 0);
  });

  // --- orchestrate: unanimous approval on round 1 ---

  test('orchestrate: all reviewers approve on round 1 → file approved, 1 round', async () => {
    const planner = new MockProvider('openai').setPlan([
      { filePath: 'foo.ts', action: 'create', reason: 'new file' },
    ]);
    const reviewer = new MockProvider('gemini').setVerdicts('APPROVE');
    const result = await makeOrchestrator([planner, reviewer]).orchestrate('add foo.ts', '');

    assert.strictEqual(result.approvedFiles.length, 1);
    assert.strictEqual(result.approvedFiles[0].relativePath, 'foo.ts');
    assert.strictEqual(result.fileDebates[0].status, 'approved');
    assert.strictEqual(result.fileDebates[0].rounds.length, 1);
    assert.strictEqual(result.hasDisagreements, false);
  });

  test('orchestrate: three providers, both reviewers approve round 1 → consensus', async () => {
    const planner = new MockProvider('openai').setPlan([
      { filePath: 'bar.ts', action: 'create', reason: 'new' },
    ]);
    const reviewer1 = new MockProvider('gemini').setVerdicts('APPROVE');
    const reviewer2 = new MockProvider('claude').setVerdicts('APPROVE');
    const result = await makeOrchestrator([planner, reviewer1, reviewer2]).orchestrate('add bar.ts', '');

    assert.strictEqual(result.fileDebates[0].status, 'approved');
    assert.strictEqual(result.fileDebates[0].rounds.length, 1);
    assert.strictEqual(result.fileDebates[0].rounds[0].reviews.length, 2);
  });

  // --- orchestrate: approval after revision ---

  test('orchestrate: reviewer requests changes once, approves next round → 2 rounds', async () => {
    // 2 providers: openai builds round 1, gemini builds round 2
    // gemini reviews round 1 (REQUEST_CHANGES), openai reviews round 2 (APPROVE)
    const p0 = new MockProvider('openai')
      .setPlan([{ filePath: 'app.ts', action: 'create', reason: 'new' }])
      .setVerdicts('APPROVE'); // reviews in round 2

    const p1 = new MockProvider('gemini')
      .setVerdicts('REQUEST_CHANGES'); // reviews in round 1

    const result = await makeOrchestrator([p0, p1]).orchestrate('build app.ts', '');

    assert.strictEqual(result.fileDebates[0].status, 'approved');
    assert.strictEqual(result.fileDebates[0].rounds.length, 2);
    assert.strictEqual(result.fileDebates[0].rounds[0].consensus, false);
    assert.strictEqual(result.fileDebates[0].rounds[1].consensus, true);
  });

  // --- orchestrate: disagreement ---

  test('orchestrate: reviewer always rejects → disagreement after maxIterations', async () => {
    const p0 = new MockProvider('openai')
      .setPlan([{ filePath: 'x.ts', action: 'create', reason: 'new' }])
      .setVerdicts('REQUEST_CHANGES', 'REQUEST_CHANGES');

    const p1 = new MockProvider('gemini')
      .setVerdicts('REQUEST_CHANGES', 'REQUEST_CHANGES');

    const result = await makeOrchestrator([p0, p1], 2).orchestrate('build x.ts', '');

    assert.strictEqual(result.fileDebates[0].status, 'disagreement');
    assert.strictEqual(result.fileDebates[0].rounds.length, 2);
    assert.strictEqual(result.hasDisagreements, true);
    assert.ok(result.fileDebates[0].disagreementReport?.includes('Disagreement Report'));
  });

  // --- orchestrate: split verdict (one approves, one rejects) ---

  test('orchestrate: split verdict is not consensus → continues to next round', async () => {
    // Round 1: gemini APPROVE, claude REQUEST_CHANGES → not unanimous → no consensus
    // Round 2: openai APPROVE, claude APPROVE → consensus (openai reviews when gemini builds)
    const planner = new MockProvider('openai')
      .setPlan([{ filePath: 'split.ts', action: 'create', reason: 'new' }])
      .setVerdicts('APPROVE'); // openai reviews in round 2

    const reviewer1 = new MockProvider('gemini')
      .setVerdicts('APPROVE'); // reviews in round 1

    const reviewer2 = new MockProvider('claude')
      .setVerdicts('REQUEST_CHANGES', 'APPROVE'); // round 1 reject, round 2 approve

    const result = await makeOrchestrator([planner, reviewer1, reviewer2]).orchestrate('build split.ts', '');

    assert.strictEqual(result.fileDebates[0].status, 'approved');
    assert.strictEqual(result.fileDebates[0].rounds[0].consensus, false);
    assert.ok(result.fileDebates[0].rounds.length >= 2);
  });

  // --- orchestrate: multiple files ---

  test('orchestrate: multiple files each go through their own debate', async () => {
    const planner = new MockProvider('openai').setPlan([
      { filePath: 'a.ts', action: 'create', reason: 'new' },
      { filePath: 'b.ts', action: 'create', reason: 'new' },
    ]);
    // reviewer approves both files (2 reviews total)
    const reviewer = new MockProvider('gemini').setVerdicts('APPROVE', 'APPROVE');

    const result = await makeOrchestrator([planner, reviewer]).orchestrate('add two files', '');

    assert.strictEqual(result.fileDebates.length, 2);
    assert.strictEqual(result.approvedFiles.length, 2);
    assert.strictEqual(result.hasDisagreements, false);
  });

  // --- abort signal ---

  test('orchestrate: pre-aborted signal throws immediately', async () => {
    const controller = new AbortController();
    controller.abort();

    const p = new MockProvider('openai').setPlan([
      { filePath: 'x.ts', action: 'create', reason: 'new' },
    ]);

    try {
      await makeOrchestrator([p], 4, controller.signal).orchestrate('do something', '');
      assert.fail('Expected an error to be thrown');
    } catch (err: any) {
      assert.ok(err.message.includes('cancelled') || err.message.includes('abort'), err.message);
    }
  });

  // --- approved file content ---

  test('orchestrate: approved file carries the draft content from builder', async () => {
    const builder = new MockProvider('openai')
      .setPlan([{ filePath: 'out.ts', action: 'create', reason: 'new' }])
      .setDraft('export const x = 1;');

    const reviewer = new MockProvider('gemini').setVerdicts('APPROVE');

    const result = await makeOrchestrator([builder, reviewer]).orchestrate('build out.ts', '');

    assert.strictEqual(result.approvedFiles[0].proposedContent, 'export const x = 1;');
    assert.strictEqual(result.approvedFiles[0].type, 'create');
  });
});
