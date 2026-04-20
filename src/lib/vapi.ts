import { env, resolvedBookingUrl } from "../config.js";
import type { LeadRecord } from "../types.js";

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function apiBase(): string {
  return env.VAPI_BASE_URL;
}

function apiKey(): string {
  if (!env.VAPI_API_KEY) throw new Error("VAPI_API_KEY is not configured.");
  return env.VAPI_API_KEY;
}

async function requestJson(
  route: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const response = await fetch(`${apiBase()}${route}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Vapi request failed (${response.status}): ${raw.slice(0, 500)}`);
  }
  return raw ? JSON.parse(raw) as Record<string, unknown> | Array<Record<string, unknown>> : {};
}

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
}

export interface VapiPhoneNumberRecord {
  id: string;
  number?: string;
  name?: string;
  assistantId?: string;
}

export async function listVapiPhoneNumbers(): Promise<VapiPhoneNumberRecord[]> {
  const parsed = await requestJson("/phone-number");
  const rows = Array.isArray(parsed) ? parsed : toObjectArray((parsed as Record<string, unknown>).phoneNumbers);
  return rows
    .map((row) => ({
      id: safeString(row.id) ?? "",
      number: safeString(row.number),
      name: safeString(row.name),
      assistantId: safeString(row.assistantId)
    }))
    .filter((row) => row.id);
}

export async function listVapiAssistants(): Promise<Array<Record<string, unknown>>> {
  const parsed = await requestJson("/assistant");
  if (Array.isArray(parsed)) return parsed;
  return toObjectArray((parsed as Record<string, unknown>).assistants);
}

export async function attachAssistantToPhoneNumber(phoneNumberId: string, assistantId: string): Promise<Record<string, unknown>> {
  const patched = await requestJson(`/phone-number/${phoneNumberId}`, {
    method: "PATCH",
    body: { assistantId }
  });
  return Array.isArray(patched) ? (patched[0] ?? {}) : patched;
}

export async function createProspectAssistant(input: {
  name: string;
  firstMessage: string;
  systemPrompt: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; raw: Record<string, unknown> }> {
  const basePayload: Record<string, unknown> = {
    name: input.name.slice(0, 40),
    firstMessage: input.firstMessage,
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content: input.systemPrompt
        }
      ]
    },
    firstMessageMode: "assistant-speaks-first",
    voicemailDetection: {
      provider: "vapi",
      backoffPlan: {
        maxRetries: 6,
        startAtSeconds: 2,
        frequencySeconds: 2.5
      },
      beepMaxAwaitSeconds: 30
    },
    metadata: input.metadata ?? {}
  };

  if (env.VAPI_OUTBOUND_VOICE_PROVIDER && env.VAPI_OUTBOUND_VOICE_ID) {
    basePayload.voice = {
      provider: env.VAPI_OUTBOUND_VOICE_PROVIDER,
      voiceId: env.VAPI_OUTBOUND_VOICE_ID,
      name: env.VAPI_OUTBOUND_VOICE_NAME
    };
  }

  const payloads = [
    {
      ...basePayload,
      transcriber: {
        provider: "deepgram",
        model: "nova-2-phonecall",
        language: "en-US"
      }
    },
    {
      ...basePayload,
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en-US"
      }
    },
    basePayload
  ];

  for (const payload of payloads) {
    try {
      const parsed = await requestJson("/assistant", {
        method: "POST",
        body: payload
      });
      const raw = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
      const id = safeString(raw.id);
      if (id) return { id, raw };
    } catch (error) {
      if (payload === payloads[payloads.length - 1]) {
        throw error;
      }
    }
  }

  throw new Error("Vapi assistant creation returned no id.");
}

export async function createOutboundCall(lead: LeadRecord, input: {
  assistantId: string;
  phoneNumberId?: string;
  additionalVariables?: Record<string, string>;
}): Promise<{ id: string; raw: Record<string, unknown> }> {
  const bookingUrl = resolvedBookingUrl() ?? "";
  const payload: Record<string, unknown> = {
    assistantId: input.assistantId,
    customer: {
      number: lead.phone,
      name: lead.company
    },
    assistantOverrides: {
      variableValues: {
        leadCompany: lead.company,
        leadWebsite: lead.website ?? "",
        leadCity: lead.city ?? "",
        leadState: lead.state ?? "",
        bookingUrl,
        ...(input.additionalVariables ?? {})
      }
    },
    metadata: {
      leadId: lead.id,
      clientId: lead.clientId
    }
  };

  if (input.phoneNumberId) {
    payload.phoneNumberId = input.phoneNumberId;
  } else if (env.VAPI_PHONE_NUMBER_ID) {
    payload.phoneNumberId = env.VAPI_PHONE_NUMBER_ID;
  }

  const parsed = await requestJson("/call", {
    method: "POST",
    body: payload
  });
  const raw = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
  const id = safeString(raw.id);
  if (!id) {
    throw new Error("Vapi call creation did not return an id.");
  }
  return { id, raw };
}
