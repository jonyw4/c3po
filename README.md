# C3PO — Family Agent (OpenClaw)

Versioned workspace for the **C3PO** family agent, running on [OpenClaw](https://openclaw.ai/) and hosted on [exe.dev](https://exe.dev).

## What it does

- Operates on **WhatsApp** (DM + couple's group: Jony + Ana)
- Schedules **reminders** as future messages (cron)
- Creates **Google Calendar events** (Ana organizes, Jony invited)
- Queries and updates a **Markdown knowledge base**
- Maintains daily **operational memory** (90-day retention)
- Persona: **C3PO** (polite, formal, concise, light humor)

## Structure

```
AGENTS.md          → agent guardrails (closed scope)
SOUL.md            → tone and style (C3PO)
IDENTITY.md        → bot identity
TOOLS.md           → allowed tools
USER.md            → user context
config/            → people.json (gitignored) + example
kb/                → knowledge base (Markdown)
memory/            → daily logs + archive/
skills/            → family agent skill
openclaw/          → config examples (JSON5, exec-approvals)
scripts/           → wrappers (calendar, archive, check, render)
scripts/systemd/   → services and timers (gateway, archive, watchdog)
deploy/            → exe.dev setup script
rfcs/              → specification (RFC 0001)
```

## Setup

See: [`scripts/setup-exe-dev.md`](scripts/setup-exe-dev.md)

## Full spec

See: [`rfcs/0001-openclaw-agente-familia.md`](rfcs/0001-openclaw-agente-familia.md)

## Stack

- **Runtime**: OpenClaw + Bun (TypeScript)
- **Scripts**: TypeScript (via `bun`)
- **Host**: exe.dev (Linux VM with persistent disk)
- **Calendar**: Google Calendar API (`googleapis` npm)
- **Messaging**: WhatsApp (via OpenClaw/Baileys)
