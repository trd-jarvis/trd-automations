import path from "node:path";
import type { LeadRecord } from "../types.js";
import { DESKTOP_LEADS_DIR, writeCsv } from "./fs.js";

const PRIORITY_RAW_KEYS = [
  "ownerName",
  "contactName",
  "contactFirstName",
  "contactLastName",
  "contactTitle",
  "secondaryEmail",
  "secondaryPhone",
  "address",
  "street",
  "street1",
  "street2",
  "zip",
  "postalCode",
  "country",
  "category",
  "primaryCategory",
  "secondaryCategories",
  "facebook",
  "facebookUrl",
  "instagram",
  "instagramUrl",
  "linkedin",
  "linkedinUrl",
  "youtube",
  "youtubeUrl",
  "tiktok",
  "tiktokUrl",
  "x",
  "xUrl",
  "twitter",
  "twitterUrl",
  "pinterest",
  "pinterestUrl",
  "yelp",
  "yelpUrl",
  "gbpUrl",
  "googleBusinessProfile",
  "websiteContactPage",
  "contactPage"
];

function scalar(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function pickRawKeys(leads: LeadRecord[]): string[] {
  const keys = new Set<string>();
  for (const lead of leads) {
    for (const key of Object.keys(lead.raw)) {
      if (!keys.has(key)) keys.add(key);
    }
  }

  const prioritized = PRIORITY_RAW_KEYS.filter((key) => keys.has(key));
  const remaining = Array.from(keys)
    .filter((key) => !PRIORITY_RAW_KEYS.includes(key))
    .sort((left, right) => left.localeCompare(right));
  return [...prioritized, ...remaining];
}

export function exportLeadsCsv(clientId: string, workerKey: string, leads: LeadRecord[]): string {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const filePath = path.join(DESKTOP_LEADS_DIR, `${stamp}-${clientId}-${workerKey}-leads.csv`);
  const rawKeys = pickRawKeys(leads);
  const headers = [
    "id",
    "clientId",
    "workerKey",
    "company",
    "website",
    "phone",
    "email",
    "city",
    "state",
    "rating",
    "reviewCount",
    "weaknessSignals",
    "weaknessScore",
    "qualificationScore",
    "recommendedChannel",
    "status",
    ...rawKeys.map((key) => `raw.${key}`)
  ];

  const rows = leads.map((lead) => {
    const base: Record<string, unknown> = {
      id: lead.id,
      clientId: lead.clientId,
      workerKey: lead.workerKey,
      company: lead.company,
      website: lead.website ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      rating: lead.rating ?? "",
      reviewCount: lead.reviewCount ?? "",
      weaknessSignals: lead.weaknessSignals.join(" | "),
      weaknessScore: lead.weaknessScore,
      qualificationScore: lead.qualificationScore,
      recommendedChannel: lead.recommendedChannel,
      status: lead.status
    };
    for (const key of rawKeys) {
      base[`raw.${key}`] = scalar(lead.raw[key]);
    }
    return base;
  });

  writeCsv(filePath, headers, rows);
  return filePath;
}
