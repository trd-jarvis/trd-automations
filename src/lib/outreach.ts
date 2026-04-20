import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getClientAccount, resolvedBookingUrl, teamRecipients } from "../config.js";
import type { ClientAccount, DispatchChannel, LeadRecord } from "../types.js";
import { createApproval, createDispatchPlan, getLeads, queueShareJob, updateDispatchPlanStatus, upsertLeads } from "./db.js";
import { generateGeminiText } from "./gemini.js";
import { EXPORT_DIR, REPORT_DIR, writeJson } from "./fs.js";
import { syncGeneratedLeadToGhl } from "./ghl.js";
import { computeLeadScores } from "./scoring.js";
import { sendTwilioSms } from "./twilio.js";
import {
  attachAssistantToPhoneNumber,
  createOutboundCall,
  createProspectAssistant,
  listVapiPhoneNumbers
} from "./vapi.js";

const STATUS_ORDER: LeadRecord["status"][] = [
  "STAGED",
  "SCORED",
  "APPROVAL_PENDING",
  "READY",
  "GHL_SYNCED",
  "ANALYZED",
  "EMAIL_READY",
  "VOICE_READY",
  "CALL_QUEUED",
  "SMS_READY",
  "SMS_SENT",
  "DISPATCHED"
];

function stageLead(lead: LeadRecord, nextStatus: LeadRecord["status"]): LeadRecord {
  const currentIndex = STATUS_ORDER.indexOf(lead.status);
  const nextIndex = STATUS_ORDER.indexOf(nextStatus);
  return {
    ...lead,
    status: nextIndex > currentIndex ? nextStatus : lead.status,
    updatedAt: new Date().toISOString()
  };
}

