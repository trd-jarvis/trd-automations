import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import type { ChannelTarget, ClientAccount, ClientContactRecord, WorkerDefinition } from "./types.js";

loadEnvFiles();

const envSchema = z.object({
  DEFAULT_REPORT_RECIPIENT: z.string().optional(),
  DEFAULT_REPORT_CC: z.string().optional(),
  TEAM_SHARE_RECIPIENTS: z.string().optional(),
  LOG_GIT_REMOTE: z.string().optional(),
  LOG_GIT_BRANCH: z.string().default("main"),
  APIFY_PRIMARY_TOKEN: z.string().optional(),
  APIFY_TOKENS: z.string().optional(),
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.0-flash"),
  GEMINI_PROSPECTOR_MODEL: z.string().default("gemini-3.0-flash"),
  BOOKING_PROVIDER: z.string().optional(),
  BOOKING_URL: z.string().optional(),
  BOOKING_URL_CALENDLY: z.string().optional(),
  BOOKING_URL_GOOGLE_CALENDAR: z.string().optional(),
  GHL_API_KEY: z.string().optional(),
  GHL_LOCATION_ID: z.string().optional(),
  GHL_BASE_URL: z.string().default("https://services.leadconnectorhq.com"),
  GHL_API_VERSION: z.string().default("2021-07-28"),
  GHL_SYNC_ON_CALL_ATTEMPT: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  VAPI_API_KEY: z.string().optional(),
  VAPI_PUBLIC_KEY: z.string().optional(),
  VAPI_CLI_API_KEY: z.string().optional(),
  VAPI_ASSISTANT_ID: z.string().optional(),
  VAPI_BASE_URL: z.string().default("https://api.vapi.ai"),
  VAPI_PHONE_NUMBER_ID: z.string().optional(),
  VAPI_OUTBOUND_VOICE_PROVIDER: z.string().optional(),
  VAPI_OUTBOUND_VOICE_ID: z.string().optional(),
  VAPI_OUTBOUND_VOICE_NAME: z.string().optional(),
  VAPI_CREDIT_GUARD_ENABLED: z.string().optional(),
  VAPI_MIN_CREDITS_TO_DIAL: z.string().optional(),
  VAPI_CREDIT_CHECK_INTERVAL_SECONDS: z.string().optional(),
  VAPI_DEFAULT_AREA_CODES: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  DEFAULT_SLACK_CHANNEL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON_PATH: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
  GOOGLE_AUTOMATIONS_ENV_PATH: z.string().optional(),
  BLITZ_BASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
  TINYURL_API_KEY: z.string().optional(),
  SCHEDULED_CONTENT_DISPATCHER_ENABLED: z.string().optional()
});

export const env = envSchema.parse(process.env);

const signalRuleSchema = z.object({
  requiredKeywords: z.array(z.string()),
  boostKeywords: z.array(z.string()),
  blockedKeywords: z.array(z.string()),
  minimumScore: z.number()
});

const workerSchema = z.object({
  key: z.string(),
  label: z.string(),
  category: z.enum(["ai-monitor", "entity-audit", "review-monitor", "lead-scrape"]),
  source: z.object({
    type: z.enum(["sample-file", "json-file", "apify-actor"]),
    path: z.string().optional(),
    actorId: z.string().optional(),
    inputTemplate: z.record(z.string(), z.unknown()).optional()
  }),
  datasetFields: z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    snippet: z.string().optional(),
    publishedAt: z.string().optional(),
    rank: z.string().optional(),
    rating: z.string().optional()
  }),
  leadFields: z.object({
    company: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    rating: z.string().optional(),
    reviewCount: z.string().optional(),
    weaknessHints: z.string().optional()
  }).optional(),
  positiveRules: signalRuleSchema,
  negativeRules: signalRuleSchema
});

