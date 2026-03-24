import React, { useState } from 'react';

// ── Guide definitions ──────────────────────────────────────────────────────────

interface Guide {
  id:      string;
  title:   string;
  icon:    string;
  summary: string;
  content: string;   // markdown-ish plain text
}

const GUIDES: Guide[] = [

  {
    id:      'getting-started',
    title:   'Getting Started',
    icon:    '⬡',
    summary: 'Set up TriForge AI from zero to first council session.',
    content: `# Getting Started with TriForge AI

## What is TriForge?
TriForge is a personal AI council that runs OpenAI, Claude, and Grok simultaneously, synthesizes their reasoning, and delivers a multi-perspective decision you can act on.

## Step 1 — Add API Keys
Open **Settings** (⚙ in the sidebar) and add keys for all three providers:
- **OpenAI** — get a key at platform.openai.com/api-keys
- **Anthropic Claude** — get a key at console.anthropic.com/settings/keys
- **xAI Grok** — get a key at console.x.ai

All keys are stored locally using your OS keychain. They are never transmitted to TriForge servers.

## Step 2 — Ask the Council
Open **TriForge** (the main chat screen) and type any question. Press Enter or click Send.
- **Single message** — uses whichever providers are connected
- **Think Tank mode** — all three AIs deliberate and produce a synthesized answer with a confidence score

## Step 3 — Connect Integrations (optional)
For team workflows, connect:
- **GitHub** — enables PR review, issue triage, and webhook events
- **Slack** — enables channel summaries and automated replies
- **Jira / Linear** — enables issue tracking and queue management
Go to **Settings** to add credentials.

## Step 4 — Explore Screens
- **Command** — mission-mode Think Tank with full council visualization
- **Dashboard** — overview of activity, integrations, and recent decisions
- **Automate** — create and run runbooks, install packs, schedule jobs
- **Control** — workspace management, member roles, policy settings
- **Health** — integration status and diagnostics
- **Recovery** — backup, restore, snapshots, and store validation

## Upgrade
Features beyond basic chat require Pro or Business.
Go to **Plan** (sidebar) or look for upgrade prompts inside locked features.`,
  },

  {
    id:      'dispatch',
    title:   'Dispatch Guide',
    icon:    '⊛',
    summary: 'Configure remote access, device pairing, and shared collaboration.',
    content: `# TriForge Dispatch Guide

## What is Dispatch?
Dispatch is the TriForge remote access layer. It lets you:
- Trigger runbooks from your phone
- Collaborate with teammates on shared tasks
- Receive push notifications for approvals and incidents
- Access TriForge remotely via a secure token-authenticated server

## Starting the Dispatch Server
1. Open **Phone Link** (⊛ in the sidebar)
2. Click **Start Dispatch Server**
3. Choose network mode: **Local** (same network), **LAN** (local network), or **Remote** (public URL)
4. For remote access, configure a public URL (e.g. Cloudflare Tunnel) under Dispatch Settings

## Pairing a Device
1. Click **Generate Pairing Code** in the Phone Link screen
2. On the remote device, open the TriForge mobile companion and enter the 6-digit code
3. Paired devices appear in the Devices list with a session token

## Setting an Approval Policy
Dispatch can require approval for sensitive remote actions:
- **All remote actions** — require approval for everything
- **High-risk only** — approve only high-risk runbook steps
- **None** — no approval gate (trusted devices only)

## Shared Threads (Business plan)
With a Business plan, teammates can send messages and receive synthesized council responses through Dispatch without a TriForge desktop install.

## Security
- All connections use bearer-token authentication
- Tokens expire based on your session TTL setting (default 7 days)
- Revoke individual device sessions from the Devices list
- Set network mode to **Local** for maximum security`,
  },

  {
    id:      'workspace-admin',
    title:   'Workspace Admin Guide',
    icon:    '⊕',
    summary: 'Create workspaces, invite members, set roles, and configure policies.',
    content: `# Workspace Admin Guide

## What is a Workspace?
A workspace is a shared TriForge environment for a team. It defines:
- Member roster with roles (owner / admin / operator / viewer)
- Integration settings visible to all members
- Automation governance policies
- Recipe and runbook scope

## Creating a Workspace
1. Open **Control** (⊕ in the sidebar)
2. Click **Create Workspace** and give it a name
3. You become the owner

## Inviting Members
1. In Control, click **Invite Member**
2. Enter their Dispatch device ID or email (they need TriForge installed)
3. Assign a role:
   - **Owner** — full control
   - **Admin** — manage members, policies, integrations
   - **Operator** — run runbooks, trigger automation
   - **Viewer** — read-only access to results

## Workspace Policies
Governance policies control what automation is allowed:
- **Max risk level** — block runbooks above low/medium/high
- **Require desktop confirm** — all remote actions need local approval
- **Allow remote run** — whether operators can trigger runbooks remotely

Access policies under **Control → Policy**.

## Integration Scope
Integrations (Slack, GitHub, Jira, Linear) can be set to:
- **Personal** — uses your own credentials
- **Workspace** — uses workspace-shared credentials
Configure under **Control → Integrations**.`,
  },

  {
    id:      'runbooks',
    title:   'Runbooks & Packs Guide',
    icon:    '∞',
    summary: 'Create, run, and install automation runbooks and packs.',
    content: `# Runbooks & Packs Guide

## What is a Runbook?
A runbook is a sequence of steps that TriForge executes on your behalf. Steps can:
- Run terminal commands
- Send Slack messages
- Create Jira issues
- Trigger AI council analysis
- Wait for human approval
- Branch based on conditions

## Creating a Runbook
1. Open **Automate** (∞ in the sidebar)
2. Click **New Runbook**
3. Add steps with the step editor
4. Each step has a **risk level** (low / medium / high) and optional approval gate

## Running a Runbook
- Click **Run** next to any runbook
- Steps with approval gates pause and show in the approval queue
- High-risk steps on Business plan can require a remote team approval

## Runbook Packs
Packs are pre-built collections of runbooks you can import:
- Open **Automate → Packs**
- Click **Import Pack** and select a \`.json\` pack file
- Review the preview (what runbooks will install, risk level, required integrations)
- Click **Install**

## Starter Pack Types
- **GitHub + Slack Review Pack** — automates PR review notifications and triage
- **Jira Incident Pack** — creates and escalates Jira issues on alert
- **Linear Planning Pack** — creates Linear issues from council analysis
- **Safe Remote Dispatch Pack** — minimal pack for remote team triggers

## Rollback
If a pack update causes problems:
1. Open **Automate → Packs**
2. Click the pack and choose **Rollback**
TriForge keeps up to 3 previous versions of each pack.`,
  },

  {
    id:      'trust-signing',
    title:   'Trust & Signing Guide',
    icon:    '◆',
    summary: 'Sign packs, configure trusted signers, and set trust policies.',
    content: `# Trust & Signing Guide

## Why Trust Matters
Runbook packs can execute commands and send messages. To prevent supply-chain attacks:
- Packs can be **signed** with a local private key
- You configure which signers you trust
- The trust policy controls what happens with unsigned or unknown-signer packs

## Generating a Signing Key
1. Open **Automate → Trust**
2. Click **Generate Local Key**
3. Your key ID is displayed — share it with teammates who should trust your packs

## Signing a Pack
When exporting a pack, TriForge automatically signs it with your local key:
1. Open **Automate → Packs**
2. Select a pack and click **Export**
3. The exported \`.json\` includes your signature

## Adding a Trusted Signer
1. Open **Automate → Trust → Trusted Signers**
2. Click **Add Signer** and enter the key ID
3. All packs signed by that key ID will be trusted on import

## Trust Policy
| Setting | Effect |
|---------|--------|
| Allow unsigned | Import packs with no signature |
| Allow unknown signers | Import packs from unregistered keys |
| Require admin approval for install | Admin must approve each pack install |
| Block new destinations | Reject packs that add new integration destinations |
| Require confirm on risk increase | Pause if an update raises the risk level |

Configure under **Automate → Trust → Policy**.`,
  },

  {
    id:      'backup-recovery',
    title:   'Backup & Recovery Guide',
    icon:    '⊘',
    summary: 'Back up your configuration, restore from file, and use snapshots.',
    content: `# Backup & Recovery Guide

## What Gets Backed Up
A TriForge backup includes:
- Workspace config, members, and integration settings (flags, not credentials)
- All runbooks and pack registry
- Trusted signers and pack trust policy
- Automation recipe states and shared context
- Permissions, user profile, and recent memory (last 100 entries)
- Dispatch settings (port, network mode, public URL)

**Not included:** API keys, tokens, PIN hash, license key. Those stay in your OS keychain.

## Creating a Backup
1. Open **Recovery** (⊘ in the sidebar)
2. Go to the **Backup / Restore** tab
3. Click **Backup Now** — a save dialog opens
4. Save the \`.json\` file somewhere safe (cloud storage, external drive)

## Restoring from a Backup
1. Open **Recovery → Backup / Restore**
2. Click **Restore from File**
3. Select your backup \`.json\`
4. TriForge validates the schema version, creates a pre-restore snapshot, then applies the backup

## Snapshots
Snapshots are instant restore points kept inside TriForge (max 5):
- Created automatically before pack installs, policy changes, and restores
- Create manual snapshots anytime under **Recovery → Snapshots**
- Rollback to any snapshot with one click

## Store Validation & Repair
If something seems wrong:
1. Open **Recovery → Store Health**
2. Click **Validate Store** — shows all integrity issues
3. Click **Validate & Repair** — auto-fixes safe defaults

## Migrations
TriForge runs schema migrations automatically at startup.
You can check migration history under **Recovery → Migrations**.`,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function DocsScreen() {
  const [activeId,  setActiveId]  = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);

  const active = GUIDES.find(g => g.id === activeId) ?? null;

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(id);
      setTimeout(() => setCopyState(null), 2000);
    } catch { /* ok */ }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h2 style={s.title}>Help & Guides</h2>
        <p style={s.subtitle}>In-app reference documentation for all major TriForge surfaces.</p>
      </div>

      <div style={s.layout}>
        {/* Guide list */}
        <nav style={s.sidebar}>
          {GUIDES.map(g => (
            <button
              key={g.id}
              style={{ ...s.navItem, ...(activeId === g.id ? s.navItemActive : {}) }}
              onClick={() => setActiveId(g.id)}
            >
              <span style={s.navIcon}>{g.icon}</span>
              <div style={s.navText}>
                <span style={s.navTitle}>{g.title}</span>
                <span style={s.navSummary}>{g.summary}</span>
              </div>
            </button>
          ))}
        </nav>

        {/* Guide content */}
        <div style={s.content}>
          {!active ? (
            <div style={s.placeholder}>
              <span style={s.placeholderIcon}>◎</span>
              <p style={s.placeholderText}>Select a guide from the list to read it here.</p>
            </div>
          ) : (
            <div style={s.guide}>
              <div style={s.guideHeader}>
                <div>
                  <h3 style={s.guideTitle}>{active.title}</h3>
                  <p style={s.guideSummary}>{active.summary}</p>
                </div>
                <button
                  style={s.copyBtn}
                  onClick={() => copyToClipboard(active.content, active.id)}
                >
                  {copyState === active.id ? 'Copied!' : 'Copy as Markdown'}
                </button>
              </div>
              <div style={s.guideBody}>
                <DocContent content={active.content} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DocContent — simple markdown-ish renderer ─────────────────────────────────

function DocContent({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div style={s.docBody}>
      {lines.map((line, i) => {
        if (line.startsWith('# '))  return <h1 key={i} style={s.h1}>{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={i} style={s.h2}>{line.slice(3)}</h2>;
        if (line.startsWith('### '))return <h3 key={i} style={s.h3}>{line.slice(4)}</h3>;
        if (line.startsWith('- '))  return <div key={i} style={s.bullet}><span style={s.bulletDot}>·</span>{renderInline(line.slice(2))}</div>;
        if (line.startsWith('| '))  return <div key={i} style={s.tableRow}>{renderTableRow(line)}</div>;
        if (line.startsWith('|---')) return null;
        if (line.trim() === '')      return <div key={i} style={{ height: 8 }} />;
        return <p key={i} style={s.para}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} style={s.code}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function renderTableRow(line: string): React.ReactNode {
  const cells = line.split('|').filter(c => c.trim() !== '');
  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {cells.map((cell, i) => (
        <div key={i} style={{ ...s.tableCell, ...(i === 0 ? s.tableCellFirst : {}) }}>
          {renderInline(cell.trim())}
        </div>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
  },
  header: {
    padding: '20px 24px 12px', flexShrink: 0,
    borderBottom: '1px solid var(--border)',
  },
  title:    { fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' },
  subtitle: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },

  layout: {
    display: 'flex', flex: 1, overflow: 'hidden',
  },
  sidebar: {
    width: 220, flexShrink: 0, overflowY: 'auto',
    borderRight: '1px solid var(--border)',
    padding: '8px 0',
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  navItem: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 14px', cursor: 'pointer',
    background: 'transparent', border: 'none', textAlign: 'left',
    borderRadius: 0,
  },
  navItemActive: { background: 'rgba(99,102,241,0.1)', borderLeft: '2px solid var(--accent)' },
  navIcon:  { fontSize: 14, color: 'var(--accent)', flexShrink: 0, marginTop: 1 },
  navText:  { display: 'flex', flexDirection: 'column', gap: 2 },
  navTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' },
  navSummary: { fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 },

  content: { flex: 1, overflowY: 'auto' },

  placeholder: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: 12,
  },
  placeholderIcon: { fontSize: 28, color: 'var(--text-muted)' },
  placeholderText: { fontSize: 13, color: 'var(--text-muted)', margin: 0 },

  guide: { padding: '20px 24px' },
  guideHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 12, marginBottom: 20,
  },
  guideTitle:   { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' },
  guideSummary: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },
  copyBtn: {
    height: 28, padding: '0 12px', flexShrink: 0,
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-muted)', fontSize: 11,
    cursor: 'pointer',
  },

  guideBody: {},
  docBody:   {},

  h1: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '16px 0 8px' },
  h2: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '14px 0 6px', paddingTop: 8, borderTop: '1px solid var(--border)' },
  h3: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '10px 0 4px' },
  para: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65, margin: '2px 0' },
  bullet: {
    display: 'flex', alignItems: 'flex-start', gap: 6,
    fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65,
    margin: '1px 0',
  },
  bulletDot: { color: 'var(--accent)', flexShrink: 0 },
  code: {
    fontFamily: 'monospace', fontSize: 11,
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 3, padding: '1px 4px',
    color: 'var(--text-primary)',
  },
  tableRow: {
    marginBottom: 1,
  },
  tableCell: {
    flex: 1, fontSize: 11, color: 'var(--text-secondary)',
    padding: '4px 8px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 0,
  },
  tableCellFirst: {
    color: 'var(--text-primary)', fontWeight: 600,
    background: 'var(--surface-alt, #16161a)',
  },
};
