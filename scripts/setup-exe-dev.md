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

## 3) Clone the repo

```bash
# Create a fine-grained token on GitHub (read-only for this repo)
# https://github.com/settings/personal-access-tokens/new

git clone https://<TOKEN>@github.com/<ORG>/nunes-celio-c3po.git ~/nunes-celio-c3po
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

- [ ] Bot responds to DMs from Jony and Ana
- [ ] Bot ignores DMs from other numbers
- [ ] Bot responds in group with `c3po,` or @mention
- [ ] Bot ignores messages without trigger in group
- [ ] `systemctl --user list-timers` shows archive and watchdog
- [ ] (if calendar configured) "c3po, marca jantar sexta 20h" works

## Maintenance

### Update the workspace

```bash
cd ~/nunes-celio-c3po && git pull
# OpenClaw hot-reloads workspace files automatically
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
