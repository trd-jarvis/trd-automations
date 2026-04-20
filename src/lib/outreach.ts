import { execFileSync } from "node:child_process";
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
  return clip(`AI Search Readiness for ${lead.company}`, 86);
}

function buildBody(lead: LeadRecord): string {
  return [
    `Hey ${lead.company} team,`,
    ``,
    `I wanted to send this over before I call so you have quick context.`,
    `Traditional search is evolving fast. If your business is not optimized to be cited by AI engines and smart assistants, you miss a growing share of ready-to-buy local demand.`,
    `True Rank Digital focuses on AI search readiness so when customers ask AI for the best local option, your business has a better chance to be the answer.`,
    `If you want the quick version first, grab 10 minutes here: ${resolvedBookingUrl() ?? "booking link pending"}`,
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
  const greeting = escapeHtml(`${lead.company} team`);
  const bookingUrlEscaped = bookingUrl ? escapeHtml(bookingUrl) : "booking link pending";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Touch 1 - Warm Intro</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="text-align:center;padding:24px 0 8px;">
    <img src="https://lh3.googleusercontent.com/p/AF1QipMXo3XQgG0YvEAEXvebt5fvZ8vIm-2G5DGgea0Y=s680-w680-h510-rw" alt="True Rank Digital" style="display:block;margin:0 auto;max-width:180px;width:180px;height:auto;" />
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px 14px;background:#0f766e;color:#ffffff;">
              <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.8;">True Rank Digital</div>
              <div style="font-size:24px;line-height:1.2;font-weight:700;margin-top:10px;">AI Search Readiness</div>
              <div style="font-size:14px;line-height:1.6;opacity:0.92;margin-top:8px;">Making sure you show up when customers ask AI.</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Hey ${greeting},</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">I wanted to send this over before I call so you have quick context. I’ll keep it brief.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">As search keeps shifting, businesses that are not optimized to be cited by AI engines and smart assistants are getting left out of a growing wave of ready-to-buy local demand.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">At True Rank Digital, we go beyond outdated SEO. We build your digital authority so that when people ask AI for the best local services, <strong>your business has a better chance to be the answer.</strong></p>
              <p style="margin:0 0 22px;font-size:16px;line-height:1.7;">If you want the quick assessment before we connect, grab 10 minutes on my calendar here:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
                <tr>
                  <td style="border-radius:999px;background:#0f766e;">
                    <a href="${bookingUrlEscaped}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Book with Jarvis</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#4b5563;">Booking page:</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.7;"><a href="${bookingUrlEscaped}" style="color:#0f766e;text-decoration:underline;">${bookingUrlEscaped}</a></p>
              <div style="font-size:14px;line-height:1.7;color:#111827;">
                <strong>Jarvis</strong><br />
                True Rank Digital<br />
                908-416-3008
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

interface PreparedLeadEmail {
  analyzed: LeadRecord;
  subject: string;
  body: string;
  html: string;
  htmlPath: string;
  payloadPath: string;
  preparedAt: string;
}

interface GogSendResult {
  messageId: string | null;
  raw: Record<string, unknown> | null;
}

function extractMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = [record.messageId, record.gmailMessageId, record.id]
    .find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof direct === "string") return direct;
  for (const nested of Object.values(record)) {
    const candidate = extractMessageId(nested);
    if (candidate) return candidate;
  }
  return null;
}

function sendLeadEmailViaGog(input: {
  recipient: string;
  subject: string;
  body: string;
  html: string;
  account?: string;
  from?: string;
}): GogSendResult {
  const args = [
    "send",
    "--json",
    "--no-input",
    `--to=${input.recipient}`,
    `--subject=${input.subject}`,
    `--body=${input.body}`,
    `--body-html=${input.html}`
  ];
  if (input.account) args.push(`--account=${input.account}`);
  if (input.from) args.push(`--from=${input.from}`);
  const raw = execFileSync("gog", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  }).trim();
  const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  return {
    messageId: extractMessageId(parsed),
    raw: parsed
  };
}

