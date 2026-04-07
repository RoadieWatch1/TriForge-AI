# TriForge Reassignment Map (Section 1 — Goal 3)

**Date:** 2026-04-06  
**Status:** Structural mapping only — no code modified  
**Input:** `docs/screen-audit.md` (31 screens audited)  
**Foundation:** `docs/product-identity.md` (locked identity)

---

## Summary

| Metric | Value |
|---|---|
| Total screens mapped | 31 |
| Pillars used | 5 / 5 |
| Unmapped screens | 0 |
| Hidden / internal | 8 |
| Conflict zones resolved | 3 |

---

## 1. TriForge (Thinking)

The only pillar where the user thinks with TriForge. No other pillar presents a conversational or reasoning interface.

### Primary Surface

| Screen | File Path | Role |
|---|---|---|
| Chat | `packages/desktop/src/renderer/components/Chat.tsx` | The single user-facing thinking interface. Multi-agent council conversation, planning, guidance, and decision support. |

### Sub-Surfaces

| Screen | File Path | Role | Decision |
|---|---|---|---|
| ForgeCommand | `packages/desktop/src/renderer/forge/ForgeCommand.tsx` | Structured council mission planner — same underlying council as Chat, but accessed through a deliberate configure-launch-review flow rather than conversation. | Keep. This is not a second chat; it is a structured entry point into the same council for users who want to define a mission explicitly before thinking begins. It sits inside the TriForge pillar, not beside it. |

### Internal / Supporting Components

These are not screens. They are components that power the TriForge pillar from within.

| Component | File Path | Role |
|---|---|---|
| ForgeChamber | `packages/desktop/src/renderer/components/ForgeChamber.tsx` | Council orchestration engine — internal to Chat |
| ExecutionPlanView | `packages/desktop/src/renderer/components/ExecutionPlanView.tsx` | Step-by-step execution plan renderer — used inside Chat |
| CouncilWakeScreen | `packages/desktop/src/renderer/components/CouncilWakeScreen.tsx` | Full-screen wake/auth overlay triggered by voice — internal flow layer |
| HandsFreeVoice | `packages/desktop/src/renderer/components/HandsFreeVoice.tsx` | Headless continuous speech recognition loop — internal service |
| VoiceButton | `packages/desktop/src/renderer/components/VoiceButton.tsx` | Voice input trigger — Chat UI sub-component |
| VoiceConversation | `packages/desktop/src/renderer/components/VoiceConversation.tsx` | Voice session state manager — internal to Chat |
| TrianglePresence | `packages/desktop/src/renderer/components/TrianglePresence.tsx` | Persistent sidebar council state indicator — shell-level, not a screen |
| CouncilView | `packages/desktop/src/renderer/forge/CouncilView.tsx` | Council response display — sub-component of ForgeCommand |
| DecisionBoard | `packages/desktop/src/renderer/forge/DecisionBoard.tsx` | Decision result display — sub-component of ForgeCommand |
| ExecutionGate | `packages/desktop/src/renderer/forge/ExecutionGate.tsx` | Approval gate before execution — sub-component of ForgeCommand |
| MissionBriefing | `packages/desktop/src/renderer/forge/MissionBriefing.tsx` | Mission configuration form — sub-component of ForgeCommand |
| ConflictZonePanel | `packages/desktop/src/renderer/forge/ConflictZonePanel.tsx` | Conflict analysis panel — sub-component of ForgeCommand |
| CostOptimizer | `packages/desktop/src/renderer/forge/CostOptimizer.tsx` | Token/cost optimization display — sub-component of ForgeCommand |
| InfluencePanel | `packages/desktop/src/renderer/forge/InfluencePanel.tsx` | Provider influence visualization — sub-component of ForgeCommand |
| ForgeEngine | `packages/desktop/src/renderer/components/forge/ForgeEngine.tsx` | Core council execution engine — internal service |
| MergeZone | `packages/desktop/src/renderer/components/forge/MergeZone.tsx` | Consensus synthesis display — sub-component |

### Merged Into TriForge

