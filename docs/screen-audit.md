# TriForge Screen Audit (Section 1 — Goal 2)

**Date:** 2026-04-06  
**Status:** Complete — classification only, no code changes made

---

## Summary

| Category | Count |
|---|---|
| Total screens audited | 31 |
| Primary (core pillar) | 5 |
| Secondary (internal support) | 15 |
| Merge targets | 3 |
| Removed from main experience | 8 |
| Unknown | 0 |

---

## Primary Screens (Core Pillars)

These screens directly represent one of the five locked pillars and must remain as first-class destinations.

| Screen | File Path | Maps To Pillar | Reason |
|---|---|---|---|
| Chat | `packages/desktop/src/renderer/components/Chat.tsx` | TriForge | Core multi-agent council chat — the primary "think with user" interface |
| ForgeCommand | `packages/desktop/src/renderer/forge/ForgeCommand.tsx` | TriForge | Council mission planner: configure, launch, and review multi-agent reasoning missions |
| AgentHQ | `packages/desktop/src/renderer/components/AgentHQ.tsx` | Sessions | Task queue, approval requests, scheduler — the primary execution runtime monitor |
| MemoryScreen | `packages/desktop/src/renderer/App.tsx` (inline, line 803) | Memory | Long-term user memory store: facts, goals, preferences, business context |
| SettingsScreen | `packages/desktop/src/renderer/App.tsx` (inline, line 458) | Settings | API key management, permissions, PIN auth, voice toggle — system control |

---

## Secondary / Internal Screens

Important supporting screens that belong inside a pillar but should not be standalone top-level nav items.

| Screen | File Path | Suggested Pillar | Reason |
|---|---|---|---|
| Dashboard | `packages/desktop/src/renderer/ui/Dashboard.tsx` | Sessions | System health summary, running tasks, scheduled jobs — runtime status overview |
| Ledger | `packages/desktop/src/renderer/components/Ledger.tsx` | Sessions | Audit log of AI decisions and actions — execution history |
| AutomationMode | `packages/desktop/src/renderer/modes/AutomationMode.tsx` | Sessions | Job scheduler management — supports the "do work" function |
| MissionControl | `packages/desktop/src/renderer/components/MissionControl.tsx` | Sessions | Chat session history replay and autonomy status snapshot; overlaps with AgentHQ and Chat history |
| ForgeHubCatalog | `packages/desktop/src/renderer/components/ForgeHubCatalog.tsx` | Sessions | Skill catalog and starter pack manager — tooling library for agent workflows |
| ForgeProfiles | `packages/desktop/src/renderer/components/ForgeProfiles.tsx` | Memory | Agent persona profiles that modify council behavior — belongs inside Memory as context configuration |
| LicensePanel | `packages/desktop/src/renderer/components/LicensePanel.tsx` | Settings | Subscription and tier management |
| SystemHealth | `packages/desktop/src/renderer/components/SystemHealth.tsx` | Settings | Provider and engine health diagnostics — operational check |
| RecoveryScreen | `packages/desktop/src/renderer/components/RecoveryScreen.tsx` | Settings | Store snapshot, validation, and migration tools — system repair |
| DocsScreen | `packages/desktop/src/renderer/components/DocsScreen.tsx` | Settings | In-app user guides |
| ReadinessScreen | `packages/desktop/src/renderer/components/ReadinessScreen.tsx` | Settings | Pre-flight system checks before full operation |
| PhoneLink | `packages/desktop/src/renderer/components/PhoneLink.tsx` | Settings | Phone pairing for mobile companion access |
| SetupWizard | `packages/desktop/src/renderer/components/SetupWizard.tsx` | Settings | First-run onboarding flow — shown only on fresh install |
| LockScreen | `packages/desktop/src/renderer/components/LockScreen.tsx` | Settings | PIN auth lock — shown on launch when PIN is set |
| PermissionWizard | `packages/desktop/src/renderer/components/PermissionWizard.tsx` | Settings | Permission setup step within the first-run flow — not a standalone destination |

---

## Merge Targets

These screens have functionality relevant to a core pillar but currently exist as separate identities or mode containers. Their content should be absorbed when the target pillar is built.

