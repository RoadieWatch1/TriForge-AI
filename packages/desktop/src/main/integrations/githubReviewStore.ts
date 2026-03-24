// ── githubReviewStore.ts — Pending GitHub review approval queue (Phase 3) ────
//
// Stores PR reviews and issue triage results awaiting user approval before
// they are posted as GitHub comments.
//
// File: <dataDir>/github-reviews.json
// Pattern: same atomic write + in-memory cache as ApprovalStore.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GitHubReviewType = 'pr_review' | 'issue_triage';
export type GitHubReviewStatus = 'pending' | 'approved' | 'dismissed' | 'posted';

export interface ProviderResponse {
  provider: string;
  text: string;
}

export interface GitHubPendingReview {
  id: string;
  type: GitHubReviewType;
  owner: string;
  repo: string;
  number: number;          // PR or issue number
  title: string;           // PR/issue title
  htmlUrl: string;         // link for UI
  responses: ProviderResponse[];
  synthesis: string;       // council-synthesized comment body
  status: GitHubReviewStatus;
  commentUrl?: string;     // set after successful post
  createdAt: number;
  approvedAt?: number;
  source: 'manual' | 'webhook';
}

interface StoreFile {
  reviews: Record<string, GitHubPendingReview>;
}

// ── GitHubReviewStore ─────────────────────────────────────────────────────────

export class GitHubReviewStore {
  private _filePath: string;
  private _tmpPath: string;
  private _cache: Record<string, GitHubPendingReview> = {};
  private _loaded = false;

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'github-reviews.json');
    this._tmpPath  = this._filePath + '.tmp';
  }

  create(
    fields: Omit<GitHubPendingReview, 'id' | 'createdAt' | 'status'>,
  ): GitHubPendingReview {
    this._ensureLoaded();
    const review: GitHubPendingReview = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      status: 'pending',
      ...fields,
    };
    this._cache[review.id] = review;
    this._save();
    return review;
  }

  get(id: string): GitHubPendingReview | null {
    this._ensureLoaded();
    return this._cache[id] ?? null;
  }

  update(id: string, patch: Partial<GitHubPendingReview>): GitHubPendingReview | null {
    this._ensureLoaded();
    const existing = this._cache[id];
    if (!existing) return null;
    this._cache[id] = { ...existing, ...patch };
    this._save();
    return this._cache[id];
  }

  listPending(): GitHubPendingReview[] {
    this._ensureLoaded();
    return Object.values(this._cache)
      .filter(r => r.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listAll(limit = 50): GitHubPendingReview[] {
    this._ensureLoaded();
    return Object.values(this._cache)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf8');
        const data = JSON.parse(raw) as StoreFile;
        this._cache = data.reviews ?? {};
      }
    } catch (e) {
      console.error('[GitHubReviewStore] load failed, starting fresh:', e);
      this._cache = {};
    }
  }

  private _save(): void {
    try {
      const dir = path.dirname(this._filePath);
      fs.mkdirSync(dir, { recursive: true });
      const data: StoreFile = { reviews: this._cache };
      fs.writeFileSync(this._tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(this._tmpPath, this._filePath);
    } catch (e) {
      console.error('[GitHubReviewStore] save error:', e);
    }
  }
}