Nothing merged from other sections. TriForge is the origin of the thinking function, not a destination for displaced screens.

### Notes

Chat is the only screen in this entire product where the user talks to TriForge. ForgeCommand extends this by providing a structured briefing interface before council reasoning begins — it is not a second interface, it is a different entry path into the same council. The distinction is: Chat is open-ended dialogue; ForgeCommand is mission-driven deliberation. Both terminate in council output. If any future screen presents itself as a place to "ask TriForge something," it belongs here or it does not belong in the product.

---

## 2. Operate (Execution)

The pillar where TriForge does work on the user's machine: files, apps, browser, communications, scheduled tasks. **This pillar has no primary screen yet.** It is currently decomposed across three mode-based screens that will be dissolved and reassembled when Operate is built in Section 2.

### Primary Surface

**None yet.** The Operate primary screen does not exist. It will be created in Section 2. Its job: present the user with a unified view of what TriForge can do and is doing on their machine — active tasks, file operations, inbox management, scheduled automations — all in one surface.

### Sub-Surfaces (Future — feeding Operate)

These three screens are the raw material Operate will be built from. They are merge targets, not the final form.

| Screen | File Path | What It Contributes to Operate | Decision |
|---|---|---|---|
| FileMode | `packages/desktop/src/renderer/modes/FileMode.tsx` | File browsing and file-level operations — the foundation of machine-level work | Merge. Strip "mode" framing. The file capability becomes a sub-surface or panel inside Operate. |
| InboxMode | `packages/desktop/src/renderer/modes/InboxMode.tsx` | Email and social platform monitoring (Gmail, LinkedIn, Instagram) — communication-layer operations | Merge. Strip "mode" framing. Inbox monitoring becomes a communication sub-surface inside Operate. |
| OperatorMode | `packages/desktop/src/renderer/modes/OperatorMode.tsx` | Social content scheduling and posting pipeline — outbound automated operations | Merge. Strip "mode" framing. Content scheduling becomes a scheduling/automation sub-surface inside Operate. Note: the name "OperatorMode" is legacy — this content does not define what Operate means in the new structure; it only contributes scheduling capability to it. |

### Internal / Supporting

| Screen | File Path | Role |
|---|---|---|
| ImageGenerator | `packages/desktop/src/renderer/components/ImageGenerator.tsx` | Image generation capability — functionally could become an Operate tool in the future, but currently has no connection to the machine-operation workflow. Contained here as internal-only, not surfaced. |

### Notes

Operate is the most structurally underdeveloped pillar. Three existing screens (FileMode, InboxMode, OperatorMode) provide capability inputs, but they were built as separate "modes," not as parts of a unified execution layer. When Operate is built in Section 2, the primary surface must present a single coherent view of "what is TriForge doing on my machine right now" — not three separate tools joined by a nav bar. The `SYSTEM_REGISTRY` mode pattern that structures these files must not be carried forward as the organizing principle of Operate.

---

## 3. Sessions (Runtime & History)

The pillar where the user sees what TriForge has done, is doing, and is scheduled to do. Execution state. Agent activity. Decision history. Runtime visibility. **This is not a thinking surface — it is an observation and control surface.**

### Primary Surface

| Screen | File Path | Role |
|---|---|---|
| AgentHQ | `packages/desktop/src/renderer/components/AgentHQ.tsx` | The primary Sessions surface. Task queue, approval requests, running plans, scheduler — the complete execution runtime monitor. This is where the user sees the agent working. |

### Sub-Surfaces

