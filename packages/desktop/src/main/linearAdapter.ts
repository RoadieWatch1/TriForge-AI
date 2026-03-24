// ── linearAdapter.ts — Phase 11: Linear GraphQL API client ──────────────────
//
// Uses the Linear GraphQL API with Bearer token authentication.
// No external dependencies — built on Node's built-in `https` module.
//
// API endpoint: https://api.linear.app/graphql
//
// Key operations:
//   viewer              — validate token, get user info
//   teams               — list all teams
//   issues(filter)      — search issues by text / team / state
//   issue(id)           — full issue detail + comments
//   team(id).states     — list workflow states for team
//   commentCreate       — add comment to issue   [write]
//   issueCreate         — create new issue        [write]
//   issueUpdate         — update state/assignee/priority/title [write]

import https from 'https';

// ── Public types ──────────────────────────────────────────────────────────────

export interface LinearUserInfo {
  id:    string;
  name:  string;
  email: string;
}

export interface LinearTeam {
  id:   string;
  name: string;
  key:  string;
}

export interface LinearWorkflowState {
  id:    string;
  name:  string;
  type:  string;   // 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'
  color: string;
}

export interface LinearIssue {
  id:            string;
  identifier:    string;   // e.g. "ENG-42"
  title:         string;
  stateId:       string;
  stateName:     string;
  stateType:     string;
  priority:      number;   // 0=none 1=urgent 2=high 3=medium 4=low
  priorityLabel: string;
  assigneeId?:   string;
  assigneeName?: string;
  teamId:        string;
  teamName:      string;
  teamKey:       string;
  description:   string;
  updatedAt:     string;
  createdAt:     string;
  url:           string;
}

export interface LinearComment {
  id:         string;
  body:       string;
  authorName: string;
  createdAt:  string;
}

// ── LinearAdapter ─────────────────────────────────────────────────────────────

const GQL_ENDPOINT = { host: 'api.linear.app', path: '/graphql' };

export class LinearAdapter {
  constructor(private readonly _apiKey: string) {}

  // ── Test / meta ────────────────────────────────────────────────────────────

  async getViewer(): Promise<LinearUserInfo> {
    const data = await this._gql<{ viewer: { id: string; name: string; email: string } }>(
      `query { viewer { id name email } }`,
    );
    return data.viewer;
  }

  async listTeams(): Promise<LinearTeam[]> {
    const data = await this._gql<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(
      `query { teams { nodes { id name key } } }`,
    );
    return data.teams.nodes;
  }

  // ── Issues ─────────────────────────────────────────────────────────────────

  /**
   * Search issues.  If `teamId` is given, scopes to that team.
   * `query` is a free-text filter (empty = all).
   */
  async searchIssues(query: string, teamId?: string, limit = 25): Promise<LinearIssue[]> {
    const filter = this._buildIssueFilter(query, teamId);
    const data   = await this._gql<{ issues: { nodes: Array<RawIssue> } }>(
      `query($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first, orderBy: updatedAt) {
          nodes { ${ISSUE_FRAGMENT} }
        }
      }`,
      { filter, first: limit },
    );
    return data.issues.nodes.map(normaliseIssue);
  }

  async getIssue(id: string): Promise<LinearIssue> {
    const data = await this._gql<{ issue: RawIssue }>(
      `query($id: String!) {
        issue(id: $id) { ${ISSUE_FRAGMENT} }
      }`,
      { id },
    );
    return normaliseIssue(data.issue);
  }

  async getComments(issueId: string, limit = 8): Promise<LinearComment[]> {
    const data = await this._gql<{ issue: { comments: { nodes: Array<{ id: string; body: string; user: { name: string } | null; createdAt: string }> } } }>(
      `query($id: String!, $first: Int) {
        issue(id: $id) {
          comments(first: $first, orderBy: createdAt) {
            nodes { id body user { name } createdAt }
          }
        }
      }`,
      { id: issueId, first: limit },
    );
    return (data.issue.comments.nodes ?? []).map(c => ({
      id:         c.id,
      body:       c.body.slice(0, 600),
      authorName: c.user?.name ?? 'Unknown',
      createdAt:  c.createdAt,
    }));
  }

