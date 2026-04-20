import { Command } from "commander";
import path from "node:path";
import { getClientAccount, getClientAccounts, getChannelTargets, getWorkerDefinition, normalizeBlitzPlatformUrl, teamRecipients } from "./config.js";
import type { RunSummary } from "./types.js";
import { clearLeadPipeline, clearSignalsForRun, completeWorkerRun, getDispatchPlan, getPendingSplitRuns, getQueuedReport, getRunFindings, getRunSummaries, initDb, insertRawFindings, insertSignals, listApprovals, markReportSent, markRunSplit, queueShareJob, recordCrmActivity, startWorkerRun, upsertLeads, approveApproval, updateDispatchPlanStatus } from "./lib/db.js";
import { ensureRuntimeDirs, EXPORT_DIR, RAW_DIR, validateWorkflowTemplates, writeJson } from "./lib/fs.js";
import { healthStatuses } from "./lib/providers.js";
import { publishLogs } from "./lib/logs.js";
import { queueClientReport, getQueuedReportPayload } from "./lib/reports.js";
import { splitSignals } from "./lib/scoring.js";
import { executeWorker, expandLeadPool, filterLeadPool, loadLeadSource, normalizeLeadRecords } from "./lib/workers.js";
import { exportLeadsCsv } from "./lib/leadsExport.js";
import {
  packageJoseQueue,
  prepareGeneratedLeadEmails,
  prepareVoiceBatch,
  scoreAndPlanLeads,
  sendSmsFollowUps,
  syncGeneratedLeadsToGhl
} from "./lib/outreach.js";
import { getQueuedAnnouncementPayload, markAnnouncementSent, queueClientContactCompletionAnnouncement } from "./lib/announcements.js";
import { auditBlitzReadiness, planBlitzPostQueue } from "./lib/blitz.js";
import { uploadQueuedShareJobs } from "./lib/drive.js";
import { listVapiAssistants, listVapiPhoneNumbers } from "./lib/vapi.js";
import { exportVapiCreditSnapshot, getVapiCreditStatus } from "./lib/vapiCredits.js";
import { ensureVapiPhonePool } from "./lib/vapiPhonePool.js";
import { apifyPlatformUsageUrl, exportApifyActorDiscovery, exportApifyWorkerHealthDigest } from "./lib/apify.js";

const program = new Command();
program.name("trd-automations");

program
  .command("bootstrap")
  .description("Initialize runtime directories, SQLite schema, and validate YAML templates.")
  .action(() => {
    ensureRuntimeDirs();
    initDb();
    const templates = validateWorkflowTemplates();
    console.log(JSON.stringify({
      ok: true,
      database: path.join(process.cwd(), "data", "trd-automations.sqlite"),
      validatedTemplates: templates
    }, null, 2));
  });

program
  .command("health:check")
  .description("Inspect env-backed providers and placeholder relay targets.")
  .action(() => {
    initDb();
    console.log(JSON.stringify({
      ok: true,
      providers: healthStatuses(),
      channels: getChannelTargets()
    }, null, 2));
  });

