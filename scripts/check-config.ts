#!/usr/bin/env bun
/**
 * check-config.ts — Validates config/people.json structure and values.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const CONFIG_PATH = resolve(REPO_ROOT, "config", "people.json");

const E164_RE = /^\+\d{8,15}$/;
const GROUP_JID_RE = /@g\.us$/;
const PLACEHOLDER_JID = "00000000000000-0000000000@g.us";

function main(): number {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`Missing config: ${CONFIG_PATH}`);
    return 2;
  }

  const data = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const errors: string[] = [];

  const tz = data.timezone;
  if (tz !== "America/Sao_Paulo") {
    errors.push('timezone should be "America/Sao_Paulo" (or adjust intentionally)');
  }

  const people = typeof data.people === "object" && data.people ? data.people : {};
  for (const key of ["jony", "ana"]) {
    if (!(key in people)) {
      errors.push(`missing people.${key}`);
      continue;
    }
    const p = people[key];
    const num = p.whatsappE164;
    if (typeof num !== "string" || !E164_RE.test(num)) {
      errors.push(`people.${key}.whatsappE164 must be E.164 like +5511999999999`);
    }
    const email = p.email;
    if (typeof email !== "string" || !email.includes("@")) {
      errors.push(`people.${key}.email must look like an email`);
    }
  }

  const group = data.group || {};
  const jid = group.whatsappJid;
  if (typeof jid !== "string" || !GROUP_JID_RE.test(jid)) {
    errors.push('group.whatsappJid must end with "@g.us"');
  } else if (jid === PLACEHOLDER_JID) {
    errors.push("group.whatsappJid is still the placeholder; replace with the real group JID");
  }

  const triggers = data.triggers || {};
  const prefixes = triggers.prefixes;
  if (!Array.isArray(prefixes) || !prefixes.includes("c3po,")) {
    errors.push('triggers.prefixes must include "c3po,"');
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`- ${e}`);
    }
    return 1;
  }

  console.log("OK: config looks sane");
  return 0;
}

process.exit(main());