async function prepareLeadEmail(client: ClientAccount, lead: LeadRecord): Promise<PreparedLeadEmail | null> {
  const analyzed = await analyzeLead(client, lead);
  if (!analyzed.email) return null;
  const preparedAt = new Date().toISOString();
  const htmlPath = path.join(REPORT_DIR, `${preparedAt.replaceAll(":", "-")}-${analyzed.id}-outbound-email.html`);
  const payloadPath = path.join(EXPORT_DIR, `${analyzed.id}-email-payload.json`);
  const subject = buildSubject(analyzed);
  const body = buildBody(analyzed);
  const html = emailHtml(client, analyzed);
  writeFileSync(htmlPath, html, "utf8");
  writeJson(payloadPath, {
    to: analyzed.email,
    cc: [],
    subject,
    htmlPath,
    preparedAt
  });
  queueShareJob(htmlPath, teamRecipients(), `Share outbound email HTML for ${analyzed.company}.`);
  queueShareJob(payloadPath, teamRecipients(), `Share outbound email payload for ${analyzed.company}.`);
  return {
    analyzed,
    subject,
    body,
    html,
    htmlPath,
    payloadPath,
    preparedAt
  };
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
    const preparedEmail = await prepareLeadEmail(client, lead);
    if (!preparedEmail) {
      const analyzed = await analyzeLead(client, lead);
      updated.push(analyzed);
      suppressed += 1;
      continue;
    }
    updated.push(stageLead({
      ...preparedEmail.analyzed,
      emailSubject: preparedEmail.subject,
      emailBody: preparedEmail.body,
      emailHtmlPath: preparedEmail.htmlPath,
      emailPayloadPath: preparedEmail.payloadPath,
      emailPreparedAt: preparedEmail.preparedAt
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

export async function sendGeneratedLeadEmails(
  clientId: string,
  options: {
    limit?: number;
    account?: string;
    from?: string;
    toOverride?: string;
  } = {}
): Promise<{ sent: number; suppressed: number; exportPath: string; leads: LeadRecord[] }> {
  const client = getClientAccount(clientId);
  const limit = Math.max(1, options.limit ?? 200);
  const leads = getLeads(clientId)
    .filter((lead) => lead.leadSource === "generated" && Boolean(lead.email) && !lead.emailSentAt)
    .sort((left, right) => right.qualificationScore - left.qualificationScore || right.weaknessScore - left.weaknessScore)
    .slice(0, limit);

  const updated: LeadRecord[] = [];
  const exportRows: Array<Record<string, unknown>> = [];
  let sent = 0;
  let suppressed = 0;

  for (const lead of leads) {
    const preparedEmail = await prepareLeadEmail(client, lead);
    if (!preparedEmail?.analyzed.email) {
      suppressed += 1;
      continue;
    }

    const recipient = options.toOverride ?? preparedEmail.analyzed.email;
    const sentAt = new Date().toISOString();
    const result = sendLeadEmailViaGog({
      recipient,
      subject: preparedEmail.subject,
      body: preparedEmail.body,
      html: preparedEmail.html,
      account: options.account,
      from: options.from
    });

    exportRows.push({
      leadId: preparedEmail.analyzed.id,
      company: preparedEmail.analyzed.company,
      originalRecipient: preparedEmail.analyzed.email,
      deliveredTo: recipient,
      subject: preparedEmail.subject,
      htmlPath: preparedEmail.htmlPath,
      payloadPath: preparedEmail.payloadPath,
      messageId: result.messageId,
      sentAt
    });

    if (!options.toOverride) {
      updated.push(stageLead({
        ...preparedEmail.analyzed,
        emailSubject: preparedEmail.subject,
        emailBody: preparedEmail.body,
        emailHtmlPath: preparedEmail.htmlPath,
        emailPayloadPath: preparedEmail.payloadPath,
        emailPreparedAt: preparedEmail.preparedAt,
        emailSentAt: sentAt,
        emailMessageId: result.messageId
      }, "EMAIL_READY"));
    }

    sent += 1;
  }

  if (updated.length > 0) {
    upsertLeads(updated);
  }

  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${clientId}-email-send.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId,
    sent,
    suppressed,
    overrideRecipient: options.toOverride ?? null,
    leads: exportRows
  });
  queueShareJob(exportPath, teamRecipients(), `Share outbound email send summary for ${client.name}.`);
  return { sent, suppressed, exportPath, leads: updated };
}

export async function prepareVoiceBatch(
  clientId: string,
  batchSize = 10,
  live = false
): Promise<{ batchId: string; selected: number; numbersUsed: number; exportPath: string; leads: LeadRecord[] }> {
  const client = getClientAccount(clientId);
  const nextLeads = getLeads(clientId)
    .filter((lead) => (
      lead.leadSource === "generated"
      && Boolean(lead.phone)
      && lead.voiceStatus !== "QUEUED"
      && (!lead.email || Boolean(lead.emailSentAt))
    ))
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