function bestChannel(lead: LeadRecord): DispatchChannel {
  if (lead.email) return "email";
  if (lead.phone) return "voice";
  return "sms";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

function buildSubject(lead: LeadRecord): string {
  const market = [lead.city, lead.state].filter(Boolean).join(", ");
  return clip(`${lead.company} is leaving AI search visibility on the table${market ? ` in ${market}` : ""}`, 86);
}

function buildBody(lead: LeadRecord): string {
  const summary = lead.negativeAnalysis?.summary ?? "We found a few authority and visibility gaps.";
  const issueLine = lead.negativeAnalysis?.issues?.length
    ? `Top gaps: ${lead.negativeAnalysis.issues.slice(0, 3).join("; ")}.`
    : `Top gaps: ${lead.weaknessSignals.join(", ") || "review depth, AI visibility, and authority signals"}.`;
  return [
    `Hi,`,
    ``,
    `I took a look at ${lead.company} and noticed a few easy-to-miss issues that are making AI search and local visibility work harder than they should.`,
    summary,
    issueLine,
    `Not trying to write you a dramatic breakup letter from Google, but there is real cleanup opportunity here.`,
    `If you want, I can send over the short version and show you what we would fix first.`,
    ``,
    `Jarvis`,
    `True Rank Digital`
  ].join("\n");
}

function heuristicAnalysis(client: ClientAccount, lead: LeadRecord): NonNullable<LeadRecord["negativeAnalysis"]> {
  const issues = [
    ...lead.weaknessSignals.slice(0, 4),
    lead.reviewCount !== null && lead.reviewCount !== undefined && lead.reviewCount < 30
      ? "thin review volume weakens trust signals"
      : "",
    lead.rating !== null && lead.rating !== undefined && lead.rating < 4.3
      ? "rating signal is soft enough to suppress click confidence"
      : "",
    lead.website ? "site likely lacks entity clarity for AI retrieval" : "no usable website surfaced for entity verification"
  ].filter(Boolean);

  const market = [lead.city, lead.state].filter(Boolean).join(", ") || "the local market";
  return {
    summary: `${lead.company} looks under-positioned for AI search in ${market}, with authority signals weaker than they should be for a ${client.primaryOffer ?? "high-intent lead gen"} sale.`,
    issues: issues.slice(0, 4),
    emailAngle: `Keep it sharp: point out the AI visibility gap, make one joke, and offer a short walkthrough.`,
    voiceBrief: `Lead with the AI search gap, mention one or two concrete misses, and try to book a quick strategy call instead of doing a full audit.`,
    smsAngle: `Reference the email, keep it light, and drive them to the booking link.`,
    severityScore: Math.max(45, Math.min(92, lead.weaknessScore + Math.round(lead.qualificationScore / 3)))
  };
}

async function analyzeLead(client: ClientAccount, lead: LeadRecord): Promise<LeadRecord> {
  if (lead.negativeAnalysisStatus === "READY" && lead.negativeAnalysis) {
    return lead;
  }

  const fallback = heuristicAnalysis(client, lead);
  try {
    const prompt = [
      "You are creating concise outbound prospecting analysis for a local SEO + AI visibility agency.",
      "Return strict JSON with keys: summary, issues, emailAngle, voiceBrief, smsAngle, severityScore.",
      `Agency context: ${client.primaryOffer ?? "AI visibility optimization and local lead generation"}.`,
      `Lead company: ${lead.company}`,
      `Lead market: ${lead.city ?? ""} ${lead.state ?? ""}`.trim(),
      `Website: ${lead.website ?? "unknown"}`,
      `Weakness signals: ${lead.weaknessSignals.join(", ") || "none captured"}`,
      `Rating: ${lead.rating ?? "unknown"}`,
      `Review count: ${lead.reviewCount ?? "unknown"}`,
      "Constraints: keep the summary under 55 words, issues to 3-5 concise bullet-style strings, slightly witty but not cringe, no mention of being AI."
    ].join("\n");
    const raw = await generateGeminiText({
      prompt,
      responseMimeType: "application/json"
    });
    const parsed = JSON.parse(raw) as NonNullable<LeadRecord["negativeAnalysis"]>;
    const analyzed = {
      ...lead,
      negativeAnalysisStatus: "READY" as const,
      negativeAnalysis: {
        summary: clip(parsed.summary || fallback.summary, 280),
        issues: Array.isArray(parsed.issues) && parsed.issues.length > 0 ? parsed.issues.slice(0, 5) : fallback.issues,
        emailAngle: parsed.emailAngle || fallback.emailAngle,
        voiceBrief: parsed.voiceBrief || fallback.voiceBrief,
        smsAngle: parsed.smsAngle || fallback.smsAngle,
        severityScore: Number.isFinite(parsed.severityScore) ? Math.max(1, Math.min(100, Math.round(parsed.severityScore))) : fallback.severityScore
      },
      negativeAnalysisGeneratedAt: new Date().toISOString()
    };
    return stageLead(analyzed, "ANALYZED");
  } catch {
    return stageLead({
      ...lead,
      negativeAnalysisStatus: "READY",
      negativeAnalysis: fallback,
      negativeAnalysisGeneratedAt: new Date().toISOString()
    }, "ANALYZED");
  }
}

function emailHtml(client: ClientAccount, lead: LeadRecord): string {
  const bookingUrl = resolvedBookingUrl();
  const summary = escapeHtml(lead.negativeAnalysis?.summary ?? "We found authority and visibility gaps worth fixing.");
  const issues = (lead.negativeAnalysis?.issues ?? lead.weaknessSignals).slice(0, 4);
  const buttons = [
    bookingUrl ? `<a href="${bookingUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0d5c63;color:#ffffff;text-decoration:none;font-weight:600;">Book A Quick Walkthrough</a>` : "",
    lead.website ? `<a href="${lead.website}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#eff6f3;color:#0f172a;text-decoration:none;font-weight:600;">View Your Site</a>` : ""
  ].filter(Boolean).join("&nbsp;");

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f0e8;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:720px;margin:0 auto;padding:32px 20px;">
      <div style="background:linear-gradient(135deg,#fff9f2,#edf7f4);border:1px solid #d9e6df;border-radius:28px;padding:32px;">
        <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#0d5c63;font-weight:700;">True Rank Digital</div>
        <h1 style="margin:14px 0 8px;font-size:34px;line-height:1.05;">${escapeHtml(lead.company)} has a few AI visibility leaks.</h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#334155;">${summary}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
          <div style="flex:1;min-width:180px;background:#ffffff;border-radius:18px;padding:18px;border:1px solid #e2e8f0;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">Severity</div>
            <div style="font-size:30px;font-weight:700;margin-top:8px;">${lead.negativeAnalysis?.severityScore ?? lead.weaknessScore}</div>
          </div>
          <div style="flex:1;min-width:180px;background:#ffffff;border-radius:18px;padding:18px;border:1px solid #e2e8f0;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">Market</div>
            <div style="font-size:18px;font-weight:700;margin-top:10px;">${escapeHtml([lead.city, lead.state].filter(Boolean).join(", ") || "Local Search")}</div>
          </div>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;padding:22px;margin-bottom:24px;">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;margin-bottom:12px;">What stood out</div>
          <ul style="padding-left:20px;margin:0;">
            ${issues.map((issue) => `<li style="margin:0 0 10px;line-height:1.5;">${escapeHtml(issue)}</li>`).join("")}
          </ul>
        </div>
        <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#334155;">
          Short version: there is fixable demand slipping through the cracks here. The dramatic part is only what Google is doing, not this email.
        </p>
        <div>${buttons}</div>
        <p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:#475569;">
          Jarvis<br/>True Rank Digital
        </p>
      </div>
    </div>
  </body>
</html>`;
}

function buildVoiceSystemPrompt(client: ClientAccount, lead: LeadRecord): string {
  const analysis = lead.negativeAnalysis ?? heuristicAnalysis(client, lead);
  const bookingUrl = resolvedBookingUrl() ?? "";
  return [
    "You are Jarvis with True Rank Digital doing outbound prospecting.",
    "Sound direct, natural, quick, and slightly witty. Do not sound like a script robot.",
    "Never disclose that you are AI.",
    "Goal: book a short strategy call, not a full audit on the phone.",
    "Keep the conversation under 3 minutes.",
    `Lead company: ${lead.company}.`,
    `Lead market: ${[lead.city, lead.state].filter(Boolean).join(", ") || "local market"}.`,
    `Key negative AI visibility summary: ${analysis.summary}`,
    `Priority issues: ${analysis.issues.join("; ")}`,
    `Offer context: ${client.primaryOffer ?? "AI visibility optimization and local lead generation"}.`,
    "If they show interest, tell them a booking link can be texted over and that a team member may reach out beforehand.",
    bookingUrl ? `Booking link: ${bookingUrl}` : "Booking link will be handled separately."
  ].join("\n");
}

function buildVoiceFirstMessage(lead: LeadRecord): string {
  const market = [lead.city, lead.state].filter(Boolean).join(", ");
  return clip(`Hi, this is Jarvis with True Rank Digital. Quick question about ${lead.company}${market ? ` in ${market}` : ""} and how it is showing up in AI search right now.`, 220);
}

function buildSmsBody(client: ClientAccount, lead: LeadRecord): string {
  const bookingUrl = resolvedBookingUrl();
  const market = [lead.city, lead.state].filter(Boolean).join(", ");
  const gap = lead.negativeAnalysis?.issues?.[0] ?? lead.weaknessSignals[0] ?? "a few AI visibility gaps";
  return clip(
    `Hey ${lead.company}${market ? ` in ${market}` : ""} team, I just tried calling and also sent an email. Short version: ${gap}. Nothing is on fire, but Google is definitely freelancing a bit. If you want the quick walkthrough, book here: ${bookingUrl ?? "booking link pending"}. A team member may reach out before the meeting.`,
    600
  );
}

export function scoreAndPlanLeads(clientId: string): { scored: LeadRecord[]; approvalIds: string[]; planIds: string[] } {
  const leads = getLeads(clientId).map((lead) => computeLeadScores(lead));
  const approvalIds: string[] = [];
  const planIds: string[] = [];

  for (const lead of leads) {
    const channel = bestChannel(lead);
    const approvalId = createApproval(lead.id, lead.clientId, channel, `Approve ${channel} outreach for ${lead.company}`);
    approvalIds.push(approvalId);
    const previewPath = path.join(EXPORT_DIR, `${lead.id}-dispatch-preview.json`);
    writeJson(previewPath, {
      leadId: lead.id,
      company: lead.company,
      channel,
      subject: channel === "email" ? buildSubject(lead) : undefined,
      body: buildBody(lead),
      createdAt: new Date().toISOString()
    });
    queueShareJob(previewPath, teamRecipients(), `Share dispatch preview for ${lead.company}.`);
    const planId = createDispatchPlan({
      leadId: lead.id,
      clientId: lead.clientId,
      channel,
      subject: channel === "email" ? buildSubject(lead) : undefined,
      body: buildBody(lead),
      nextAction: "Review the preview, then grant approval before any live send.",
      status: "AWAITING_APPROVAL",
      approvalId,
      previewPath
    });
    planIds.push(planId);
  }

  return { scored: leads, approvalIds, planIds };
}

export function previewDispatch(planId: string, previewPath: string): void {
  updateDispatchPlanStatus(planId, "PREVIEWED", previewPath);
}

export async function syncGeneratedLeadsToGhl(
  clientId: string,
  limit = 200
): Promise<{ synced: number; failed: number; leads: LeadRecord[] }> {
  const client = getClientAccount(clientId);
  const leads = getLeads(clientId).slice(0, limit);
  const updated: LeadRecord[] = [];
  let synced = 0;
  let failed = 0;

  for (const lead of leads) {
    const result = await syncGeneratedLeadToGhl(client, lead);
    if (result.synced) synced += 1;
    else failed += 1;
    updated.push({
      ...stageLead(lead, result.synced ? "GHL_SYNCED" : lead.status),
      ghlContactId: result.contactId ?? lead.ghlContactId,
      ghlTags: result.tags,
      ghlSyncedAt: result.synced ? new Date().toISOString() : lead.ghlSyncedAt ?? null,
      ghlLastError: result.synced ? null : result.error ?? "Unknown GHL sync failure"
    });
  }

  upsertLeads(updated);
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${clientId}-ghl-sync.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId,
    synced,
    failed,
    leads: updated.map((lead) => ({
      id: lead.id,
      company: lead.company,
      ghlContactId: lead.ghlContactId ?? null,
      tags: lead.ghlTags ?? [],
      error: lead.ghlLastError ?? null
    }))
  });
  queueShareJob(exportPath, teamRecipients(), `Share GHL sync summary for ${client.name}.`);
  return { synced, failed, leads: updated };
}

export async function prepareGeneratedLeadEmails(
  clientId: string,
  limit = 25
): Promise<{ prepared: number; suppressed: number; exportPath: string; leads: LeadRecord[] }> {
  const client = getClientAccount(clientId);
  const leads = getLeads(clientId)
    .filter((lead) => lead.leadSource === "generated")
    .sort((left, right) => right.qualificationScore - left.qualificationScore || right.weaknessScore - left.weaknessScore)
    .slice(0, limit);

  const updated: LeadRecord[] = [];
  let prepared = 0;
  let suppressed = 0;

  for (const lead of leads) {
    const analyzed = await analyzeLead(client, lead);
    if (!analyzed.email) {
      updated.push(analyzed);
      suppressed += 1;
      continue;
    }
    const htmlPath = path.join(REPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${analyzed.id}-outbound-email.html`);
    const payloadPath = path.join(EXPORT_DIR, `${analyzed.id}-email-payload.json`);
    const subject = buildSubject(analyzed);
    const body = buildBody(analyzed);
    writeJson(payloadPath, {
      to: analyzed.email,
      cc: [],
      subject,
      htmlPath,
      preparedAt: new Date().toISOString()
    });
    const html = emailHtml(client, analyzed);
    writeFileSync(htmlPath, html, "utf8");
    queueShareJob(htmlPath, teamRecipients(), `Share outbound email HTML for ${analyzed.company}.`);
    queueShareJob(payloadPath, teamRecipients(), `Share outbound email payload for ${analyzed.company}.`);
    updated.push(stageLead({
      ...analyzed,
      emailSubject: subject,
      emailBody: body,
      emailHtmlPath: htmlPath,
      emailPayloadPath: payloadPath,
      emailPreparedAt: new Date().toISOString()
    }, "EMAIL_READY"));
    prepared += 1;
  }

  upsertLeads(updated);
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${clientId}-email-prep.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId,
    prepared,
    suppressed,
    leads: updated.map((lead) => ({
      id: lead.id,
      company: lead.company,
      email: lead.email ?? null,
      emailHtmlPath: lead.emailHtmlPath ?? null,
      emailPayloadPath: lead.emailPayloadPath ?? null,
      analysisSummary: lead.negativeAnalysis?.summary ?? null
    }))
  });
  queueShareJob(exportPath, teamRecipients(), `Share outbound email prep summary for ${client.name}.`);
  return { prepared, suppressed, exportPath, leads: updated };
}