const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  brandTerms: z.array(z.string()),
  domains: z.array(z.string()),
  startUrls: z.array(z.string()).optional(),
  competitors: z.array(z.string()).optional(),
  reportRecipients: z.array(z.string()).optional(),
  reportCc: z.array(z.string()).optional(),
  internalRecipients: z.array(z.string()).optional(),
  workerKeys: z.array(z.string()),
  seedQueries: z.array(z.string()),
  targetAreas: z.array(z.string()).optional(),
  icp: z.string().optional(),
  primaryOffer: z.string().optional(),
  leadSearchCategories: z.array(z.string()).optional(),
  leadSearchLocations: z.array(z.string()).optional(),
  leadSearchQueries: z.array(z.string()).optional(),
  blitzClientId: z.string().optional(),
  blitzClientName: z.string().optional(),
  blitzUrl: z.string().optional(),
  websiteUrl: z.string().optional(),
  gbpUrl: z.string().optional(),
  primaryContactName: z.string().optional(),
  primaryContactEmail: z.string().optional(),
  contactCc: z.array(z.string()).optional(),
  announceRecipients: z.array(z.string()).optional(),
  announceCc: z.array(z.string()).optional(),
  automationCadence: z.object({
    positiveReport: z.string().optional(),
    readinessAudit: z.string().optional(),
    postQueue: z.string().optional(),
    leadGeneration: z.string().optional(),
    joseQueue: z.string().optional()
  }).optional(),
  leadBatchPolicy: z.object({
    batchSize: z.number(),
    targetStates: z.array(z.string()),
    businessModel: z.enum(["service", "mixed"]),
    marketTier: z.enum(["high-ticket", "mixed"])
  }).optional()
});

const clientContactSchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string(),
  primaryContactName: z.string(),
  primaryContactEmail: z.string(),
  ccEmails: z.array(z.string()).optional(),
  title: z.string().optional(),
  notes: z.string().optional()
});

const channelSchema = z.object({
  key: z.string(),
  type: z.enum(["slack", "gmail", "drive", "calendar"]),
  label: z.string(),
  destination: z.string(),
  placeholder: z.boolean(),
  description: z.string().optional()
});

