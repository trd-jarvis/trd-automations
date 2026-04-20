import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApifyClient } from "apify-client";
import { getApifyTokens } from "../config.js";
import type { ActorRunMetadata, ClientAccount, LeadRecord, RawFinding, WorkerDefinition } from "../types.js";

export interface LeadSourceLoadResult {
  rows: Record<string, unknown>[];
  sourceType: WorkerDefinition["source"]["type"];
  actorId?: string;
  actorRunId?: string;
  actorInput?: Record<string, unknown>;
  defaultDatasetId?: string;
  usageTotalUsd?: number | null;
  actorRuns?: ActorRunMetadata[];
}

const DEFAULT_LEAD_CATEGORIES = [
  "roofing contractor",
  "water damage restoration service",
  "foundation repair contractor",
  "personal injury lawyer",
  "plumbing service",
  "tree service",
  "kitchen remodeler",
  "med spa",
  "plastic surgeon",
  "pool contractor",
  "hardscaping contractor",
  "hvac contractor"
];

const DEFAULT_LEAD_LOCATIONS = [
  "Brooklyn NY",
  "Queens NY",
  "Manhattan NY",
  "Bronx NY",
  "Staten Island NY",
  "Jersey City NJ",
  "Newark NJ",
  "Elizabeth NJ",
  "Paterson NJ",
  "Stamford CT",
  "Bridgeport CT",
  "New Haven CT"
];

const STATE_ALIASES = new Map<string, string>([
  ["NEW YORK", "NY"],
  ["NEW JERSEY", "NJ"],
  ["CONNECTICUT", "CT"],
  ["NY", "NY"],
  ["NJ", "NJ"],
  ["CT", "CT"]
]);

