# Security Checklist — C3PO

Checklist de segurança para deploy e operação do C3PO.

## Antes do deploy

- [ ] OpenClaw >= `2026.1.29` (corrige CVE-2026-25253 — RCE via WebSocket hijacking)
- [ ] `GATEWAY_PASSWORD` definida em `~/.config/c3po/.env`
- [ ] `ANTHROPIC_API_KEY` definida (nunca commitada no repo)
- [ ] `config/people.json` preenchido (arquivo local, nunca commitado)
- [ ] Executar `bun scripts/render-files.ts` para gerar configs locais
- [ ] Executar `bun scripts/check-config.ts` para validar configuração

## Rede e acesso

- [ ] Porta do gateway (18789) **somente localhost** — nunca expor publicamente
- [ ] Se usar reverse proxy (nginx), configurar autenticação adequada
- [ ] VM com SSH key-only (desabilitar password auth)
- [ ] Firewall: bloquear portas 18789 e 18800 (CDP) de acesso externo

## Repositório Git

- [ ] Repo remoto **privado** (o workspace-backup.ts recusa push para repos públicos)
- [ ] Verificar que `git ls-files` não inclui arquivos com dados reais
- [ ] Rotacionar PAT/SSH key do Git periodicamente

## Credenciais

- [ ] Google OAuth token (`~/.config/c3po-calendar/token.json`): rotacionar periodicamente
- [ ] Sessão WhatsApp (`~/.openclaw/`): re-escanear QR mensalmente
- [ ] `~/.config/c3po/.env`: permissão `600` (somente owner)

## Operação contínua

- [ ] Monitorar atualizações de segurança do OpenClaw
- [ ] Verificar logs do watchdog (`journalctl --user -u c3po-watchdog`)
- [ ] Auditar skills de terceiros antes de instalar
- [ ] Nunca instalar skills do ClawdHub sem auditar o código
