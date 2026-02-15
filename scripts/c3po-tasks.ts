#!/usr/bin/env bun
/**
 * c3po-tasks.ts — Manage Google Tasks (create, list, update, delete).
 *
 * Uses the Google Tasks API directly via `googleapis` (npm).
 *
 * Usage (list all task lists):
 *   bun scripts/c3po-tasks.ts --list-tasklists
 *
 * Usage (list tasks in a tasklist):
 *   bun scripts/c3po-tasks.ts --list-tasks --tasklist-id "id"
 *     [--show-completed true|false]
 *     [--due-before "YYYY-MM-DD"]
 *     [--due-after "YYYY-MM-DD"]
 *
 * Usage (create task):
 *   bun scripts/c3po-tasks.ts --create-task \
 *     --tasklist-id "id" \
 *     --title "Task title" \
 *     [--notes "Description"] \
 *     [--due "YYYY-MM-DD"] \
 *     [--dry-run]
 *
 * Usage (update task):
 *   bun scripts/c3po-tasks.ts --update-task \
 *     --tasklist-id "id" \
 *     --task-id "task-id" \
 *     [--title "New title"] \
 *     [--status completed|needsAction] \
 *     [--dry-run]
 *
 * Usage (delete task):
 *   bun scripts/c3po-tasks.ts --delete-task \
 *     --tasklist-id "id" \
 *     --task-id "task-id"
 *
 * Usage (create tasklist):
 *   bun scripts/c3po-tasks.ts --create-tasklist \
 *     --title "List name"
 *
 * Requires:
 *   - bun install googleapis
 *   - OAuth token at ~/.config/c3po-tasks/token.json
 *   - OAuth credentials at ~/.config/c3po-tasks/credentials.json
 *
 * Initial setup (1x):
 *   bun scripts/c3po-tasks.ts --setup
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
  "c3po-tasks"
);
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
const TOKEN_PATH = join(CONFIG_DIR, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/tasks"];

// --- Helpers ---

interface PeopleConfig {
  timezone: string;
}

function loadPeople(): PeopleConfig {
  const raw = JSON.parse(readFileSync(PEOPLE_PATH, "utf-8"));
  const tz = raw.timezone || "America/Sao_Paulo";
  return { timezone: tz };
}

function parseLocalDate(value: string): string {
  // Accept "YYYY-MM-DD" and convert to RFC 3339 date (no time component)
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid date: "${value}". Expected "YYYY-MM-DD"`);
  }
  return value.trim(); // RFC 3339 format (date only)
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
    console.error("Then run: bun scripts/c3po-tasks.ts --setup");
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
        console.error("Token expired and refresh failed. Run: bun scripts/c3po-tasks.ts --setup");
        process.exit(3);
      }
    }

    return oAuth2Client;
  }

  console.error(`Missing token: ${TOKEN_PATH}`);
  console.error("Run: bun scripts/c3po-tasks.ts --setup");
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
  console.log("Setup complete! You can now manage Google Tasks.");
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Setup mode
  if (args.setup) {
    await setupOAuth();
    return;
  }

  const auth = await authorize();
  const tasks = google.tasks({ version: "v1", auth });

  // List tasklists
  if (args.listTasklists) {
    const res = await tasks.tasklists.list({ maxResults: 50 });
    const tasklists = (res.data.items || []).map((tl) => ({
      id: tl.id,
      title: tl.title,
      updated: tl.updated,
    }));
    console.log(JSON.stringify({ tasklists, count: tasklists.length }, null, 2));
    return;
  }

  // List tasks
  if (args.listTasks) {
    if (!args.tasklistId) {
      console.error("Missing required: --tasklist-id");
      process.exit(1);
    }

    const tasklistId = String(args.tasklistId);
    const showCompleted = args.showCompleted !== "false";
    const dueBefore = args.dueBefore ? parseLocalDate(String(args.dueBefore)) : undefined;
    const dueAfter = args.dueAfter ? parseLocalDate(String(args.dueAfter)) : undefined;

    const res = await tasks.tasks.list({
      tasklist: tasklistId,
      showCompleted,
      dueMax: dueBefore,
      dueMin: dueAfter,
      maxResults: 100,
    });

    const taskList = (res.data.items || []).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due: t.due || null,
      notes: t.notes || null,
      updated: t.updated,
    }));

    console.log(
      JSON.stringify(
        { tasklist: tasklistId, tasks: taskList, count: taskList.length },
        null,
        2
      )
    );
    return;
  }

  // Create task
  if (args.createTask) {
    if (!args.tasklistId) {
      console.error("Missing required: --tasklist-id");
      process.exit(1);
    }
    if (!args.title) {
      console.error("Missing required: --title");
      process.exit(1);
    }

    const tasklistId = String(args.tasklistId);
    const task: Record<string, unknown> = {
      title: String(args.title),
      status: "needsAction",
    };

    if (args.notes) {
      task.notes = String(args.notes);
    }
    if (args.due) {
      task.due = parseLocalDate(String(args.due));
    }

    if (args.dryRun) {
      console.log(JSON.stringify({ mode: "dry-run", task }, null, 2));
      return;
    }

    const res = await tasks.tasks.insert({
      tasklist: tasklistId,
      requestBody: task as any,
    });

    console.log(
      JSON.stringify(
        {
          status: "created",
          taskId: res.data.id,
          title: res.data.title,
          due: res.data.due || null,
        },
        null,
        2
      )
    );
    return;
  }

  // Update task
  if (args.updateTask) {
    if (!args.tasklistId) {
      console.error("Missing required: --tasklist-id");
      process.exit(1);
    }
    if (!args.taskId) {
      console.error("Missing required: --task-id");
      process.exit(1);
    }

    const tasklistId = String(args.tasklistId);
    const taskId = String(args.taskId);

    // Fetch current task
    const current = await tasks.tasks.get({
      tasklist: tasklistId,
      task: taskId,
    });

    const update: Record<string, unknown> = { ...current.data };

    if (args.title) {
      update.title = String(args.title);
    }
    if (args.status) {
      const status = String(args.status);
      if (status !== "completed" && status !== "needsAction") {
        console.error("Invalid status. Use 'completed' or 'needsAction'");
        process.exit(1);
      }
      update.status = status;
    }

    if (args.dryRun) {
      console.log(JSON.stringify({ mode: "dry-run", update }, null, 2));
      return;
    }

    const res = await tasks.tasks.update({
      tasklist: tasklistId,
      task: taskId,
      requestBody: update as any,
    });

    console.log(
      JSON.stringify(
        {
          status: "updated",
          taskId: res.data.id,
          title: res.data.title,
          taskStatus: res.data.status,
        },
        null,
        2
      )
    );
    return;
  }

  // Delete task
  if (args.deleteTask) {
    if (!args.tasklistId) {
      console.error("Missing required: --tasklist-id");
      process.exit(1);
    }
    if (!args.taskId) {
      console.error("Missing required: --task-id");
      process.exit(1);
    }

    const tasklistId = String(args.tasklistId);
    const taskId = String(args.taskId);

    await tasks.tasks.delete({
      tasklist: tasklistId,
      task: taskId,
    });

    console.log(JSON.stringify({ status: "deleted", taskId }, null, 2));
    return;
  }

  // Create tasklist
  if (args.createTasklist) {
    if (!args.title) {
      console.error("Missing required: --title");
      process.exit(1);
    }

    const res = await tasks.tasklists.insert({
      requestBody: { title: String(args.title) },
    });

    console.log(
      JSON.stringify(
        {
          status: "created",
          tasklistId: res.data.id,
          title: res.data.title,
        },
        null,
        2
      )
    );
    return;
  }

  // No valid mode
  console.error("Please specify a mode: --list-tasklists, --list-tasks, --create-task, --update-task, --delete-task, --create-tasklist, or --setup");
  process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
