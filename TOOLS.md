# Allowed tools (intent)

The `family` agent should operate with the smallest possible set of tools:

- `cron` (schedule executions)
- Workspace file read/write (`kb/`, `memory/`)
- Explicit `calendar` tool(s) (Google Calendar, via dedicated skill)
- Explicit `tasks` tool(s) (Google Tasks, via dedicated script)
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

For Google Calendar and Google Tasks, it may be necessary to enable `group:exec` **with allowlist** (wrappers only), via Exec Approvals.

Allowed scripts:
- `scripts/c3po-calendar.ts` (Google Calendar — TypeScript wrapper)
- `scripts/c3po-calendar-create` (Google Calendar — Python/gog wrapper, fallback)
- `scripts/c3po-tasks.ts` (Google Tasks — TypeScript wrapper)
- `scripts/archive-memory.ts` (memory archival)
- `scripts/workspace-backup.ts` (auto-commit and push kb/ + memory/ to Git)
- `scripts/c3po-shopping-ml.ts` (busca produtos no Mercado Livre via API pública)

Avoid any shell execution outside the allowlist.

## Google Tasks

The `c3po-tasks` tool provides read/write access to Google Tasks via the official API.

Operations:
- List all task lists: `bun scripts/c3po-tasks.ts --list-tasklists`
- List tasks: `bun scripts/c3po-tasks.ts --list-tasks --tasklist-id "id" [--show-completed true|false] [--due-before "YYYY-MM-DD"] [--due-after "YYYY-MM-DD"]`
- Create task: `bun scripts/c3po-tasks.ts --create-task --tasklist-id "id" --title "…" [--notes "…"] [--due "YYYY-MM-DD"]`
- Update task: `bun scripts/c3po-tasks.ts --update-task --tasklist-id "id" --task-id "…" [--title "…"] [--status completed|needsAction]`
- Delete task: `bun scripts/c3po-tasks.ts --delete-task --tasklist-id "id" --task-id "…"`
- Create tasklist: `bun scripts/c3po-tasks.ts --create-tasklist --title "…"`
- Setup OAuth: `bun scripts/c3po-tasks.ts --setup` (one-time, interactive)

Configuration:
- OAuth credentials: `~/.config/c3po-tasks/credentials.json` (from Google Cloud Console)
- OAuth token: `~/.config/c3po-tasks/token.json` (auto-generated after setup)
- Scope: `https://www.googleapis.com/auth/tasks`
- Timezone from: `config/people.json`

Security:
- Token auto-refreshes if expired
- Never log task contents in memory (only task IDs and metadata if needed)
- Output is JSON for easy parsing

## Voice messages (TTS)

ElevenLabs text-to-speech is available for sending WhatsApp voice notes.

- Provider: ElevenLabs (`eleven_flash_v2_5`, voice `weA4Q36twV5kwSaTEL0Q`)
- Mode: `tagged` — the agent can send voice when the user asks for audio ("manda em áudio", "responde com voz")
- Language: `pt` (Brazilian Portuguese)
- Max text length per audio: 500 characters
- Configuration: `messages.tts` block in `openclaw.json`
- Requires `ELEVENLABS_API_KEY` environment variable

## Shopping (Mercado Livre)

O `c3po-shopping-ml` busca e ranqueia produtos no Mercado Livre Brasil via API pública (sem autenticação).

Operações:
- Busca por query: `bun scripts/c3po-shopping-ml.ts --query "TERMO"`
- Com filtros: `bun scripts/c3po-shopping-ml.ts --query "TERMO" [--max-price X] [--min-rating 4.0] [--free-shipping] [--official-store] [--limit 20]`

Saída: JSON com `{ query, total, filters_applied, results[] }` onde cada resultado contém:
- `title`, `price`, `currency`, `condition`
- `rating`, `reviews_total`
- `free_shipping`, `estimated_delivery`
- `seller_type` (official_store / mercadolider_platinum / gold / silver / regular)
- `seller_name`, `permalink`, `score` (0–100)

Para Amazon Brasil, usar o browser headless (navegar `amazon.com.br/s?k=query&s=price-asc-rank`).

## Skills

Workspace skills in `skills/`:

- `family-agent` — Core routines and guardrails for the family agent
- `whatsapp-styling-guide` — WhatsApp-native formatting rules (no raw Markdown)
- `clawlist` — Multi-step project planning and tracking for family tasks
- `gtasks` — Google Tasks management (create, list, update, delete tasks)
- `shopping-comparison` — Pesquisa e compara produtos no ML + Amazon, iterativamente até 5 opções