function readJsonArray(filePath: string): Record<string, unknown>[] {
  const content = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array JSON in ${filePath}`);
  }
  return parsed as Record<string, unknown>[];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry).trim()).filter(Boolean);
}

function normalizeFinding(item: Record<string, unknown>, worker: WorkerDefinition): RawFinding {
  return {
    title: asString(item[worker.datasetFields.title ?? "title"]) || "(untitled finding)",
    url: asString(item[worker.datasetFields.url ?? "url"]),
    snippet: asString(item[worker.datasetFields.snippet ?? "snippet"]),
    sourceLabel: worker.label,
    publishedAt: asString(item[worker.datasetFields.publishedAt ?? "publishedAt"]) || null,
    rank: asNumber(item[worker.datasetFields.rank ?? "rank"]),
    rating: asNumber(item[worker.datasetFields.rating ?? "rating"]),
    raw: item
  };
}

function renderTemplate(value: unknown, client: ClientAccount): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("{{clientName}}", client.name)
      .replaceAll("{{clientId}}", client.id)
      .replaceAll("{{domains}}", client.domains.join(","))
      .replaceAll("{{brandTerms}}", client.brandTerms.join(","))
      .replaceAll("{{seedQueries}}", client.seedQueries.join(","));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplate(entry, client));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderTemplate(entry, client)])
    );
  }
  return value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getApifyExecutionPool(workerKey: string): Array<{ token: string; tokenLabel: string }> {
  const tokens = uniqueStrings(getApifyTokens());
  if (tokens.length === 0) {
    throw new Error("No Apify tokens configured. Set APIFY_PRIMARY_TOKEN or APIFY_TOKENS.");
  }
  const offset = Math.abs(Array.from(workerKey).reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tokens.length;
  return tokens.map((_, index) => {
    const token = tokens[(index + offset) % tokens.length]!;
    return {
      token,
      tokenLabel: `account-${index + 1}`
    };
  });
}

function getLeadCategories(client: ClientAccount): string[] {
  return uniqueStrings(client.leadSearchCategories ?? DEFAULT_LEAD_CATEGORIES);
}

function getLeadLocations(client: ClientAccount): string[] {
  return uniqueStrings(client.leadSearchLocations ?? client.targetAreas ?? DEFAULT_LEAD_LOCATIONS);
}

function buildLeadSearchQueries(client: ClientAccount, limit: number): string[] {
  const explicitQueries = uniqueStrings(client.leadSearchQueries ?? []);
  if (explicitQueries.length > 0) {
    return explicitQueries;
  }

  const categories = getLeadCategories(client);
  const locations = getLeadLocations(client);
  const crossProduct = categories.flatMap((category) => locations.map((location) => `${category} in ${location}`));
  const desiredQueryCount = Math.max(12, Math.min(crossProduct.length, Math.ceil(limit / 8)));
  return uniqueStrings(crossProduct).slice(0, desiredQueryCount);
}

function buildLeadActorInput(
  client: ClientAccount,
  worker: WorkerDefinition,
  limit: number,
  searchQueriesOverride?: string[]
): Record<string, unknown> {
  const base = (renderTemplate(worker.source.inputTemplate ?? {}, client) || {}) as Record<string, unknown>;
  const searchQueries = searchQueriesOverride ?? buildLeadSearchQueries(client, limit);
  if (searchQueries.length === 0) {
    throw new Error(`Worker "${worker.key}" could not derive any lead search queries.`);
  }

  const perQueryCap = Math.min(25, Math.max(8, Math.ceil((limit * 1.35) / searchQueries.length)));
  return {
    ...base,
    searchStringsArray: searchQueries,
    maxCrawledPlacesPerSearch: typeof base.maxCrawledPlacesPerSearch === "number" ? base.maxCrawledPlacesPerSearch : perQueryCap
  };
}

async function executeApifyActor(
  worker: WorkerDefinition,
  input: Record<string, unknown>,
  token: string,
  tokenLabel?: string
): Promise<LeadSourceLoadResult & { rows: Record<string, unknown>[] }> {
  if (!worker.source.actorId) {
    throw new Error(`Worker "${worker.key}" is missing source.actorId`);
  }
  const apify = new ApifyClient({ token });
  const run = await apify.actor(worker.source.actorId).call(input);
  const dataset = await apify.dataset(run.defaultDatasetId).listItems({ clean: true });
  return {
    rows: dataset.items as Record<string, unknown>[],
    sourceType: worker.source.type,
    actorId: worker.source.actorId,
    actorRunId: run.id,
    actorInput: input,
    defaultDatasetId: run.defaultDatasetId,
    usageTotalUsd: run.usageTotalUsd ?? null,
    actorRuns: [{
      actorId: worker.source.actorId,
      actorRunId: run.id,
      defaultDatasetId: run.defaultDatasetId,
      usageTotalUsd: run.usageTotalUsd ?? null,
      tokenLabel,
      searchQueries: Array.isArray(input.searchStringsArray)
        ? input.searchStringsArray.map((entry) => asString(entry)).filter(Boolean)
        : []
    }]
  };
}

function partitionSearchQueries(queries: string[], bucketCount: number): string[][] {
  const buckets = Array.from({ length: Math.max(1, bucketCount) }, () => [] as string[]);
  queries.forEach((query, index) => {
    buckets[index % buckets.length]!.push(query);
  });
  return buckets.filter((bucket) => bucket.length > 0);
}

function dedupeLeadRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const row of rows) {
    const identity = [
      asString(row.placeId).trim(),
      asString(row.url).trim(),
      asString(row.website).trim(),
      asString(row.phoneUnformatted ?? row.phone).trim(),
      [asString(row.title).trim(), asString(row.address).trim()].filter(Boolean).join("|")
    ].find(Boolean);
    const key = identity || JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

async function executeLeadActorAcrossPool(
  client: ClientAccount,
  worker: WorkerDefinition,
  limit: number
): Promise<LeadSourceLoadResult & { rows: Record<string, unknown>[] }> {
  const baseQueries = buildLeadSearchQueries(client, limit);
  const executionPool = getApifyExecutionPool(worker.key);
  const queryBuckets = partitionSearchQueries(baseQueries, Math.min(executionPool.length, baseQueries.length));
  const poolSlice = executionPool.slice(0, queryBuckets.length);

  const settled = await Promise.allSettled(
    poolSlice.map(async (entry, index) => {
      const queryBucket = queryBuckets[index]!;
      const approxLimit = Math.max(25, Math.ceil(limit / queryBuckets.length));
      const input = buildLeadActorInput(client, worker, approxLimit, queryBucket);
      return executeApifyActor(worker, input, entry.token, entry.tokenLabel);
    })
  );

  const successes = settled
    .filter((result): result is PromiseFulfilledResult<LeadSourceLoadResult & { rows: Record<string, unknown>[] }> => result.status === "fulfilled")
    .map((result) => result.value);
  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

  if (successes.length === 0) {
    throw new Error(`All Apify lead runs failed for worker "${worker.key}": ${failures.join("; ")}`);
  }

  const mergedRows = dedupeLeadRows(successes.flatMap((result) => result.rows));
  const actorRuns = successes.flatMap((result) => result.actorRuns ?? []);
  return {
    rows: mergedRows,
    sourceType: worker.source.type,
    actorId: worker.source.actorId,
    actorRunId: actorRuns[0]?.actorRunId,
    actorInput: {
      searchStringsArray: baseQueries,
      executionPoolSize: poolSlice.length
    },
    defaultDatasetId: actorRuns[0]?.defaultDatasetId,
    usageTotalUsd: successes.reduce((sum, result) => sum + (result.usageTotalUsd ?? 0), 0),
    actorRuns
  };
}

export async function executeWorker(client: ClientAccount, worker: WorkerDefinition): Promise<{ findings: RawFinding[]; snapshot: Record<string, unknown> }> {
  let items: Record<string, unknown>[];
  let actorMetadata: Record<string, unknown> | undefined;

  if (worker.source.type === "sample-file" || worker.source.type === "json-file") {
    if (!worker.source.path) {
      throw new Error(`Worker "${worker.key}" is missing source.path`);
    }
    items = readJsonArray(path.resolve(process.cwd(), worker.source.path));
  } else {
    const input = (renderTemplate(worker.source.inputTemplate ?? {}, client) || {}) as Record<string, unknown>;
    const token = getApifyExecutionPool(worker.key)[0]!;
    const result = await executeApifyActor(worker, input, token.token, token.tokenLabel);
    items = result.rows;
    actorMetadata = {
      actorId: result.actorId,
      actorRunId: result.actorRunId,
      actorInput: result.actorInput,
      defaultDatasetId: result.defaultDatasetId,
      usageTotalUsd: result.usageTotalUsd,
      actorRuns: result.actorRuns
    };
  }

  const findings = items.map((item) => normalizeFinding(item, worker));
  return {
    findings,
    snapshot: {
      clientId: client.id,
      workerKey: worker.key,
      itemCount: findings.length,
      findings,
      sourceType: worker.source.type,
      generatedAt: new Date().toISOString(),
      ...(actorMetadata ? { actor: actorMetadata } : {})
    }
  };
}

function extractPrimaryEmail(row: Record<string, unknown>): string | undefined {
  const direct = asString(row.primaryEmail || row.email).trim();
  if (direct) return direct;
  const emails = asStringArray(row.emails);
  if (emails.length > 0) return emails[0];
  const leads = Array.isArray(row.leadsEnrichment) ? row.leadsEnrichment as Array<Record<string, unknown>> : [];
  for (const lead of leads) {
    const email = asString(lead.email || lead.workEmail || lead.emailAddress).trim();
    if (email) return email;
  }
  return undefined;
}

function extractLeadContact(row: Record<string, unknown>): {
  contactName?: string;
  contactTitle?: string;
  linkedinUrl?: string;
} {
  const leads = Array.isArray(row.leadsEnrichment) ? row.leadsEnrichment as Array<Record<string, unknown>> : [];
  const first = leads.find((entry) => entry && typeof entry === "object");
  if (!first) return {};
  const name = asString(first.fullName || first.name).trim();
  const title = asString(first.jobTitle || first.title).trim();
  const linkedinUrl = asString(first.linkedIn || first.linkedinUrl).trim();
  return {
    contactName: name || undefined,
    contactTitle: title || undefined,
    linkedinUrl: linkedinUrl || undefined
  };
}

function extractSocials(row: Record<string, unknown>): Record<string, string | string[]> {
  const facebooks = asStringArray(row.facebooks);
  const instagrams = asStringArray(row.instagrams);
  const linkedIns = asStringArray(row.linkedIns);
  const twitters = asStringArray(row.twitters);
  const youtubes = asStringArray(row.youtubes);
  const tiktoks = asStringArray(row.tiktoks);
  const pinterests = asStringArray(row.pinterests);
  const whatsapps = asStringArray(row.whatsapps);
  return {
    facebooks,
    instagrams,
    linkedIns,
    twitters,
    youtubes,
    tiktoks,
    pinterests,
    whatsapps,
    facebookUrl: facebooks[0] ?? "",
    instagramUrl: instagrams[0] ?? "",
    linkedinUrl: linkedIns[0] ?? "",
    twitterUrl: twitters[0] ?? "",
    youtubeUrl: youtubes[0] ?? "",
    tiktokUrl: tiktoks[0] ?? "",
    pinterestUrl: pinterests[0] ?? "",
    whatsappUrl: whatsapps[0] ?? ""
  };
}

function deriveWeaknessSignals(row: Record<string, unknown>, primaryEmail?: string): string[] {
  const signals: string[] = [];
  const reviewsCount = asNumber(row.reviewsCount ?? row.reviewCount) ?? 0;
  const rating = asNumber(row.totalScore ?? row.rating) ?? 5;
  const imagesCount = asNumber(row.imagesCount) ?? 0;
  const hasWebsite = Boolean(asString(row.website).trim());
  const claimed = Boolean(row.claimThisBusiness);
  const socials = [
    ...asStringArray(row.facebooks),
    ...asStringArray(row.instagrams),
    ...asStringArray(row.linkedIns),
    ...asStringArray(row.twitters),
    ...asStringArray(row.youtubes),
    ...asStringArray(row.tiktoks),
    ...asStringArray(row.pinterests)
  ];

  if (!hasWebsite) signals.push("website missing");
  if (!primaryEmail) signals.push("no email found");
  if (socials.length === 0) signals.push("no social profiles found");
  if (!claimed) signals.push("listing appears unclaimed");
  if (reviewsCount < 40) signals.push("review count under 40");
  if (rating < 4.7) signals.push("rating under 4.7");
  if (imagesCount < 25) signals.push("thin photo footprint");
  if ((asString(row.description) || "").trim().length === 0) signals.push("no business description");

  return signals;
}

function normalizeStateToken(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return "";
  return STATE_ALIASES.get(raw.toUpperCase()) ?? raw.toUpperCase();
}

export function normalizeLeadRecords(client: ClientAccount, worker: WorkerDefinition, rows: Record<string, unknown>[]): LeadRecord[] {
  const leadFields = worker.leadFields;
  if (!leadFields) {
    throw new Error(`Worker "${worker.key}" is missing leadFields`);
  }
  const now = new Date().toISOString();
  return rows.map((row) => {
    const primaryEmail = extractPrimaryEmail(row);
    const contact = extractLeadContact(row);
    const socialFields = extractSocials(row);
    const derivedWeaknessSignals = deriveWeaknessSignals(row, primaryEmail);
    const configuredWeaknessText = asString(row[leadFields.weaknessHints ?? "weaknessHints"]);
    const weaknessSignals = configuredWeaknessText
      ? configuredWeaknessText.split("|").map((entry) => entry.trim()).filter(Boolean)
      : derivedWeaknessSignals;
    const reviewCount = asNumber(row[leadFields.reviewCount ?? "reviewCount"]);
    const rating = asNumber(row[leadFields.rating ?? "rating"]);
    const weaknessScore = Math.max(
      0,
      35
        + weaknessSignals.length * 9
        + (!primaryEmail ? 8 : 0)
        + ((rating ?? 5) < 4.7 ? 12 : 0)
        + ((reviewCount ?? 0) < 40 ? 14 : 0)
    );

    return {
      id: randomUUID(),
      clientId: client.id,
      workerKey: worker.key,
      leadSource: "generated",
      company: asString(row[leadFields.company ?? "company"]) || "Unknown company",
      website: asString(row[leadFields.website ?? "website"]) || undefined,
      phone: asString(row[leadFields.phone ?? "phone"]) || undefined,
      email: primaryEmail,
      city: asString(row[leadFields.city ?? "city"]) || undefined,
      state: normalizeStateToken(row[leadFields.state ?? "state"]) || undefined,
      rating,
      reviewCount,
      weaknessSignals,
      weaknessScore,
      qualificationScore: 0,
      recommendedChannel: "email",
      status: "STAGED",
      negativeAnalysisStatus: "PENDING",
      voiceStatus: "PENDING",
      smsStatus: "PENDING",
      raw: {
        ...row,
        primaryEmail: primaryEmail ?? "",
        contactName: contact.contactName ?? "",
        contactTitle: contact.contactTitle ?? "",
        linkedinUrl: contact.linkedinUrl ?? (socialFields.linkedinUrl as string),
        ...socialFields,
        stateAbbr: normalizeStateToken(row[leadFields.state ?? "state"])
      },
      createdAt: now,
      updatedAt: now
    };
  });
}

export async function loadLeadSource(client: ClientAccount, worker: WorkerDefinition, limit: number): Promise<LeadSourceLoadResult> {
  if (worker.source.type === "sample-file" || worker.source.type === "json-file") {
    if (!worker.source.path) {
      throw new Error(`Worker "${worker.key}" is missing source.path`);
    }
    return {
      rows: readJsonArray(path.resolve(process.cwd(), worker.source.path)),
      sourceType: worker.source.type
    };
  }

  return executeLeadActorAcrossPool(client, worker, limit);
}

export function expandLeadPool(rows: Record<string, unknown>[], targetCount: number, client: ClientAccount): Record<string, unknown>[] {
  if (rows.length >= targetCount) return rows.slice(0, targetCount);
  const states = client.leadBatchPolicy?.targetStates?.length ? client.leadBatchPolicy.targetStates : ["NY", "NJ", "CT"];
  const expanded: Record<string, unknown>[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const source = rows[index % rows.length] ?? {};
    const state = states[index % states.length] ?? "NY";
    expanded.push({
      ...source,
      company: `${asString(source.company || source.title || `TRD Lead ${index + 1}`)} ${Math.floor(index / Math.max(1, rows.length)) + 1}`,
      city: asString(source.city || "Metro Area"),
      state,
      businessType: "service",
      marketTier: "high-ticket"
    });
  }
  return expanded;
}

export function filterLeadPool(client: ClientAccount, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const states = new Set((client.leadBatchPolicy?.targetStates ?? ["NY", "NJ", "CT"]).map((entry) => normalizeStateToken(entry)));
  return rows.filter((row) => {
    const state = normalizeStateToken(row.state ?? row.stateAbbr);
    const businessType = asString(row.businessType || "service").toLowerCase();
    const marketTier = asString(row.marketTier || "high-ticket").toLowerCase();
    return (!state || states.has(state)) && businessType.includes("service") && marketTier.includes("high-ticket");
  });
}
