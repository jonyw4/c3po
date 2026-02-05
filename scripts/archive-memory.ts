#!/usr/bin/env bun
/**
 * archive-memory.ts — Archives memory/YYYY-MM-DD.md files older than N days
 * into memory/archive/.
 */

import { readFileSync, readdirSync, renameSync, existsSync, mkdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

interface Config {
  timezone?: string;
}

function loadTimezone(configPath: string): string | null {
  try {
    const data: Config = JSON.parse(readFileSync(configPath, "utf-8"));
    return data.timezone || null;
  } catch {
    return null;
  }
}

function parseDate(s: string): Date {
  const [year, month, day] = s.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function safeMove(src: string, dstDir: string): string {
  mkdirSync(dstDir, { recursive: true });
  const filename = src.split("/").pop()!;
  let dst = join(dstDir, filename);

  if (!existsSync(dst)) {
    renameSync(src, dst);
    return dst;
  }

  const ext = filename.includes(".") ? "." + filename.split(".").pop() : "";
  const stem = ext ? filename.slice(0, -ext.length) : filename;

  for (let i = 1; i < 1000; i++) {
    const candidate = join(dstDir, `${stem}.${i}${ext}`);
    if (!existsSync(candidate)) {
      renameSync(src, candidate);
      return candidate;
    }
  }

  throw new Error(`Could not find free destination name for ${filename}`);
}

function main(): number {
  // Parse args
  const args = process.argv.slice(2);
  let days = 90;
  let memoryDir = join(REPO_ROOT, "memory");
  let archiveDir = join(REPO_ROOT, "memory", "archive");
  let configPath = join(REPO_ROOT, "config", "people.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[++i], 10);
    } else if (args[i] === "--memory-dir" && args[i + 1]) {
      memoryDir = args[++i];
    } else if (args[i] === "--archive-dir" && args[i + 1]) {
      archiveDir = args[++i];
    } else if (args[i] === "--config" && args[i + 1]) {
      configPath = args[++i];
    }
  }

  const tz = loadTimezone(configPath);
  if (tz) {
    process.env.TZ = process.env.TZ || tz;
  }

  const todayDate = today();
  const cutoff = new Date(todayDate.getTime() - days * 24 * 60 * 60 * 1000);

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  let moved = 0;
  let scanned = 0;

  const entries = readdirSync(memoryDir).sort();
  for (const entry of entries) {
    const fullPath = join(memoryDir, entry);
    if (!statSync(fullPath).isFile()) continue;

    const match = entry.match(DATE_RE);
    if (!match) continue;

    scanned++;
    const fileDate = parseDate(match[1]);

    if (fileDate < cutoff) {
      safeMove(fullPath, archiveDir);
      moved++;
    }
  }

  console.log(
    JSON.stringify({
      memoryDir,
      archiveDir,
      days,
      cutoffDate: cutoff.toISOString().split("T")[0],
      filesScanned: scanned,
      filesArchived: moved,
    })
  );

  return 0;
}

process.exit(main());
