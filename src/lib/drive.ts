import { execFileSync } from "node:child_process";
import path from "node:path";
import { env, gogAccount } from "../config.js";
import { listShareJobs, markShareJobFailed, markShareJobUploaded } from "./db.js";

const DEFAULT_GOG_DRIVE_FOLDER_NAME = "TRD Automations Leads";

function gogJson(args: string[]): Record<string, unknown> {
  const raw = execFileSync("gog", [...args, "--json", "--no-input"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  }).trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function gogDriveArgs(...args: string[]): string[] {
  return ["drive", `--account=${gogAccount()}`, ...args];
}

function extractId(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === "string" && direct.trim()) return direct;
  for (const value of Object.values(record)) {
    const nested = extractId(value);
    if (nested) return nested;
  }
  return null;
}

function driveFolderId(): string {
  const configured = env.GOG_DRIVE_FOLDER_ID?.trim() || env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (configured) return configured;

  const search = gogJson(gogDriveArgs("search", DEFAULT_GOG_DRIVE_FOLDER_NAME, "--max=20"));
  const files = Array.isArray(search.files) ? search.files : [];
  const existing = files.find((entry) => (
    entry
    && typeof entry === "object"
    && (entry as Record<string, unknown>).mimeType === "application/vnd.google-apps.folder"
    && (entry as Record<string, unknown>).name === DEFAULT_GOG_DRIVE_FOLDER_NAME
  ));
  const existingId = extractId(existing);
  if (existingId) return existingId;

  const created = gogJson(gogDriveArgs("mkdir", DEFAULT_GOG_DRIVE_FOLDER_NAME));
  const createdId = extractId(created.folder);
  if (!createdId) {
    throw new Error(`gog drive mkdir returned no folder id for ${DEFAULT_GOG_DRIVE_FOLDER_NAME}.`);
  }
  return createdId;
}

function inferMimeType(fileName: string): string {
  if (fileName.endsWith(".html")) return "text/html";
  if (fileName.endsWith(".json")) return "application/json";
  if (fileName.endsWith(".csv")) return "text/csv";
  if (fileName.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

export async function uploadQueuedShareJobs(jobId?: string): Promise<Array<{ shareJobId: string; remoteId?: string; status: string; artifactPath: string; error?: string }>> {
  const jobs = listShareJobs("QUEUED").filter((job) => !jobId || job.id === jobId);
  const parentFolderId = driveFolderId();
  const results: Array<{ shareJobId: string; remoteId?: string; status: string; artifactPath: string; error?: string }> = [];

  for (const job of jobs) {
    try {
      const fileName = path.basename(job.artifactPath);
      const upload = gogJson(gogDriveArgs(
        "upload",
        job.artifactPath,
        `--parent=${parentFolderId}`,
        `--name=${fileName}`,
        `--mime-type=${inferMimeType(fileName)}`
      ));
      const remoteId = extractId(upload.file);
      if (!remoteId) {
        throw new Error(`gog drive upload returned no file id for ${job.artifactPath}`);
      }

      for (const recipient of job.recipients) {
        gogJson(gogDriveArgs(
          "share",
          remoteId,
          "--to=user",
          `--email=${recipient}`,
          "--role=writer"
        ));
      }

      markShareJobUploaded(job.id, remoteId);
      results.push({
        shareJobId: job.id,
        remoteId,
        status: "UPLOADED",
        artifactPath: job.artifactPath
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markShareJobFailed(job.id, message);
      results.push({
        shareJobId: job.id,
        status: "FAILED",
        artifactPath: job.artifactPath,
        error: message
      });
    }
  }

  return results;
}
