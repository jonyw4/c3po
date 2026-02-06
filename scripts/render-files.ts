#!/usr/bin/env bun
/**
 * render-files.ts — Generates local config files from templates
 * using values from config/people.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

function loadPeople(): Record<string, any> {
  return JSON.parse(readFileSync(join(REPO_ROOT, "config", "people.json"), "utf-8"));
}

function replaceAll(content: string, replacements: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(key).join(value);
  }
  return result;
}

function main(): number {
  const people = loadPeople();
  const ana = people.people.ana;
  const jony = people.people.jony;
  const tz = people.timezone || "America/Sao_Paulo";
  const groupJid = people.group.whatsappJid;

  const replacements: Record<string, string> = {
    "/ABSOLUTE/PATH/TO/THIS/REPO": REPO_ROOT,
    "+55XXXXXXXXXXX": ana.whatsappE164,
    "+55YYYYYYYYYYY": jony.whatsappE164,
    "00000000000000-0000000000@g.us": groupJid,
    "America/Sao_Paulo": tz,
  };

  const targets: [string, string][] = [
    ["openclaw/openclaw.json5.example", "openclaw/openclaw.json5.local"],
    ["openclaw/exec-approvals.json.example", "openclaw/exec-approvals.local.json"],
    ["scripts/systemd/c3po-memory-archive.service", "scripts/systemd/c3po-memory-archive.local.service"],
    ["scripts/systemd/c3po-memory-archive.timer", "scripts/systemd/c3po-memory-archive.local.timer"],
    ["scripts/systemd/c3po-gateway.service", "scripts/systemd/c3po-gateway.local.service"],
    ["scripts/systemd/c3po-watchdog.service", "scripts/systemd/c3po-watchdog.local.service"],
    ["scripts/systemd/c3po-watchdog.sh", "scripts/systemd/c3po-watchdog.local.sh"],
    ["scripts/systemd/c3po-workspace-backup.service", "scripts/systemd/c3po-workspace-backup.local.service"],
  ];

  const written: string[] = [];

  for (const [srcRel, dstRel] of targets) {
    const src = join(REPO_ROOT, srcRel);
    const dst = join(REPO_ROOT, dstRel);

    if (!existsSync(src)) {
      console.log(`SKIP (not found): ${srcRel}`);
      continue;
    }

    const content = readFileSync(src, "utf-8");
    const rendered = replaceAll(content, replacements);

    const dstDir = dirname(dst);
    mkdirSync(dstDir, { recursive: true });
    writeFileSync(dst, rendered, "utf-8");

    written.push(dstRel);
  }

  console.log(JSON.stringify({ written }, null, 2));
  return 0;
}

process.exit(main());
