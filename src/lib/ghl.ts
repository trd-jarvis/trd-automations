import { env } from "../config.js";
import type { ClientAccount, LeadRecord } from "../types.js";

interface GhlCredentials {
  apiKey: string;
  locationId: string;
  baseUrl: string;
  version: string;
}

interface GhlSyncResult {
  synced: boolean;
  contactId?: string;
  tags: string[];
  error?: string;
}

function creds(): GhlCredentials {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) {
    throw new Error("GHL_API_KEY and GHL_LOCATION_ID are required.");
  }
  return {
    apiKey: env.GHL_API_KEY,
    locationId: env.GHL_LOCATION_ID,
    baseUrl: env.GHL_BASE_URL,
    version: env.GHL_API_VERSION
  };
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function ghlRequest(
  credentials: GhlCredentials,
  method: string,
  route: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`${credentials.baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      Version: credentials.version,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  if (!response.ok) {
    throw new Error(`GHL request failed (${response.status}): ${raw.slice(0, 400)}`);
  }
  return parsed;
}

function extractContactId(payload: Record<string, unknown>): string | undefined {
  const direct = safeString(payload.id);
  if (direct) return direct;
  const contact = payload.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const nested = safeString((contact as Record<string, unknown>).id);
    if (nested) return nested;
  }
  const contacts = payload.contacts;
  if (Array.isArray(contacts) && contacts.length > 0) {
    const first = contacts[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return safeString((first as Record<string, unknown>).id);
    }
  }
  return undefined;
}

function compactTags(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function normalizeTagValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function leadTags(client: ClientAccount, lead: LeadRecord): string[] {
  return compactTags([
    "jarvis-generated-lead",
    "jarvis-outbound-sequence",
    `client:${normalizeTagValue(client.id)}`,
    lead.state ? `state:${normalizeTagValue(lead.state)}` : undefined,
    `channel:${lead.recommendedChannel}`,
    lead.voiceBatchId ? `voice-batch:${normalizeTagValue(lead.voiceBatchId)}` : undefined,
    lead.status ? `stage:${normalizeTagValue(lead.status)}` : undefined
  ]);
}

async function upsertContact(credentials: GhlCredentials, lead: LeadRecord, tags: string[]): Promise<string> {
  const payload: Record<string, unknown> = {
    locationId: credentials.locationId,
    companyName: lead.company,
    phone: lead.phone,
    email: lead.email,
    name: lead.company,
    tags
  };

  const upsert = await ghlRequest(credentials, "POST", "/contacts/upsert", payload);
  const upsertId = extractContactId(upsert);
  if (upsertId) return upsertId;

  const created = await ghlRequest(credentials, "POST", "/contacts/", payload);
  const createdId = extractContactId(created);
  if (createdId) return createdId;

  throw new Error("Unable to resolve a GHL contact id after upsert/create.");
}

async function addTags(credentials: GhlCredentials, contactId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  await ghlRequest(credentials, "POST", `/contacts/${contactId}/tags`, { tags });
}

async function addNote(credentials: GhlCredentials, contactId: string, note: string): Promise<void> {
  const variants = [{ body: note }, { note }, { content: note }];
  for (const variant of variants) {
    try {
      await ghlRequest(credentials, "POST", `/contacts/${contactId}/notes`, variant);
      return;
    } catch {
      // try the next accepted note shape
    }
  }
  throw new Error("Unable to add a note to the GHL contact.");
}

export async function syncGeneratedLeadToGhl(client: ClientAccount, lead: LeadRecord): Promise<GhlSyncResult> {
  const tags = leadTags(client, lead);
  try {
    const credentials = creds();
    const contactId = await upsertContact(credentials, lead, tags);
    await addTags(credentials, contactId, tags);
    await addNote(
      credentials,
      contactId,
      [
        "Generated lead synced from TRD Automations.",
        `Client: ${client.name}`,
        `Company: ${lead.company}`,
        `Location: ${lead.city ?? ""}${lead.city && lead.state ? ", " : ""}${lead.state ?? ""}`,
        `Weakness signals: ${lead.weaknessSignals.join(", ") || "not captured"}`,
        `Qualification: ${lead.qualificationScore}`,
        `Recommended channel: ${lead.recommendedChannel}`
      ].join("\n")
    );
    return { synced: true, contactId, tags };
  } catch (error) {
    return {
      synced: false,
      tags,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
