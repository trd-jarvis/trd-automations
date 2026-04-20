import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ActionBucket,
  AnnouncementAudience,
  AnnouncementStatus,
  ApprovalItem,
  ApprovalStatus,
  ClientAccount,
  DispatchChannel,
  DispatchPlan,
  DispatchStatus,
  LeadRecord,
  RawFinding,
  RunSummary,
  ShareJob,
  ShareJobStatus,
  SignalFinding,
  SignalSentiment,
  WorkerDefinition
} from "../types.js";
import { DATA_DIR, ensureRuntimeDirs } from "./fs.js";

ensureRuntimeDirs();
const db = new DatabaseSync(path.join(DATA_DIR, "trd-automations.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);

function json<T>(value: T): string {
  return JSON.stringify(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function hasColumn(tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<Record<string, unknown>>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_runs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      worker_key TEXT NOT NULL,
      status TEXT NOT NULL,
      source_type TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      positive_count INTEGER NOT NULL DEFAULT 0,
      negative_count INTEGER NOT NULL DEFAULT 0,
      snapshot_path TEXT,
      error_message TEXT,
      split_completed_at TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS raw_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      worker_key TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      snippet TEXT NOT NULL,
      source_label TEXT NOT NULL,
      published_at TEXT,
      rank_value REAL,
      rating_value REAL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signal_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      worker_key TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      snippet TEXT NOT NULL,
      source_label TEXT NOT NULL,
      published_at TEXT,
      rank_value REAL,
      rating_value REAL,
      sentiment TEXT NOT NULL,
      score INTEGER NOT NULL,
      action_bucket TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      report_status TEXT NOT NULL DEFAULT 'PENDING',
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queued_reports (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      cc_json TEXT NOT NULL,
      subject TEXT NOT NULL,
      finding_count INTEGER NOT NULL,
      signal_ids_json TEXT NOT NULL,
      html_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      message_id TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      worker_key TEXT NOT NULL,
      lead_source TEXT NOT NULL DEFAULT 'generated',
      company TEXT NOT NULL,
      website TEXT,
      phone TEXT,
      email TEXT,
      city TEXT,
      state TEXT,
      rating_value REAL,
      review_count REAL,
      weakness_signals_json TEXT NOT NULL,
      weakness_score INTEGER NOT NULL DEFAULT 0,
      qualification_score INTEGER NOT NULL DEFAULT 0,
      recommended_channel TEXT NOT NULL DEFAULT 'email',
      status TEXT NOT NULL,
      ghl_contact_id TEXT,
      ghl_tags_json TEXT,
      ghl_synced_at TEXT,
      ghl_last_error TEXT,
      negative_analysis_status TEXT NOT NULL DEFAULT 'PENDING',
      negative_analysis_json TEXT,
      negative_analysis_generated_at TEXT,
      email_subject TEXT,
      email_body TEXT,
      email_html_path TEXT,
      email_payload_path TEXT,
      email_prepared_at TEXT,
      email_sent_at TEXT,
      email_message_id TEXT,
      voice_batch_id TEXT,
      voice_slot_index INTEGER,
      voice_phone_number_id TEXT,
      voice_assistant_id TEXT,
      voice_call_id TEXT,
      voice_status TEXT NOT NULL DEFAULT 'PENDING',
      voice_prepared_at TEXT,
      voice_called_at TEXT,
      sms_body TEXT,
      sms_status TEXT NOT NULL DEFAULT 'PENDING',
      sms_sid TEXT,
      sms_sent_at TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS dispatch_plans (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      next_action TEXT NOT NULL,
      status TEXT NOT NULL,
      approval_id TEXT,
      preview_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS share_jobs (
      id TEXT PRIMARY KEY,
      artifact_path TEXT NOT NULL,
      recipients_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queued_announcements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      audience TEXT NOT NULL,
      client_id TEXT,
      recipient TEXT NOT NULL,
      cc_json TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      message_id TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS crm_activity (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      note TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing("share_jobs", "status", "TEXT NOT NULL DEFAULT 'QUEUED'");
  addColumnIfMissing("share_jobs", "remote_id", "TEXT");
  addColumnIfMissing("share_jobs", "completed_at", "TEXT");
  addColumnIfMissing("share_jobs", "error_message", "TEXT");
  addColumnIfMissing("leads", "lead_source", "TEXT NOT NULL DEFAULT 'generated'");
  addColumnIfMissing("leads", "ghl_contact_id", "TEXT");
  addColumnIfMissing("leads", "ghl_tags_json", "TEXT");
  addColumnIfMissing("leads", "ghl_synced_at", "TEXT");
  addColumnIfMissing("leads", "ghl_last_error", "TEXT");
  addColumnIfMissing("leads", "negative_analysis_status", "TEXT NOT NULL DEFAULT 'PENDING'");
  addColumnIfMissing("leads", "negative_analysis_json", "TEXT");
  addColumnIfMissing("leads", "negative_analysis_generated_at", "TEXT");
  addColumnIfMissing("leads", "email_subject", "TEXT");
  addColumnIfMissing("leads", "email_body", "TEXT");
  addColumnIfMissing("leads", "email_html_path", "TEXT");
  addColumnIfMissing("leads", "email_payload_path", "TEXT");
  addColumnIfMissing("leads", "email_prepared_at", "TEXT");
  addColumnIfMissing("leads", "email_sent_at", "TEXT");
  addColumnIfMissing("leads", "email_message_id", "TEXT");
  addColumnIfMissing("leads", "voice_batch_id", "TEXT");
  addColumnIfMissing("leads", "voice_slot_index", "INTEGER");
  addColumnIfMissing("leads", "voice_phone_number_id", "TEXT");
  addColumnIfMissing("leads", "voice_assistant_id", "TEXT");
  addColumnIfMissing("leads", "voice_call_id", "TEXT");
  addColumnIfMissing("leads", "voice_status", "TEXT NOT NULL DEFAULT 'PENDING'");
  addColumnIfMissing("leads", "voice_prepared_at", "TEXT");
  addColumnIfMissing("leads", "voice_called_at", "TEXT");
  addColumnIfMissing("leads", "sms_body", "TEXT");
  addColumnIfMissing("leads", "sms_status", "TEXT NOT NULL DEFAULT 'PENDING'");
  addColumnIfMissing("leads", "sms_sid", "TEXT");
  addColumnIfMissing("leads", "sms_sent_at", "TEXT");
}

export function startWorkerRun(client: ClientAccount, worker: WorkerDefinition): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO worker_runs (
      id, client_id, worker_key, status, source_type, started_at
    ) VALUES (?, ?, ?, 'RUNNING', ?, ?)
  `).run(id, client.id, worker.key, worker.source.type, nowIso());
  return id;
}

export function completeWorkerRun(summary: RunSummary): void {
  db.prepare(`
    UPDATE worker_runs
    SET status = ?, item_count = ?, positive_count = ?, negative_count = ?, snapshot_path = ?, error_message = ?, completed_at = ?
    WHERE id = ?
  `).run(
    summary.status,
    summary.itemCount,
    summary.positiveCount,
    summary.negativeCount,
    summary.snapshotPath ?? null,
    summary.errorMessage ?? null,
    nowIso(),
    summary.runId
  );
}

export function markRunSplit(runId: string): void {
  db.prepare(`
    UPDATE worker_runs
    SET split_completed_at = ?
    WHERE id = ?
  `).run(nowIso(), runId);
}

export function insertRawFindings(runId: string, clientId: string, workerKey: string, findings: RawFinding[]): void {
  const stmt = db.prepare(`
    INSERT INTO raw_findings (
      id, run_id, client_id, worker_key, title, url, snippet, source_label, published_at, rank_value, rating_value, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    const createdAt = nowIso();
    for (const finding of findings) {
      stmt.run(
        randomUUID(),
        runId,
        clientId,
        workerKey,
        finding.title,
        finding.url,
        finding.snippet,
        finding.sourceLabel,
        finding.publishedAt ?? null,
        finding.rank ?? null,
        finding.rating ?? null,
        json(finding.raw),
        createdAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function clearSignalsForRun(runId: string): void {
  db.prepare(`DELETE FROM signal_findings WHERE run_id = ?`).run(runId);
}

export function insertSignals(runId: string, clientId: string, workerKey: string, findings: SignalFinding[]): void {
  const stmt = db.prepare(`
    INSERT INTO signal_findings (
      id, run_id, client_id, worker_key, title, url, snippet, source_label, published_at, rank_value, rating_value, sentiment, score, action_bucket, reasons_json, report_status, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `);
  db.exec("BEGIN");
  try {
    const createdAt = nowIso();
    for (const finding of findings) {
      stmt.run(
        randomUUID(),
        runId,
        clientId,
        workerKey,
        finding.title,
        finding.url,
        finding.snippet,
        finding.sourceLabel,
        finding.publishedAt ?? null,
        finding.rank ?? null,
        finding.rating ?? null,
        finding.sentiment,
        finding.score,
        finding.actionBucket,
        json(finding.reasons),
        json(finding.raw),
        createdAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getLatestRun(clientId: string, workerKey?: string): { id: string } | undefined {
  const query = workerKey
    ? `SELECT id FROM worker_runs WHERE client_id = ? AND worker_key = ? ORDER BY started_at DESC LIMIT 1`
    : `SELECT id FROM worker_runs WHERE client_id = ? ORDER BY started_at DESC LIMIT 1`;
  const row = workerKey
    ? db.prepare(query).get(clientId, workerKey)
    : db.prepare(query).get(clientId);
  return row as { id: string } | undefined;
}

export function getPendingSplitRuns(clientId: string, workerKey?: string): Array<{ runId: string; workerKey: string }> {
  const query = workerKey
    ? `
      SELECT id AS runId, worker_key AS workerKey
      FROM worker_runs
      WHERE client_id = ? AND worker_key = ? AND status = 'SUCCESS' AND split_completed_at IS NULL
      ORDER BY started_at ASC
    `
    : `
      SELECT id AS runId, worker_key AS workerKey
      FROM worker_runs
      WHERE client_id = ? AND status = 'SUCCESS' AND split_completed_at IS NULL
      ORDER BY started_at ASC
    `;
  const rows = workerKey
    ? db.prepare(query).all(clientId, workerKey)
    : db.prepare(query).all(clientId);
  return rows as Array<{ runId: string; workerKey: string }>;
}

export function getRunFindings(runId: string): RawFinding[] {
  const rows = db.prepare(`
    SELECT title, url, snippet, source_label AS sourceLabel, published_at AS publishedAt, rank_value AS rank, rating_value AS rating, raw_json AS rawJson
    FROM raw_findings
    WHERE run_id = ?
    ORDER BY created_at ASC
  `).all(runId) as Array<{
    title: string;
    url: string;
    snippet: string;
    sourceLabel: string;
    publishedAt?: string | null;
    rank?: number | null;
    rating?: number | null;
    rawJson: string;
  }>;
  return rows.map((row) => ({
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    sourceLabel: row.sourceLabel,
    publishedAt: row.publishedAt ?? null,
    rank: row.rank ?? null,
    rating: row.rating ?? null,
    raw: JSON.parse(row.rawJson) as Record<string, unknown>
  }));
}

export function countSignalsBySentiment(runId: string, sentiment: SignalSentiment): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM signal_findings
    WHERE run_id = ? AND sentiment = ?
  `).get(runId, sentiment) as { count: number };
  return row.count;
}

export function getPendingReportSignals(clientId: string): Array<SignalFinding & { id: string }> {
  return db.prepare(`
    SELECT id, title, url, snippet, source_label AS sourceLabel, published_at AS publishedAt, rank_value AS rank, rating_value AS rating, sentiment, score, action_bucket AS actionBucket, reasons_json AS reasonsJson, raw_json AS rawJson
    FROM signal_findings
    WHERE client_id = ? AND sentiment = 'POSITIVE' AND report_status = 'PENDING'
    ORDER BY score DESC, created_at DESC
  `).all(clientId).map((row) => {
    const typed = row as {
      id: string;
      title: string;
      url: string;
      snippet: string;
      sourceLabel: string;
      publishedAt?: string | null;
      rank?: number | null;
      rating?: number | null;
      sentiment: SignalSentiment;
      score: number;
      actionBucket: ActionBucket;
      reasonsJson: string;
      rawJson: string;
    };
    return {
      id: typed.id,
      title: typed.title,
      url: typed.url,
      snippet: typed.snippet,
      sourceLabel: typed.sourceLabel,
      publishedAt: typed.publishedAt ?? null,
      rank: typed.rank ?? null,
      rating: typed.rating ?? null,
      sentiment: typed.sentiment,
      score: typed.score,
      actionBucket: typed.actionBucket,
      reasons: JSON.parse(typed.reasonsJson) as string[],
      raw: JSON.parse(typed.rawJson) as Record<string, unknown>
    };
  }) as Array<SignalFinding & { id: string }>;
}

export function queueReport(clientId: string, recipient: string, cc: string[], subject: string, signalIds: string[], htmlPath: string): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO queued_reports (
      id, client_id, recipient, cc_json, subject, finding_count, signal_ids_json, html_path, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, recipient, json(cc), subject, signalIds.length, json(signalIds), htmlPath, nowIso());
  return id;
}

export function getQueuedReport(clientId: string): {
  id: string;
  recipient: string;
  cc: string[];
  subject: string;
  htmlPath: string;
  signalIds: string[];
} | undefined {
  const row = db.prepare(`
    SELECT id, recipient, cc_json AS ccJson, subject, html_path AS htmlPath, signal_ids_json AS signalIdsJson
    FROM queued_reports
    WHERE client_id = ? AND status = 'QUEUED'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(clientId) as {
    id: string;
    recipient: string;
    ccJson: string;
    subject: string;
    htmlPath: string;
    signalIdsJson: string;
  } | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    recipient: row.recipient,
    cc: JSON.parse(row.ccJson) as string[],
    subject: row.subject,
    htmlPath: row.htmlPath,
    signalIds: JSON.parse(row.signalIdsJson) as string[]
  };
}

export function markReportSent(reportId: string, signalIds: string[], messageId?: string): void {
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE queued_reports
      SET status = 'SENT', sent_at = ?, message_id = ?
      WHERE id = ?
    `).run(nowIso(), messageId ?? null, reportId);
    const stmt = db.prepare(`
      UPDATE signal_findings
      SET report_status = 'SENT'
      WHERE id = ?
    `);
    for (const signalId of signalIds) stmt.run(signalId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function upsertLeads(leads: LeadRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO leads (
      id, client_id, worker_key, lead_source, company, website, phone, email, city, state, rating_value, review_count, weakness_signals_json, weakness_score, qualification_score, recommended_channel, status, ghl_contact_id, ghl_tags_json, ghl_synced_at, ghl_last_error, negative_analysis_status, negative_analysis_json, negative_analysis_generated_at, email_subject, email_body, email_html_path, email_payload_path, email_prepared_at, email_sent_at, email_message_id, voice_batch_id, voice_slot_index, voice_phone_number_id, voice_assistant_id, voice_call_id, voice_status, voice_prepared_at, voice_called_at, sms_body, sms_status, sms_sid, sms_sent_at, raw_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      lead_source = excluded.lead_source,
      company = excluded.company,
      website = excluded.website,
      phone = excluded.phone,
      email = excluded.email,
      city = excluded.city,
      state = excluded.state,
      rating_value = excluded.rating_value,
      review_count = excluded.review_count,
      weakness_signals_json = excluded.weakness_signals_json,
      weakness_score = excluded.weakness_score,
      qualification_score = excluded.qualification_score,
      recommended_channel = excluded.recommended_channel,
      status = excluded.status,
      ghl_contact_id = excluded.ghl_contact_id,
      ghl_tags_json = excluded.ghl_tags_json,
      ghl_synced_at = excluded.ghl_synced_at,
      ghl_last_error = excluded.ghl_last_error,
      negative_analysis_status = excluded.negative_analysis_status,
      negative_analysis_json = excluded.negative_analysis_json,
      negative_analysis_generated_at = excluded.negative_analysis_generated_at,
      email_subject = excluded.email_subject,
      email_body = excluded.email_body,
      email_html_path = excluded.email_html_path,
      email_payload_path = excluded.email_payload_path,
      email_prepared_at = excluded.email_prepared_at,
      email_sent_at = excluded.email_sent_at,
      email_message_id = excluded.email_message_id,
      voice_batch_id = excluded.voice_batch_id,
      voice_slot_index = excluded.voice_slot_index,
      voice_phone_number_id = excluded.voice_phone_number_id,
      voice_assistant_id = excluded.voice_assistant_id,
      voice_call_id = excluded.voice_call_id,
      voice_status = excluded.voice_status,
      voice_prepared_at = excluded.voice_prepared_at,
      voice_called_at = excluded.voice_called_at,
      sms_body = excluded.sms_body,
      sms_status = excluded.sms_status,
      sms_sid = excluded.sms_sid,
      sms_sent_at = excluded.sms_sent_at,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  db.exec("BEGIN");
  try {
    for (const lead of leads) {
      stmt.run(
        lead.id,
        lead.clientId,
        lead.workerKey,
        lead.leadSource,
        lead.company,
        lead.website ?? null,
        lead.phone ?? null,
        lead.email ?? null,
        lead.city ?? null,
        lead.state ?? null,
        lead.rating ?? null,
        lead.reviewCount ?? null,
        json(lead.weaknessSignals),
        lead.weaknessScore,
        lead.qualificationScore,
        lead.recommendedChannel,
        lead.status,
        lead.ghlContactId ?? null,
        lead.ghlTags ? json(lead.ghlTags) : null,
        lead.ghlSyncedAt ?? null,
        lead.ghlLastError ?? null,
        lead.negativeAnalysisStatus ?? "PENDING",
        lead.negativeAnalysis ? json(lead.negativeAnalysis) : null,
        lead.negativeAnalysisGeneratedAt ?? null,
        lead.emailSubject ?? null,
        lead.emailBody ?? null,
        lead.emailHtmlPath ?? null,
        lead.emailPayloadPath ?? null,
        lead.emailPreparedAt ?? null,
        lead.emailSentAt ?? null,
        lead.emailMessageId ?? null,
        lead.voiceBatchId ?? null,
        lead.voiceSlotIndex ?? null,
        lead.voicePhoneNumberId ?? null,
        lead.voiceAssistantId ?? null,
        lead.voiceCallId ?? null,
        lead.voiceStatus ?? "PENDING",
        lead.voicePreparedAt ?? null,
        lead.voiceCalledAt ?? null,
        lead.smsBody ?? null,
        lead.smsStatus ?? "PENDING",
        lead.smsSid ?? null,
        lead.smsSentAt ?? null,
        json(lead.raw),
        lead.createdAt,
        lead.updatedAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function clearLeadPipeline(clientId: string): void {
  db.exec("BEGIN");
  try {
    const leadIds = db.prepare(`SELECT id FROM leads WHERE client_id = ?`).all(clientId) as Array<{ id: string }>;
    for (const lead of leadIds) {
      db.prepare(`DELETE FROM approvals WHERE lead_id = ?`).run(lead.id);
      db.prepare(`DELETE FROM dispatch_plans WHERE lead_id = ?`).run(lead.id);
      db.prepare(`DELETE FROM crm_activity WHERE lead_id = ?`).run(lead.id);
    }
    db.prepare(`DELETE FROM leads WHERE client_id = ?`).run(clientId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getLeads(clientId: string): LeadRecord[] {
  const rows = db.prepare(`
    SELECT *
    FROM leads
    WHERE client_id = ?
    ORDER BY qualification_score DESC, weakness_score DESC, created_at DESC
  `).all(clientId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    clientId: String(row.client_id),
    workerKey: String(row.worker_key),
    leadSource: String(row.lead_source || "generated") as LeadRecord["leadSource"],
    company: String(row.company),
    website: typeof row.website === "string" ? row.website : undefined,
    phone: typeof row.phone === "string" ? row.phone : undefined,
    email: typeof row.email === "string" ? row.email : undefined,
    city: typeof row.city === "string" ? row.city : undefined,
    state: typeof row.state === "string" ? row.state : undefined,
    rating: typeof row.rating_value === "number" ? row.rating_value : null,
    reviewCount: typeof row.review_count === "number" ? row.review_count : null,
    weaknessSignals: JSON.parse(String(row.weakness_signals_json)) as string[],
    weaknessScore: Number(row.weakness_score),
    qualificationScore: Number(row.qualification_score),
    recommendedChannel: row.recommended_channel as DispatchChannel,
    status: String(row.status) as LeadRecord["status"],
    ghlContactId: typeof row.ghl_contact_id === "string" ? row.ghl_contact_id : undefined,
    ghlTags: typeof row.ghl_tags_json === "string" ? JSON.parse(String(row.ghl_tags_json)) as string[] : undefined,
    ghlSyncedAt: typeof row.ghl_synced_at === "string" ? row.ghl_synced_at : null,
    ghlLastError: typeof row.ghl_last_error === "string" ? row.ghl_last_error : null,
    negativeAnalysisStatus: String(row.negative_analysis_status || "PENDING") as LeadRecord["negativeAnalysisStatus"],
    negativeAnalysis: typeof row.negative_analysis_json === "string"
      ? JSON.parse(String(row.negative_analysis_json)) as NonNullable<LeadRecord["negativeAnalysis"]>
      : null,
    negativeAnalysisGeneratedAt: typeof row.negative_analysis_generated_at === "string" ? row.negative_analysis_generated_at : null,
    emailSubject: typeof row.email_subject === "string" ? row.email_subject : undefined,
    emailBody: typeof row.email_body === "string" ? row.email_body : undefined,
    emailHtmlPath: typeof row.email_html_path === "string" ? row.email_html_path : null,
    emailPayloadPath: typeof row.email_payload_path === "string" ? row.email_payload_path : null,
    emailPreparedAt: typeof row.email_prepared_at === "string" ? row.email_prepared_at : null,
    emailSentAt: typeof row.email_sent_at === "string" ? row.email_sent_at : null,
    emailMessageId: typeof row.email_message_id === "string" ? row.email_message_id : null,
    voiceBatchId: typeof row.voice_batch_id === "string" ? row.voice_batch_id : null,
    voiceSlotIndex: typeof row.voice_slot_index === "number" ? row.voice_slot_index : null,
    voicePhoneNumberId: typeof row.voice_phone_number_id === "string" ? row.voice_phone_number_id : null,
    voiceAssistantId: typeof row.voice_assistant_id === "string" ? row.voice_assistant_id : null,
    voiceCallId: typeof row.voice_call_id === "string" ? row.voice_call_id : null,
    voiceStatus: String(row.voice_status || "PENDING") as LeadRecord["voiceStatus"],
    voicePreparedAt: typeof row.voice_prepared_at === "string" ? row.voice_prepared_at : null,
    voiceCalledAt: typeof row.voice_called_at === "string" ? row.voice_called_at : null,
    smsBody: typeof row.sms_body === "string" ? row.sms_body : undefined,
    smsStatus: String(row.sms_status || "PENDING") as LeadRecord["smsStatus"],
    smsSid: typeof row.sms_sid === "string" ? row.sms_sid : null,
    smsSentAt: typeof row.sms_sent_at === "string" ? row.sms_sent_at : null,
    raw: JSON.parse(String(row.raw_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }));
}

export function getLeadById(leadId: string): LeadRecord | undefined {
  const row = db.prepare(`
    SELECT client_id AS clientId
    FROM leads
    WHERE id = ?
    LIMIT 1
  `).get(leadId) as { clientId?: string } | undefined;
  if (!row?.clientId) return undefined;
  return getLeads(String(row.clientId)).find((lead) => lead.id === leadId);
}

export function createApproval(leadId: string, clientId: string, channel: DispatchChannel, summary: string): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO approvals (
      id, lead_id, client_id, channel, summary, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(id, leadId, clientId, channel, summary, nowIso());
  return id;
}

export function listApprovals(status?: ApprovalStatus): ApprovalItem[] {
  const query = status
    ? `SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC`
    : `SELECT * FROM approvals ORDER BY created_at DESC`;
  const rows = status ? db.prepare(query).all(status) : db.prepare(query).all();
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    leadId: String(row.lead_id),
    clientId: String(row.client_id),
    channel: row.channel as DispatchChannel,
    summary: String(row.summary),
    status: row.status as ApprovalStatus,
    createdAt: String(row.created_at),
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    approvedBy: typeof row.approved_by === "string" ? row.approved_by : null
  }));
}

export function approveApproval(approvalId: string, approvedBy: string): void {
  db.prepare(`
    UPDATE approvals
    SET status = 'APPROVED', approved_at = ?, approved_by = ?
    WHERE id = ?
  `).run(nowIso(), approvedBy, approvalId);
}

export function createDispatchPlan(plan: Omit<DispatchPlan, "id" | "createdAt" | "updatedAt">): string {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO dispatch_plans (
      id, lead_id, client_id, channel, subject, body, next_action, status, approval_id, preview_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    plan.leadId,
    plan.clientId,
    plan.channel,
    plan.subject ?? null,
    plan.body,
    plan.nextAction,
    plan.status,
    plan.approvalId ?? null,
    plan.previewPath ?? null,
    now,
    now
  );
  return id;
}

export function getDispatchPlan(planId: string): DispatchPlan | undefined {
  const row = db.prepare(`SELECT * FROM dispatch_plans WHERE id = ?`).get(planId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    clientId: String(row.client_id),
    channel: row.channel as DispatchChannel,
    subject: typeof row.subject === "string" ? row.subject : undefined,
    body: String(row.body),
    nextAction: String(row.next_action),
    status: row.status as DispatchStatus,
    approvalId: typeof row.approval_id === "string" ? row.approval_id : null,
    previewPath: typeof row.preview_path === "string" ? row.preview_path : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function updateDispatchPlanStatus(planId: string, status: DispatchStatus, previewPath?: string | null): void {
  db.prepare(`
    UPDATE dispatch_plans
    SET status = ?, preview_path = COALESCE(?, preview_path), updated_at = ?
    WHERE id = ?
  `).run(status, previewPath ?? null, nowIso(), planId);
}

export function queueShareJob(artifactPath: string, recipients: string[], reason: string): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO share_jobs (
      id, artifact_path, recipients_json, reason, created_at, status
    ) VALUES (?, ?, ?, ?, ?, 'QUEUED')
  `).run(id, artifactPath, json(recipients), reason, nowIso());
  return id;
}

export function listShareJobs(status: ShareJobStatus = "QUEUED"): ShareJob[] {
  const rows = db.prepare(`
    SELECT id, artifact_path AS artifactPath, recipients_json AS recipientsJson, reason, created_at AS createdAt, status, remote_id AS remoteId, completed_at AS completedAt, error_message AS errorMessage
    FROM share_jobs
    WHERE status = ?
    ORDER BY created_at ASC
  `).all(status) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    artifactPath: String(row.artifactPath),
    recipients: JSON.parse(String(row.recipientsJson)) as string[],
    reason: String(row.reason),
    createdAt: String(row.createdAt),
    status: String(row.status) as ShareJobStatus,
    remoteId: typeof row.remoteId === "string" ? row.remoteId : null,
    completedAt: typeof row.completedAt === "string" ? row.completedAt : null,
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : null
  }));
}

export function markShareJobUploaded(shareJobId: string, remoteId: string): void {
  db.prepare(`
    UPDATE share_jobs
    SET status = 'UPLOADED', remote_id = ?, completed_at = ?, error_message = NULL
    WHERE id = ?
  `).run(remoteId, nowIso(), shareJobId);
}

export function markShareJobFailed(shareJobId: string, errorMessage: string): void {
  db.prepare(`
    UPDATE share_jobs
    SET status = 'FAILED', error_message = ?, completed_at = ?
    WHERE id = ?
  `).run(errorMessage, nowIso(), shareJobId);
}

export function queueAnnouncement(input: {
  type: string;
  audience: AnnouncementAudience;
  clientId?: string | null;
  recipient: string;
  cc: string[];
  subject: string;
  htmlPath: string;
  metadata?: Record<string, unknown>;
}): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO queued_announcements (
      id, type, audience, client_id, recipient, cc_json, subject, html_path, metadata_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)
  `).run(
    id,
    input.type,
    input.audience,
    input.clientId ?? null,
    input.recipient,
    json(input.cc),
    input.subject,
    input.htmlPath,
    json(input.metadata ?? {}),
    nowIso()
  );
  return id;
}

export function getQueuedAnnouncement(announcementId: string): {
  id: string;
  type: string;
  audience: AnnouncementAudience;
  clientId?: string | null;
  recipient: string;
  cc: string[];
  subject: string;
  htmlPath: string;
  metadata: Record<string, unknown>;
} | undefined {
  const row = db.prepare(`
    SELECT id, type, audience, client_id AS clientId, recipient, cc_json AS ccJson, subject, html_path AS htmlPath, metadata_json AS metadataJson
    FROM queued_announcements
    WHERE id = ? AND status = 'QUEUED'
    LIMIT 1
  `).get(announcementId) as Record<string, unknown> | undefined;

  if (!row) return undefined;
  return {
    id: String(row.id),
    type: String(row.type),
    audience: String(row.audience) as AnnouncementAudience,
    clientId: typeof row.clientId === "string" ? row.clientId : null,
    recipient: String(row.recipient),
    cc: JSON.parse(String(row.ccJson)) as string[],
    subject: String(row.subject),
    htmlPath: String(row.htmlPath),
    metadata: JSON.parse(String(row.metadataJson)) as Record<string, unknown>
  };
}

export function markAnnouncementSent(announcementId: string, messageId?: string): void {
  db.prepare(`
    UPDATE queued_announcements
    SET status = 'SENT', sent_at = ?, message_id = ?
    WHERE id = ?
  `).run(nowIso(), messageId ?? null, announcementId);
}

export function listAnnouncements(status: AnnouncementStatus = "QUEUED"): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT id, type, audience, client_id AS clientId, recipient, cc_json AS ccJson, subject, html_path AS htmlPath, status, created_at AS createdAt, sent_at AS sentAt
    FROM queued_announcements
    WHERE status = ?
    ORDER BY created_at DESC
  `).all(status) as Array<Record<string, unknown>>;
}

export function recordCrmActivity(clientId: string, leadId: string, activityType: string, note: string, payload: Record<string, unknown>): void {
  db.prepare(`
    INSERT INTO crm_activity (
      id, client_id, lead_id, activity_type, note, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), clientId, leadId, activityType, note, json(payload), nowIso());
}

export function getRunSummaries(): RunSummary[] {
  const rows = db.prepare(`
    SELECT id AS runId, client_id AS clientId, worker_key AS workerKey, status, source_type AS sourceType, item_count AS itemCount, positive_count AS positiveCount, negative_count AS negativeCount, snapshot_path AS snapshotPath, error_message AS errorMessage
    FROM worker_runs
    ORDER BY started_at DESC
  `).all() as unknown as RunSummary[];
  return rows;
}
