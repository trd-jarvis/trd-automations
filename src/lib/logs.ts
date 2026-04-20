import path from "node:path";
import { spawnSync } from "node:child_process";
import { env, teamRecipients } from "../config.js";
import { getRunSummaries, queueShareJob } from "./db.js";
import { LOG_EXPORT_DIR, writeJson } from "./fs.js";

function runGit(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function isGitRepo(): boolean {
  return runGit(["rev-parse", "--is-inside-work-tree"]).status === 0;
}

function hasRemote(remote: string): boolean {
  return runGit(["remote", "get-url", remote]).status === 0;
}

function hasStagedChanges(): boolean {
  return runGit(["diff", "--cached", "--quiet"]).status === 1;
}

function headSha(): string | null {
  const result = runGit(["rev-parse", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

export function publishLogs(): { exportedPath: string; pushed: boolean; shareJobId: string; committed: boolean; commitSha?: string | null } {
  const exportedPath = path.join(LOG_EXPORT_DIR, "run-summary.json");
  writeJson(exportedPath, {
    generatedAt: new Date().toISOString(),
    runs: getRunSummaries()
  });

  let pushed = false;
  let committed = false;
  let commitSha: string | null = null;
  if (isGitRepo()) {
    const remote = env.LOG_GIT_REMOTE ?? "origin";
    runGit(["add", "-A", "."]);
    if (hasStagedChanges()) {
      const commit = runGit(["commit", "-m", "Update automation logs and repo state"]);
      committed = commit.status === 0;
      commitSha = headSha();
      if (committed && hasRemote(remote)) {
        const push = runGit(["push", remote, env.LOG_GIT_BRANCH]);
        pushed = push.status === 0;
      }
    }
  }

  const shareJobId = queueShareJob(exportedPath, teamRecipients(), "Share exported automation evidence with the TRD team.");
  return { exportedPath, pushed, shareJobId, committed, commitSha };
}
