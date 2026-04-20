import path from "node:path";
import { ApifyClient } from "apify-client";
import { env, getApifyTokens, getWorkerDefinitions } from "../config.js";
import { queueApifyActorDiscoveryAnnouncement, queueApifyWorkerDigestAnnouncement } from "./announcements.js";
import { EXPORT_DIR, writeJson } from "./fs.js";
import { queueShareJob } from "./db.js";
import { teamRecipients } from "../config.js";

interface ApifyRunRecord {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  usageTotalUsd?: number;
  defaultDatasetId?: string;
}

interface WorkerHealthSummary {
  workerKey: string;
  workerLabel: string;
  actorId: string;
  actorTitle: string;
  actorUrl: string;
  status: "healthy" | "degraded";
  lastRunStatus: string;
  lastRunStartedAt?: string;
  spend24hUsd: number;
  spend7dUsd: number;
  recentRuns: ApifyRunRecord[];
  reason: string;
}

interface ApifyAccountSummary {
  username: string;
  email?: string;
  planTier: string;
  monthlyCreditsUsd: number;
  tokenLabel: string;
}

interface DiscoveryCandidate {
  id: string;
  title: string;
  url: string;
  username: string;
  name: string;
  description: string;
  categories: string[];
  actorReviewRating: number;
  actorReviewCount: number;
  totalUsers30Days: number;
  lastRunStartedAt?: string;
  pricingModel?: string;
  score: number;
  reason: string;
}

const DISCOVERY_QUERIES = [
  "google maps lead generation",
  "google business profile automation",
  "local seo audit",
  "review management",
  "citation audit",
  "brand monitoring ai"
];

function getTokenPool(): Array<{ token: string; tokenLabel: string }> {
  const tokens = [...new Set(getApifyTokens())];
  if (tokens.length === 0) {
    throw new Error("No Apify token configured.");
  }
  return tokens.map((token, index) => ({ token, tokenLabel: `account-${index + 1}` }));
}

function getApifyClient(token?: string): ApifyClient {
  const resolved = token ?? getTokenPool()[0]?.token;
  if (!resolved) {
    throw new Error("No Apify token configured.");
  }
  return new ApifyClient({ token: resolved });
}

function actorRoute(actorId: string): string {
  return actorId.includes("/") ? actorId.replace("/", "~") : actorId;
}

function actorConsoleUrl(actorId: string): string {
  return `https://console.apify.com/actors/${actorRoute(actorId)}`;
}

async function listRuns(actorId: string, token: string, limit = 25): Promise<ApifyRunRecord[]> {
  const client = getApifyClient(token);
  const response = await client.httpClient.call({
    url: `https://api.apify.com/v2/acts/${actorRoute(actorId)}/runs`,
    method: "GET",
    params: {
      token,
      limit,
      desc: true
    }
  });
  const items = (response.data?.data?.items ?? []) as Array<Record<string, unknown>>;
  return items.map((item) => ({
    id: String(item.id),
    status: String(item.status),
    startedAt: typeof item.startedAt === "string" ? item.startedAt : undefined,
    finishedAt: typeof item.finishedAt === "string" ? item.finishedAt : undefined,
    usageTotalUsd: typeof item.usageTotalUsd === "number" ? item.usageTotalUsd : Number(item.usageTotalUsd ?? 0),
    defaultDatasetId: typeof item.defaultDatasetId === "string" ? item.defaultDatasetId : undefined
  }));
}

function isoAgeHours(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return (Date.now() - timestamp) / 3_600_000;
}

function sumSpend(runs: ApifyRunRecord[], hours: number): number {
  return runs
    .filter((run) => {
      const age = isoAgeHours(run.startedAt);
      return age !== null && age <= hours;
    })
    .reduce((sum, run) => sum + (run.usageTotalUsd ?? 0), 0);
}