  async listWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
    const data = await this._gql<{ team: { states: { nodes: Array<LinearWorkflowState> } } }>(
      `query($id: String!) {
        team(id: $id) {
          states { nodes { id name type color } }
        }
      }`,
      { id: teamId },
    );
    return data.team.states.nodes;
  }

  // ── Write actions ──────────────────────────────────────────────────────────

  async createComment(issueId: string, body: string): Promise<{ id: string }> {
    const data = await this._gql<{ commentCreate: { success: boolean; comment: { id: string } } }>(
      `mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id } }
      }`,
      { input: { issueId, body: body.slice(0, 65_535) } },
    );
    if (!data.commentCreate.success) throw new Error('commentCreate returned success=false');
    return { id: data.commentCreate.comment.id };
  }

  async createIssue(input: {
    teamId:       string;
    title:        string;
    description?: string;
    stateId?:     string;
    assigneeId?:  string;
    priority?:    number;
  }): Promise<{ id: string; identifier: string }> {
    const data = await this._gql<{ issueCreate: { success: boolean; issue: { id: string; identifier: string } } }>(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { id identifier } }
      }`,
      { input },
    );
    if (!data.issueCreate.success) throw new Error('issueCreate returned success=false');
    return data.issueCreate.issue;
  }

  async updateIssue(id: string, patch: {
    stateId?:    string;
    assigneeId?: string;
    priority?:   number;
    title?:      string;
  }): Promise<{ identifier: string; stateName: string }> {
    const data = await this._gql<{ issueUpdate: { success: boolean; issue: { identifier: string; state: { name: string } } } }>(
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success issue { identifier state { name } }
        }
      }`,
      { id, input: patch },
    );
    if (!data.issueUpdate.success) throw new Error('issueUpdate returned success=false');
    return { identifier: data.issueUpdate.issue.identifier, stateName: data.issueUpdate.issue.state.name };
  }

  // ── GraphQL transport ──────────────────────────────────────────────────────

  private _buildIssueFilter(query: string, teamId?: string): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.trim()) filter['title'] = { containsIgnoreCase: query.trim() };
    if (teamId)       filter['team']  = { id: { eq: teamId } };
    return filter;
  }

  private async _gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const payload = Buffer.from(JSON.stringify({ query, variables: variables ?? {} }), 'utf8');
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          ...GQL_ENDPOINT,
          method:  'POST',
          timeout: 15_000,
          headers: {
            Authorization:    `Bearer ${this._apiKey}`,
            'Content-Type':   'application/json',
            'Content-Length': payload.length,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => { raw += c; });
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
              return;
            }
            try {
              const parsed = JSON.parse(raw) as { data?: T; errors?: Array<{ message: string }> };
              if (parsed.errors?.length) {
                reject(new Error(parsed.errors[0].message));
                return;
              }
              resolve(parsed.data as T);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Linear request timed out')); });
      req.write(payload);
      req.end();
    });
  }
}

// ── GraphQL fragment + normaliser ─────────────────────────────────────────────

const ISSUE_FRAGMENT = `
  id identifier title
  state { id name type color }
  priority priorityLabel
  assignee { id name }
  team { id name key }
  description
  updatedAt createdAt
  url
`;

interface RawIssue {
  id:            string;
  identifier:    string;
  title:         string;
  state:         { id: string; name: string; type: string; color: string };
  priority:      number;
  priorityLabel: string;
  assignee:      { id: string; name: string } | null;
  team:          { id: string; name: string; key: string };
  description:   string | null;
  updatedAt:     string;
  createdAt:     string;
  url:           string;
}

function normaliseIssue(raw: RawIssue): LinearIssue {
  return {
    id:            raw.id,
    identifier:    raw.identifier,
    title:         raw.title ?? '',
    stateId:       raw.state?.id   ?? '',
    stateName:     raw.state?.name ?? '',
    stateType:     raw.state?.type ?? '',
    priority:      raw.priority   ?? 0,
    priorityLabel: raw.priorityLabel ?? 'No priority',
    assigneeId:    raw.assignee?.id,
    assigneeName:  raw.assignee?.name,
    teamId:        raw.team?.id   ?? '',
    teamName:      raw.team?.name ?? '',
    teamKey:       raw.team?.key  ?? '',
    description:   (raw.description ?? '').trim().slice(0, 1_000),
    updatedAt:     raw.updatedAt  ?? '',
    createdAt:     raw.createdAt  ?? '',
    url:           raw.url        ?? '',
  };
}
