import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultReportCc, env, teamRecipients } from "../config.js";
import type { ClientAccount, QueuedReportPayload, ReportQueueResult, SignalFinding } from "../types.js";
import { queueInternalContactSetupAnnouncement } from "./announcements.js";
import { escapeHtml, renderBarChart, renderButtons, renderEmailShell, renderMetricCards, renderSections } from "./html.js";
import { REPORT_DIR } from "./fs.js";
import { getPendingReportSignals, getQueuedReport, queueReport, queueShareJob } from "./db.js";

function compactUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function buildClientReport(client: ClientAccount, findings: Array<SignalFinding & { id: string }>): { subject: string; html: string } {
  const cards = findings.slice(0, 8).map((finding) => `
    <tr>
      <td style="padding:0 0 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7dcc9;border-radius:16px;background:#fffdf8;">
          <tr>
            <td style="padding:18px 20px;font-family:Georgia,'Times New Roman',serif;color:#1c1917;">
              <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#a16207;margin-bottom:8px;">${escapeHtml(finding.sourceLabel)}</div>
              <div style="font-size:20px;line-height:1.35;font-weight:bold;margin-bottom:8px;">${escapeHtml(finding.title)}</div>
              <div style="font-size:15px;line-height:1.65;color:#44403c;margin-bottom:10px;">${escapeHtml(finding.snippet)}</div>
              <div style="font-size:13px;color:#78716c;margin-bottom:10px;">Signal score: ${finding.score}</div>
              <a href="${escapeHtml(finding.url)}" style="font-size:14px;color:#9a3412;text-decoration:none;">Open ${escapeHtml(compactUrlLabel(finding.url))}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join("");

  const sourceCounts = Array.from(
    findings.reduce((acc, finding) => {
      acc.set(finding.sourceLabel, (acc.get(finding.sourceLabel) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).map(([label, value]) => ({ label, value, tone: "amber" as const }));

  const avgScore = Math.round(findings.reduce((sum, finding) => sum + finding.score, 0) / findings.length);
  const buttons = [
    client.blitzUrl ? { label: "Open Blitz Workspace", url: client.blitzUrl } : null,
    client.websiteUrl ? { label: "Visit Client Website", url: client.websiteUrl } : null,
    client.gbpUrl ? { label: "Open GBP Profile", url: client.gbpUrl } : null
  ].filter((entry): entry is { label: string; url: string } => Boolean(entry));

  const html = renderEmailShell({
    eyebrow: "True Rank Digital",
    title: `Positive visibility momentum for ${client.name}`,
    summary: `We identified ${findings.length} reportable wins worth sharing across AI search, brand authority, and local visibility signals.`,
    metrics: renderMetricCards([
      { label: "Wins Captured", value: String(findings.length), tone: "accent" },
      { label: "Average Score", value: String(avgScore), tone: "success" },
      { label: "Primary Offer", value: client.primaryOffer ?? "AI visibility", tone: "neutral" }
    ]),
    chart: sourceCounts.length > 0 ? renderBarChart("Wins by monitoring surface", sourceCounts) : "",
    sections: [
      ...findings.slice(0, 8).map((finding) => ({
        heading: finding.title,
        body: `${finding.snippet} Source: ${finding.sourceLabel}. Signal score: ${finding.score}.`
      })),
      {
        heading: "What happens next",
        body: "We keep the negative and optimization findings in a separate internal queue so this update stays focused on traction and visible wins."
      }
    ].length > 0
      ? renderSections([
          {
            heading: "Visibility highlights",
            body: "Below are the strongest positive signals from the latest monitoring run."
          },
          ...findings.slice(0, 6).map((finding) => ({
            heading: finding.title,
            body: `${finding.snippet} Review source: ${finding.url}.`
          })),
          {
            heading: "Internal optimization handling",
            body: "Negative findings stay separated from this report so your team only receives the strongest positive movement here."
          }
        ])
      : "",
    ctas: renderButtons(buttons)
  });

  return {
    subject: `Positive visibility wins for ${client.name}`,
    html
  };
}

export function queueClientReport(client: ClientAccount): ReportQueueResult | null {
  const findings = getPendingReportSignals(client.id);
  if (findings.length === 0) return null;

  const recipient = client.primaryContactEmail ?? client.reportRecipients?.[0] ?? env.DEFAULT_REPORT_RECIPIENT;
  if (!recipient) {
    const announcementId = queueInternalContactSetupAnnouncement(client, findings.length);
    return {
      kind: "suppressed",
      clientId: client.id,
      findingCount: findings.length,
      reason: "missing-client-contact",
      announcementId
    };
  }

  const cc = client.contactCc?.length
    ? client.contactCc
    : client.reportCc?.length
      ? client.reportCc
      : defaultReportCc();

  const report = buildClientReport(client, findings);
  const htmlPath = path.join(REPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${client.id}.html`);
  writeFileSync(htmlPath, report.html, "utf8");
  const reportId = queueReport(client.id, recipient, cc, report.subject, findings.map((finding) => finding.id), htmlPath);
  queueShareJob(htmlPath, teamRecipients(), `Share queued client report preview for ${client.name}.`);
  return {
    kind: "queued",
    clientId: client.id,
    reportId,
    htmlPath,
    recipient,
    cc,
    findingCount: findings.length
  };
}

export function getQueuedReportPayload(clientId: string): QueuedReportPayload | null {
  const report = getQueuedReport(clientId);
  if (!report) return null;
  return {
    reportId: report.id,
    clientId,
    recipient: report.recipient,
    cc: report.cc,
    subject: report.subject,
    htmlPath: report.htmlPath,
    body: readFileSync(report.htmlPath, "utf8"),
    signalIds: report.signalIds
  };
}
