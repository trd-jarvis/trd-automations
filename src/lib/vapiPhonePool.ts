import { env, teamRecipients } from "../config.js";
import { queueShareJob } from "./db.js";
import { EXPORT_DIR, writeJson } from "./fs.js";
import { attachAssistantToPhoneNumber, createProspectAssistant, listVapiPhoneNumbers, type VapiPhoneNumberRecord } from "./vapi.js";

function defaultAreaCodes(): string[] {
  return (env.VAPI_DEFAULT_AREA_CODES ?? "651,540,774")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function createVapiPhoneNumber(input: { areaCode: string; name: string; assistantId?: string }): Promise<Record<string, unknown>> {
  if (!env.VAPI_API_KEY) throw new Error("VAPI_API_KEY is not configured.");
  const response = await fetch(`${env.VAPI_BASE_URL}/phone-number`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      provider: "vapi",
      numberDesiredAreaCode: input.areaCode,
      name: input.name,
      assistantId: input.assistantId
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Vapi phone number create failed (${response.status}): ${raw.slice(0, 300)}`);
  }
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

export async function ensureVapiPhonePool(input?: {
  targetCount?: number;
  areaCodes?: string[];
  createDefaultAssistant?: boolean;
}): Promise<{
  targetCount: number;
  existingCount: number;
  createdCount: number;
  exportPath: string;
  shareJobId: string;
  phoneNumbers: VapiPhoneNumberRecord[];
}> {
  const targetCount = Math.max(1, Math.min(10, Math.trunc(input?.targetCount ?? 10)));
  const areaCodes = input?.areaCodes?.length ? input.areaCodes : defaultAreaCodes();
  const existing = await listVapiPhoneNumbers();
  let assistantId = env.VAPI_ASSISTANT_ID || undefined;

  if (input?.createDefaultAssistant && !assistantId) {
    const assistant = await createProspectAssistant({
      name: "TRD Pool Default",
      firstMessage: "Hi, this is True Rank Digital reaching out with a quick AI visibility note for your business.",
      systemPrompt: [
        "You are a default outbound assistant for True Rank Digital phone numbers.",
        "You sound concise, natural, and businesslike.",
        "If used directly, your only job is to confirm the call should be routed to a lead-specific assistant."
      ].join("\n"),
      metadata: { pool: "default" }
    });
    assistantId = assistant.id;
  }

  const created: Array<Record<string, unknown>> = [];
  const errors: Array<{ areaCode: string; error: string }> = [];
  for (let index = existing.length; index < targetCount; index += 1) {
    const areaCode = areaCodes[index % areaCodes.length] ?? areaCodes[0] ?? "651";
    try {
      const createdNumber = await createVapiPhoneNumber({
        areaCode,
        name: `TRD Pool ${String(index + 1).padStart(2, "0")}`,
        assistantId
      });
      created.push(createdNumber);
    } catch (error) {
      errors.push({
        areaCode,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const phoneNumbers = await listVapiPhoneNumbers();
  if (assistantId) {
    for (const phoneNumber of phoneNumbers) {
      if (phoneNumber.id && !phoneNumber.assistantId) {
        await attachAssistantToPhoneNumber(phoneNumber.id, assistantId).catch(() => undefined);
      }
    }
  }

  const exportPath = `${EXPORT_DIR}/${new Date().toISOString().replaceAll(":", "-")}-vapi-phone-pool.json`;
  writeJson(exportPath, {
    generatedAt: new Date().toISOString(),
    targetCount,
    existingCount: existing.length,
    createdCount: created.length,
    errors,
    assistantId: assistantId ?? null,
    phoneNumbers
  });
  const shareJobId = queueShareJob(exportPath, teamRecipients(), "Share Vapi phone pool inventory and creation results.");
  return {
    targetCount,
    existingCount: existing.length,
    createdCount: created.length,
    exportPath,
    shareJobId,
    phoneNumbers
  };
}