export async function prepareVoiceBatch(
  clientId: string,
  batchSize = 10,
  live = false
): Promise<{ batchId: string; selected: number; numbersUsed: number; exportPath: string; leads: LeadRecord[] }> {
  const client = getClientAccount(clientId);
  const nextLeads = getLeads(clientId)
    .filter((lead) => lead.leadSource === "generated" && Boolean(lead.phone) && lead.voiceStatus !== "QUEUED")
    .sort((left, right) => right.qualificationScore - left.qualificationScore || right.weaknessScore - left.weaknessScore)
    .slice(0, Math.min(10, Math.max(1, batchSize)));

  const phoneNumbers = await listVapiPhoneNumbers().catch(() => []);
  if (live && phoneNumbers.length === 0) {
    throw new Error("No Vapi phone numbers are available for live voice dispatch.");
  }

  const batchId = `voice-${randomUUID()}`;
  const updated: LeadRecord[] = [];
  const exportRows: Array<Record<string, unknown>> = [];

  for (const [index, lead] of nextLeads.entries()) {
    const analyzed = await analyzeLead(client, lead);
    const phoneNumber = phoneNumbers[index];
    let assistantId = analyzed.voiceAssistantId ?? null;
    let callId = analyzed.voiceCallId ?? null;

    if (live) {
      const assistant = await createProspectAssistant({
        name: `${lead.company}`.slice(0, 28),
        firstMessage: buildVoiceFirstMessage(analyzed),
        systemPrompt: buildVoiceSystemPrompt(client, analyzed),
        metadata: {
          clientId,
          leadId: analyzed.id,
          batchId
        }
      });
      assistantId = assistant.id;
      if (phoneNumber?.id) {
        await attachAssistantToPhoneNumber(phoneNumber.id, assistantId);
      }
      const call = await createOutboundCall(analyzed, {
        assistantId,
        phoneNumberId: phoneNumber?.id,
        additionalVariables: {
          leadFindings: analyzed.negativeAnalysis?.issues.join("; ") ?? analyzed.weaknessSignals.join("; "),
          bookingUrl: resolvedBookingUrl() ?? ""
        }
      });
      callId = call.id;
    }

    const preparedLead = stageLead({
      ...analyzed,
      voiceBatchId: batchId,
      voiceSlotIndex: index + 1,
      voicePhoneNumberId: phoneNumber?.id ?? null,
      voiceAssistantId: assistantId,
      voiceCallId: callId,
      voiceStatus: live ? "QUEUED" : "READY",
      voicePreparedAt: new Date().toISOString(),
      voiceCalledAt: live ? new Date().toISOString() : analyzed.voiceCalledAt ?? null
    }, live ? "CALL_QUEUED" : "VOICE_READY");
    updated.push(preparedLead);
    exportRows.push({
      leadId: preparedLead.id,
      company: preparedLead.company,
      phone: preparedLead.phone ?? null,
      slot: index + 1,
      phoneNumberId: preparedLead.voicePhoneNumberId,
      assistantId: preparedLead.voiceAssistantId,
      callId: preparedLead.voiceCallId,
      summary: preparedLead.negativeAnalysis?.summary ?? null,
      issues: preparedLead.negativeAnalysis?.issues ?? []
    });
  }

  upsertLeads(updated);
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${clientId}-${batchId}.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId,
    batchId,
    live,
    selected: updated.length,
    numbersUsed: Math.min(updated.length, phoneNumbers.length),
    assignments: exportRows
  });
  queueShareJob(exportPath, teamRecipients(), `Share voice batch plan for ${client.name}.`);
  return {
    batchId,
    selected: updated.length,
    numbersUsed: Math.min(updated.length, phoneNumbers.length),
    exportPath,
    leads: updated
  };
}

