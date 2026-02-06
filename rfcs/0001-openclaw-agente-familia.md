# RFC 0001 — Agente de Família no OpenClaw

- **Status:** Proposto
- **Data:** 2026-02-02
- **Owner:** família Nunes-Célio

## 1) Propósito

Criar um “agente de família” que opere principalmente pelo WhatsApp (DM + grupo do casal) para executar um conjunto **fechado** de tarefas domésticas/organizacionais:

- responder mensagens do casal sobre rotinas e decisões
- agendar mensagens para o futuro (ex.: “amanhã 9h lembre X”)
- criar eventos no Google Calendar da Ana e convidar o Jony
- criar “lembretes” como mensagens agendadas no WhatsApp (por enquanto)
- consultar uma base de conhecimento (KB) da família em arquivos Markdown
- manter memória operacional do dia (decisões, compromissos, pendências), com privacidade e segurança
- navegar na web via browser headless para executar tarefas como consultar sites, preencher formulários, baixar PDFs, etc.

O objetivo principal é **reduzir atrito** em organização do casal, sem virar um "bot genérico" com acesso amplo ao sistema.

## 2) Features (escopo fechado)

### 2.1 WhatsApp (canal primário)
- Estar em 1 grupo “da família” composto por **Jony + Ana + bot** e aceitar DMs de Jony/Ana.
- Responder somente quando:
  - for mencionado (`@bot`) **ou**
  - mensagens seguirem um prefixo/regex acordado (ex.: `c3po, ...`).
- Recusar interação de qualquer número fora da allowlist.

### 2.1.1 Persona (“C3PO”)
- Nome: **C3PO**.
- Tom: educado, formal, “solícito”, com humor leve (sem ficar verboso no WhatsApp).
- Sempre que citar tempo, devolver data/hora **explícitas**.

### 2.2 Agendamento de mensagens
- Interpretar pedidos como “amanhã às 9 me lembra X”, “amanhã 9h avisa a Ana X”, etc.
- Criar um job no cron do Gateway que, no horário, publique no chat correto.
- Sempre responder com um ACK de confirmação (“Confirmado: …”) contendo data/hora **explícitas**, destino e resumo.

