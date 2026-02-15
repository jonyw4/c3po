# RFC 0003 — Leitura de Calendário + Identificação de Remetente

- **Status:** Proposto
- **Data:** 2026-02-14
- **Owner:** família Nunes-Célio

## 1) Contexto

O C3PO já consegue **criar** eventos no Google Calendar (via `scripts/c3po-calendar.ts`), mas **não consegue ler/listar** eventos existentes. Quando o Jony pergunta "o que eu tenho amanhã?", o bot responde que não tem essa capacidade.

Além disso, o bot **confunde o remetente**: na primeira mensagem de DM, chamou o Jony de "Ana". O `USER.md` não incluía os números de telefone para mapeamento, e o bot não sabia como usar o envelope do OpenClaw (`[WhatsApp Nome (+55…)]`) para identificar quem está falando.

## 2) Problemas

### 2.1 Identificação de remetente
- O OpenClaw passa no envelope da mensagem o nome e número do remetente (ex: `[WhatsApp Jony (+5512982476359)]`)
- O `USER.md` não mapeava números → pessoas
- **Fix já aplicado:** `USER.md` agora inclui tabela com número E.164 de cada pessoa
- **Pendência:** commitar e fazer deploy no servidor

### 2.2 Leitura de calendário
- O script `c3po-calendar.ts` só tem modo `--setup` e modo criação de eventos
- Não existe flag `--list` para consultar eventos
- O bot precisa responder perguntas como:
  - "o que eu tenho amanhã?"
  - "quais reuniões da semana que vem?"
  - "estou livre sexta à tarde?"

### 2.3 Calendário de quem?
- O OAuth token atual foi gerado com a conta que fez login no browser
- Para acessar o calendário de **ambos** (Jony + Ana), seria necessário:
  - Opção A: dois tokens separados (um por conta) — mais complexo
  - Opção B: um único token, e a outra pessoa compartilha o calendário com a conta autenticada — mais simples
  - Opção C: usar apenas um calendário por enquanto e expandir depois

## 3) Proposta

### 3.1 Adicionar modo `--list` ao `c3po-calendar.ts`

Novo modo de uso:

```bash
bun scripts/c3po-calendar.ts --list \
  --from "2026-02-15" \
  --to "2026-02-22"
```

Saída JSON:

```json
{
  "events": [
    {
      "summary": "Reunião de equipe",
      "start": "2026-02-16T10:00:00-03:00",
      "end": "2026-02-16T11:00:00-03:00",
      "location": "Google Meet",
      "attendees": ["jony@companypicnic.com", "fulano@email.com"]
    }
  ],
  "count": 1,
  "range": { "from": "2026-02-15", "to": "2026-02-22" }
}
```

Implementação: usar `calendar.events.list()` com `timeMin`, `timeMax`, `singleEvents: true`, `orderBy: "startTime"`.

### 3.2 Defaults inteligentes

- `--from` default: hoje
- `--to` default: hoje + 7 dias
- Limite: max 50 eventos por consulta
- Timezone: lido de `config/people.json` (America/Sao_Paulo)

### 3.3 Adicionar ao exec-approvals

O script com `--list` já está coberto pelo padrão existente em `exec-approvals.json`:
```json
{"pattern": "/home/exedev/nunes-celio-c3po/scripts/c3po-calendar.ts"}
```

### 3.4 Identidade (já feito)

O `USER.md` já foi atualizado com a tabela de números → pessoas. Só precisa ser commitado e deployado.

## 4) Alterações

| Arquivo | Mudança |
|---------|---------|
| `scripts/c3po-calendar.ts` | Adicionar modo `--list` com `calendar.events.list()` |
| `USER.md` | Já alterado: tabela de identificação por número |
| `openclaw/openclaw.json5.example` | Já alterado anteriormente (cleanup de campos obsoletos) |

## 5) Fora de escopo (futuro)

- Acesso ao calendário de ambas as contas simultaneamente (requer decisão sobre Opção A/B/C acima)
- Edição/exclusão de eventos existentes
- Busca de horários livres ("free/busy")
- Sincronização bidirecional de calendários

## 6) Verificação

1. Deploy `USER.md` → testar mandando "Oi" via WhatsApp e confirmar que o bot identifica corretamente
2. Implementar `--list` → testar com `--list --from "2026-02-15" --to "2026-02-22"` no servidor
3. Testar via WhatsApp: "o que eu tenho amanhã?" → bot deve listar os eventos
