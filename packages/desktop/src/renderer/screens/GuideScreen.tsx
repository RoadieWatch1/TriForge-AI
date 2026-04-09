// ── GuideScreen.tsx — TriForge AI User Guide ─────────────────────────────────
//
// In-app guide that teaches users how to get results from TriForge AI.
// Covers: what to say in chat, how the operator works, app-specific examples,
// tips for best results, and the overall workflow.

import React, { useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface GuideSection {
  id: string;
  title: string;
  icon: string;
  content: React.ReactNode;
}

interface Props {
  onNavigate?: (screen: string) => void;
}

// ── Guide Content ────────────────────────────────────────────────────────────

function TryIt({ text, onNavigate }: { text: string; onNavigate?: (s: string) => void }) {
  return (
    <button
      style={s.tryBtn}
      onClick={() => onNavigate?.('chat')}
      title="Open Chat and try this"
    >
      <span style={s.tryIcon}>&#9654;</span>
      <span style={s.tryText}>"{text}"</span>
    </button>
  );
}

function buildSections(onNavigate?: (s: string) => void): GuideSection[] {
  return [
    // ── Getting Started ────────────────────────────────────────────────────
    {
      id: 'getting-started',
      title: 'Getting Started',
      icon: '&#9733;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge AI is your personal desktop operator. It doesn't just answer questions — it
            physically takes over your mouse and keyboard to work inside your apps. Here's how to
            get the most out of it.
          </p>

          <h4 style={s.subHead}>The 3-Step Flow</h4>
          <div style={s.steps}>
            <div style={s.step}>
              <div style={s.stepNum}>1</div>
              <div>
                <strong>Tell TriForge what you want</strong>
                <p style={s.stepDesc}>Describe your goal in Chat. Be specific about what app and what result you want.</p>
              </div>
            </div>
            <div style={s.step}>
              <div style={s.stepNum}>2</div>
              <div>
                <strong>Answer the intake questions</strong>
                <p style={s.stepDesc}>TriForge will ask for details — genre, style, features, etc. This builds a plan before it touches your app.</p>
              </div>
            </div>
            <div style={s.step}>
              <div style={s.stepNum}>3</div>
              <div>
                <strong>Click "Start Building" and approve steps</strong>
                <p style={s.stepDesc}>TriForge opens the Operate tab and executes step by step. You approve each action before it runs.</p>
              </div>
            </div>
          </div>

          <h4 style={s.subHead}>Quick Setup</h4>
          <ul style={s.list}>
            <li>Add at least one AI key in <strong>Settings → API Keys</strong> (OpenAI, Claude, or Grok)</li>
            <li>For desktop operator: grant <strong>Accessibility</strong> and <strong>Screen Recording</strong> permissions when prompted</li>
            <li>Have the target app (Unreal, Blender, Photoshop, etc.) installed and open</li>
          </ul>
        </div>
      ),
    },

    // ── What To Say ────────────────────────────────────────────────────────
    {
      id: 'what-to-say',
      title: 'What To Say in Chat',
      icon: '&#128172;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            Talk to TriForge like you'd talk to a skilled assistant sitting at your computer.
            The more specific you are, the better the results.
          </p>

          <h4 style={s.subHead}>Power Phrases That Work</h4>
          <div style={s.exampleGrid}>
            <div style={s.exampleCard}>
              <div style={s.exampleLabel}>Take over and build</div>
              <TryIt text="Take over my mouse and keyboard and build me a game in Unreal Engine" onNavigate={onNavigate} />
            </div>
            <div style={s.exampleCard}>
              <div style={s.exampleLabel}>Create something specific</div>
              <TryIt text="Create a low-poly character model in Blender for a mobile game" onNavigate={onNavigate} />
            </div>
            <div style={s.exampleCard}>
              <div style={s.exampleLabel}>Design and produce</div>
              <TryIt text="Design me a modern logo in Photoshop for my startup called NightOwl" onNavigate={onNavigate} />
            </div>
            <div style={s.exampleCard}>
              <div style={s.exampleLabel}>Edit and produce</div>
              <TryIt text="Edit my video in Premiere Pro — add transitions, color grade, and export for YouTube" onNavigate={onNavigate} />
            </div>
            <div style={s.exampleCard}>
              <div style={s.exampleLabel}>Quick single action</div>
              <TryIt text="Compile my Unreal project" onNavigate={onNavigate} />
            </div>
            <div style={s.exampleCard}>
              <div style={s.exampleLabel}>Research first</div>
              <TryIt text="Research the best survival game mechanics and then build one in Unreal" onNavigate={onNavigate} />
            </div>
          </div>

          <h4 style={s.subHead}>Tips for Better Results</h4>
          <ul style={s.list}>
            <li><strong>Name the app:</strong> "in Unreal", "in Blender", "in Photoshop" — TriForge needs to know where to work</li>
            <li><strong>Describe the end result:</strong> "a survival game with crafting" is better than "a game"</li>
            <li><strong>Include style/mood:</strong> "low-poly stylized" or "dark and cinematic" helps TriForge plan</li>
            <li><strong>Don't worry about technical terms:</strong> "make the enemies chase me" works just as well as "implement AI patrol states"</li>
          </ul>
        </div>
      ),
    },

    // ── Game Development ───────────────────────────────────────────────────
    {
      id: 'unreal',
      title: 'Game Development (Unreal Engine)',
      icon: '&#9044;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge can build games directly inside Unreal Engine on your machine. It generates
            Blueprint C++ files, compiles, and iterates — all with your approval at each step.
          </p>

          <h4 style={s.subHead}>How It Works</h4>
          <ol style={s.list}>
            <li>Tell TriForge your game idea in Chat</li>
            <li>It asks about genre, mechanics, setting, and features</li>
            <li>TriForge researches current Unreal techniques for your game type</li>
            <li>It generates a build plan and shows a "Start Building" button</li>
            <li>In the Operate tab, TriForge creates C++ files, Blueprints, and compiles your project</li>
          </ol>

          <h4 style={s.subHead}>Example Prompts</h4>
          <TryIt text="Build me a third-person survival game with crafting, base building, and enemy AI in a post-apocalyptic setting" onNavigate={onNavigate} />
          <TryIt text="Create an FPS game with weapon switching, health pickups, and 3 enemy types" onNavigate={onNavigate} />
          <TryIt text="Add a save/load system to my Unreal project" onNavigate={onNavigate} />
          <TryIt text="Create an inventory UI with drag-and-drop in my Unreal game" onNavigate={onNavigate} />

          <h4 style={s.subHead}>What TriForge Creates</h4>
          <ul style={s.list}>
            <li>Character controllers (third-person, first-person, top-down)</li>
            <li>Combat systems (melee, ranged, abilities)</li>
            <li>AI enemies with patrol, chase, and attack behaviors</li>
            <li>Inventory and crafting systems</li>
            <li>Save/load and checkpoint systems</li>
            <li>HUD and UI widgets</li>
            <li>Day/night cycles, weather systems</li>
            <li>Multiplayer networking foundations</li>
          </ul>
        </div>
      ),
    },

    // ── 3D & Blender ──────────────────────────────────────────────────────
    {
      id: 'blender',
      title: '3D Modeling (Blender)',
      icon: '&#9830;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge operates inside Blender using Python scripts — it can model, texture,
            render, and export directly in your open Blender session.
          </p>

          <h4 style={s.subHead}>Example Prompts</h4>
          <TryIt text="Create a low-poly medieval castle in Blender" onNavigate={onNavigate} />
          <TryIt text="Model a stylized robot character in Blender for a game" onNavigate={onNavigate} />
          <TryIt text="Render my current Blender scene at 4K with nice lighting" onNavigate={onNavigate} />
          <TryIt text="Export all objects in my Blender scene as individual FBX files" onNavigate={onNavigate} />

          <h4 style={s.subHead}>What TriForge Can Do in Blender</h4>
          <ul style={s.list}>
            <li>Create 3D models (characters, props, environments)</li>
            <li>Apply materials and textures</li>
            <li>Set up lighting and cameras</li>
            <li>Render scenes to PNG/EXR</li>
            <li>Export to FBX, OBJ, glTF for game engines</li>
            <li>Batch process assets</li>
          </ul>
        </div>
      ),
    },

    // ── Design ────────────────────────────────────────────────────────────
    {
      id: 'design',
      title: 'Design (Photoshop, Illustrator, Figma)',
      icon: '&#9998;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge clicks through menus, uses tools, and types text inside design apps.
            It can create logos, banners, mockups, and edit photos.
          </p>

          <h4 style={s.subHead}>Example Prompts</h4>
          <TryIt text="Design a modern minimalist logo in Photoshop for my brand 'NightOwl Studios'" onNavigate={onNavigate} />
          <TryIt text="Create a YouTube thumbnail in Photoshop — bold text, dark background, neon accents" onNavigate={onNavigate} />
          <TryIt text="Remove the background from my photo in Photoshop and add a gradient" onNavigate={onNavigate} />

          <h4 style={s.subHead}>What TriForge Can Do</h4>
          <ul style={s.list}>
            <li>Create logos, icons, and brand assets</li>
            <li>Design social media graphics and banners</li>
            <li>Photo editing and retouching</li>
            <li>Create mockups and wireframes</li>
            <li>Apply filters, effects, and adjustments</li>
          </ul>
        </div>
      ),
    },

    // ── Video & Audio ─────────────────────────────────────────────────────
    {
      id: 'video-audio',
      title: 'Video & Audio Production',
      icon: '&#9654;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge can edit video in Premiere Pro, DaVinci Resolve, or Final Cut Pro, and
            produce audio in Logic Pro, Ableton, or Pro Tools.
          </p>

          <h4 style={s.subHead}>Video Examples</h4>
          <TryIt text="Edit my video in Premiere Pro — add cuts, transitions, and export for YouTube" onNavigate={onNavigate} />
          <TryIt text="Color grade my footage in DaVinci Resolve with a cinematic look" onNavigate={onNavigate} />
          <TryIt text="Create a motion graphics intro in After Effects" onNavigate={onNavigate} />

          <h4 style={s.subHead}>Audio Examples</h4>
          <TryIt text="Create a lo-fi hip hop beat in Logic Pro" onNavigate={onNavigate} />
          <TryIt text="Mix and master my track in Ableton Live" onNavigate={onNavigate} />

          <h4 style={s.subHead}>Supported Apps</h4>
          <ul style={s.list}>
            <li><strong>Video:</strong> Premiere Pro, After Effects, DaVinci Resolve, Final Cut Pro</li>
            <li><strong>Audio:</strong> Logic Pro, Ableton Live, Pro Tools</li>
          </ul>
        </div>
      ),
    },

    // ── App Development ───────────────────────────────────────────────────
    {
      id: 'dev',
      title: 'App Development (Xcode, Android Studio)',
      icon: '&#9000;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge can write code, build projects, and navigate IDEs on your behalf.
          </p>

          <h4 style={s.subHead}>Example Prompts</h4>
          <TryIt text="Build a new SwiftUI view in Xcode with a list of items and a detail screen" onNavigate={onNavigate} />
          <TryIt text="Create a new Activity in Android Studio with a RecyclerView" onNavigate={onNavigate} />
          <TryIt text="Fix the build error in my Xcode project" onNavigate={onNavigate} />
        </div>
      ),
    },

    // ── Any App ───────────────────────────────────────────────────────────
    {
      id: 'any-app',
      title: 'Any App on Your Computer',
      icon: '&#9635;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            TriForge isn't limited to specific apps. It can see your screen and operate
            inside any program — clicking, typing, and using keyboard shortcuts.
          </p>

          <h4 style={s.subHead}>Example Prompts</h4>
          <TryIt text="Open Excel and create a budget spreadsheet with formulas for monthly expenses" onNavigate={onNavigate} />
          <TryIt text="Open my terminal and run npm install followed by npm start" onNavigate={onNavigate} />
          <TryIt text="Take a screenshot of my current screen" onNavigate={onNavigate} />

          <h4 style={s.subHead}>How It Works</h4>
          <ul style={s.list}>
            <li>TriForge takes a screenshot to see what's on your screen</li>
            <li>It identifies UI elements (buttons, menus, text fields)</li>
            <li>It plans the next click, type, or shortcut</li>
            <li>You approve the action, then TriForge executes it</li>
            <li>It takes another screenshot to verify the result</li>
            <li>Repeat until the task is done</li>
          </ul>
        </div>
      ),
    },

    // ── Chat Features ────────────────────────────────────────────────────
    {
      id: 'chat-features',
      title: 'Chat Features (Beyond the Operator)',
      icon: '&#9733;',
      content: (
        <div style={s.sectionBody}>
          <p style={s.intro}>
            The Chat isn't just for operator tasks. TriForge has three AI brains (GPT, Claude, Grok)
            that debate and give you the best answer on anything.
          </p>

          <h4 style={s.subHead}>What You Can Ask</h4>
          <ul style={s.list}>
            <li><strong>Research:</strong> "Research the best monetization models for mobile games"</li>
            <li><strong>Code:</strong> "Write a TypeScript function that validates JWTs"</li>
            <li><strong>Analysis:</strong> "Compare React vs Vue vs Svelte for my next project"</li>
            <li><strong>Planning:</strong> "Create a 30-day launch plan for my SaaS product"</li>
            <li><strong>Writing:</strong> "Write a professional email declining this meeting"</li>
            <li><strong>File management:</strong> "Organize my Downloads folder" or "Find my driver's license"</li>
            <li><strong>Image generation:</strong> "Generate a logo for my startup" (uses DALL-E 3)</li>
          </ul>

          <h4 style={s.subHead}>Pro Tips</h4>
          <ul style={s.list}>
            <li>TriForge automatically searches the web when your question needs current info</li>
            <li>It remembers context from earlier in the conversation — you can say "now make it darker" after a design task</li>
            <li>Use voice input (click the mic icon) for hands-free operation</li>
          </ul>
        </div>
      ),
    },

    // ── Troubleshooting ──────────────────────────────────────────────────
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      icon: '&#9888;',
      content: (
        <div style={s.sectionBody}>
          <h4 style={s.subHead}>Common Issues</h4>

          <div style={s.faqItem}>
            <strong>TriForge says it can't interact with my app</strong>
            <p style={s.faqAnswer}>This should never happen with the latest version. If it does, try rephrasing: "Take over my mouse and build X in [App Name]". Make sure you name the specific app.</p>
          </div>

          <div style={s.faqItem}>
            <strong>The Operate tab shows "Accessibility not granted"</strong>
            <p style={s.faqAnswer}>Go to System Settings → Privacy & Security → Accessibility → toggle TriForge AI on. Same for Screen Recording. These permissions let TriForge see and interact with your screen.</p>
          </div>

          <div style={s.faqItem}>
            <strong>TriForge can't find my app</strong>
            <p style={s.faqAnswer}>Make sure the app is open and running before asking TriForge to operate in it. TriForge detects running apps automatically.</p>
          </div>

          <div style={s.faqItem}>
            <strong>The build failed in Unreal</strong>
            <p style={s.faqAnswer}>Say "Triage the build error in my Unreal project" — TriForge will analyze the log file, classify the error, and suggest a fix.</p>
          </div>

          <div style={s.faqItem}>
            <strong>I added an API key but nothing happens</strong>
            <p style={s.faqAnswer}>Make sure the key is valid. Go to Settings → API Keys and check that the status shows a green dot. You need at least one key (OpenAI, Claude, or Grok) for Chat to work. All three are recommended for the full council experience.</p>
          </div>
        </div>
      ),
    },
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GuideScreen({ onNavigate }: Props) {
  const sections = buildSections(onNavigate);
  const [activeId, setActiveId] = useState(sections[0].id);

  return (
    <div style={s.root}>
      {/* Sidebar TOC */}
      <nav style={s.toc}>
        <div style={s.tocTitle}>TriForge Guide</div>
        {sections.map(sec => (
          <button
            key={sec.id}
            style={{
              ...s.tocItem,
              ...(activeId === sec.id ? s.tocItemActive : {}),
            }}
            onClick={() => setActiveId(sec.id)}
          >
            <span
              style={s.tocIcon}
              dangerouslySetInnerHTML={{ __html: sec.icon }}
            />
            {sec.title}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div style={s.content}>
        {sections.filter(sec => sec.id === activeId).map(sec => (
          <div key={sec.id}>
            <h2 style={s.sectionTitle}>{sec.title}</h2>
            {sec.content}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
  },

  // TOC sidebar
  toc: {
    width: 220,
    minWidth: 220,
    borderRight: '1px solid var(--border)',
    padding: '16px 0',
    overflowY: 'auto',
    background: 'var(--bg-surface, var(--bg-primary))',
  },
  tocTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.04em',
    padding: '0 16px 12px',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
  },
  tocItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 16px',
    border: 'none',
    background: 'none',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.12s, color 0.12s',
    borderLeft: '3px solid transparent',
  },
  tocItemActive: {
    background: 'rgba(99,102,241,0.08)',
    color: '#6366f1',
    borderLeftColor: '#6366f1',
    fontWeight: 600,
  },
  tocIcon: {
    fontSize: 14,
    opacity: 0.7,
    flexShrink: 0,
    width: 18,
    textAlign: 'center' as const,
  },

  // Content area
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 32px 48px',
    maxWidth: 720,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 16,
    color: 'var(--text-primary)',
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  intro: {
    fontSize: 13,
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
    margin: 0,
  },
  subHead: {
    fontSize: 14,
    fontWeight: 600,
    margin: '8px 0 4px',
    color: 'var(--text-primary)',
  },
  list: {
    margin: 0,
    paddingLeft: 20,
    fontSize: 13,
    lineHeight: 1.7,
    color: 'var(--text-secondary)',
  },

  // Steps
  steps: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  step: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  stepNum: {
    width: 28,
    height: 28,
    minWidth: 28,
    borderRadius: '50%',
    background: 'rgba(99,102,241,0.12)',
    color: '#6366f1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 13,
  },
  stepDesc: {
    margin: '2px 0 0',
    fontSize: 12,
    color: 'var(--text-muted)',
  },

  // Example grid
  exampleGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  exampleCard: {
    padding: '10px 12px',
    background: 'var(--bg-elevated, rgba(255,255,255,0.04))',
    border: '1px solid var(--border)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  exampleLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },

  // Try button
  tryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.12s',
    marginBottom: 4,
  },
  tryIcon: {
    fontSize: 10,
    color: '#6366f1',
    flexShrink: 0,
  },
  tryText: {
    fontSize: 12,
    color: '#6366f1',
    fontWeight: 500,
    fontStyle: 'italic' as const,
  },

  // FAQ
  faqItem: {
    padding: '10px 12px',
    background: 'var(--bg-elevated, rgba(255,255,255,0.04))',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
  },
  faqAnswer: {
    margin: '6px 0 0',
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
};