| Screen | File Path | Role | Decision |
|---|---|---|---|
| Dashboard | `packages/desktop/src/renderer/ui/Dashboard.tsx` | Runtime health summary: running tasks, pending approvals, scheduled jobs at a glance. | Keep as sub-surface. Operates as a summary/home view within Sessions — not a top-level nav destination. |
| Ledger | `packages/desktop/src/renderer/components/Ledger.tsx` | Audit log of AI decisions, actions, and ForgeScores — permanent execution history. | Keep as sub-surface within Sessions. History panel, not a top-level destination. |
| AutomationMode | `packages/desktop/src/renderer/modes/AutomationMode.tsx` | Job scheduler interface: create, view, and manage scheduled tasks and cron jobs. | Merge into Sessions. Strip "mode" framing. Becomes the scheduling/jobs sub-surface within Sessions, adjacent to AgentHQ's live task view. |
| MissionControl | `packages/desktop/src/renderer/components/MissionControl.tsx` | **Conflict resolved (see below).** Retains: autonomy status snapshot, council effectiveness metrics, approval strictness state. Strips: all conversational elements, chat history rendering, message thread display. | Keep in Sessions, stripped. Conversational elements removed. Becomes a runtime status panel: autonomy config, sensor activity, workflow state — not a place to talk to TriForge. |

### Internal / Supporting

| Screen | File Path | Role |
|---|---|---|
| ForgeHubCatalog | `packages/desktop/src/renderer/components/ForgeHubCatalog.tsx` | Skill catalog and starter pack manager (RunbookPacks). Not a navigation destination — accessed as a configuration panel within Sessions when setting up agent capabilities. |

### Merged Into Sessions

- `AutomationMode` — scheduling capability absorbed into Sessions as jobs/scheduler sub-surface
- `MissionControl` — retained only for its execution-state and autonomy-visibility content; chat-like elements stripped

### Notes

The critical structural decision here is the resolution of the MissionControl conflict. MissionControl currently holds `triforge-chat-v2` history and renders council responses — which makes it look like a second chat. Under this mapping it is reassigned to Sessions, and its job narrows to: showing the user the autonomy and execution state of the system. It does not present a message thread. It does not invite the user to type. It shows: what is running, what level of autonomy is active, what was approved or denied, and how the system has been performing. All rendering of council output as a conversation thread must be removed from MissionControl — that surface belongs exclusively to Chat in the TriForge pillar.

---

## 4. Memory (Context & Knowledge)

The pillar where the user defines and reviews what TriForge knows about them. Persistent context that shapes how the council thinks and how agents operate.

### Primary Surface

| Screen | File Path | Role |
|---|---|---|
| MemoryScreen | `packages/desktop/src/renderer/App.tsx` (inline, line 803) | The primary Memory surface. User-managed long-term memory: facts, goals, preferences, business context. Direct read/write/delete interface. |

### Sub-Surfaces

| Screen | File Path | Role | Decision |
|---|---|---|---|
| ForgeProfiles | `packages/desktop/src/renderer/components/ForgeProfiles.tsx` | Agent persona configuration — profiles that shape how the council responds (tone, domain focus, behavior). | Keep as sub-surface inside Memory. A profile is a form of context: it tells the council who the user is and how to operate. Belongs in Memory alongside facts and goals. |

### Internal / Supporting

| Component | File Path | Role |
|---|---|---|
| OnboardingChecklist | `packages/desktop/src/renderer/components/OnboardingChecklist.tsx` | Structured checklist used during first-run to guide the user through initial memory/context setup. Internal to the onboarding flow. |

### Merged Into Memory

Nothing merged from outside. ForgeProfiles was always contextually adjacent to Memory and is a natural sub-surface.

---

## 5. Settings (Control & Trust)

The pillar for system configuration, credentials, permissions, health, and security. Not a product destination — a control panel. Users arrive here with intent; they do not browse here.

### Primary Surface

| Screen | File Path | Role |
|---|---|---|
| SettingsScreen | `packages/desktop/src/renderer/App.tsx` (inline, line 458) | The primary Settings surface. API keys (OpenAI, Claude, Grok), permissions, voice toggle, PIN management. Core system control. |

### Sub-Surfaces