#### 2.2.1 Regra de destino (“quem lembrar”)
- Se o pedido mencionar explicitamente **Ana**/**Jony**/**me avisa**/**me lembra** → DM da pessoa alvo (ou do autor, no caso de “me…”).
- Caso contrário:
  - se o pedido veio por DM → responder em DM ao autor
  - se o pedido veio no grupo → enviar no grupo

### 2.3 Calendário (Jony + Ana)
- Criar evento no **Google Calendar da Ana** e adicionar **Jony como convidado** (2 e-mails).
- Antes de criar, apresentar um “preview” (título, data/hora, duração) e pedir confirmação explícita (SIM/NAO).
- Duração: se não vier, propor **30 min** como padrão e perguntar se está OK.
- Depois de criar, perguntar (opcional) se desejam acrescentar detalhes (local/notas/alerta).
- Recorrência: suportar **apenas quando pedida explicitamente** (ex.: “toda terça…”); caso contrário, criar evento único.

### 2.4 Lembretes (v1 = WhatsApp)
- Na v1, “reminder” significa **mensagem agendada no WhatsApp** (não Apple Reminders).
- Não exige confirmação obrigatória, mas sempre exige:
  - normalização de data/hora (“amanhã” → data explícita)
  - ACK de confirmação com resumo e destino
  - registro na memória diária
- Futuro (v2): integração com Apple Reminders (quando necessário).

### 2.5 KB da família (Markdown)
- Consultar e responder com base em `kb/`.
- Registrar decisões duráveis (ex.: “o pediatra é X”, “preferimos tal restaurante”) em arquivos de KB, não em memória livre.
- Futuro (v2): publicar/editar KB em Notion, mantendo uma cópia exportada para Markdown no workspace.

### 2.7 Browser (navegação web)
- Navegar na web usando browser headless (Chromium via Playwright) para executar tarefas em nome do casal.
- Exemplos: consultar sites (escola, condomínio, lojas), preencher formulários, baixar documentos (boletos, PDFs), pesquisar preços.
- Fluxo:
  1) Entender o pedido do usuário
  2) Navegar até o site alvo
  3) Usar `snapshot` (accessibility tree) para ler a página
  4) Interagir com elementos via refs do snapshot
  5) Se envolver submissão de formulário ou download, pedir confirmação (SIM/NÃO)
  6) Reportar resultado ao usuário
  7) Registrar em `memory/YYYY-MM-DD.md`
- Segurança:
  - Nunca inserir senhas, credenciais, CPF/RG ou dados financeiros
  - Nunca acessar sites de banco, pagamento ou financeiros
  - Nunca fazer compras ou transações
  - Se o site exigir login, informar o usuário e não prosseguir
- Configuração: ver `openclaw/openclaw.json5.example` (bloco `browser:`)
- Requisitos na VM: Playwright + Chromium instalados (ver `deploy/exe-dev-setup.sh`)

### 2.8 Memória diária (operacional)
- Registrar memória operacional ao longo do uso (principalmente após ações):
  - lembretes agendados (cron)
  - eventos criados/atualizados (calendário)
  - decisões registradas na KB
- Retenção: **arquivar** (mover) memórias com mais de **90 dias** para `memory/archive/` (job diário).
- **Não** registrar dados sensíveis (senhas, documentos, números completos, etc.).

## 3) Não-objetivos (fora de escopo)

- Acessar bancos, serviços financeiros, compras, transferências, PIX, etc. (inclusive via browser).
- "Operar o computador" com exec arbitrário.
- Responder terceiros fora da allowlist.
- Fazer "assistente geral" (automações perigosas, redes sociais).
- Armazenar segredos no workspace (senhas, tokens, chaves privadas).
- Inserir senhas, credenciais ou dados financeiros em sites via browser.
- Fazer login em sites que exijam autenticação (informar o usuário e não prosseguir).

## 4) O que precisamos para dar certo

### 4.1 Operação 24/7 (onde roda)
- Um **Gateway** do OpenClaw precisa ficar em execução para manter os canais conectados e processar eventos.
- Para WhatsApp, o Gateway precisa manter um **listener ativo** para receber e também para enviar mensagens.

Decisão:
- **Alpha**: rodar no **macOS**.
- **V1**: migrar para **Linux/VPS** (mantendo o mesmo workspace).

### 4.2 Integrações de calendário/reminders
Decisão v1:
- **Calendário**: Google Calendar (criar no calendário da Ana e convidar o Jony).
- **Lembretes**: mensagens agendadas no WhatsApp (cron).

Futuro:
- Avaliar **CalDAV** (iCloud/Google) e/ou integração Apple (se necessário) quando a operação estiver no VPS.

### 4.3 Segurança e privacidade (obrigatório)
- Allowlist de números para DM.
- Allowlist de grupos permitidos.
- Ativação por menção/prefixo (evitar “always” no grupo).
- "Least privilege" no conjunto de tools: apenas o necessário (cron, leitura/escrita em workspace, calendário/reminders, browser com restrições).
- Confirmação humana antes de ações com maior risco (ex.: criação de evento).
- Logs/memória sem dados sensíveis.

### 4.4 Workspace versionado (este repositório)
Mesmo não sendo obrigatório para “funcionar”, o repositório ajuda a:
- versionar KB e guardrails (AGENTS/SOUL/TOOLS)
- versionar skills próprias (se precisarmos)
- revisar mudanças (PRs internos / histórico)

**Segredos ficam fora do Git**: credenciais e a config real do OpenClaw ficam fora do workspace e não devem ser commitadas.

### 4.5 Parâmetros decididos (v1)
- Host:
  - alpha: macOS
  - v1: VPS Linux
- WhatsApp:
  - número dedicado
  - 1 grupo (Jony + Ana + bot)
  - DMs habilitadas para Jony e Ana
  - ativação: @menção **ou** prefixo `c3po,` (nunca `claw,`)
- Fuso horário: `America/Sao_Paulo`
- Calendário: Google Calendar
  - criar no calendário da Ana e convidar o Jony
  - e-mails (armazenar em config local gitignored):
    - Ana: `anny.livia.nunes@gmail.com`
    - Jony: `jony@companypicnic.com`
- Lembretes: mensagens agendadas no WhatsApp (cron)
- Memória: retenção 90 dias com **arquivamento**, armazenada no workspace (repo Git privado) para consulta do bot
  - job: diariamente às 03:00 `America/Sao_Paulo`

## 5) Proposta de arquitetura

### 5.1 Componentes
1) **OpenClaw Gateway**
   - mantém conexão WhatsApp
   - executa cron jobs
   - roda o agente `family`

2) **Workspace (este repo)**
   - bootstrap files do agente (guardrails)
   - `kb/` (base de conhecimento)
   - `memory/` (logs diários)
   - `skills/` (skills customizadas quando necessário)

3) **Integração Calendário/Reminders**
   - uma skill com tool(s) específicas para Google Calendar (owner: Ana; convidado: Jony)
   - (futuro) CalDAV/Apple Reminders conforme necessidade

4) **Browser (headless Chromium)**
   - browser tool nativa do OpenClaw com Playwright
   - headless mode para automação sem GUI
   - `evaluateEnabled: false` para segurança

4) **Registro de identidades (Jony/Ana)**
   - mapeia: WhatsApp ↔ pessoa ↔ e-mail Google (convidados)
   - evita “lembrar errado” e define destinos de DM

### 5.2 Agentes
Definir dois agentes (opcional, mas recomendado):
- `family` (restrito): participa do WhatsApp, faz somente as features do escopo fechado.
- `main` (privado): usado só por DM do owner para manutenção/diagnóstico (sem estar em grupo).

### 5.3 Guardrails do `family`
- Só executa: `cron` (mensagens/lembretes), `calendar` (Google), leitura KB, escrita em `memory/`, `browser` (com restrições).
- Qualquer pedido fora do escopo → recusa + sugere alternativa ("posso agendar lembrete, criar evento no calendário, consultar/atualizar KB, navegar na web").
- Calendário: sempre pede confirmação explícita (SIM/NAO) antes de criar.
- Lembretes via WhatsApp: não exige confirmação obrigatória, mas sempre envia ACK com resumo e data/hora explícitas.

## 6) Fluxos principais

### 6.1 “Amanhã 9h manda X no grupo”
1) Extrair: data/hora, fuso, destino (grupo vs DM), mensagem.
2) Validar: “amanhã” relativo ao fuso configurado.
3) Criar cron job no Gateway para enviar a mensagem no chat.
4) Responder com ACK (“Confirmado: …”) com data/hora explícitas e destino.
5) Registrar em `memory/YYYY-MM-DD.md` (pedido + job id).

### 6.2 “Marca jantar sexta 20h”
1) Extrair: título, data/hora, duração (propor 30 min se faltar), local/notas (opcional).
2) Mostrar preview e pedir confirmação (SIM/NAO).
3) Criar evento no Google Calendar da Ana e convidar o Jony.
4) Responder com resumo + link/ID (se aplicável).
5) Registrar em memória diária.
6) Perguntar (opcional) se desejam adicionar local/notas/alerta.

### 6.3 “Me lembra de comprar fraldas amanhã”
1) Extrair: texto, data/hora (propor um horário se faltar), destino (DM vs grupo pela regra).
2) Criar job no cron para enviar a mensagem no destino.
3) Responder com ACK (“Confirmado: …”) com data/hora explícitas e destino.
4) Registrar em memória diária.

### 6.4 "Entra no site do condomínio e pega a segunda via do boleto"
1) Navegar até o site do condomínio (URL da KB ou fornecida pelo usuário).
2) Usar `snapshot` para ler a página e identificar links/botões relevantes.
3) Interagir com os elementos para chegar até o boleto.
4) Se exigir login: informar o usuário ("Esse site precisa de login, não consigo prosseguir") e parar.
5) Se encontrar o PDF/link de download: pedir confirmação (SIM/NÃO) antes de baixar.
6) Enviar o resultado (link ou informação) de volta no WhatsApp.
7) Registrar em `memory/YYYY-MM-DD.md`.

### 6.5 "Qual é o pediatra?" / "Qual a rotina do banho?"
1) Buscar em `kb/` (preferência: arquivo mais específico).
2) Responder com a informação e apontar onde está registrado.
3) Se não existir: perguntar se deve registrar e em qual arquivo.

## 7) Estrutura proposta do repositório

```
.
├─ AGENTS.md
├─ SOUL.md
├─ TOOLS.md
├─ USER.md
├─ kb/
│  ├─ README.md
│  ├─ decisoes.md
│  ├─ rotinas.md
│  └─ contatos.md
├─ memory/
│  └─ README.md
├─ skills/
│  └─ family-agent/
│     └─ SKILL.md
├─ openclaw/
│  ├─ openclaw.json5.example
│  └─ .env.example
└─ scripts/
   └─ setup-local.md
```

## 8) O que já existe no OpenClaw vs o que vamos desenvolver

### Já existe (nativo)
- WhatsApp (DM + grupo) com políticas (allowlist e ativação por menção/padrão).
- Cron do Gateway para jobs agendados.
- Memória em arquivos (`memory/YYYY-MM-DD.md`) e busca em Markdown.
- Skills como mecanismo de "cola"/integração e tool wrappers.
- Browser tool nativa (headless Chromium via CDP + Playwright): navigate, snapshot, screenshot, act, pdf.

### Precisaremos desenvolver/configurar (cola do fluxo)
- “Skill do casal” (`skills/family-agent`) com:
  - padrões de confirmação
  - convenções de KB/memória
  - comandos/pedidos suportados
- Integração de Calendário/Reminders:
  - Google Calendar: se não houver skill pronta compatível, criar uma skill simples (API Google Calendar).
- Registro de identidades:
  - arquivo de configuração local (gitignored) com WhatsApp ↔ pessoa ↔ e-mails.

## 9) Plano de execução

1) **Alpha no macOS** e preparar migração para **VPS** na v1.
2) **Inicializar OpenClaw** apontando o workspace para este repo.
3) **Configurar WhatsApp** (allowlist e groupPolicy por menção/prefixo).
4) **Validar fluxos básicos**: responder no grupo, agendar mensagem via cron.
5) **Implementar/instalar integração de calendário/reminders**.
6) **Popular KB** e definir convenções (“o que registramos / o que não registramos”).
7) **Hardening**: permissões, backups, testes, observabilidade.

## 10) Questões em aberto

- Nenhuma (alpha definida).
