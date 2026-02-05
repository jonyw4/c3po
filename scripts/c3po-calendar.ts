#!/usr/bin/env bun
/**
 * c3po-calendar.ts — Creates events on Ana's Google Calendar and invites Jony.
 *
 * Uses the Google Calendar API directly via `googleapis` (npm).
 * This is the primary wrapper (fallback is c3po-calendar-create via gog).
 *
 * Usage:
 *   bun scripts/c3po-calendar.ts \
 *     --summary "Dinner" \
 *     --start "2026-02-10 20:00" \
 *     --duration-minutes 30 \
 *     [--location "Restaurant X"] \
 *     [--notes "Reservation confirmed"] \
 *     [--rrule "FREQ=WEEKLY;BYDAY=TU"] \
 *     [--dry-run]
 *
 * Requires:
 *   - bun install googleapis
 *   - OAuth token at ~/.config/c3po-calendar/token.json
 *   - OAuth credentials at ~/.config/c3po-calendar/credentials.json
 *
 * Initial setup (1x):
 *   bun scripts/c3po-calendar.ts --setup
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { google } from "googleapis";
import { createInterface } from "readline";

// --- Config ---

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const PEOPLE_PATH = join(REPO_ROOT, "config", "people.json");
const CONFIG_DIR = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".config",
  "c3po-calendar"
);
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
const TOKEN_PATH = join(CONFIG_DIR, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// --- Helpers ---

interface PeopleConfig {
  timezone: string;
  anaEmail: string;
  jonyEmail: string;
}

function loadPeople(): PeopleConfig {
  const raw = JSON.parse(readFileSync(PEOPLE_PATH, "utf-8"));
  const tz = raw.timezone || "America/Sao_Paulo";
  const anaEmail = raw.people?.ana?.email;
  const jonyEmail = raw.people?.jony?.email;
  if (!anaEmail || !anaEmail.includes("@")) {
    throw new Error("config.people.ana.email missing/invalid");
  }
  if (!jonyEmail || !jonyEmail.includes("@")) {
    throw new Error("config.people.jony.email missing/invalid");
  }
  return { timezone: tz, anaEmail, jonyEmail };
}

function parseLocalDatetime(value: string): Date {
  // Accept "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM:SS"
  const normalized = value.trim().replace("T", " ");
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new Error(`Invalid datetime: "${value}". Expected "YYYY-MM-DD HH:MM"`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second || "0")
  );
}

function formatDateTimeForGoogle(date: Date, timezone: string): { dateTime: string; timeZone: string } {
  // Format as ISO without UTC conversion (local time)
  const pad = (n: number) => n.toString().padStart(2, "0");
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { dateTime: iso, timeZone: timezone };
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      result["dryRun"] = true;
    } else if (arg === "--setup") {
      result["setup"] = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- OAuth ---

async function authorize() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error(`Missing credentials: ${CREDENTIALS_PATH}`);
    console.error("Download OAuth credentials from Google Cloud Console and place them there.");
    console.error("Then run: bun scripts/c3po-calendar.ts --setup");
    process.exit(3);
  }

  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web || {};

  if (!client_id || !client_secret) {
    console.error("Invalid credentials.json: missing client_id or client_secret");
    process.exit(3);
  }

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob"
  );

  // Load saved token if exists
  if (existsSync(TOKEN_PATH)) {
    const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    oAuth2Client.setCredentials(token);

    // Check if token is expired and try to refresh
    if (token.expiry_date && Date.now() >= token.expiry_date) {
      try {
        const { credentials: refreshed } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(refreshed);
        writeFileSync(TOKEN_PATH, JSON.stringify(refreshed, null, 2));
      } catch (err) {
        console.error("Token expired and refresh failed. Run: bun scripts/c3po-calendar.ts --setup");
        process.exit(3);
      }
    }

    return oAuth2Client;
  }

  console.error(`Missing token: ${TOKEN_PATH}`);
  console.error("Run: bun scripts/c3po-calendar.ts --setup");
  process.exit(3);
}

async function setupOAuth() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error(`Place your OAuth credentials.json at: ${CREDENTIALS_PATH}`);
    process.exit(3);
  }

  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web || {};

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob"
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("Authorize this app by visiting this URL:");
  console.log(authUrl);
  console.log("");

  const code = await prompt("Enter the authorization code: ");

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`Token saved to ${TOKEN_PATH}`);
  console.log("Setup complete! You can now create calendar events.");
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Setup mode
  if (args.setup) {
    await setupOAuth();
    return;
  }

  // Validate required args
  if (!args.summary) {
    console.error("Missing required: --summary");
    console.error('Usage: bun scripts/c3po-calendar.ts --summary "Title" --start "YYYY-MM-DD HH:MM"');
    process.exit(1);
  }
  if (!args.start) {
    console.error("Missing required: --start");
    process.exit(1);
  }

  const people = loadPeople();
  const durationMinutes = parseInt(String(args.durationMinutes || "30"), 10);
  const startDate = parseLocalDatetime(String(args.start));
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const event: Record<string, unknown> = {
    summary: String(args.summary),
    start: formatDateTimeForGoogle(startDate, people.timezone),
    end: formatDateTimeForGoogle(endDate, people.timezone),
    attendees: [{ email: people.jonyEmail }],
  };

  if (args.location) {
    event.location = String(args.location);
  }
  if (args.notes) {
    event.description = String(args.notes);
  }
  if (args.rrule) {
    event.recurrence = [`RRULE:${String(args.rrule)}`];
  }

  // Dry run
  if (args.dryRun) {
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  // Authorize and create
  const auth = await authorize();
  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event as any,
    sendUpdates: "all",
  });

  console.log(
    JSON.stringify(
      {
        status: "created",
        eventId: res.data.id,
        htmlLink: res.data.htmlLink,
        summary: res.data.summary,
        start: res.data.start,
        end: res.data.end,
        attendees: res.data.attendees?.map((a) => a.email),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
