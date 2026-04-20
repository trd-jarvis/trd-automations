import { env } from "../config.js";
import { EXPORT_DIR, writeJson } from "./fs.js";
import { queueShareJob } from "./db.js";
import { teamRecipients } from "../config.js";

export interface VapiCreditStatus {
  enabled: boolean;
  minCredits: number;
  fetchOk: boolean;
  stopDialing: boolean;
  reason: string;
  checkedAt: string;
  availableCredits?: number;
  sourceEndpoint?: string;
  statusCode?: number;
  projectedRunwayDays?: number | null;
  projectedExhaustionDate?: string | null;
  recentCallCount?: number;
  recentCallCost?: number;
  recentDailyCost?: number;
}

interface CreditProbeRequest {
  endpoint: string;
  authMode?: "private" | "public";
}

const BASE_PROBES: CreditProbeRequest[] = [
  { endpoint: "/subscription" },
  { endpoint: "/account" },
  { endpoint: "/account/usage" },
  { endpoint: "/billing" },
  { endpoint: "/billing/subscription" },
  { endpoint: "/organization" },
  { endpoint: "/organization/usage" },
  { endpoint: "/org" },
  { endpoint: "/org/usage" }
];

function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function vapiCreditGuardEnabled(): boolean {
  return (env.VAPI_CREDIT_GUARD_ENABLED ?? "true").toLowerCase() !== "false";
}

function minCreditsToDial(): number {
  const parsed = Number(env.VAPI_MIN_CREDITS_TO_DIAL ?? "1");
  return Number.isFinite(parsed) ? parsed : 1;
}

function extractOrgId(payload: unknown): string {
  const visit = (node: unknown): string => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        const found = visit(entry);
        if (found) return found;
      }
      return "";
    }
    if (!isObject(node)) return "";
    const direct = asString(node.orgId);
    if (direct) return direct;
    for (const value of Object.values(node)) {
      const found = visit(value);
      if (found) return found;
    }
    return "";
  };
  return visit(payload);
}

function extractRemainingCredits(payload: unknown): number | undefined {
  const preferredPaths = [
    ["credits"],
    ["credit"],
    ["wallet", "credits"],
    ["wallet", "creditBalance"],
    ["remainingCredits"],
    ["creditsRemaining"],
    ["availableCredits"],
    ["creditBalance"],
    ["subscription", "credits"],
    ["subscription", "creditBalance"],
    ["billing", "remainingCredits"],
    ["billing", "creditsRemaining"],
    ["usage", "remainingCredits"],
    ["usage", "creditsRemaining"],
    ["account", "remainingCredits"],
    ["account", "creditsRemaining"]
  ];

  for (const path of preferredPaths) {
    let node = payload;
    let valid = true;
    for (const key of path) {
      if (!isObject(node)) {
        valid = false;
        break;
      }
      node = node[key];
    }
    if (valid) {
      const value = asNumber(node);
      if (value !== undefined) return value;
    }
  }

  const walk = (node: unknown, found: number[] = []): number[] => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, found);
      return found;
    }
    if (!isObject(node)) return found;
    for (const [key, value] of Object.entries(node)) {
      const lowered = key.toLowerCase();
      const numeric = asNumber(value);
      if (numeric !== undefined && (lowered.includes("credit") || lowered === "balance")) {
        found.push(numeric);
      }
      walk(value, found);
    }
    return found;
  };

  return walk(payload)[0];
}

async function requestJson(probe: CreditProbeRequest): Promise<{ status: number; payload?: unknown }> {
  if (!env.VAPI_API_KEY) throw new Error("Missing VAPI_API_KEY.");
  const authToken = probe.authMode === "public" ? (env.VAPI_PUBLIC_KEY || env.VAPI_API_KEY) : env.VAPI_API_KEY;
  const response = await fetch(`${env.VAPI_BASE_URL}${probe.endpoint}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json"
    }
  });
  const raw = await response.text();
  if (!raw.trim()) return { status: response.status, payload: {} };
  try {
    return { status: response.status, payload: JSON.parse(raw) };
  } catch {
    return { status: response.status, payload: { raw } };
  }
}

async function discoverOrgId(): Promise<string> {
  const probes: CreditProbeRequest[] = [{ endpoint: "/assistant?limit=1" }, { endpoint: "/assistant" }];
  for (const probe of probes) {
    try {
      const response = await requestJson(probe);
      if (response.status < 200 || response.status >= 300) continue;
      const orgId = extractOrgId(response.payload);
      if (orgId) return orgId;
    } catch {
      // continue
    }
  }
  return "";
}

async function listRecentCalls(days = 14): Promise<Array<Record<string, unknown>>> {
  if (!env.VAPI_API_KEY) return [];
  const createdAtGe = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(`${env.VAPI_BASE_URL}/call?limit=100&createdAtGe=${encodeURIComponent(createdAtGe)}`, {
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`,
      Accept: "application/json"
    }
  });
  const raw = await response.text();
  if (!response.ok) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      : [];
  } catch {
    return [];
  }
}