export async function sendSmsFollowUps(
  clientId: string,
  limit = 10,
  live = false
): Promise<{ processed: number; sent: number; exportPath: string; leads: LeadRecord[] }> {
  const client = getClientAccount(clientId);
  const leads = getLeads(clientId)
    .filter((lead) =>
      lead.leadSource === "generated" &&
      Boolean(lead.phone) &&
      (lead.voiceStatus === "QUEUED" || lead.voiceStatus === "READY") &&
      lead.smsStatus !== "SENT"
    )
    .sort((left, right) => (right.voicePreparedAt ?? "").localeCompare(left.voicePreparedAt ?? ""))
    .slice(0, limit);

  const updated: LeadRecord[] = [];
  const exportRows: Array<Record<string, unknown>> = [];
  let sent = 0;

  for (const lead of leads) {
    const analyzed = await analyzeLead(client, lead);
    const smsBody = buildSmsBody(client, analyzed);
    let sid: string | null = null;
    if (live) {
      const result = await sendTwilioSms({ to: analyzed.phone ?? "", body: smsBody });
      sid = result.sid ?? null;
      sent += 1;
    }

    const staged = stageLead({
      ...analyzed,
      smsBody,
      smsStatus: live ? "SENT" : "READY",
      smsSid: sid,
      smsSentAt: live ? new Date().toISOString() : analyzed.smsSentAt ?? null
    }, live ? "SMS_SENT" : "SMS_READY");
    updated.push(staged);
    exportRows.push({
      leadId: staged.id,
      company: staged.company,
      phone: staged.phone ?? null,
      live,
      sid: staged.smsSid,
      smsBody: staged.smsBody
    });
  }

  upsertLeads(updated);
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${clientId}-sms-followup.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId,
    live,
    processed: updated.length,
    sent,
    leads: exportRows
  });
  queueShareJob(exportPath, teamRecipients(), `Share SMS follow-up summary for ${client.name}.`);
  return {
    processed: updated.length,
    sent,
    exportPath,
    leads: updated
  };
}