function readJson<T>(filePath: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

function configPath(baseName: string): string {
  const exact = path.resolve(process.cwd(), "config", `${baseName}.json`);
  if (existsSync(exact)) return exact;
  return path.resolve(process.cwd(), "config", `${baseName}.example.json`);
}

export function getClientAccounts(): ClientAccount[] {
  const clients = readJson(configPath("clients"), z.array(clientSchema));
  const contacts = getClientContactRecords();
  const contactMap = new Map<string, ClientContactRecord>();
  for (const entry of contacts) {
    if (entry.clientId) contactMap.set(entry.clientId, entry);
    contactMap.set(entry.clientName.toLowerCase(), entry);
  }

  return clients.map((client) => {
    const contact = contactMap.get(client.id) ?? contactMap.get(client.name.toLowerCase());
    return {
      ...client,
      websiteUrl: client.websiteUrl ?? client.startUrls?.[0],
      primaryContactName: client.primaryContactName ?? contact?.primaryContactName,
      primaryContactEmail: client.primaryContactEmail ?? contact?.primaryContactEmail,
      contactCc: client.contactCc ?? contact?.ccEmails ?? [],
      reportRecipients: client.reportRecipients ?? (contact?.primaryContactEmail ? [contact.primaryContactEmail] : undefined),
      reportCc: client.reportCc ?? contact?.ccEmails ?? [],
      blitzUrl: client.blitzUrl ?? resolveDefaultBlitzUrl(client.blitzClientId ?? client.id),
      announceRecipients: client.announceRecipients ?? client.internalRecipients,
      announceCc: client.announceCc ?? []
    };
  });
}

export function getClientAccount(clientId: string): ClientAccount {
  const client = getClientAccounts().find((entry) => entry.id === clientId);
  if (!client) {
    throw new Error(`Client "${clientId}" was not found in config/clients.json`);
  }
  return client;
}

export function getWorkerDefinitions(): WorkerDefinition[] {
  return readJson(configPath("workers"), z.array(workerSchema));
}

export function getWorkerDefinition(workerKey: string): WorkerDefinition {
  const worker = getWorkerDefinitions().find((entry) => entry.key === workerKey);
  if (!worker) {
    throw new Error(`Worker "${workerKey}" was not found in config/workers.json`);
  }
  return worker;
}

export function getChannelTargets(): ChannelTarget[] {
  return readJson(configPath("channels"), z.array(channelSchema));
}

export function getClientContactRecords(): ClientContactRecord[] {
  return readJson(configPath("client-contacts"), z.array(clientContactSchema));
}

export function getApifyTokens(): string[] {
  return [env.APIFY_PRIMARY_TOKEN, env.APIFY_TOKENS]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function teamRecipients(): string[] {
  const configured = env.TEAM_SHARE_RECIPIENTS?.split(",").map((item) => item.trim()).filter(Boolean);
  if (configured && configured.length > 0) return configured;
  return [
    "jose@truerankdigital.com",
    "jon@truerankdigital.com",
    "eric@truerankdigital.com",
    "jesse@truerankdigital.com",
    "bishop@truerankdigital.com"
  ];
}

export function defaultReportCc(): string[] {
  return env.DEFAULT_REPORT_CC?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

export function normalizeBlitzPlatformUrl(): string | undefined {
  return env.BLITZ_BASE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? undefined;
}

export function resolvedBookingUrl(): string | undefined {
  const provider = env.BOOKING_PROVIDER?.trim().toLowerCase();
  if (provider === "google" && env.BOOKING_URL_GOOGLE_CALENDAR) {
    return env.BOOKING_URL_GOOGLE_CALENDAR;
  }
  if (provider === "calendly" && env.BOOKING_URL_CALENDLY) {
    return env.BOOKING_URL_CALENDLY;
  }
  return env.BOOKING_URL ?? env.BOOKING_URL_CALENDLY ?? env.BOOKING_URL_GOOGLE_CALENDAR ?? undefined;
}

export function resolveDefaultBlitzUrl(clientId: string): string | undefined {
  const baseUrl = normalizeBlitzPlatformUrl();
  if (!baseUrl) return undefined;
  try {
    const parsed = new URL(baseUrl);
    const root = `${parsed.protocol}//${parsed.host}`;
    return `${root}/dashboard/clients/${clientId}`;
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/dashboard/clients/${clientId}`;
  }
}

function loadEnvFiles(): void {
  const defaultGoogleEnv = "/Users/jarvis/Documents/TRD-VOICE/env/googleautomations.env";
  const defaultRailwayEnv = "/Users/jarvis/Documents/TRD-VOICE/env/railway.production.env";
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    process.env.GOOGLE_AUTOMATIONS_ENV_PATH,
    defaultGoogleEnv,
    defaultRailwayEnv
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf8");
      const normalized = raw.replace(/\r/g, "");
      const fragments = normalized
        .split("\n")
        .flatMap((line) => line.split(/\\n/g))
        .map((line) => line.trim())
        .filter(Boolean);

      let loadedCustom = false;
      for (const fragment of fragments) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(fragment)) continue;
        const separatorIndex = fragment.indexOf("=");
        const key = fragment.slice(0, separatorIndex).trim();
        const value = fragment
          .slice(separatorIndex + 1)
          .trim()
          .replace(/^['"`]+/, "")
          .replace(/['"`;,]+$/, "");
        if (!Object.prototype.hasOwnProperty.call(process.env, key) || !process.env[key]) {
          process.env[key] = value === "\\n" ? "" : value;
        }
        loadedCustom = true;
      }

      if (!loadedCustom) {
        loadDotEnv({ path: candidate, override: false });
      }
    }
  }
}