program
  .command("worker:run")
  .requiredOption("--client <clientId>", "Client identifier from config/clients.json")
  .option("--worker <workerKey>", "Single worker to run instead of the client's worker set")
  .description("Run monitoring workers and persist normalized raw findings.")
  .action(async (options: { client: string; worker?: string }) => {
    initDb();
    const client = getClientAccount(options.client);
    const workerKeys = options.worker ? [options.worker] : client.workerKeys;
    const summaries: RunSummary[] = [];

    for (const workerKey of workerKeys) {
      const worker = getWorkerDefinition(workerKey);
      const runId = startWorkerRun(client, worker);
      try {
        const result = await executeWorker(client, worker);
        const snapshotPath = path.join(RAW_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${client.id}-${worker.key}.json`);
        writeJson(snapshotPath, result.snapshot);
        insertRawFindings(runId, client.id, worker.key, result.findings);
        const summary: RunSummary = {
          runId,
          clientId: client.id,
          workerKey: worker.key,
          status: "SUCCESS",
          sourceType: worker.source.type,
          itemCount: result.findings.length,
          positiveCount: 0,
          negativeCount: 0,
          snapshotPath
        };
        completeWorkerRun(summary);
        summaries.push(summary);
      } catch (error) {
        const summary: RunSummary = {
          runId,
          clientId: client.id,
          workerKey: worker.key,
          status: "FAILED",
          sourceType: worker.source.type,
          itemCount: 0,
          positiveCount: 0,
          negativeCount: 0,
          errorMessage: error instanceof Error ? error.message : String(error)
        };
        completeWorkerRun(summary);
        summaries.push(summary);
      }
    }

    console.log(JSON.stringify({ ok: true, runs: summaries }, null, 2));
  });

program
  .command("signal:split")
  .requiredOption("--client <clientId>", "Client identifier")
  .option("--worker <workerKey>", "Specific worker key")
  .option("--run-id <runId>", "Specific run identifier")
  .description("Split one normalized raw dataset into positive and negative signal queues.")
  .action((options: { client: string; worker?: string; runId?: string }) => {
    initDb();
    const targets = options.runId
      ? [{ runId: options.runId, workerKey: options.worker ?? inferWorkerKey(options.runId) }]
      : getPendingSplitRuns(options.client, options.worker);
    if (targets.length === 0) {
      throw new Error("No run found to split.");
    }
    const totals = { positive: 0, negative: 0, neutral: 0 };
    for (const target of targets) {
      const worker = getWorkerDefinition(target.workerKey);
      const rawFindings = getRunFindings(target.runId);
      const signals = rawFindings.map((finding) => splitSignals(finding, worker.positiveRules, worker.negativeRules));
      clearSignalsForRun(target.runId);
      insertSignals(target.runId, options.client, worker.key, signals);
      markRunSplit(target.runId);
      totals.positive += signals.filter((entry) => entry.sentiment === "POSITIVE").length;
      totals.negative += signals.filter((entry) => entry.sentiment === "NEGATIVE").length;
      totals.neutral += signals.filter((entry) => entry.sentiment === "NEUTRAL").length;
    }
    console.log(JSON.stringify({
      ok: true,
      splitRuns: targets,
      totals
    }, null, 2));
  });

program
  .command("report:queue")
  .requiredOption("--client <clientId>", "Client identifier")
  .description("Queue a client-facing HTML report for unsent positive findings.")
  .action((options: { client: string }) => {
    initDb();
    const client = getClientAccount(options.client);
    const queued = queueClientReport(client);
    console.log(JSON.stringify(queued ?? { ok: true, message: `No pending positive findings for ${client.id}.` }, null, 2));
  });

program
  .command("report:payload")
  .requiredOption("--client <clientId>", "Client identifier")
  .description("Emit the latest queued Gmail-ready payload.")
  .action((options: { client: string }) => {
    initDb();
    const payload = getQueuedReportPayload(options.client);
    console.log(JSON.stringify(payload ?? { ok: true, message: `No queued report for ${options.client}.` }, null, 2));
  });

program
  .command("report:mark-sent")
  .requiredOption("--client <clientId>", "Client identifier")
  .requiredOption("--report-id <reportId>", "Queued report identifier")
  .option("--message-id <messageId>", "External connector message identifier")
  .description("Mark a queued report as sent after Gmail connector delivery succeeds.")
  .action((options: { client: string; reportId: string; messageId?: string }) => {
    initDb();
    const report = getQueuedReport(options.client);
    if (!report) {
      throw new Error(`No queued report for ${options.client}`);
    }
    if (report.id !== options.reportId) {
      throw new Error(`Report mismatch. Expected ${report.id} but received ${options.reportId}.`);
    }
    markReportSent(options.reportId, report.signalIds, options.messageId);
    console.log(JSON.stringify({ ok: true, reportId: options.reportId, signalCount: report.signalIds.length }, null, 2));
  });

program
  .command("lead:scrape")
  .requiredOption("--client <clientId>", "Client identifier")
  .requiredOption("--worker <workerKey>", "Lead scrape worker key")
  .option("--limit <count>", "Maximum leads to stage", "200")
  .description("Stage Google Business Profile-style leads from a configured worker source.")
  .action(async (options: { client: string; worker: string; limit: string }) => {
    initDb();
    const client = getClientAccount(options.client);
    const worker = getWorkerDefinition(options.worker);
    const source = await loadLeadSource(client, worker, Number(options.limit));
    const filtered = filterLeadPool(client, source.rows);
    const pool = source.sourceType === "apify-actor"
      ? filtered
      : expandLeadPool(filtered, Number(options.limit), client);
    const leads = normalizeLeadRecords(client, worker, pool).slice(0, Number(options.limit));
    clearLeadPipeline(client.id);
    upsertLeads(leads);
    const csvPath = exportLeadsCsv(client.id, worker.key, leads);
    console.log(JSON.stringify({
      ok: true,
      staged: leads.length,
      target: "Jose lead queue",
      policy: client.leadBatchPolicy ?? null,
      leadIds: leads.map((lead) => lead.id),
      csvPath,
      actorRunId: source.actorRunId ?? null,
      actorId: source.actorId ?? null,
      defaultDatasetId: source.defaultDatasetId ?? null,
      usageTotalUsd: source.usageTotalUsd ?? null
    }, null, 2));
  });

program
  .command("apify:healthcheck")
  .option("--queue", "Queue an internal HTML announcement for Gmail delivery")
  .option("--recipient <email>", "Primary digest recipient override")
  .option("--cc <emails>", "Comma-separated CC list")
  .description("Inspect configured Apify workers, recent actor health, and observed platform usage.")
  .action(async (options: { queue?: boolean; recipient?: string; cc?: string }) => {
    initDb();
    const result = await exportApifyWorkerHealthDigest({
      queueAnnouncement: Boolean(options.queue),
      recipient: options.recipient,
      cc: options.cc?.split(",").map((entry) => entry.trim()).filter(Boolean)
    });
    console.log(JSON.stringify({
      ok: true,
      exportPath: result.exportPath,
      shareJobId: result.shareJobId,
      announcementId: result.announcementId ?? null,
      htmlPath: result.htmlPath ?? null,
      consoleUrl: apifyPlatformUsageUrl(),
      digest: result.digest
    }, null, 2));
  });

program
  .command("apify:discover")
  .option("--queue", "Queue an internal HTML announcement for Gmail delivery")
  .option("--recipient <email>", "Primary digest recipient override")
  .option("--cc <emails>", "Comma-separated CC list")
  .description("Scan the Apify store for new actors relevant to TRD local SEO, GBP, reviews, and lead generation.")
  .action(async (options: { queue?: boolean; recipient?: string; cc?: string }) => {
    initDb();
    const result = await exportApifyActorDiscovery({
      queueAnnouncement: Boolean(options.queue),
      recipient: options.recipient,
      cc: options.cc?.split(",").map((entry) => entry.trim()).filter(Boolean)
    });
    console.log(JSON.stringify({
      ok: true,
      exportPath: result.exportPath,
      shareJobId: result.shareJobId,
      announcementId: result.announcementId ?? null,
      htmlPath: result.htmlPath ?? null,
      result: result.result
    }, null, 2));
  });

program
  .command("lead:score")
  .requiredOption("--client <clientId>", "Client identifier")
  .description("Score staged leads and generate approval-gated dispatch previews.")
  .action((options: { client: string }) => {
    initDb();
    const result = scoreAndPlanLeads(options.client);
    upsertLeads(result.scored);
    console.log(JSON.stringify({
      ok: true,
      scored: result.scored.length,
      approvalIds: result.approvalIds,
      planIds: result.planIds
    }, null, 2));
  });

program
  .command("lead:sync-ghl")
  .requiredOption("--client <clientId>", "Client identifier")
  .option("--limit <count>", "Maximum generated leads to sync", "200")
  .description("Sync generated lead-capture records into GHL and tag them for later filtering.")
  .action(async (options: { client: string; limit: string }) => {
    initDb();
    const result = await syncGeneratedLeadsToGhl(options.client, Number(options.limit));
    console.log(JSON.stringify({
      ok: true,
      synced: result.synced,
      failed: result.failed,
      sample: result.leads.slice(0, 5).map((lead) => ({
        id: lead.id,
        company: lead.company,
        ghlContactId: lead.ghlContactId ?? null,
        tags: lead.ghlTags ?? [],
        error: lead.ghlLastError ?? null
      }))
    }, null, 2));
  });

program
  .command("outreach:email-prepare")
  .requiredOption("--client <clientId>", "Client identifier")
  .option("--limit <count>", "Maximum generated leads to prepare", "25")
  .description("Build sleek outbound email HTML and Gmail-ready payloads for generated leads.")
  .action(async (options: { client: string; limit: string }) => {
    initDb();
    const result = await prepareGeneratedLeadEmails(options.client, Number(options.limit));
    console.log(JSON.stringify({
      ok: true,
      prepared: result.prepared,
      suppressed: result.suppressed,
      exportPath: result.exportPath
    }, null, 2));
  });

program
  .command("voice:batch")
  .requiredOption("--client <clientId>", "Client identifier")
  .option("--batch-size <count>", "Max generated leads to assign in one voice rotation", "10")
  .option("--live", "Create assistants, rotate phone numbers, and queue live Vapi calls")
  .description("Analyze the next generated leads, assign up to 10 Vapi slots, and prepare or queue calls.")
  .action(async (options: { client: string; batchSize: string; live?: boolean }) => {
    initDb();
    const result = await prepareVoiceBatch(options.client, Number(options.batchSize), Boolean(options.live));
    console.log(JSON.stringify({
      ok: true,
      batchId: result.batchId,
      selected: result.selected,
      numbersUsed: result.numbersUsed,
      exportPath: result.exportPath,
      live: Boolean(options.live)
    }, null, 2));
  });

program
  .command("sms:followup")
  .requiredOption("--client <clientId>", "Client identifier")
  .option("--limit <count>", "Maximum leads to process", "10")
  .option("--live", "Send live Twilio SMS follow-ups")
  .description("Send or preview comedic post-call SMS follow-ups for generated leads.")
  .action(async (options: { client: string; limit: string; live?: boolean }) => {
    initDb();
    const result = await sendSmsFollowUps(options.client, Number(options.limit), Boolean(options.live));
    console.log(JSON.stringify({
      ok: true,
      processed: result.processed,
      sent: result.sent,
      exportPath: result.exportPath,
      live: Boolean(options.live)
    }, null, 2));
  });

program
  .command("vapi:numbers")
  .description("List Vapi phone numbers available for rotating outbound call batches.")
  .action(async () => {
    initDb();
    console.log(JSON.stringify({
      ok: true,
      phoneNumbers: await listVapiPhoneNumbers()
    }, null, 2));
  });

program
  .command("vapi:numbers:ensure")
  .option("--count <count>", "Desired pool size", "10")
  .option("--area-codes <codes>", "Comma-separated area codes to cycle during creation")
  .description("Create free Vapi phone numbers until the outbound pool reaches the desired size.")
  .action(async (options: { count: string; areaCodes?: string }) => {
    initDb();
    const result = await ensureVapiPhonePool({
      targetCount: Number(options.count),
      areaCodes: options.areaCodes?.split(",").map((entry) => entry.trim()).filter(Boolean),
      createDefaultAssistant: true
    });
    console.log(JSON.stringify({
      ok: true,
      targetCount: result.targetCount,
      existingCount: result.existingCount,
      createdCount: result.createdCount,
      totalCount: result.phoneNumbers.length,
      exportPath: result.exportPath
    }, null, 2));
  });

program
  .command("vapi:assistants")
  .description("List Vapi assistants available to the outbound automation stack.")
  .action(async () => {
    initDb();
    console.log(JSON.stringify({
      ok: true,
      assistants: await listVapiAssistants()
    }, null, 2));
  });

program
  .command("vapi:credits")
  .option("--export", "Write and queue a shareable snapshot")
  .description("Inspect Vapi credits and estimate call runway from recent cost history.")
  .action(async (options: { export?: boolean }) => {
    initDb();
    if (options.export) {
      const result = await exportVapiCreditSnapshot();
      console.log(JSON.stringify({
        ok: true,
        exportPath: result.exportPath,
        shareJobId: result.shareJobId,
        snapshot: result.snapshot
      }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      ok: true,
      snapshot: await getVapiCreditStatus()
    }, null, 2));
  });

program
  .command("approval:list")
  .option("--status <status>", "Filter by status")
  .description("List approval items.")
  .action((options: { status?: "PENDING" | "APPROVED" | "DENIED" }) => {
    initDb();
    console.log(JSON.stringify(listApprovals(options.status), null, 2));
  });

program
  .command("approval:grant")
  .requiredOption("--approval-id <approvalId>", "Approval identifier")
  .option("--approved-by <approvedBy>", "Human approver label", "operator")
  .description("Grant an approval item so the related dispatch plan can proceed.")
  .action((options: { approvalId: string; approvedBy: string }) => {
    initDb();
    approveApproval(options.approvalId, options.approvedBy);
    console.log(JSON.stringify({ ok: true, approvalId: options.approvalId, approvedBy: options.approvedBy }, null, 2));
  });

program
  .command("dispatch:run")
  .requiredOption("--plan-id <planId>", "Dispatch plan identifier")
  .option("--mode <mode>", "preview or live", "preview")
  .description("Preview or execute an approval-gated dispatch plan.")
  .action((options: { planId: string; mode: "preview" | "live" }) => {
    initDb();
    const plan = getDispatchPlan(options.planId);
    if (!plan) throw new Error(`Dispatch plan "${options.planId}" not found.`);
    if (!plan.approvalId) throw new Error(`Dispatch plan "${options.planId}" has no approval gate.`);

    const approval = listApprovals("APPROVED").find((item) => item.id === plan.approvalId);
    if (!approval) {
      updateDispatchPlanStatus(plan.id, "BLOCKED");
      throw new Error(`Dispatch plan "${plan.id}" is blocked until approval "${plan.approvalId}" is granted.`);
    }

    const previewPath = plan.previewPath ?? path.join(EXPORT_DIR, `${plan.id}-dispatch.json`);
    writeJson(previewPath, {
      planId: plan.id,
      channel: plan.channel,
      subject: plan.subject,
      body: plan.body,
      mode: options.mode,
      approvalId: plan.approvalId,
      executedAt: new Date().toISOString(),
      liveExecution: options.mode === "live",
      note: options.mode === "live"
        ? "Live dispatch hook point reached. Connector/provider execution should be attached here."
        : "Preview only. No external message or call was sent."
    });
    queueShareJob(previewPath, teamRecipients(), `Share dispatch run artifact for plan ${plan.id}.`);
    updateDispatchPlanStatus(plan.id, options.mode === "live" ? "DISPATCHED" : "PREVIEWED", previewPath);
    recordCrmActivity(plan.clientId, plan.leadId, "dispatch-preview", `Prepared ${plan.channel} dispatch plan`, {
      planId: plan.id,
      mode: options.mode,
      previewPath
    });
    console.log(JSON.stringify({
      ok: true,
      planId: plan.id,
      mode: options.mode,
      previewPath,
      message: options.mode === "live"
        ? "Dispatch plan marked as live-ready. Attach Gmail/Twilio/Vapi execution here after credential rotation."
        : "Dispatch preview generated without side effects."
    }, null, 2));
  });

program
  .command("log:publish")
  .description("Export run summaries and queue a share job for the TRD team.")
  .action(() => {
    initDb();
    console.log(JSON.stringify(publishLogs(), null, 2));
  });

program
  .command("announce:queue")
  .requiredOption("--type <type>", "Announcement type")
  .option("--recipient <email>", "Primary recipient override")
  .option("--cc <emails>", "Comma-separated CC recipients")
  .option("--blitz-url <url>", "Blitz base URL override")
  .option("--artifact-path <path>", "Artifact path to reference in metadata")
  .description("Queue an HTML internal announcement payload.")
  .action((options: { type: string; recipient?: string; cc?: string; blitzUrl?: string; artifactPath?: string }) => {
    initDb();
    if (options.type !== "client-contact-completion") {
      throw new Error(`Unsupported announcement type "${options.type}".`);
    }
    const queued = queueClientContactCompletionAnnouncement({
      recipient: options.recipient ?? "bishop@truerankdigital.com",
      cc: options.cc?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? ["jon@truerankdigital.com"],
      blitzUrl: options.blitzUrl ?? normalizeBlitzPlatformUrl(),
      artifactPath: options.artifactPath
    });
    console.log(JSON.stringify({ ok: true, ...queued }, null, 2));
  });

program
  .command("announce:payload")
  .requiredOption("--announcement-id <announcementId>", "Queued announcement identifier")
  .description("Emit the latest queued Gmail-ready announcement payload.")
  .action((options: { announcementId: string }) => {
    initDb();
    const payload = getQueuedAnnouncementPayload(options.announcementId);
    console.log(JSON.stringify(payload ?? { ok: true, message: `No queued announcement for ${options.announcementId}.` }, null, 2));
  });

program
  .command("announce:mark-sent")
  .requiredOption("--announcement-id <announcementId>", "Queued announcement identifier")
  .option("--message-id <messageId>", "External connector message identifier")
  .description("Mark a queued announcement as sent after Gmail connector delivery succeeds.")
  .action((options: { announcementId: string; messageId?: string }) => {
    initDb();
    markAnnouncementSent(options.announcementId, options.messageId);
    console.log(JSON.stringify({ ok: true, announcementId: options.announcementId }, null, 2));
  });

program
  .command("contacts:audit")
  .option("--client <clientId>", "Single client identifier")
  .description("Audit which configured clients are missing primary contact data for positive-findings reports.")
  .action((options: { client?: string }) => {
    initDb();
    const clients = options.client ? [getClientAccount(options.client)] : getClientAccounts();
    const rows = clients.map((client) => ({
      clientId: client.id,
      clientName: client.name,
      hasPrimaryContact: Boolean(client.primaryContactEmail),
      primaryContactName: client.primaryContactName ?? null,
      primaryContactEmail: client.primaryContactEmail ?? null,
      cc: client.contactCc ?? [],
      status: client.primaryContactEmail ? "READY" : "CONTACT_SETUP_NEEDED"
    }));
    console.log(JSON.stringify({
      ok: true,
      totalClients: rows.length,
      ready: rows.filter((row) => row.status === "READY").length,
      missing: rows.filter((row) => row.status === "CONTACT_SETUP_NEEDED").length,
      rows
    }, null, 2));
  });

program
  .command("blitz:readiness")
  .option("--client <clientFilter>", "Exact Blitz client id or name")
  .description("Audit live Blitz readiness via Supabase and queue an internal summary announcement.")
  .action(async (options: { client?: string }) => {
    initDb();
    console.log(JSON.stringify(await auditBlitzReadiness(options.client), null, 2));
  });

program
  .command("blitz:post-plan")
  .requiredOption("--client <clientId>", "Local client identifier")
  .description("Create a local plan for Blitz-native GBP post queueing using the live readiness model.")
  .action(async (options: { client: string }) => {
    initDb();
    const client = getClientAccount(options.client);
    console.log(JSON.stringify(await planBlitzPostQueue(client), null, 2));
  });

program
  .command("share:drive")
  .option("--job-id <shareJobId>", "Optional single queued share job identifier")
  .description("Upload queued artifacts to Drive and share them with the TRD team.")
  .action(async (options: { jobId?: string }) => {
    initDb();
    console.log(JSON.stringify({
      ok: true,
      results: await uploadQueuedShareJobs(options.jobId)
    }, null, 2));
  });

program
  .command("jose:queue")
  .requiredOption("--client <clientId>", "Client identifier")
  .description("Package the top scored tri-state lead batch for Jose.")
  .action((options: { client: string }) => {
    initDb();
    console.log(JSON.stringify({
      ok: true,
      ...packageJoseQueue(options.client)
    }, null, 2));
  });

program.parseAsync(process.argv);

function inferWorkerKey(runId: string): string {
  const matched = getRunSummaries().find((entry) => entry.runId === runId);
  if (!matched) {
    throw new Error(`Could not infer worker key for run "${runId}".`);
  }
  return matched.workerKey;
}
