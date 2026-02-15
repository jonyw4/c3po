# ADR 0002 — OpenClaw Configuration and Deployment

- **Status:** Accepted
- **Date:** 2026-02-14
- **Owner:** Jony Nunes, Claude Code
- **Relates to:** [RFC 0001 — Agente de Família no OpenClaw](./0001-openclaw-agente-familia.md)

## 1) Problem

The C3PO family agent was not responding to messages in the family WhatsApp group chat. Root cause analysis revealed multiple configuration and deployment issues:

1. Incorrect/placeholder WhatsApp group JID in configuration
2. Incorrect environment variable name for OpenClaw config file path
3. JSON5 format incompatibility in configuration files
4. Systemd service configuration using unsupported CLI flags

## 2) Solution

### 2.1 WhatsApp Group JID Identification

**Issue:** Configuration contained placeholder JID `00000000000000-0000000000@g.us`

**Resolution:**
- Extract actual group JID from WhatsApp Baileys connection logs during authentication
- Format: `[numeric_group_id]@g.us` (e.g., `120363424695328480@g.us`)
- Update `config/people.json` with correct JID:

```json
{
  "group": {
    "displayName": "Família (Jony + Ana + C3PO)",
    "whatsappJid": "120363424695328480@g.us"
  }
}
```

- Run `bun scripts/render-files.ts` to regenerate OpenClaw configuration from templates

**Lesson Learned:** Always test WhatsApp integration with actual authentication logs visible to capture the real group JID.

### 2.2 Configuration File Management

**Issue:** OpenClaw config file needs to be valid JSON (not JSON5 with comments)

**Resolution:**
- Create clean JSON configuration at `~/.openclaw/openclaw.json` (on the deployment server)
- Remove all JSON5 syntax (comments with `//`, trailing commas)
- Ensure file is valid JSON parseable by `JSON.parse()`
- Configuration should include all required sections:
  - `agents.list` - Agent definitions with workspace and group chat settings
  - `channels.whatsapp` - WhatsApp channel policies and group allowlist
  - `browser` - Headless browser configuration (if needed)

**Example structure:**

```json
{
  "agents": {
    "defaults": {
      "workspace": "/path/to/nunes-celio-c3po"
    },
    "list": [
      {
        "id": "c3po",
        "workspace": "/path/to/nunes-celio-c3po",
        "groupChat": {
          "mentionPatterns": ["^(?:c3po),\\s+"]
        }
      }
    ]
  },
  "channels": {
    "whatsapp": {
      "dmPolicy": "allowlist",
      "allowFrom": ["+5512981561999", "+5512982476359"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["+5512981561999", "+5512982476359"],
      "groups": {
        "120363424695328480@g.us": {
          "requireMention": false
        }
      }
    }
  },
  "browser": {
    "enabled": true,
    "headless": true
  }
}
```

**Lesson Learned:** Always validate JSON configuration before deploying. Use `openclaw doctor` to validate and auto-repair config files.

### 2.3 Environment Variable for Config Path

**Issue:** Systemd service was using incorrect environment variable name

**Wrong approach:**
```bash
Environment="OPENCLAW_CONFIG=/path/to/config.json"
ExecStart=openclaw gateway --config /path/to/config.json
```

**Correct approach:**
```bash
Environment="OPENCLAW_CONFIG_PATH=/home/exedev/.openclaw/openclaw.json"
ExecStart=/usr/bin/env openclaw gateway --port 18789
```

**Key findings from OpenClaw documentation:**
- Use `OPENCLAW_CONFIG_PATH` environment variable (not `OPENCLAW_CONFIG`)
- OpenClaw gateway command does NOT accept `--config` flag
- OpenClaw gateway command DOES accept `--port` flag
- Configuration is automatically discovered when `OPENCLAW_CONFIG_PATH` is set
- File is watched for changes and hot-reloaded automatically

**Lesson Learned:** Always consult official documentation for correct environment variable names and CLI flags. Different tools use different naming conventions.

### 2.4 Systemd Service Configuration

**Correct systemd service file** (`/etc/systemd/system/c3po-gateway.local.service`):

```ini
[Unit]
Description=OpenClaw Gateway (C3PO family agent)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/exedev/nunes-celio-c3po
Environment="OPENCLAW_CONFIG_PATH=/home/exedev/.openclaw/openclaw.json"
ExecStart=/usr/bin/env openclaw gateway --port 18789
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=TZ=America/Sao_Paulo

[Install]
WantedBy=default.target
```

**Key considerations:**
- `WorkingDirectory` should point to the agent repository (needed for skills and knowledge base access)
- Multiple `Environment=` lines can be used for different environment variables
- `Type=simple` is correct for long-running processes
- `Restart=always` ensures service stays running after crashes
- `RestartSec=10` prevents service restart storms

