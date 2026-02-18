---
name: family-agent
description: Routines and guardrails for the family agent (WhatsApp + cron + KB + calendar/reminders + browser).
tags:
  - family
  - whatsapp
  - cron
  - calendar
  - reminders
  - browser
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

## Shopping (comparação de produtos)

- Ativado quando o casal pede para pesquisar, comparar ou achar produto para comprar.
- **Nunca** use conhecimento de treinamento ou busca genérica para sugerir produtos e preços — os dados ficam desatualizados.
- **Sempre** execute o script ML E/OU navegue na Amazon via browser. Dados reais apenas.
- Fluxo obrigatório (ver protocolo completo em `skills/shopping-comparison/SKILL.md`):
  1) Entender o pedido (até 2–3 perguntas se vago)
  2) Buscar em paralelo:
     - ML: `bun scripts/c3po-shopping-ml.ts --query "TERMO" [--max-price X] [--min-rating 4.0] [--limit 20]`
     - Amazon: `browser navigate "https://www.amazon.com.br/s?k=TERMO&s=price-asc-rank"` → `browser snapshot`
  3) Apresentar resultados no formato WhatsApp numerado (⭐ rating, 🚚 frete, link)
  4) Oferecer refinamento ou encerrar com ≤5 opções + "🏆 Recomendação C3PO: …"
  5) Registrar em `memory/YYYY-MM-DD.md`
- **Nunca** clicar em "Comprar", acessar checkout, ou inserir dados de pagamento.

## Browser (web automation)

- Goal: perform web tasks on behalf of the couple using headless Chromium.
- Examples: check a website for information, fill out a form, download a PDF, look up prices, etc.
- Flow:
  1) Understand what the user wants to do on the web
  2) Navigate to the target URL using `browser navigate`
  3) Use `browser snapshot` to read the page (accessibility tree — preferred over screenshots)
  4) Interact with elements using refs from the snapshot (`browser act click <ref>`, `browser act fill <ref> "text"`)
  5) If the action involves submitting a form or downloading, ask for confirmation (YES/NO)
  6) Report the result back to the user
  7) Record in `memory/YYYY-MM-DD.md` (URL, action, result)
- Security rules:
  - Never enter passwords, credentials, CPF/RG, or financial data
  - Never access banking, payment, or financial sites
  - Never make purchases or transactions
  - If a site requires login, tell the user and do not proceed
  - Prefer `snapshot` over `screenshot` (faster, cheaper in tokens)