| Screen | File Path | Role | Decision |
|---|---|---|---|
| LicensePanel | `packages/desktop/src/renderer/components/LicensePanel.tsx` | Subscription and tier management. | Keep as sub-surface — accessed from within Settings. Not a standalone nav destination. |
| SystemHealth | `packages/desktop/src/renderer/components/SystemHealth.tsx` | Provider connection status, engine health, diagnostic checks. | Keep as sub-surface within Settings. Health is a settings concern, not a top-level destination. |
| ReadinessScreen | `packages/desktop/src/renderer/components/ReadinessScreen.tsx` | Pre-flight system validation before full agent operation begins. | Keep as sub-surface — a setup check panel accessible from Settings. |
| DocsScreen | `packages/desktop/src/renderer/components/DocsScreen.tsx` | In-app guides and reference documentation. | Keep as sub-surface within Settings. Docs support configuration — they live near the tools they describe. |
| PhoneLink | `packages/desktop/src/renderer/components/PhoneLink.tsx` | Phone pairing for mobile companion access. | Keep as sub-surface within Settings. A connectivity feature, not a product destination. |
| RecoveryScreen | `packages/desktop/src/renderer/components/RecoveryScreen.tsx` | Store snapshot, data validation, migration repair. | Keep as sub-surface within Settings. Diagnostic/repair tooling for power users and recovery scenarios. |

### Internal / Supporting (Flow Screens)

These are not navigable destinations. They are full-screen states the system enters under specific conditions.

| Screen | File Path | Trigger Condition |
|---|---|---|
| SetupWizard | `packages/desktop/src/renderer/components/SetupWizard.tsx` | First-run only. Shown automatically on fresh install. Exits into the main app. |
| LockScreen | `packages/desktop/src/renderer/components/LockScreen.tsx` | Shown on every launch when PIN is set, and after inactivity timeout. |
| PermissionWizard | `packages/desktop/src/renderer/components/PermissionWizard.tsx` | Step within SetupWizard — not independently triggered. |
| UpgradeGate | `packages/desktop/src/renderer/components/UpgradeGate.tsx` | Paywalling overlay triggered inline when a tier-restricted feature is accessed. |

### Merged Into Settings

No screens merged in from outside. All Settings sub-surfaces were already naturally scoped here; they were simply incorrectly elevated to top-level nav items in the current structure.

---

## 6. Hidden / Internal Only (Not in Main Experience)

These screens are removed from the main experience. They remain in the codebase. No code is deleted. No files are moved.

| Screen | File Path | Assigned Pillar | Reason for Hiding |
|---|---|---|---|
| WorldMode | `packages/desktop/src/renderer/modes/WorldMode.tsx` | None | Separate product identity (media/information). Does not serve think/do workflow. |
| HustleMode | `packages/desktop/src/renderer/modes/HustleMode.tsx` | None | Income experiment tracker framed as a distinct operating system. Separate product metaphor. |
| VentureDiscovery | `packages/desktop/src/renderer/components/VentureDiscovery.tsx` | None | Business idea discovery tool. Standalone domain, not connected to council or machine operation. |
| VibeCoding | `packages/desktop/src/renderer/components/VibeCoding.tsx` | None | Aesthetic-to-code advisory. Niche tool; any useful council function is already available via Chat. |
| ImageGenerator | `packages/desktop/src/renderer/components/ImageGenerator.tsx` | Operate (future candidate) | Standalone image tool. Could become an Operate capability in future, but not part of the current product surface. |
| TradeDesk | `packages/desktop/src/renderer/components/TradeDesk.tsx` | None | Paper trading planning. Specialized financial domain. Does not belong in the main product experience. |
| LiveTradeAdvisor | `packages/desktop/src/renderer/components/LiveTradeAdvisor.tsx` | None | Real-time futures advisory with 20+ sub-components. Deeply developed but entirely misaligned with product identity. Depth of code does not justify product prominence. |
| AppBuilder | `packages/desktop/src/renderer/components/AppBuilder.tsx` | None | Multi-studio creative tool (web app, brand, fashion, marketing, product). Separate product identity. |

**Builder sub-screens (travel with AppBuilder, all hidden):**  
`BuilderHome`, `BrandStudio`, `FashionStudio`, `MarketingStudio`, `ProductStudio`, `WebAppStudio` — all in `packages/desktop/src/renderer/builder/`