| Screen | File Path | Merge Into | Reason |
|---|---|---|---|
| FileMode | `packages/desktop/src/renderer/modes/FileMode.tsx` | Operate | File browser and file operations — direct Operate capability, currently a top-level nav item |
| InboxMode | `packages/desktop/src/renderer/modes/InboxMode.tsx` | Operate | Email and social platform monitoring (Gmail, LinkedIn, Instagram) — an Operate workflow, not a standalone product area |
| OperatorMode | `packages/desktop/src/renderer/modes/OperatorMode.tsx` | Operate | Social content scheduling mode container; function aligns with Operate but is built as a separate "mode" identity — the mode structure must be dissolved when Operate is implemented |

---

## Removed From Main Experience

These screens introduce separate "worlds", "modes", or niche product identities that conflict with the focused AI council/operator direction. They must be removed from main navigation. Files must remain in the codebase untouched.

| Screen | File Path | Reason |
|---|---|---|
| WorldMode | `packages/desktop/src/renderer/modes/WorldMode.tsx` | Separate-world experience (morning briefs, world news, user interests) — different product identity, does not serve think/do workflow |
| HustleMode | `packages/desktop/src/renderer/modes/HustleMode.tsx` | Income experiments tracker framed as a distinct operating system — separate product identity, not a council or operator function |
| VentureDiscovery | `packages/desktop/src/renderer/components/VentureDiscovery.tsx` | Business venture idea discovery — themed area unrelated to council reasoning or machine operation |
| VibeCoding | `packages/desktop/src/renderer/components/VibeCoding.tsx` | Aesthetic-to-code advisory — niche tool with its own framing; functionality subsumable by Chat council if needed |
| ImageGenerator | `packages/desktop/src/renderer/components/ImageGenerator.tsx` | Standalone image generation tool — separate single-purpose tool with no connection to think/do workflow |
| TradeDesk | `packages/desktop/src/renderer/components/TradeDesk.tsx` | Paper trading planning — specialized niche domain (finance/trading) unrelated to core product identity |
| LiveTradeAdvisor | `packages/desktop/src/renderer/components/LiveTradeAdvisor.tsx` | Real-time futures trade advisory — niche financial domain, introduces a separate product identity with its own UI language |
| AppBuilder | `packages/desktop/src/renderer/components/AppBuilder.tsx` | Multi-studio builder (web app, brand, fashion, marketing, product) — separate creative tool identity, not aligned with AI council or machine operation |

---

## Unknown / Needs Clarification

None. All 31 screens were inspectable and classifiable.

---

## Conflicting Identity Zones

These are the structural conflicts that Goal 3 must resolve. They are not implementation bugs — they are architectural contradictions built into the product over time. Documenting them here makes the restructuring surgical rather than exploratory.

---

### Conflict 1: MissionControl vs Chat — Two Thinking Interfaces

**What exists:**  
Both `Chat` and `MissionControl` interact with the multi-agent council. `MissionControl` holds `triforge-chat-v2` history, renders session messages, shows ForgeScore metrics, and displays council responses. Structurally, it looks like a second chat.

**Why this is a hard conflict:**  
The product identity requires exactly one place where the user thinks with TriForge. Two chat-adjacent surfaces fracture the experience and imply two separate agents or two versions of the product.

**Locked decision:**  
- `Chat` = TriForge pillar. The only user-facing thinking interface.  
- `MissionControl` = Sessions pillar. Execution state, agent activity, autonomy tracking, and system behavior visibility only.  
- MissionControl must not present itself as a place to talk to TriForge. Any conversational elements inside it are in conflict and must be removed or reclassified during Goal 3.  
- **Rule:** There must never be two places where the user "talks" to TriForge. If that happens, the product is broken.

---

### Conflict 2: Mode-Based Architecture vs Pillar-Based Architecture

**What exists:**  
Six screens (`OperatorMode`, `WorldMode`, `FileMode`, `InboxMode`, `AutomationMode`, `HustleMode`) are structured around a `SYSTEM_REGISTRY` filter pattern. Each screen filters the registry by a mode string (e.g., `s.modes.includes('operator')`). This encodes the old product concept: TriForge as a collection of distinct operating modes, each with its own identity.

**Why this is a hard conflict:**  
The mode pattern treats each "mode" as a product section — a mini app. This is the old architecture. The new architecture treats pillars as fixed destinations and modes as internal routing only. The two cannot coexist in the navigation layer.

