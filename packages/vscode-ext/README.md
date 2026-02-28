# TriForge AI

A VS Code extension that runs a **tri-model AI consensus engine** — OpenAI, Claude, and Grok debate every code change before it's applied to your project.

## How It Works

Instead of trusting a single AI, TriForge runs a structured debate:

1. One model **plans** which files to change
2. One model **drafts** the changes
3. The other two **review and vote** — they must agree on the exact same content (SHA-256 verified)
4. All three approve → changes applied. Disagreement → logged for your review.

The number of active providers determines the mode automatically:

| API keys configured | Mode | Behavior |
|---|---|---|
| 1 | Single | Advisory chat |
| 2 | Pair | Builder + Reviewer |
| 3 | Consensus | Full 3-way debate |

## Getting Started

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **TriForge AI: Add/Update API Key** for each provider you want to use
3. Open the chat with `Ctrl+Shift+T` (or `Cmd+Shift+T` on Mac)

## Commands

| Command | Description |
|---|---|
| `TriForge AI: Open Chat` | Open the main chat panel (`Ctrl+Shift+T`) |
| `TriForge AI: Add/Update API Key` | Store an API key for OpenAI, Claude, or Grok |
| `TriForge AI: Remove API Key` | Remove a stored API key |
| `TriForge AI: Check Provider Status` | See which providers are active |
| `TriForge AI: Export Debate as Markdown` | Save the full AI debate log |
| `Explain Code` | Explain selected code (right-click menu) |
| `Write Tests` | Generate tests for selected code |
| `Refactor Code` | Refactor selected code via consensus |
| `Find Bugs` | Analyze selected code for bugs |

## Settings

| Setting | Default | Description |
|---|---|---|
| `triforgeAi.mode` | `guided` | `guided` (beginner) or `professional` (full debate logs) |
| `triforgeAi.maxIterations` | `4` | Max debate rounds per file (1–10) |
| `triforgeAi.riskTolerance` | `medium` | `low`, `medium`, or `high` — controls how conservative the engine is |
| `triforgeAi.autoApprove` | `false` | Auto-apply low-risk patches without a confirmation prompt |
| `triforgeAi.openai.model` | `gpt-4o` | OpenAI model to use |
| `triforgeAi.claude.model` | `claude-sonnet-4-20250514` | Claude model to use |
| `triforgeAi.grok.model` | `grok-3` | Grok model to use |

## Requirements

At least one API key from OpenAI, Anthropic, or xAI. All keys are stored securely in VS Code's Secret Storage.
