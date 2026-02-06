#!/usr/bin/env bun
/**
 * workspace-backup.ts — Auto-commits and pushes workspace changes (kb/, memory/)
 * to the remote Git repository.
 *
 * Designed to run as a daily systemd timer. Only commits if there are changes.
 * Never commits files matching .gitignore (secrets, local configs, tokens).
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

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

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 30_000 }).trim();
  } catch (e: any) {
    return e.stdout?.trim() ?? "";
  }
}

function main(): number {
  const args = process.argv.slice(2);
  let configPath = join(REPO_ROOT, "config", "people.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = args[++i];
    }
  }

  const tz = loadTimezone(configPath);
  if (tz) {
    process.env.TZ = process.env.TZ || tz;
  }

  // Safety: warn if the remote repo is public (memory/kb may contain personal data)
  const remoteUrl = run("git remote get-url origin", REPO_ROOT);
  if (remoteUrl) {
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      const [, owner, repo] = match;
      try {
        const visibility = execSync(
          `gh api repos/${owner}/${repo} --jq .visibility`,
          { cwd: REPO_ROOT, encoding: "utf-8", timeout: 15_000 }
        ).trim();
        if (visibility === "public") {
          console.log(
            JSON.stringify({
              action: "abort",
              reason: "repo is public — refusing to push personal data",
              hint: `Run: gh repo edit ${owner}/${repo} --visibility private`,
            })
          );
          return 1;
        }
      } catch {
        // gh CLI not available or API error — log warning but continue
        console.error(
          "WARNING: could not verify repo visibility. Ensure the remote repo is private."
        );
      }
    }
  }

  // Check for changes in tracked paths
  const status = run("git status --porcelain -- memory/ kb/", REPO_ROOT);

  if (!status) {
    console.log(JSON.stringify({ action: "skip", reason: "no changes" }));
    return 0;
  }

  const changedFiles = status.split("\n").length;

  // Stage only workspace content (memory + kb)
  run("git add memory/ kb/", REPO_ROOT);

  // Check if there's anything staged
  const staged = run("git diff --cached --name-only", REPO_ROOT);
  if (!staged) {
    console.log(JSON.stringify({ action: "skip", reason: "nothing staged" }));
    return 0;
  }

  // Create commit
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const message = `backup: workspace auto-save ${date}`;

  try {
    execSync(`git commit -m "${message}"`, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 15_000,
    });
  } catch (e: any) {
    console.log(
      JSON.stringify({
        action: "error",
        step: "commit",
        error: e.message?.slice(0, 200),
      })
    );
    return 1;
  }

  // Push to remote
  try {
    execSync("git push", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    });
  } catch (e: any) {
    console.log(
      JSON.stringify({
        action: "error",
        step: "push",
        error: e.message?.slice(0, 200),
      })
    );
    return 1;
  }

  console.log(
    JSON.stringify({
      action: "backup",
      date,
      filesChanged: changedFiles,
      filesPushed: staged.split("\n").filter(Boolean),
    })
  );

  return 0;
}

process.exit(main());
