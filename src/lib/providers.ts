import { env, getChannelTargets } from "../config.js";
import type { IntegrationStatus } from "../types.js";

function hasAll(values: Array<string | undefined>): boolean {
  return values.every((value) => Boolean(value && value.trim()));
}

export function healthStatuses(): IntegrationStatus[] {
  const slackTarget = getChannelTargets().find((target) => target.type === "slack");

  return [
    {
      key: "apify",
      label: "Apify",
      status: getApifyStatus(),
      requiredEnv: ["APIFY_PRIMARY_TOKEN or APIFY_TOKENS"],
      message: getApifyStatus() === "ready" ? "Actor execution available." : "Using local fixtures until Apify token is configured.",
      usesPlugin: false
    },
    {
      key: "dataforseo",
      label: "DataForSEO",
      status: hasAll([env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD]) ? "ready" : "missing",
      requiredEnv: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
      message: hasAll([env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD]) ? "Ready for enrichment." : "Credentials missing.",
      usesPlugin: false
    },
    {
      key: "gemini",
      label: "Gemini",
      status: env.GEMINI_API_KEY ? "ready" : "missing",
      requiredEnv: ["GEMINI_API_KEY"],
      message: env.GEMINI_API_KEY ? `Using ${env.GEMINI_MODEL}.` : "No Gemini key configured.",
      usesPlugin: false
    },
    {
      key: "ghl",
      label: "GoHighLevel",
      status: hasAll([env.GHL_API_KEY, env.GHL_LOCATION_ID]) ? "ready" : "missing",
      requiredEnv: ["GHL_API_KEY", "GHL_LOCATION_ID"],
      message: hasAll([env.GHL_API_KEY, env.GHL_LOCATION_ID]) ? "CRM sync is available." : "CRM sync remains local-log only.",
      usesPlugin: false
    },
    {
      key: "twilio",
      label: "Twilio SMS",
      status: hasAll([env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER]) ? "ready" : "missing",
      requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
      message: hasAll([env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER])
        ? "Live SMS dispatch can be enabled after approval."
        : "Dispatch stays preview-only.",
      usesPlugin: false
    },
    {
      key: "vapi",
      label: "Vapi Voice",
      status: hasAll([env.VAPI_API_KEY, env.VAPI_ASSISTANT_ID]) ? "ready" : "missing",
      requiredEnv: ["VAPI_API_KEY", "VAPI_ASSISTANT_ID"],
      message: hasAll([env.VAPI_API_KEY, env.VAPI_ASSISTANT_ID])
        ? "Live call creation can be enabled after approval."
        : "Voice dispatch stays preview-only.",
      usesPlugin: false
    },
    {
      key: "gmail-plugin",
      label: "Gmail Plugin",
      status: "degraded",
      requiredEnv: [],
      message: "Connector-driven delivery is expected from Codex at run time; queue/payload flow is implemented locally.",
      usesPlugin: true
    },
    {
      key: "google-drive-api",
      label: "Google Drive API",
      status: hasAll([env.GOOGLE_DRIVE_FOLDER_ID]) && Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) ? "ready" : "missing",
      requiredEnv: ["GOOGLE_DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON_PATH or GOOGLE_SERVICE_ACCOUNT_JSON"],
      message: hasAll([env.GOOGLE_DRIVE_FOLDER_ID]) && Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH)
        ? "Artifact upload and sharing can run from the repo."
        : "Drive uploads remain queued locally until Google API credentials are configured.",
      usesPlugin: false
    },
    {
      key: "blitz-supabase",
      label: "Blitz Supabase",
      status: hasAll([env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY]) ? "ready" : "missing",
      requiredEnv: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
      message: hasAll([env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY])
        ? "Readiness audits and post planning can query the live Blitz data model."
        : "Load googleautomations.env to enable Blitz audits and queue management.",
      usesPlugin: false
    },
    {
      key: "slack-relay",
      label: "Slack Relay",
      status: slackTarget?.placeholder ? "degraded" : hasAll([env.SLACK_BOT_TOKEN]) ? "ready" : "missing",
      requiredEnv: ["SLACK_BOT_TOKEN", "DEFAULT_SLACK_CHANNEL"],
      message: slackTarget?.placeholder
        ? "Placeholder channel target configured. Add real channel IDs later."
        : hasAll([env.SLACK_BOT_TOKEN, env.DEFAULT_SLACK_CHANNEL])
          ? "Relay can post once the app is in-channel."
          : "Relay is configured for placeholders only.",
      usesPlugin: true
    }
  ];
}

function getApifyStatus(): "ready" | "missing" {
  return env.APIFY_PRIMARY_TOKEN || env.APIFY_TOKENS ? "ready" : "missing";
}
