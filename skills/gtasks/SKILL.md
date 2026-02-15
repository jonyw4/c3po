---
name: gtasks
description: Manage Google Tasks — create, list, update, and complete tasks
tags: [tasks, todo, google, productivity, reminders]
---

# Google Tasks Skill

This skill enables C3PO to manage Google Tasks — create to-do lists, organize tasks, and mark items as complete.

## What you can do

- **List all task lists** — See your task lists
- **View tasks** — See tasks in a specific list, filtered by due date or status
- **Create tasks** — Add new tasks with optional due dates and notes
- **Update tasks** — Rename tasks or mark them as completed/incomplete
- **Delete tasks** — Remove tasks
- **Create lists** — Organize tasks into different lists (e.g., "Pessoal", "Casa", "Trabalho")

## Examples

### List task lists

```
c3po, quais são minhas listas de tarefas?
```

Response: Shows all your task lists with IDs.

### View tasks in a list

```
c3po, lista minhas tarefas na lista Pessoal
c3po, mostra tarefas vencendo nos próximos 7 dias
c3po, tarefas que ainda não foram concluídas
```

### Create a task

```
c3po, cria tarefa: Comprar pão
c3po, adiciona: Ligar para o médico até 2026-02-20
c3po, nova tarefa: Arrumar a cozinha - notas: depois do almoço
```

### Complete or update a task

```
c3po, marca como concluído: Comprar pão
c3po, renomeia tarefa para: Estudar capítulo 3
c3po, remove tarefa: Tarefa antiga
```

## How it works

The skill executes TypeScript wrapper script (`scripts/c3po-tasks.ts`) that:

1. Authenticates via Google OAuth2 (one-time setup via `--setup` flag)
2. Manages credentials securely in `~/.config/c3po-tasks/`
3. Calls the Google Tasks API v1 for all operations
4. Returns results as JSON for parsing and response generation

## Setup

Initial OAuth2 setup (run once):

```bash
bun scripts/c3po-tasks.ts --setup
```

Follow the authorization URL in your browser, grant permission, and paste the code.

Credentials are stored at:
- `~/.config/c3po-tasks/credentials.json` (OAuth app credentials from Google Cloud Console)
- `~/.config/c3po-tasks/token.json` (user's OAuth token — auto-generated)

## Technical details

- **API**: Google Tasks API v1 (`googleapis` npm package)
- **Scope**: `https://www.googleapis.com/auth/tasks`
- **Config**: Timezone and user info from `config/people.json`
- **Output**: Structured JSON for easy parsing
- **Error codes**: Exit 1 (validation), 3 (setup needed)

## Limitations

- Sub-tasks are not supported (only flat task lists)
- Assigned tasks (shared) are visible but read-only
- Due dates are stored as date-only (no time component per Google Tasks spec)

## Common issues

**"Missing credentials" error**

Solution: Download OAuth credentials from Google Cloud Console and place at `~/.config/c3po-tasks/credentials.json`, then run `bun scripts/c3po-tasks.ts --setup`.

**Token expired**

Solution: Run setup again: `bun scripts/c3po-tasks.ts --setup` (token refresh happens automatically if offline access was granted).

**"Invalid tasklist ID"**

Solution: Use `--list-tasklists` to see available lists and their IDs, or use special ID `@default` for your primary list.