export function packageJoseQueue(clientId: string): { exportPath: string; stagedCount: number; callReadyCount: number; shareJobId: string } {
  const client = getClientAccount(clientId);
  const leads = getLeads(clientId)
    .filter((lead) => lead.status === "APPROVAL_PENDING" || lead.status === "READY" || lead.status === "GHL_SYNCED" || lead.status === "EMAIL_READY")
    .sort((left, right) => right.qualificationScore - left.qualificationScore || right.weaknessScore - left.weaknessScore);

  const callReady = leads.filter((lead) => lead.phone).slice(0, client.leadBatchPolicy?.batchSize ?? 200);
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${clientId}-jose-queue.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId,
    policy: client.leadBatchPolicy ?? null,
    leadCount: leads.length,
    callReadyCount: callReady.length,
    leads: callReady.map((lead) => ({
      id: lead.id,
      company: lead.company,
      city: lead.city,
      state: lead.state,
      website: lead.website,
      phone: lead.phone,
      email: lead.email,
      weaknessSignals: lead.weaknessSignals,
      weaknessScore: lead.weaknessScore,
      qualificationScore: lead.qualificationScore,
      recommendedChannel: lead.recommendedChannel,
      ghlContactId: lead.ghlContactId ?? null,
      callNote: `Lead is tri-state ${lead.state ?? ""}, ${client.leadBatchPolicy?.marketTier ?? "high-ticket"} focused, and weak on ${lead.weaknessSignals.join(", ")}.`
    }))
  });
  const shareJobId = queueShareJob(exportPath, teamRecipients(), `Share Jose queue package for ${client.name}.`);
  return {
    exportPath,
    stagedCount: leads.length,
    callReadyCount: callReady.length,
    shareJobId
  };
}