**Locked decision:**  
- The mode system is no longer a product structure. It becomes an internal capability grouping mechanism only.  
- No "mode" may appear as a top-level navigation destination.  
- `SYSTEM_REGISTRY` may remain as an internal data structure if useful, but it must not drive top-level navigation or imply multiple product identities.  
- During Goal 3: FileMode, InboxMode, OperatorMode → merge into Operate. AutomationMode → merge into Sessions. WorldMode, HustleMode → removed from main experience entirely.

---

### Conflict 3: Screens That Feel Like Separate Products

The following screens introduce their own visual language, framing, and purpose to the point where they feel like standalone applications embedded inside TriForge. This is a product coherence failure — not a feature problem.

| Screen | Why It Feels Like a Separate Product |
|---|---|
| LiveTradeAdvisor | Full real-time advisory system with 20+ sub-components, its own trading vocabulary, shadow mode, trust evidence panels — an entire fintech product inside TriForge |
| TradeDesk | Paper trading interface with its own council verdict system and risk sizing logic — another separate financial tool |
| HustleMode | Income experiments tracker framed as an "operating system" — different product metaphor entirely |
| AppBuilder | Multi-studio creative tool (web app, brand, fashion, marketing, product) — a creative agency tool inside an AI worker product |
| VentureDiscovery | Business idea discovery tool — its own domain, its own framing |
| WorldMode | Morning briefing and world news — a separate media/information product |

**Locked decision:**  
All six are removed from the main experience. Their depth of implementation does not justify product prominence. Depth of code is not a product argument.

---

## Notes & Observations

### Navigation state today
The current sidebar exposes 14 items directly: TriForge, Command, Dashboard, Files, Inbox, Memory, Ledger, Settings, Phone, Health, Recovery, Docs, Readiness, Plan. This is overloaded and contradicts the focused identity. At least 6 of these (Health, Recovery, Docs, Readiness, Phone, Ledger) belong inside Settings or Sessions, not at the top level.

### Redundancy between Chat, ForgeCommand, and MissionControl
All three interact with the multi-agent council. `Chat` is conversational. `ForgeCommand` is structured mission planning. `MissionControl` appears to be a legacy or parallel implementation that also holds chat history (`triforge-chat-v2`) and autonomy status — overlapping with both Chat and AgentHQ. MissionControl needs clarification before Goal 3: is it still active? Is it diverging from Chat? This is the highest structural risk going into Goal 3.

### The "modes" pattern must be dissolved
`OperatorMode`, `WorldMode`, `FileMode`, `InboxMode`, `AutomationMode`, and `HustleMode` are all built around a `SYSTEM_REGISTRY` filter pattern (`s.modes.includes('operator')` etc.). This registry-driven mode structure implies there are multiple "modes" of TriForge — which directly contradicts the locked identity. The registry pattern itself should be reviewed in Goal 3.

### Trading domain is deeply developed but misaligned
`LiveTradeAdvisor` has 20+ sub-components in `components/trading/` — this is one of the most developed sections of the app. It is also the furthest from the product identity. Removal from main experience does not require deleting this code, but it must not appear in the primary navigation or opening experience.

### AppBuilder sub-screens
`BuilderHome`, `BrandStudio`, `FashionStudio`, `MarketingStudio`, `ProductStudio`, `WebAppStudio` (in `builder/`) are all nested under AppBuilder and have no independent routes. They travel with their parent.

### Forge sub-components (not standalone screens)
`CouncilView`, `DecisionBoard`, `ExecutionGate`, `MissionBriefing`, `ConflictZonePanel`, `CostOptimizer`, `InfluencePanel`, `ForgeEngine`, `MergeZone` (in `forge/`) are all sub-components of ForgeCommand — not standalone screens. They are correctly scoped.

### Shared sub-components (not standalone screens)
`ForgeChamber`, `ExecutionPlanView`, `CouncilWakeScreen`, `HandsFreeVoice`, `TrianglePresence`, `TrustComponents`, `UpgradeGate`, `VoiceButton`, `VoiceConversation`, `OnboardingChecklist`, `StarterPackInstallWizard` are sub-components or headless utilities, not navigation destinations.

### Five-pillar mapping coverage
Of the five locked pillars, four have clear screen anchors today: TriForge (Chat + ForgeCommand), Sessions (AgentHQ + Dashboard + Ledger), Memory (MemoryScreen + ForgeProfiles), Settings (SettingsScreen + supporting screens). **Operate has no primary screen yet** — it exists only as a future target for FileMode, InboxMode, and OperatorMode merges.