function estimateRunway(availableCredits: number | undefined, calls: Array<Record<string, unknown>>): Pick<VapiCreditStatus, "projectedRunwayDays" | "projectedExhaustionDate" | "recentCallCount" | "recentCallCost" | "recentDailyCost"> {
  const recentCallCost = calls.reduce((sum, call) => {
    const amount = asNumber(call.cost) ?? asNumber(call.costTotal) ?? asNumber(call.endedReasonCost) ?? 0;
    return sum + amount;
  }, 0);
  const recentCallCount = calls.length;
  const recentDailyCost = recentCallCost > 0 ? recentCallCost / 14 : 0;

  if (availableCredits === undefined || recentDailyCost <= 0) {
    return {
      projectedRunwayDays: null,
      projectedExhaustionDate: null,
      recentCallCount,
      recentCallCost,
      recentDailyCost
    };
  }

  const projectedRunwayDays = Number((availableCredits / recentDailyCost).toFixed(2));
  const projectedExhaustionDate = new Date(Date.now() + projectedRunwayDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    projectedRunwayDays,
    projectedExhaustionDate,
    recentCallCount,
    recentCallCost,
    recentDailyCost
  };
}

export async function getVapiCreditStatus(): Promise<VapiCreditStatus> {
  const checkedAt = nowIso();
  const minCredits = minCreditsToDial();

  if (!vapiCreditGuardEnabled()) {
    return {
      enabled: false,
      minCredits,
      fetchOk: false,
      stopDialing: false,
      reason: "disabled",
      checkedAt
    };
  }

  if (!env.VAPI_API_KEY) {
    return {
      enabled: true,
      minCredits,
      fetchOk: false,
      stopDialing: false,
      reason: "missing VAPI_API_KEY",
      checkedAt
    };
  }

  const orgId = await discoverOrgId();
  const probes = [
    ...(orgId ? [
      { endpoint: `/subscription/${encodeURIComponent(orgId)}` },
      { endpoint: `/organization/${encodeURIComponent(orgId)}` },
      { endpoint: `/org/${encodeURIComponent(orgId)}` },
      { endpoint: `/org/${encodeURIComponent(orgId)}`, authMode: "public" as const }
    ] : []),
    ...BASE_PROBES
  ];

  let lastStatus = 0;
  let sawUnsupported = false;
  for (const probe of probes) {
    try {
      const response = await requestJson(probe);
      lastStatus = response.status;
      if (response.status === 404 || response.status === 401) {
        sawUnsupported = true;
        continue;
      }
      if (response.status < 200 || response.status >= 300) continue;
      const availableCredits = extractRemainingCredits(response.payload);
      if (availableCredits === undefined) continue;
      const recentCalls = await listRecentCalls();
      return {
        enabled: true,
        minCredits,
        fetchOk: true,
        stopDialing: availableCredits <= minCredits,
        reason: availableCredits <= minCredits ? "credits at or below threshold" : "ok",
        checkedAt,
        availableCredits,
        sourceEndpoint: probe.endpoint,
        statusCode: response.status,
        ...estimateRunway(availableCredits, recentCalls)
      };
    } catch {
      // continue
    }
  }

  const recentCalls = await listRecentCalls();
  return {
    enabled: true,
    minCredits,
    fetchOk: false,
    stopDialing: false,
    reason: sawUnsupported
      ? "credit endpoint unsupported for current Vapi key/account"
      : lastStatus
        ? `credit endpoint unavailable (status=${lastStatus})`
        : "credit endpoint unavailable",
    checkedAt,
    statusCode: lastStatus || undefined,
    ...estimateRunway(undefined, recentCalls)
  };
}

export async function exportVapiCreditSnapshot(): Promise<{ exportPath: string; shareJobId: string; snapshot: VapiCreditStatus }> {
  const snapshot = await getVapiCreditStatus();
  const exportPath = `${EXPORT_DIR}/${new Date().toISOString().replaceAll(":", "-")}-vapi-credit-snapshot.json`;
  writeJson(exportPath, snapshot);
  const shareJobId = queueShareJob(exportPath, teamRecipients(), "Share Vapi credit snapshot and runway forecast.");
  return { exportPath, shareJobId, snapshot };
}
