/**
 * sharedContext.ts — Team Memory + Shared Context Layer (Phase 16)
 *
 * Structured workspace memory that maps repos, channels, and projects to
 * each other and stores reusable operating context injected into agent prompts.
 */

import * as crypto from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Maps a GitHub repo to Jira/Linear projects and review instructions. */
export interface RepoMapping {
  id:                  string;
  repo:                string;   // "owner/repo"
  jiraProjectKey?:     string;
  linearTeamId?:       string;
  linearTeamName?:     string;
  reviewInstructions?: string;   // prepended to PR review council prompt
  defaultLabels?:      string[];
  createdAt:           number;
  updatedAt:           number;
}

/** Maps a messaging channel (Telegram/Slack/Discord) to a team or project. */
export interface ChannelMapping {
  id:           string;
  channel:      'telegram' | 'slack' | 'discord';
  channelId:    string;          // chat_id (Telegram) or channel ID (Slack/Discord)
  channelName?: string;
  workstream?:  string;          // free-form team/project label
  projectKey?:  string;          // Jira project key or Linear team ID
  createdAt:    number;
  updatedAt:    number;
}

/** Operating notes + defaults for a Jira project, Linear team, or custom workstream. */
export interface ProjectNote {
  id:                  string;
  projectKey:          string;   // Jira key, Linear team ID, or custom identifier
  projectName?:        string;
  summary?:            string;   // operating notes shown in UI
  defaultPriority?:    string;
  defaultLabels?:      string[];
  automationContext?:  string;   // injected into agent prompts (triage, queue, recipes)
  escalationChannelId?: string;  // Slack/Discord channel to escalate to
  createdAt:           number;
  updatedAt:           number;
}

export type ContextCategory = 'repo_mappings' | 'channel_mappings' | 'project_notes';

export interface SharedContextData {
  repoMappings:    RepoMapping[];
  channelMappings: ChannelMapping[];
  projectNotes:    ProjectNote[];
  enabled:         Partial<Record<ContextCategory, boolean>>;
}

const EMPTY: SharedContextData = {
  repoMappings:    [],
  channelMappings: [],
  projectNotes:    [],
  enabled:         { repo_mappings: true, channel_mappings: true, project_notes: true },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ── Context resolver ───────────────────────────────────────────────────────────

export interface ResolvedRepoContext {
  mapping?:     RepoMapping;
  projectNote?: ProjectNote;
}

export interface ResolvedChannelContext {
  mapping?:     ChannelMapping;
  projectNote?: ProjectNote;
}

export function resolveRepo(data: SharedContextData, repo: string): ResolvedRepoContext {
  if (!data.enabled.repo_mappings) return {};
  const mapping = data.repoMappings.find(m => m.repo.toLowerCase() === repo.toLowerCase());
  if (!mapping) return {};
  const projectKey = mapping.jiraProjectKey ?? mapping.linearTeamId;
  const projectNote = projectKey
    ? data.projectNotes.find(n => n.projectKey === projectKey)
    : undefined;
  return { mapping, projectNote };
}

export function resolveChannel(data: SharedContextData, channel: string, channelId: string): ResolvedChannelContext {
  if (!data.enabled.channel_mappings) return {};
  const mapping = data.channelMappings.find(
    m => m.channel === channel && m.channelId === channelId
  );
  if (!mapping) return {};
  const projectNote = mapping.projectKey
    ? data.projectNotes.find(n => n.projectKey === mapping.projectKey)
    : undefined;
  return { mapping, projectNote };
}

export function resolveProject(data: SharedContextData, projectKey: string): ProjectNote | undefined {
  if (!data.enabled.project_notes) return undefined;
  return data.projectNotes.find(n => n.projectKey === projectKey);
}

// ── Mutation helpers ────────────────────────────────────────────────────────────

export function upsertRepo(data: SharedContextData, input: Partial<RepoMapping> & { repo: string }): SharedContextData {
  const now = Date.now();
  const existing = data.repoMappings.find(m => m.repo.toLowerCase() === input.repo.toLowerCase());
  if (existing) {
    return {
      ...data,
      repoMappings: data.repoMappings.map(m =>
        m.id === existing.id ? { ...m, ...input, updatedAt: now } : m
      ),
    };
  }
  return {
    ...data,
    repoMappings: [...data.repoMappings, { id: newId(), createdAt: now, updatedAt: now, ...input } as RepoMapping],
  };
}

export function deleteRepo(data: SharedContextData, id: string): SharedContextData {
  return { ...data, repoMappings: data.repoMappings.filter(m => m.id !== id) };
}

export function upsertChannel(data: SharedContextData, input: Partial<ChannelMapping> & { channel: ChannelMapping['channel']; channelId: string }): SharedContextData {
  const now = Date.now();
  const existing = data.channelMappings.find(m => m.channel === input.channel && m.channelId === input.channelId);
  if (existing) {
    return {
      ...data,
      channelMappings: data.channelMappings.map(m =>
        m.id === existing.id ? { ...m, ...input, updatedAt: now } : m
      ),
    };
  }
  return {
    ...data,
    channelMappings: [...data.channelMappings, { id: newId(), createdAt: now, updatedAt: now, ...input } as ChannelMapping],
  };
}

export function deleteChannel(data: SharedContextData, id: string): SharedContextData {
  return { ...data, channelMappings: data.channelMappings.filter(m => m.id !== id) };
}

export function upsertProject(data: SharedContextData, input: Partial<ProjectNote> & { projectKey: string }): SharedContextData {
  const now = Date.now();
  const existing = data.projectNotes.find(n => n.projectKey === input.projectKey);
  if (existing) {
    return {
      ...data,
      projectNotes: data.projectNotes.map(n =>
        n.id === existing.id ? { ...n, ...input, updatedAt: now } : n
      ),
    };
  }
  return {
    ...data,
    projectNotes: [...data.projectNotes, { id: newId(), createdAt: now, updatedAt: now, ...input } as ProjectNote],
  };
}

export function deleteProject(data: SharedContextData, id: string): SharedContextData {
  return { ...data, projectNotes: data.projectNotes.filter(n => n.id !== id) };
}

export { EMPTY as EMPTY_SHARED_CONTEXT };
