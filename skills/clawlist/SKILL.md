---
name: clawlist
description: Use for any multi-step family project or task that requires planning and tracking. Breaks down complex requests into steps with verification.
tags:
  - family
  - tasks
  - planning
  - tracking
---

# Skill: Clawlist (Family Edition)

## When to use

Use clawlist when the couple asks for something that involves *more than one action*. Examples:

- "Organiza a mudança" (multiple steps: pesquisar, agendar, listar)
- "Prepara o aniversário da Maria" (local, bolo, convidados, lembretes)
- "A gente precisa trocar de pediatra" (pesquisar, ligar, agendar, atualizar KB)
- "Monta uma rotina de manhã pra gente" (listar tarefas, definir horários, criar lembretes)

Do NOT use for single actions like "marca jantar sexta" or "me lembra de comprar leite".

## The flow

```
Pedido do casal
      |
  1. ENTENDER — Clarificar o que querem
      |
  2. PLANEJAR — Criar lista de passos com estimativas
      |
  3. CONFIRMAR — Mostrar o plano e pedir OK
      |
  4. EXECUTAR — Fazer cada passo (criar eventos, lembretes, atualizar KB)
      |
  5. VERIFICAR — Confirmar que tudo foi feito
```

## Step 1: ENTENDER

- Leia o pedido e identifique o objetivo final.
- Se faltar informação, pergunte (máximo 2-3 perguntas).
- Não assuma — se o pedido for ambíguo, peça clarificação.

## Step 2: PLANEJAR

- Quebre em passos concretos e acionáveis.
- Cada passo deve ser algo que o C3PO pode fazer (lembrete, evento, KB) ou algo que o casal precisa fazer (nesse caso, marcar como "vocês").
- Use formato de checklist:

```
*PLANO: Aniversário da Maria*

1. [ ] Definir data e local (vocês)
2. [ ] Criar evento no calendário (C3PO)
3. [ ] Criar lista de convidados em kb/ (C3PO)
4. [ ] Agendar lembrete: encomendar bolo 3 dias antes (C3PO)
5. [ ] Agendar lembrete: confirmar presença 1 semana antes (C3PO)
```

## Step 3: CONFIRMAR

- Mostre o plano completo no WhatsApp.
- Pergunte: "Posso executar esse plano?"
- Espere confirmação explícita (SIM/NÃO).
- Se quiserem ajustar, volte ao Step 2.

## Step 4: EXECUTAR

- Execute cada passo que é responsabilidade do C3PO:
  - Criar eventos no Google Calendar
  - Criar lembretes via cron
  - Atualizar/criar entradas em `kb/`
- Para cada passo executado, marque como [x] no plano.
- Passos marcados como "vocês" — apenas acompanhe (lembre quando a data se aproximar).

## Step 5: VERIFICAR

- Quando todos os passos do C3PO estiverem feitos, envie resumo:

```
*PLANO COMPLETO: Aniversário da Maria*

[x] Evento criado: sábado 15/03 15:00
[x] Lista de convidados salva em kb/
[x] Lembrete: bolo — quarta 12/03 09:00
[x] Lembrete: confirmar presença — sábado 08/03 10:00
[ ] Definir local (com vocês)
```

## Tracking

- Save the plan in `memory/YYYY-MM-DD.md` when created.
- If the plan spans multiple days, reference it in subsequent daily memory entries.
- When all steps are complete, write a final entry: "Plano [nome] concluído."

## Rules

- Always stay within the C3PO scope (no purchases, no finances, no arbitrary commands).
- If a step requires something outside scope, mark it as "vocês" (the couple handles it).
- Keep plans concise — maximum 8 steps. If more, group related steps.
- All communication in pt-BR, following WhatsApp formatting rules.
