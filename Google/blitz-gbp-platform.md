# Blitz GBP Platform Notes

Repo clone:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/trd-blitzai`

Env reference:

- `/Users/jarvis/Documents/TRD-VOICE/env/googleautomations.env`

## Repo shape

- `apps/web`: Next.js control plane and REST endpoints
- `apps/worker-ts`: live GBP executor and scheduled content dispatcher
- `packages/integrations-gbp`: Google Business Profile client, token handling, snapshots, reporting, review replies
- `supabase/migrations`: tenant data model, assets, actions-needed, orchestration settings

## Post automation path

- `apps/web/app/api/v1/clients/[clientId]/post-tool/route.ts`
- `apps/web/app/dashboard/clients/[clientId]/post-tool/page.tsx`
- `apps/worker-ts/src/executors/gbp-live.ts`

What matters:

- The post tool can queue one post or three posts at once.
- It dedupes by landing URL against queued drafts and scheduled artifacts.
- It filters assets through `client_media_assets.is_allowed_for_posts` and selected `photo_asset_ids`.
- It stores `dispatchActionType: "post_publish"` and action payload metadata on the queued content artifact.
- The live worker resolves TinyURL for the CTA and can generate QR-overlay media before publish.

## Review automation path

- `apps/web/app/api/v1/clients/[clientId]/review-ignition/webhook/route.ts`
- `apps/web/app/dashboard/clients/[clientId]/review-engine/page.tsx`

What matters:

- Review requests queue scheduled `content_artifacts`.
- Dispatch channels are `review_request_sms` and `review_request_email`.
- It enforces daily caps, cooldown minutes, delay minutes, jitter, and duplicate suppression.
- Manual reply work is routed into `actions_needed` with `actionType: "review_reply"`.

## Dispatcher path

- `apps/worker-ts/src/index.ts`
- `apps/worker-ts/src/scheduled-content.ts`

What matters:

- `REDIS_URL` enables queue mode.
- `SCHEDULED_CONTENT_DISPATCHER_ENABLED=true` enables due-artifact dispatch.
- Scheduled post artifacts are converted into worker actions with `objective: "publish_scheduled_artifact"` when needed.

## Supabase-backed objects to respect

- `client_orchestration_settings`
- `client_media_assets`
- `content_artifacts`
- `actions_needed`
- `integration_connections`
- `review_reply_history`

## Current operating rule for TRD automations

- When a future TRD automation needs GBP posts, review requests, review replies, or client asset awareness, it should target the Blitz repo flow first and only fall back to standalone scripts if the platform surface is missing.
