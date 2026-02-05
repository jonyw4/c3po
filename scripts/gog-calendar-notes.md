# Google Calendar via `gog` (fallback)

Goal: create event on Ana's "primary" Calendar and invite Jony.

**Note**: the primary wrapper is `scripts/c3po-calendar.ts` (uses googleapis directly).
The `c3po-calendar-create` (Python/gog) is a fallback in case `gog` gains attendee support.

## What we already know about `gog`

- List events:
  - `gog calendar events <calendarId> --from <iso> --to <iso>`
- Create event:
  - `gog calendar create <calendarId> --summary "Title" --from <iso> --to <iso>`

Ref: the `gog` skill documents these commands.

## What still needs practical confirmation

1) Which `calendarId` to use for Ana's "primary" (often it's the email, but confirm with `gog`).
2) How to add attendees via `gog` (whether there's a flag like `--attendee/--attendees` or JSON).
   - Run: `gog calendar create --help` and `gog calendar update --help`
3) How to force sending invites (Google "sendUpdates") if `gog` exposes that option.

If `gog` doesn't support attendees (likely), use `scripts/c3po-calendar.ts` (TypeScript wrapper using googleapis directly).
