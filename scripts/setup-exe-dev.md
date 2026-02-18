# Setup: C3PO on exe.dev

Step-by-step guide to get C3PO running on exe.dev.

## 0) Prerequisites

- Account on [exe.dev](https://exe.dev) ($20/month Individual)
- Dedicated WhatsApp number (eSIM or extra number)
- Ana's Google account with Calendar enabled
- `ANTHROPIC_API_KEY` key (Anthropic)
- Repo cloned on GitHub (private)

## 1) Create VM on exe.dev

```bash
# Via SSH
ssh exe.dev new --name c3po

# Or via https://exe.new/openclaw (quick start with OpenClaw pre-installed)
```

## 2) Access the VM

```bash
ssh c3po.exe.xyz
```

## 3) Setup Git (deploy key + identity)

The bot needs write access to push workspace backups (kb/ + memory/).
A deploy key gives access to **this repo only** (not your whole GitHub account).

### 3.1 Generate SSH key on the VM

```bash
ssh-keygen -t ed25519 -C "c3po-bot" -f ~/.ssh/c3po-deploy -N ""
```

### 3.2 Add the public key to GitHub

```bash
# Show the public key (copy the output)
cat ~/.ssh/c3po-deploy.pub
```

Go to: https://github.com/jonyw4/c3po/settings/keys
→ **Add deploy key** → paste the public key → check **"Allow write access"** → Save

### 3.3 Configure SSH to use the key

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/c3po-deploy
  IdentitiesOnly yes
EOF
```

### 3.4 Configure git identity

```bash
git config --global user.name "C3PO (bot)"
git config --global user.email "c3po@nunes-celio.family"
```

### 3.5 Verify authentication

```bash
ssh -T git@github.com
# Expected: "Hi jonyw4/c3po! You've been successfully authenticated..."
```

### 3.6 Clone the repo

```bash
git clone git@github.com:jonyw4/c3po.git ~/nunes-celio-c3po
cd ~/nunes-celio-c3po
```

## 4) Configure people.json

```bash
cp config/people.json.example config/people.json
# Edit with real data (numbers, emails)
```

## 5) Configure ANTHROPIC_API_KEY

```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.bashrc
source ~/.bashrc
```

## 5.1) Configure Mercado Livre API credentials

The shopping skill calls the ML search API server-side. **ML blocks server IPs without an OAuth user token** — a simple App ID + Secret is not enough.

### Create the ML app (one-time)

1. Go to https://developers.mercadolivre.com.br/
2. Log in → **Minhas Aplicações** → **Criar aplicação**
3. Fill in:
   - **Nome**: `c3po-shopping`
   - **URI de redirect**: any HTTPS URI you control (e.g. `https://mercadolivre.c`)
   - **Scopes**: `read` (leitura pública)
4. Save → copy **App ID** and **Secret Key**

### Get OAuth user token (authorization_code flow)

The search API requires a user-level token. Steps to get it:

```bash
# Step 1 — Open this URL in your browser (replace values):
# https://auth.mercadolivre.com.br/authorization?response_type=code
#   &client_id=YOUR_APP_ID&redirect_uri=https://YOUR_REDIRECT_URI

# You'll be redirected to https://YOUR_REDIRECT_URI?code=TG-xxxx-USER_ID
# Copy the "code" value (starts with TG-)

# Step 2 — Exchange code for token:
CODE="TG-xxxxx-xxxxxx"
curl -X POST "https://api.mercadolibre.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&client_id=$ML_APP_ID&client_secret=$ML_APP_SECRET\
&code=$CODE&redirect_uri=https://YOUR_REDIRECT_URI"

# Copy the "access_token" from the response (starts with APP_USR-)
```

### Set on the VM

```bash
# Required (app identity)
echo 'export ML_APP_ID="YOUR_APP_ID"' >> ~/.bashrc
echo 'export ML_APP_SECRET="YOUR_SECRET_KEY"' >> ~/.bashrc

# Required (user OAuth token — renew every ~6h or when the script reports 403)
echo 'export ML_ACCESS_TOKEN="APP_USR-xxxx"' >> ~/.bashrc
source ~/.bashrc
```

### Test

```bash
bun ~/nunes-celio-c3po/scripts/c3po-shopping-ml.ts \
  --query "liquidificador" --max-price 150 --limit 3
```

Should return JSON with `results` array.

### If the API still returns PolicyAgent 403

The server IP may be blocked by ML. In that case C3PO falls back to browser-based ML search automatically (see AGENTS.md §Exec). No code changes needed — the agent handles the fallback.

## 6) Run the automated setup

```bash
bash deploy/exe-dev-setup.sh
```

This installs Bun, OpenClaw, googleapis, configures systemd, and renders the configs.

## 7) Connect WhatsApp

```bash
openclaw channels login
```

Scan the QR code with the phone of the dedicated number (WhatsApp > Linked Devices).

## 8) Get the group JID

```bash
openclaw channels whatsapp groups
```

Copy the JID (format: `XXXXXXXXXXXXXXX-XXXXXXXXXX@g.us`) and update `config/people.json`.

Then re-render and re-copy:

```bash
bun scripts/render-files.ts
cp openclaw/openclaw.json5.local ~/.openclaw/openclaw.json
cp openclaw/exec-approvals.local.json ~/.openclaw/exec-approvals.json
```

## 9) Start the Gateway

```bash
# Manual test first
openclaw gateway --port 18789

# If it works, enable as a service
systemctl --user enable --now c3po-gateway
```

## 10) Test on WhatsApp

- DM the bot: "Oi" → should respond as C3PO
- In the group: "c3po, que horas são?" → should respond
- DM from unknown number → should ignore

## 11) Google Calendar setup (optional, for creating events)

### 11.1 Create Google Cloud project

1. Go to https://console.cloud.google.com/
2. Create a new project (e.g.: "C3PO Calendar")
3. Enable the **Google Calendar API**
4. Create **OAuth 2.0 credentials** (type: Desktop app)
5. Download the credentials JSON

### 11.2 Configure on the VM

```bash
# Create config directory
mkdir -p ~/.config/c3po-calendar

# Copy credentials.json to the VM
scp /local/path/to/credentials.json c3po.exe.xyz:~/.config/c3po-calendar/credentials.json

# Run OAuth setup (1x — generates the token)
bun scripts/c3po-calendar.ts --setup
```

This will generate a URL. Open it in a browser, authorize with Ana's account (`anny.livia.nunes@gmail.com`), and paste the code back in the terminal.

### 11.3 Test

```bash
# Dry run (creates nothing)
bun scripts/c3po-calendar.ts --summary "C3PO Test" --start "2026-02-10 20:00" --dry-run

# Create for real
bun scripts/c3po-calendar.ts --summary "C3PO Test" --start "2026-02-10 20:00"
```

Verify:
- Event appears on Ana's Google Calendar
- Jony receives invite by email

## 12) Final verification

- [ ] `ssh -T git@github.com` authenticates as `jonyw4/c3po`
- [ ] `git push --dry-run` succeeds (no errors)
- [ ] Bot responds to DMs from Jony and Ana
- [ ] Bot ignores DMs from other numbers
- [ ] Bot responds in group with `c3po,` or @mention
- [ ] Bot ignores messages without trigger in group
- [ ] `systemctl --user list-timers` shows archive, watchdog, and workspace-backup
- [ ] `openclaw browser start && openclaw browser open https://example.com && openclaw browser snapshot` works
- [ ] (if calendar configured) "c3po, marca jantar sexta 20h" works
- [ ] `ML_ACCESS_TOKEN` is set (obtained via ML OAuth authorization_code flow)
- [ ] `bun scripts/c3po-shopping-ml.ts --query "liquidificador" --limit 3` returns JSON with results; if PolicyAgent 403, confirm browser fallback is working

## Maintenance

### Update the workspace

```bash
cd ~/nunes-celio-c3po && git pull
bun scripts/render-files.ts
cp openclaw/openclaw.json5.local ~/.openclaw/openclaw.json
cp openclaw/exec-approvals.local.json ~/.openclaw/exec-approvals.json
# OpenClaw hot-reloads workspace files automatically; exec-approvals requires restart
systemctl --user restart c3po-gateway
```

### Reconnect WhatsApp (if session expires)

```bash
openclaw channels login
```

### View logs

```bash
openclaw logs --follow
# or: journalctl --user -u c3po-gateway -f
```
