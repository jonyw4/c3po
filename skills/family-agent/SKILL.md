---
name: family-agent
description: Routines and guardrails for the family agent (WhatsApp + cron + KB + calendar/reminders).
tags:
  - family
  - whatsapp
  - cron
  - calendar
  - reminders
---

# Skill: Family agent

## Intent
Operate only within the closed scope defined in `AGENTS.md`.

## How to respond on WhatsApp
- If the message is not a request within scope, reply with a short refusal and offer the supported options.
- If it is a request with an action (schedule/create event/create reminder), always:
  1) Extract the parameters (date/time/timezone, title, destination)
  2) Propose defaults
  3) Ask for explicit confirmation ("Confirm?") **only** for calendar
  4) Execute
  5) Write a short record in `memory/YYYY-MM-DD.md` (after executing)

## Schedule messages (cron)
- For requests like "tomorrow at 9am", convert to absolute date/time and confirm before creating the job.
- Record in the daily log: who requested, destination, time, summarized content.

### Routing (DM vs group)
- If it mentions "Ana" or "Jony" → DM to the target person.
- If it mentions "me avisa" / "me lembra" → DM to the author.
- Otherwise:
  - request via DM → DM to the author
  - request from the group → group

## KB (kb/)
- When answering "durable facts", prefer citing the KB and suggest an update if it's outdated.
- If asked to "remember forever", propose recording in `kb/decisoes.md` (or appropriate file) and ask permission.

## Daily memory (memory/)
- Write only what's necessary for operational continuity.
- Never include sensitive data.

## Calendar (Google)

- Goal: create event on Ana's "primary" Google Calendar and invite Jony.
- Flow:
  1) Extract title + date/time + duration (default 30 min if not provided)
  2) Show preview and ask for confirmation (YES/NO)
  3) Execute `bun scripts/c3po-calendar.ts ...` (or `scripts/c3po-calendar-create` as fallback)
  4) Reply "Confirmado: …" with explicit date/time
  5) Record in `memory/YYYY-MM-DD.md`
