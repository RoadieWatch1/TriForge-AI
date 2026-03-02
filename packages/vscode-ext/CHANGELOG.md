# Change Log

All notable changes to the Triforge AI Code Council extension will be documented here.

## [0.0.1] - 2026-03-02

### Added
- Tri-model AI consensus engine — OpenAI, Claude, and Grok debate every code change before it's applied
- Automatic mode selection based on active providers (Single / Pair / Consensus)
- SHA-256 verified consensus: all three models must agree on identical output before changes apply
- `Ctrl+Shift+T` / `Cmd+Shift+T` keyboard shortcut to open the Council panel
- Command Palette commands: Open Council, Add/Update API Key, Remove API Key, Check Provider Status, Export Council Report
- Right-click context menu: Explain Code, Write Tests, Refactor Code, Find Bugs (on selected code)
- Secure API key storage via VS Code Secret Storage
- Configurable AI models per provider (OpenAI, Claude, Grok)
- Guided and Professional UI modes
- Adjustable risk tolerance and auto-approve settings for low-risk patches
- License activation / deactivation via Lemon Squeezy