**Trading sub-components (travel with LiveTradeAdvisor, all hidden):**  
20+ components in `packages/desktop/src/renderer/components/trading/` — contained with their parent.

---

## 7. Key Structural Decisions

1. **Chat is the only thinking interface.** ForgeCommand is a structured mission entry point into the same council — it is not a second chat, it is a different mode of engagement with the same reasoning system. MissionControl is not a thinking interface at all.

2. **MissionControl is stripped and reassigned to Sessions.** Its conversational and chat-history elements must be removed. Its function narrows to: execution state, autonomy status, approval history, and system behavior visibility.

3. **The mode system is eliminated as product structure.** `OperatorMode`, `FileMode`, `InboxMode`, `AutomationMode`, `WorldMode`, `HustleMode` are no longer modes of TriForge. FileMode, InboxMode, and OperatorMode become raw capability inputs to the Operate pillar. AutomationMode becomes a scheduling sub-surface within Sessions. WorldMode and HustleMode are hidden entirely.

4. **Operate is a conceptual pillar, not yet a screen.** Three existing screens (FileMode, InboxMode, OperatorMode) provide its building blocks. Section 2 must define and build the Operate primary surface. Until that screen exists, Operate has no user-facing entry point.

5. **The Dashboard is demoted.** It is not a home screen or a top-level destination. It is a runtime summary sub-surface within Sessions — a status panel, not a product anchor.

6. **Fourteen sidebar items collapse to five.** The current sidebar has 14 entries (TriForge, Command, Dashboard, Files, Inbox, Memory, Ledger, Settings, Phone, Health, Recovery, Docs, Readiness, Plan). Under this mapping, the main navigation has exactly five entries: TriForge, Operate, Sessions, Memory, Settings. Everything else lives inside one of these five.

7. **Hidden screens are not deleted.** Eight screens (WorldMode, HustleMode, VentureDiscovery, VibeCoding, ImageGenerator, TradeDesk, LiveTradeAdvisor, AppBuilder) and their sub-components remain in the codebase. Their routes are removed from navigation. Their files are untouched.

8. **Depth does not equal priority.** LiveTradeAdvisor is the most developed section in the codebase. It is also the most hidden. Implementation investment made in a previous product direction does not grant navigation placement in the new one.

---

## 8. Risks & Follow-Ups for Section 2

- **MissionControl surgical edit is required.** Before Section 2 can finalize the Sessions pillar, MissionControl's conversational rendering must be removed. This is the highest-risk code change in the entire restructuring — it touches a component that holds chat history and renders council responses. Goal: retain the autonomy status, approval log, and execution state views; remove anything that renders a message thread or invites user input.

- **Operate primary screen is a new build.** Section 2 must create a screen that does not currently exist. The three input screens (FileMode, InboxMode, OperatorMode) are written as mode containers with `SYSTEM_REGISTRY` filtering. That pattern must not be the internal structure of the new Operate surface — it will need to be re-implemented or refactored when Operate is built.

- **MemoryScreen is inline in App.tsx.** The Memory primary surface has no dedicated file — it lives as an inline function at line 803 of App.tsx alongside the SettingsScreen function. For Section 2 navigation work, this should be extracted into its own file (`components/MemoryScreen.tsx`) to make the pillar structure explicit in the codebase.

- **SettingsScreen is also inline in App.tsx.** Same issue as MemoryScreen. For clean pillar separation in Section 2, SettingsScreen should move to its own file.

- **ForgeHubCatalog currently navigates back to `hustle`** (`onBack={() => setScreen('hustle')}`). HustleMode is being hidden. This back-navigation reference will break and must be updated in Section 2 to navigate back to Sessions instead.

- **ForgeCommand's `onDiscussInChat` callback already links to Chat.** This is a correct dependency. The TriForge pillar's two surfaces (Chat and ForgeCommand) are already wired together. This connection must be preserved during navigation restructuring.

- **`AutomationMode` back-navigation target is undefined.** Currently accessed programmatically, no back button observed. When absorbed into Sessions in Section 2, its navigation context will need to be explicitly defined.
