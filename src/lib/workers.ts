import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApifyClient } from "apify-client";
import { getApifyTokens } from "../config.js";
import type { ClientAccount, LeadRecord, RawFinding, WorkerDefinition } from "../types.js";

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

function chooseApifyToken(workerKey: string): string {
  const tokens = getApifyTokens();
  if (tokens.length === 0) {
    throw new Error("No Apify tokens configured. Set APIFY_PRIMARY_TOKEN or APIFY_TOKENS.");
  }
  const index = Math.abs(Array.from(workerKey).reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tokens.length;
  return tokens[index]!;
}

export async function executeWorker(client: ClientAccount, worker: WorkerDefinition): Promise<{ findings: RawFinding[]; snapshot: Record<string, unknown> }> {
  let items: Record<string, unknown>[];

  if (worker.source.type === "sample-file" || worker.source.type === "json-file") {
    if (!worker.source.path) {
      throw new Error(`Worker "${worker.key}" is missing source.path`);
    }
    items = readJsonArray(path.resolve(process.cwd(), worker.source.path));
  } else {
    if (!worker.source.actorId) {
      throw new Error(`Worker "${worker.key}" is missing source.actorId`);
    }
    const token = chooseApifyToken(worker.key);
    const apify = new ApifyClient({ token });
    const input = (renderTemplate(worker.source.inputTemplate ?? {}, client) || {}) as Record<string, unknown>;
    const run = await apify.actor(worker.source.actorId).call(input);
    const dataset = await apify.dataset(run.defaultDatasetId).listItems({ clean: true });
    items = dataset.items as Record<string, unknown>[];
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
      generatedAt: new Date().toISOString()
    }
  };
}

export function normalizeLeadRecords(client: ClientAccount, worker: WorkerDefinition, rows: Record<string, unknown>[]): LeadRecord[] {
  const leadFields = worker.leadFields;
  if (!leadFields) {
    throw new Error(`Worker "${worker.key}" is missing leadFields`);
  }
  const now = new Date().toISOString();
  return rows.map((row) => {
    const weaknessText = asString(row[leadFields.weaknessHints ?? "weaknessHints"]);
    const weaknessSignals = weaknessText
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const reviewCount = asNumber(row[leadFields.reviewCount ?? "reviewCount"]);
    const rating = asNumber(row[leadFields.rating ?? "rating"]);
    const weaknessScore = Math.max(
      0,
      35 + weaknessSignals.length * 10 + ((rating ?? 5) < 4.3 ? 15 : 0) + ((reviewCount ?? 0) < 30 ? 10 : 0)
    );

    return {
      id: randomUUID(),
      clientId: client.id,
      workerKey: worker.key,
      leadSource: "generated",
      company: asString(row[leadFields.company ?? "company"]) || "Unknown company",
      website: asString(row[leadFields.website ?? "website"]) || undefined,
      phone: asString(row[leadFields.phone ?? "phone"]) || undefined,
      email: asString(row[leadFields.email ?? "email"]) || undefined,
      city: asString(row[leadFields.city ?? "city"]) || undefined,
      state: asString(row[leadFields.state ?? "state"]) || undefined,
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
      raw: row,
      createdAt: now,
      updatedAt: now
    };
  });
}

export function loadLeadSource(worker: WorkerDefinition): Record<string, unknown>[] {
  if (!worker.source.path) {
    throw new Error(`Worker "${worker.key}" is missing source.path`);
  }
  return readJsonArray(path.resolve(process.cwd(), worker.source.path));
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
      company: `${asString(source.company || `TRD Lead ${index + 1}`)} ${Math.floor(index / Math.max(1, rows.length)) + 1}`,
      city: asString(source.city || "Metro Area"),
      state,
      businessType: "service",
      marketTier: "high-ticket"
    });
  }
  return expanded;
}

export function filterLeadPool(client: ClientAccount, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const states = new Set((client.leadBatchPolicy?.targetStates ?? ["NY", "NJ", "CT"]).map((entry) => entry.toUpperCase()));
  return rows.filter((row) => {
    const state = asString(row.state).toUpperCase();
    const businessType = asString(row.businessType || "service").toLowerCase();
    const marketTier = asString(row.marketTier || "high-ticket").toLowerCase();
    return states.has(state) && businessType.includes("service") && marketTier.includes("high-ticket");
  });
}
