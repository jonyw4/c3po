# Daily memory (operational)

Files in this directory follow the pattern `YYYY-MM-DD.md`.

Use for:
- Decisions of the day
- Appointments and reminders created
- Pending items

Avoid sensitive data.

## Archive (retention)

- 90-day retention via archival (move) to `memory/archive/`.
- The job runs daily at 03:00 (America/Sao_Paulo) via systemd timer on the exe.dev VM.
