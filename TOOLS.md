# Allowed tools (intent)

The `family` agent should operate with the smallest possible set of tools:

- `cron` (schedule executions)
- Workspace file read/write (`kb/`, `memory/`)
- Explicit `calendar` tool(s) (Google Calendar, via dedicated skill)
- `browser` (headless Chromium for web automation)

## Browser

The `browser` tool provides headless Chromium controlled via OpenClaw's built-in browser integration (CDP + Playwright).

Key operations:
- `navigate` — open a URL
- `snapshot` — get an accessibility-tree representation of the page (preferred over screenshots for speed/tokens)
- `screenshot` — capture the page as an image
- `act` — click, type, fill, select, drag elements (by ref from snapshot)
- `pdf` — generate a PDF of the page

Configuration: see `openclaw/openclaw.json5.example` (the `browser:` block).

Requirements on the VM:
- Playwright installed globally (`npm install -g playwright`)
- Chromium browser binary (`npx playwright install chromium`)

Security constraints:
- `evaluateEnabled: false` — no arbitrary JS execution
- Never enter passwords, credentials, or financial data
- Never access banking or payment sites
- Always confirm before submitting forms or downloading files

## Exec

For Google Calendar, it may be necessary to enable `group:exec` **with allowlist** (wrappers only), via Exec Approvals.

Allowed scripts:
- `scripts/c3po-calendar.ts` (TypeScript wrapper — primary)
- `scripts/c3po-calendar-create` (Python/gog wrapper — fallback)
- `scripts/archive-memory.ts` (memory archival)
- `scripts/workspace-backup.ts` (auto-commit and push kb/ + memory/ to Git)

Avoid any shell execution outside the allowlist.

## Skills

Workspace skills in `skills/`:

- `family-agent` — Core routines and guardrails for the family agent
- `whatsapp-styling-guide` — WhatsApp-native formatting rules (no raw Markdown)
- `clawlist` — Multi-step project planning and tracking for family tasks