function sortTimestamp(run: ApifyRunRecord): number {
  const raw = run.startedAt ?? run.finishedAt;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getApifyWorkerHealthDigest(): Promise<{
  accounts: ApifyAccountSummary[];
  workers: WorkerHealthSummary[];
  totals: {
    accountCount: number;
    monthlyCreditsUsd: number;
    workerCount: number;
    healthyWorkers: number;
    degradedWorkers: number;
    spend24hUsd: number;
    spend7dUsd: number;
  };
}> {
  const tokenPool = getTokenPool();
  const accountResults = await Promise.all(tokenPool.map(async ({ token, tokenLabel }) => {
    const user = await getApifyClient(token).user().get();
    return {
      username: user?.username ?? tokenLabel,
      email: user?.email ?? undefined,
      planTier: user?.plan?.id ?? "UNKNOWN",
      monthlyCreditsUsd: Number(user?.plan?.monthlyUsageCreditsUsd ?? 0),
      tokenLabel
    } satisfies ApifyAccountSummary;
  }));
  const workerDefs = getWorkerDefinitions().filter((worker) => worker.source.type === "apify-actor" && worker.source.actorId);
  const workers = await Promise.all(workerDefs.map(async (worker) => {
    const actor = await getApifyClient(tokenPool[0]?.token).actor(worker.source.actorId!).get();
    const runBuckets = await Promise.all(
      tokenPool.map(async ({ token }) => listRuns(worker.source.actorId!, token, 25).catch(() => []))
    );
    const recentRuns = runBuckets
      .flat()
      .sort((left, right) => sortTimestamp(right) - sortTimestamp(left))
      .slice(0, 25);
    const lastRun = recentRuns[0];
    const spend24hUsd = sumSpend(recentRuns, 24);
    const spend7dUsd = sumSpend(recentRuns, 24 * 7);
    const lastAge = isoAgeHours(lastRun?.startedAt);
    const degradedReason = !lastRun
      ? "No recent actor runs."
      : lastRun.status !== "SUCCEEDED"
        ? `Latest run status is ${lastRun.status}.`
        : lastAge !== null && lastAge > 36
          ? `Latest run is ${lastAge.toFixed(1)} hours old.`
          : "";

    return {
      workerKey: worker.key,
      workerLabel: worker.label,
      actorId: worker.source.actorId!,
      actorTitle: actor?.title ?? worker.label,
      actorUrl: actorConsoleUrl(worker.source.actorId!),
      status: degradedReason ? "degraded" : "healthy",
      lastRunStatus: lastRun?.status ?? "NO_RUNS",
      lastRunStartedAt: lastRun?.startedAt,
      spend24hUsd,
      spend7dUsd,
      recentRuns,
      reason: degradedReason || "Recent run status is healthy."
    } satisfies WorkerHealthSummary;
  }));

  return {
    accounts: accountResults,
    workers,
    totals: {
      accountCount: accountResults.length,
      monthlyCreditsUsd: accountResults.reduce((sum, account) => sum + account.monthlyCreditsUsd, 0),
      workerCount: workers.length,
      healthyWorkers: workers.filter((worker) => worker.status === "healthy").length,
      degradedWorkers: workers.filter((worker) => worker.status === "degraded").length,
      spend24hUsd: workers.reduce((sum, worker) => sum + worker.spend24hUsd, 0),
      spend7dUsd: workers.reduce((sum, worker) => sum + worker.spend7dUsd, 0)
    }
  };
}

export async function exportApifyWorkerHealthDigest(options?: {
  recipient?: string;
  cc?: string[];
  queueAnnouncement?: boolean;
}): Promise<{
  exportPath: string;
  shareJobId: string;
  announcementId?: string;
  htmlPath?: string;
  digest: Awaited<ReturnType<typeof getApifyWorkerHealthDigest>>;
}> {
  const digest = await getApifyWorkerHealthDigest();
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-apify-worker-health.json`);
  writeJson(exportPath, digest);
  const shareJobId = queueShareJob(exportPath, teamRecipients(), "Share Apify worker health digest.");

  let queued: { announcementId: string; htmlPath: string } | undefined;
  if (options?.queueAnnouncement) {
    queued = queueApifyWorkerDigestAnnouncement({
      recipient: options.recipient ?? "jon@truerankdigital.com",
      cc: options.cc ?? ["bishop@truerankdigital.com"],
      accountCount: digest.totals.accountCount,
      planTier: digest.accounts.map((account) => `${account.username} (${account.planTier})`).join(", "),
      monthlyCreditsUsd: digest.totals.monthlyCreditsUsd,
      spend24hUsd: digest.totals.spend24hUsd,
      spend7dUsd: digest.totals.spend7dUsd,
      workerCount: digest.totals.workerCount,
      healthyWorkers: digest.totals.healthyWorkers,
      degradedWorkers: digest.totals.degradedWorkers,
      actorCreditsUrl: "https://console.apify.com/account/usage",
      artifactPath: exportPath,
      workerHighlights: digest.workers.map((worker) => ({
        label: worker.workerLabel,
        status: worker.status,
        spend24hUsd: worker.spend24hUsd,
        lastRunStatus: worker.lastRunStatus
      }))
    });
  }

  return {
    exportPath,
    shareJobId,
    announcementId: queued?.announcementId,
    htmlPath: queued?.htmlPath,
    digest
  };
}

async function searchActors(query: string, limit = 8): Promise<Array<Record<string, unknown>>> {
  const token = getTokenPool()[0]?.token;
  const client = getApifyClient(token);
  const response = await client.httpClient.call({
    url: "https://api.apify.com/v2/store",
    method: "GET",
    params: {
      token,
      search: query,
      limit
    }
  });
  return (response.data?.data?.items ?? []) as Array<Record<string, unknown>>;
}

function buildCandidateScore(item: Record<string, unknown>, query: string): { score: number; reason: string } {
  const description = String(item.description ?? "").toLowerCase();
  const title = String(item.title ?? "");
  const categories = Array.isArray(item.categories) ? item.categories.map((entry) => String(entry)) : [];
  const rating = Number(item.actorReviewRating ?? 0);
  const reviewCount = Number(item.actorReviewCount ?? 0);
  const totalUsers30Days = Number((item.stats as Record<string, unknown> | undefined)?.totalUsers30Days ?? 0);
  const lastRun = typeof (item.stats as Record<string, unknown> | undefined)?.lastRunStartedAt === "string"
    ? String((item.stats as Record<string, unknown>).lastRunStartedAt)
    : undefined;
  const recencyHours = isoAgeHours(lastRun) ?? 9999;
  const relevanceHits = [
    description.includes("google business profile"),
    description.includes("google maps"),
    description.includes("local seo"),
    description.includes("review"),
    description.includes("lead"),
    description.includes("citation"),
    title.toLowerCase().includes("google")
  ].filter(Boolean).length;
  const categoryHits = categories.filter((entry) => ["LEAD_GENERATION", "SEO_TOOLS", "AUTOMATION", "AI", "SOCIAL_MEDIA"].includes(entry)).length;
  const score = Math.round(
    relevanceHits * 20
      + categoryHits * 8
      + rating * 10
      + Math.min(reviewCount, 50)
      + Math.min(totalUsers30Days / 20, 30)
      + Math.max(0, 24 - Math.min(recencyHours, 24))
  );
  return {
    score,
    reason: `${query} match; ${rating.toFixed(1)} rating across ${reviewCount} reviews; ${totalUsers30Days} users in 30 days`
  };
}

export async function discoverApifyActors(): Promise<{ candidates: DiscoveryCandidate[]; queries: string[] }> {
  const bucket = new Map<string, DiscoveryCandidate>();
  for (const query of DISCOVERY_QUERIES) {
    const items = await searchActors(query, 8);
    for (const item of items) {
      const id = String(item.id);
      if (!id) continue;
      const scored = buildCandidateScore(item, query);
      const current = bucket.get(id);
      const candidate: DiscoveryCandidate = {
        id,
        title: String(item.title ?? ""),
        url: String(item.url ?? ""),
        username: String(item.username ?? ""),
        name: String(item.name ?? ""),
        description: String(item.description ?? ""),
        categories: Array.isArray(item.categories) ? item.categories.map((entry) => String(entry)) : [],
        actorReviewRating: Number(item.actorReviewRating ?? 0),
        actorReviewCount: Number(item.actorReviewCount ?? 0),
        totalUsers30Days: Number((item.stats as Record<string, unknown> | undefined)?.totalUsers30Days ?? 0),
        lastRunStartedAt: typeof (item.stats as Record<string, unknown> | undefined)?.lastRunStartedAt === "string"
          ? String((item.stats as Record<string, unknown>).lastRunStartedAt)
          : undefined,
        pricingModel: typeof (item.currentPricingInfo as Record<string, unknown> | undefined)?.pricingModel === "string"
          ? String((item.currentPricingInfo as Record<string, unknown>).pricingModel)
          : undefined,
        score: scored.score,
        reason: scored.reason
      };
      if (!current || candidate.score > current.score) {
        bucket.set(id, candidate);
      }
    }
  }

  return {
    queries: DISCOVERY_QUERIES,
    candidates: Array.from(bucket.values())
      .filter((candidate) => candidate.score >= 70)
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
  };
}

export async function exportApifyActorDiscovery(options?: {
  recipient?: string;
  cc?: string[];
  queueAnnouncement?: boolean;
}): Promise<{
  exportPath: string;
  shareJobId: string;
  announcementId?: string;
  htmlPath?: string;
  result: Awaited<ReturnType<typeof discoverApifyActors>>;
}> {
  const result = await discoverApifyActors();
  const exportPath = path.join(EXPORT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-apify-actor-discovery.json`);
  writeJson(exportPath, result);
  const shareJobId = queueShareJob(exportPath, teamRecipients(), "Share Apify actor discovery results.");

  let queued: { announcementId: string; htmlPath: string } | undefined;
  if (options?.queueAnnouncement) {
    queued = queueApifyActorDiscoveryAnnouncement({
      recipient: options.recipient ?? "jon@truerankdigital.com",
      cc: options.cc ?? ["bishop@truerankdigital.com"],
      candidateCount: result.candidates.length,
      topCandidates: result.candidates.map((candidate) => ({
        title: candidate.title,
        url: candidate.url,
        score: candidate.score,
        reason: candidate.reason
      })),
      artifactPath: exportPath
    });
  }

  return {
    exportPath,
    shareJobId,
    announcementId: queued?.announcementId,
    htmlPath: queued?.htmlPath,
    result
  };
}

export function apifyPlatformUsageUrl(): string {
  return env.APIFY_PRIMARY_TOKEN || getApifyTokens()[0]
    ? "https://console.apify.com/account/usage"
    : actorConsoleUrl("compass/crawler-google-places");
}
