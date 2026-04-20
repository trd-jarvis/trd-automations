import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AnnouncementTemplate, ClientAccount, QueuedAnnouncementPayload } from "../types.js";
import { teamRecipients } from "../config.js";
import { ANNOUNCEMENT_DIR } from "./fs.js";
import { getQueuedAnnouncement, markAnnouncementSent, queueAnnouncement, queueShareJob } from "./db.js";
import { renderBarChart, renderButtons, renderEmailShell, renderMetricCards, renderSections } from "./html.js";

function writeAnnouncement(template: AnnouncementTemplate, clientId?: string | null): { announcementId: string; htmlPath: string } {
  const html = renderEmailShell({
    eyebrow: template.audience === "internal" ? "TRD Operations" : "True Rank Digital",
    title: template.title,
    summary: template.summary,
    metrics: renderMetricCards(template.metrics),
    chart: template.chart ? renderBarChart(template.chart.label, template.chart.bars) : "",
    sections: renderSections(template.sections),
    ctas: renderButtons(template.ctas)
  });

  const htmlPath = path.join(
    ANNOUNCEMENT_DIR,
    `${new Date().toISOString().replaceAll(":", "-")}-${template.key}${clientId ? `-${clientId}` : ""}.html`
  );
  writeFileSync(htmlPath, html, "utf8");
  const announcementId = queueAnnouncement({
    type: template.key,
    audience: template.audience,
    clientId,
    recipient: template.recipient,
    cc: template.cc,
    subject: template.title,
    htmlPath,
    metadata: template.metadata
  });
  queueShareJob(htmlPath, teamRecipients(), `Share queued ${template.key} announcement${clientId ? ` for ${clientId}` : ""}.`);
  return { announcementId, htmlPath };
}

export function queueClientContactCompletionAnnouncement(input: {
  recipient: string;
  cc: string[];
  blitzUrl?: string;
  artifactPath?: string;
}): { announcementId: string; htmlPath: string } {
  return writeAnnouncement({
    key: "client-contact-completion",
    audience: "internal",
    title: "Client contact automation completed",
    summary: "The contact-roster automation is now wired into the TRD automation stack and ready to govern client-facing positive-findings email delivery.",
    recipient: input.recipient,
    cc: input.cc,
    ctas: [
      input.blitzUrl ? { label: "Open Blitz Platform", url: input.blitzUrl } : null,
      input.artifactPath ? { label: "Open Contact Artifact", url: `file://${input.artifactPath}` } : null
    ].filter((entry): entry is { label: string; url: string } => Boolean(entry)),
    metrics: [
      { label: "Audience", value: "Internal ops", tone: "accent" },
      { label: "Delivery", value: "HTML via Gmail", tone: "success" },
      { label: "Next Gate", value: "Client contacts", tone: "warning" }
    ],
    chart: {
      label: "Completion snapshot",
      bars: [
        { label: "Notifications", value: 1, tone: "amber" },
        { label: "Drive share jobs", value: 1, tone: "sage" },
        { label: "Follow-up inputs", value: 2, tone: "slate" }
      ]
    },
    sections: [
      {
        heading: "What shipped",
        body: "Announcement payloads, contact-aware client report gating, Drive-share queueing, and Blitz/lead-gen automation surfaces are now part of the repo runtime."
      },
      {
        heading: "What still needs operator input",
        body: "The final client-contact roster and Blitz platform base URL still need to be filled in before client-facing positive updates can begin."
      }
    ],
    artifactPath: input.artifactPath,
    metadata: {
      workflow: "client-contact-completion-announce"
    }
  });
}

export function queueInternalContactSetupAnnouncement(client: ClientAccount, findingCount: number): string {
  return writeAnnouncement({
    key: "contact-setup-needed",
    audience: "internal",
    title: `Contact setup needed before reporting ${client.name}`,
    summary: `Positive findings were captured for ${client.name}, but the client-facing report was suppressed because no primary contact email is configured.`,
    recipient: client.announceRecipients?.[0] ?? "jon@truerankdigital.com",
    cc: client.announceCc?.length ? client.announceCc : ["bishop@truerankdigital.com"],
    ctas: [
      client.blitzUrl ? { label: "Open Blitz Client", url: client.blitzUrl } : null,
      client.websiteUrl ? { label: "Open Website", url: client.websiteUrl } : null
    ].filter((entry): entry is { label: string; url: string } => Boolean(entry)),
    metrics: [
      { label: "Suppressed wins", value: String(findingCount), tone: "warning" },
      { label: "Client", value: client.name, tone: "neutral" },
      { label: "Action", value: "Add contact", tone: "accent" }
    ],
    sections: [
      {
        heading: "Why this was held",
        body: "The positive report queue requires a maintained client contact record so we do not send polished wins to the wrong inbox."
      },
      {
        heading: "Required fields",
        body: "Add client_name, client_id or exact Blitz client name, primary_contact_name, and primary_contact_email to the local contact roster source."
      }
    ],
    metadata: {
      workflow: "contact-setup-needed",
      findingCount
    }
  }, client.id).announcementId;
}

export function queueBlitzReadinessAnnouncement(input: {
  recipient: string;
  cc: string[];
  readyClients: number;
  blockedClients: number;
  pendingActions: number;
  blitzUrl?: string;
  artifactPath?: string;
}): { announcementId: string; htmlPath: string } {
  return writeAnnouncement({
    key: "blitz-readiness",
    audience: "internal",
    title: "Blitz GBP readiness audit completed",
    summary: "The latest readiness scan separated post-ready accounts from setup-blocked accounts and packaged the results for operator review.",
    recipient: input.recipient,
    cc: input.cc,
    ctas: [
      input.blitzUrl ? { label: "Open Blitz Dashboard", url: input.blitzUrl } : null
    ].filter((entry): entry is { label: string; url: string } => Boolean(entry)),
    metrics: [
      { label: "Post-ready", value: String(input.readyClients), tone: "success" },
      { label: "Setup-blocked", value: String(input.blockedClients), tone: "warning" },
      { label: "Pending actions", value: String(input.pendingActions), tone: "neutral" }
    ],
    chart: {
      label: "Readiness mix",
      bars: [
        { label: "Ready", value: input.readyClients, tone: "sage" },
        { label: "Blocked", value: input.blockedClients, tone: "amber" },
        { label: "Actions needed", value: input.pendingActions, tone: "slate" }
      ]
    },
    sections: [
      {
        heading: "What this audit covers",
        body: "The scan checks seeded GBP locations, active GBP integrations, approved media assets, sitemap/default post URL coverage, and open actions-needed items."
      },
      {
        heading: "How to use it",
        body: "Use the readiness output to prioritize client setup fixes before scheduling post bursts or enabling review workflows."
      }
    ],
    artifactPath: input.artifactPath
  });
}

export function getQueuedAnnouncementPayload(announcementId: string): QueuedAnnouncementPayload | null {
  const queued = getQueuedAnnouncement(announcementId);
  if (!queued) return null;
  return {
    announcementId: queued.id,
    clientId: queued.clientId ?? null,
    audience: queued.audience,
    type: queued.type,
    recipient: queued.recipient,
    cc: queued.cc,
    subject: queued.subject,
    htmlPath: queued.htmlPath,
    body: readFileSync(queued.htmlPath, "utf8")
  };
}

export { markAnnouncementSent };
