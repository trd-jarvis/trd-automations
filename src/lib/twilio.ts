import { Buffer } from "node:buffer";
import { env } from "../config.js";

export interface TwilioSmsResult {
  sid?: string;
  status: number;
}

function normalizePhone(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function authHeader(): string {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured.");
  }
  return Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

export async function sendTwilioSms(input: { to: string; body: string }): Promise<TwilioSmsResult> {
  if (!env.TWILIO_PHONE_NUMBER) {
    throw new Error("TWILIO_PHONE_NUMBER is not configured.");
  }
  const to = normalizePhone(input.to);
  const from = normalizePhone(env.TWILIO_PHONE_NUMBER);
  if (!to || !from) {
    throw new Error("A valid to/from phone number is required.");
  }

  const form = new URLSearchParams({
    To: to,
    From: from,
    Body: input.body.replace(/\s+/g, " ").trim().slice(0, 1400)
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader()}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio SMS failed (${response.status}): ${raw.slice(0, 400)}`);
  }

  const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  return {
    sid: typeof parsed.sid === "string" ? parsed.sid : undefined,
    status: response.status
  };
}