**Lesson Learned:** Use absolute paths for all service configuration. Test service changes with `systemctl daemon-reload` and `systemctl restart` before checking logs.

## 3) OpenClaw Deployment Checklist

Before deploying an OpenClaw agent, ensure:

- [ ] WhatsApp credentials authenticated via `openclaw channels login` (QR code scan)
- [ ] Group JID correctly identified from Baileys connection logs
- [ ] Configuration file created at `~/.openclaw/openclaw.json` (valid JSON)
- [ ] Configuration validated with `openclaw doctor` (auto-fix any issues)
- [ ] Environment variable set to correct path: `OPENCLAW_CONFIG_PATH`
- [ ] Systemd service file created with correct syntax
- [ ] Service reloaded with `systemctl daemon-reload`
- [ ] Service started with `systemctl restart c3po-gateway.local`
- [ ] Service status checked with `systemctl status c3po-gateway.local`
- [ ] Recent logs checked with `journalctl -u c3po-gateway.local -n 20 --no-pager`
- [ ] Confirmed no "Missing config" errors in logs
- [ ] Test message sent to group chat or DM to verify agent responds

## 4) Troubleshooting Guide

### 4.1 Gateway Reports "Missing config"

**Symptoms:**
- Service is running (`systemctl status` shows `active (running)`)
- Logs show error like: `Missing config. Run 'openclaw setup'...`

**Diagnosis:**
1. Check if config file exists: `test -f ~/.openclaw/openclaw.json && echo "exists" || echo "missing"`
2. Validate JSON: `cat ~/.openclaw/openclaw.json | jq . > /dev/null && echo "valid" || echo "invalid JSON"`
3. Check environment variable is set: `echo $OPENCLAW_CONFIG_PATH`
4. Verify service has env var: `systemctl show-environment | grep OPENCLAW_CONFIG_PATH`

**Solutions:**
1. Ensure `OPENCLAW_CONFIG_PATH` is set (not `OPENCLAW_CONFIG`)
2. Verify file path is absolute (not relative)
3. Run `openclaw doctor` to validate and auto-repair configuration
4. Reload and restart service: `systemctl daemon-reload && systemctl restart c3po-gateway.local`

### 4.2 Unknown option '--config' errors

**Symptoms:**
- Service fails with: `error: unknown option '--config'`

**Cause:** Systemd service is using old CLI flag syntax that OpenClaw doesn't support

**Solution:** Remove `--config` flag from `ExecStart`, use `OPENCLAW_CONFIG_PATH` environment variable instead

### 4.3 JSON5 Format Errors

**Symptoms:**
- Service fails to parse configuration
- Logs mention "unexpected comment" or "trailing comma"

**Cause:** Configuration file contains JSON5 syntax (comments, trailing commas) but OpenClaw expects strict JSON

**Solution:** Remove all JSON5 syntax:
- Replace `// comment` with `/* comment */` or remove entirely
- Remove trailing commas from objects/arrays
- Run through `jq . < config.json > config-clean.json` to validate and reformat

### 4.4 Agent Not Responding in Group Chat

**Symptoms:**
- Service is running and logs show no errors
- Messages sent to group get no response

**Causes (in order of likelihood):**
1. Group JID in config doesn't match actual WhatsApp group
2. Agent mention pattern doesn't match message format
3. Message sender not in WhatsApp allowlist
4. Agent not properly linked to WhatsApp account

**Troubleshooting:**
1. Verify group JID: Check latest Baileys connection logs for actual JID
2. Verify mention pattern: Test with exact prefix from config (e.g., `c3po, help`)
3. Verify sender in allowlist: Check `channels.whatsapp.allowFrom` and `groupAllowFrom`
4. Re-authenticate WhatsApp: Run `openclaw channels login` and scan QR code again
5. Check agent logs: `journalctl -u c3po-gateway.local -n 50 --no-pager | grep -i "group\|whatsapp\|message"`

## 5) References

- [OpenClaw Configuration Documentation](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw Gateway CLI](https://docs.openclaw.ai/cli/gateway)
- [OpenClaw Environment Variables](https://docs.openclaw.ai/reference/environment-variables)
- [Systemd Service Unit Documentation](https://www.freedesktop.org/software/systemd/man/systemd.service.html)

## 6) Future Improvements

1. **Auto-migration tool:** Create a script to migrate from old config format to new one
2. **Config validation in CI:** Add JSON schema validation in pre-commit hooks
3. **Deployment automation:** Create Ansible/Terraform playbooks for consistent deployment
4. **Config templates:** Provide templated configurations for common agent setups
5. **Health checks:** Implement health check endpoint to verify agent is responding
6. **Monitoring:** Add Prometheus metrics for gateway uptime and message processing
