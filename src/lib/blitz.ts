import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, normalizeBlitzPlatformUrl, teamRecipients } from "../config.js";
import type { BlitzReadinessRow, ClientAccount } from "../types.js";
import { queueBlitzReadinessAnnouncement } from "./announcements.js";
import { queueShareJob } from "./db.js";
import { EXPORT_DIR, writeJson } from "./fs.js";

type JsonRow = Record<string, unknown>;

function getSupabase(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Blitz Supabase credentials are missing. Load googleautomations.env or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function clientDashboardUrl(clientId: string): string | undefined {
  const base = normalizeBlitzPlatformUrl();
  if (!base) return undefined;
  try {
    const parsed = new URL(base);
    return `${parsed.protocol}//${parsed.host}/dashboard/clients/${clientId}`;
  } catch {
    return `${base.replace(/\/+$/, "")}/dashboard/clients/${clientId}`;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function selectRows(supabase: SupabaseClient, table: string, query: string): Promise<JsonRow[]> {
  const { data, error } = await supabase.from(table).select(query);
  if (error) {
    throw new Error(`Failed to query ${table}: ${error.message}`);
  }
  return (data ?? []) as unknown as JsonRow[];
}

async function collectBlitzReadiness(clientFilter?: string): Promise<{
  summary: {
    organizationCount: number;
    clientCount: number;
    readyClients: number;
    blockedClients: number;
    pendingActions: number;
  };
  rows: BlitzReadinessRow[];
}> {
  const supabase = getSupabase();
  const [organizations, clients, locations, connections, assets, settings, actions] = await Promise.all([
    selectRows(supabase, "organizations", "id,name"),
    selectRows(supabase, "clients", "id,organization_id,name,website_url,status"),
    selectRows(supabase, "gbp_locations", "id,client_id,website_uri"),
    selectRows(supabase, "integration_connections", "client_id,provider,is_active"),
    selectRows(supabase, "client_media_assets", "id,client_id,is_allowed_for_posts"),
    selectRows(supabase, "client_orchestration_settings", "client_id,sitemap_url,default_post_url,photo_asset_ids"),
    selectRows(supabase, "client_actions_needed", "client_id,action_type,status")
  ]);

  const settingsByClient = new Map(settings.map((row) => [String(row.client_id), row]));
  const rows = clients
    .filter((row) => {
      if (!clientFilter) return true;
      const id = String(row.id);
      const name = String(row.name).toLowerCase();
      const normalized = clientFilter.toLowerCase();
      return id === clientFilter || name === normalized;
    })
    .map((row) => {
      const clientId = String(row.id);
      const clientName = String(row.name);
      const organizationId = String(row.organization_id);
      const locationCount = locations.filter((entry) => String(entry.client_id) === clientId).length;
      const activeGbpConnections = connections.filter((entry) => String(entry.client_id) === clientId && entry.provider === "gbp" && entry.is_active === true).length;
      const approvedAssetCount = assets.filter((entry) => String(entry.client_id) === clientId && entry.is_allowed_for_posts === true).length;
      const rowSettings = settingsByClient.get(clientId);
      const sitemapUrl = asString(rowSettings?.sitemap_url);
      const defaultPostUrl = asString(rowSettings?.default_post_url) ?? asString(row.website_url);
      const pendingForClient = actions.filter((entry) => String(entry.client_id) === clientId && entry.status === "pending");
      const pendingActionTypes = pendingForClient.map((entry) => String(entry.action_type));
      const postReady = locationCount > 0 && activeGbpConnections > 0 && approvedAssetCount > 0 && Boolean(sitemapUrl || defaultPostUrl);

      return {
        clientId,
        clientName,
        organizationId,
        websiteUrl: asString(row.website_url),
        locationCount,
        activeGbpConnections,
        approvedAssetCount,
        sitemapUrl,
        defaultPostUrl,
        pendingActionCount: pendingForClient.length,
        pendingActionTypes,
        postReady
      } satisfies BlitzReadinessRow;
    })
    .sort((left, right) => Number(right.postReady) - Number(left.postReady) || left.clientName.localeCompare(right.clientName));

  return {
    summary: {
      organizationCount: organizations.length,
      clientCount: rows.length,
      readyClients: rows.filter((row) => row.postReady).length,
      blockedClients: rows.filter((row) => !row.postReady).length,
      pendingActions: rows.reduce((sum, row) => sum + row.pendingActionCount, 0)
    },
    rows
  };
}

export async function auditBlitzReadiness(clientFilter?: string): Promise<{
  summary: {
    organizationCount: number;
    clientCount: number;
    readyClients: number;
    blockedClients: number;
    pendingActions: number;
  };
  rows: BlitzReadinessRow[];
  exportPath: string;
  shareJobId: string;
  announcementId: string;
}> {
  const { summary, rows } = await collectBlitzReadiness(clientFilter);

  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-blitz-readiness.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    summary,
    rows: rows.map((row) => ({
      ...row,
      dashboardUrl: clientDashboardUrl(row.clientId)
    }))
  });
  const shareJobId = queueShareJob(exportPath, teamRecipients(), "Share Blitz readiness audit export.");
  const announcement = queueBlitzReadinessAnnouncement({
    recipient: "jon@truerankdigital.com",
    cc: ["bishop@truerankdigital.com"],
    readyClients: summary.readyClients,
    blockedClients: summary.blockedClients,
    pendingActions: summary.pendingActions,
    blitzUrl: normalizeBlitzPlatformUrl(),
    artifactPath: exportPath
  });

  return {
    summary,
    rows,
    exportPath,
    shareJobId,
    announcementId: announcement.announcementId
  };
}

export async function planBlitzPostQueue(client: ClientAccount): Promise<{
  clientId: string;
  blitzClientId?: string;
  dashboardUrl?: string;
  eligible: boolean;
  reason?: string;
  plannedArtifacts: Array<Record<string, unknown>>;
  exportPath: string;
  shareJobId: string;
}> {
  const audit = await collectBlitzReadiness(client.blitzClientId ?? client.blitzClientName ?? client.name);
  const match = audit.rows.find((row) =>
    row.clientId === client.blitzClientId ||
    row.clientName.toLowerCase() === (client.blitzClientName ?? client.name).toLowerCase()
  );

  const plannedArtifacts = match?.postReady
    ? [{
        clientId: match.clientId,
        clientName: match.clientName,
        landingUrl: match.defaultPostUrl ?? match.websiteUrl,
        sitemapUrl: match.sitemapUrl,
        approvedAssetCount: match.approvedAssetCount,
        mode: "single",
        dispatchActionType: "post_publish",
        note: "Queue via Blitz post tool with approved asset rotation and TinyURL/QR handling in the worker."
      }]
    : [];

  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${client.id}-blitz-post-plan.json`);
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    clientId: client.id,
    requestedBlitzClientId: client.blitzClientId ?? null,
    match: match ?? null,
    plannedArtifacts,
    eligible: Boolean(match?.postReady)
  });
  const shareJobId = queueShareJob(exportPath, teamRecipients(), `Share Blitz post plan for ${client.name}.`);

  return {
    clientId: client.id,
    blitzClientId: match?.clientId,
    dashboardUrl: match ? clientDashboardUrl(match.clientId) : client.blitzUrl,
    eligible: Boolean(match?.postReady),
    reason: match ? undefined : "No matching Blitz client was resolved from local config.",
    plannedArtifacts,
    exportPath,
    shareJobId
  };
}
