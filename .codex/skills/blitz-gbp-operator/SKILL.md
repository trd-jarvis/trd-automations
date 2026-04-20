---
name: blitz-gbp-operator
description: Use this skill when the task depends on the cloned trd-blitzai platform for GBP post tooling, review ignition, scheduled content dispatch, Supabase-backed client assets, or operator approval flows.
---

# Blitz GBP Operator

Use this skill when the automation should operate against the cloned Blitz platform at `/Users/jarvis/Documents/TRD-AUTOMATIONS/trd-blitzai`.

## What Blitz actually does

- The control plane lives in `apps/web`.
- The live worker and scheduled dispatcher live in `apps/worker-ts`.
- GBP API logic lives in `packages/integrations-gbp`.
- Persistent client, asset, artifact, and action state lives in Supabase.

## High-value surfaces

### GBP Post Tool

- API: `apps/web/app/api/v1/clients/[clientId]/post-tool/route.ts`
- UI: `apps/web/app/dashboard/clients/[clientId]/post-tool/page.tsx`
- Use it to:
  - inspect sitemap URLs and approved media assets
  - queue one post or a `spawn3` batch
  - push queued drafts now
  - unschedule queued drafts

Important behavior:

- It creates `content_artifacts` with `dispatchActionType: "post_publish"`.
- It stores `landingUrl`, `mediaAssetId`, `toneOverride`, and `systemMessage` in metadata.
- The scheduled worker later resolves TinyURL, generates QR-overlay media when possible, and publishes the GBP post.

### Review Engine

- API: `apps/web/app/api/v1/clients/[clientId]/review-ignition/webhook/route.ts`
- UI: `apps/web/app/dashboard/clients/[clientId]/review-engine/page.tsx`
- Use it to:
  - queue review request SMS/email artifacts
  - enforce daily caps, cooldowns, jitter, and duplicate suppression
  - route manual review replies into the Actions Needed queue

Important behavior:

- Review requests are queued as `content_artifacts` with channels `review_request_sms` or `review_request_email`.
- Worker dispatch uses Twilio or SendGrid when the live env is enabled.

### Scheduled Dispatcher

- Worker entry: `apps/worker-ts/src/index.ts`
- Dispatcher: `apps/worker-ts/src/scheduled-content.ts`

Important behavior:

- When `REDIS_URL` is present and `SCHEDULED_CONTENT_DISPATCHER_ENABLED=true`, the worker continuously dispatches due scheduled artifacts.
- Post artifacts without explicit action payloads fall back to `objective: "publish_scheduled_artifact"`.

## Supabase model to respect

- `client_media_assets` controls which images are allowed for posts.
- `client_orchestration_settings` stores tone, post frequency, word-count range, sitemap/default URLs, and selected photo asset IDs.
- `content_artifacts` is the queue for drafts, scheduled items, published items, and failures.
- `actions_needed` is the operator approval queue for risky mutations and manual review replies.

## Env references

- Google automation env source: `/Users/jarvis/Documents/TRD-VOICE/env/googleautomations.env`
- Do not copy secrets into tracked files.
- Treat that env file as runtime reference only.

## Typical workflows

1. Posts:
   - inspect `/post-tool`
   - queue content artifacts
   - allow scheduled dispatcher to publish or use `push_now`
2. Reviews:
   - trigger `/review-ignition/webhook`
   - verify scheduled review artifacts
   - watch `Actions Needed` for manual review replies
3. Client seeding:
   - use `scripts/seed-gbp-clients.ts` to mirror connected GBP locations into client records

## Guardrails

- Prefer the Blitz repo’s APIs and worker queue over inventing direct GBP calls.
- Respect `client_media_assets.is_allowed_for_posts`.
- Respect operator approval status for risky changes.
- Do not assume live dispatch is safe until credentials are rotated and the target environment is confirmed.
