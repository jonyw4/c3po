# Allowed tools (intent)

The `family` agent should operate with the smallest possible set of tools:

- `cron` (schedule executions)
- Workspace file read/write (`kb/`, `memory/`)
- Explicit `calendar` tool(s) (Google Calendar, via dedicated skill)

## Exec

For Google Calendar, it may be necessary to enable `group:exec` **with allowlist** (wrappers only), via Exec Approvals.

Allowed scripts:
- `scripts/c3po-calendar.ts` (TypeScript wrapper — primary)
- `scripts/c3po-calendar-create` (Python/gog wrapper — fallback)
- `scripts/archive-memory.ts` (memory archival)

Avoid any shell execution outside the allowlist.
