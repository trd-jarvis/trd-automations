import { readFileSync } from "node:fs";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";
import { env } from "../config.js";
import { listShareJobs, markShareJobFailed, markShareJobUploaded } from "./db.js";

const DRIVE_SCOPE = ["https://www.googleapis.com/auth/drive"];

function serviceAccountCredential(): { client_email?: string; private_key?: string } | null {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) {
    const raw = readFileSync(path.resolve(env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH), "utf8");
    return JSON.parse(raw) as { client_email?: string; private_key?: string };
  }
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string };
  }
  return null;
}

async function driveClient() {
  const credentials = serviceAccountCredential();
  if (!credentials?.client_email || !credentials.private_key) {
    throw new Error("Google service account credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON_PATH or GOOGLE_SERVICE_ACCOUNT_JSON.");
  }
  const auth = new GoogleAuth({
    credentials,
    scopes: DRIVE_SCOPE
  });
  return google.drive({ version: "v3", auth });
}

export async function uploadQueuedShareJobs(jobId?: string): Promise<Array<{ shareJobId: string; remoteId?: string; status: string; artifactPath: string; error?: string }>> {
  const jobs = listShareJobs("QUEUED").filter((job) => !jobId || job.id === jobId);
  if (!env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured.");
  }

  const drive = await driveClient();
  const results: Array<{ shareJobId: string; remoteId?: string; status: string; artifactPath: string; error?: string }> = [];

  for (const job of jobs) {
    try {
      const fileName = path.basename(job.artifactPath);
      const created = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [env.GOOGLE_DRIVE_FOLDER_ID]
        },
        media: {
          mimeType: fileName.endsWith(".html") ? "text/html" : "application/json",
          body: readFileSync(job.artifactPath)
        },
        fields: "id"
      });

      const remoteId = created.data.id;
      if (!remoteId) {
        throw new Error(`Drive upload returned no file id for ${job.artifactPath}`);
      }

      for (const recipient of job.recipients) {
        await drive.permissions.create({
          fileId: remoteId,
          requestBody: {
            role: "writer",
            type: "user",
            emailAddress: recipient
          },
          sendNotificationEmail: false
        });
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
