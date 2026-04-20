import path from "node:path";
import { getClientAccount, teamRecipients } from "../config.js";
import { computeLeadScores } from "./scoring.js";
import { EXPORT_DIR } from "./fs.js";
import { writeJson } from "./fs.js";
import { createApproval, createDispatchPlan, getLeads, queueShareJob, updateDispatchPlanStatus } from "./db.js";
import type { DispatchChannel, LeadRecord } from "../types.js";

function bestChannel(lead: LeadRecord): DispatchChannel {
  if (lead.phone && lead.qualificationScore >= 55) return "voice";
  if (lead.email) return "email";
  return "sms";
}

function buildSubject(lead: LeadRecord): string {
  return `Visibility gaps we found for ${lead.company}`;
}

function buildBody(lead: LeadRecord): string {
  const weaknessLine = lead.weaknessSignals.length > 0
    ? `What stood out: ${lead.weaknessSignals.join(", ")}.`
    : "We found visibility and authority gaps worth addressing.";
  return [
    `Hi,`,
    ``,
    `I reviewed ${lead.company} and noticed a few issues that likely limit local visibility and AI search trust.`,
    weaknessLine,
    `If it makes sense, I can walk you through the top fixes and what would likely move the needle fastest.`,
    ``,
    `Jarvis`,
    `True Rank Digital`
  ].join("\n");
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

export function packageJoseQueue(clientId: string): { exportPath: string; stagedCount: number; callReadyCount: number; shareJobId: string } {
  const client = getClientAccount(clientId);
  const leads = getLeads(clientId)
    .filter((lead) => lead.status === "APPROVAL_PENDING" || lead.status === "READY")
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
