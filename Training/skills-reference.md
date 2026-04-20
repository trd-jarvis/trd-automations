# Skills Reference

This document explains the repo-local skills that power the TRD automation stack. It focuses on what each skill is responsible for, what command surface it maps to, and which automations use it.

## 1. Why Skills Matter

In this repo, a skill is not just documentation. It is the operating contract that tells Codex:

- which command to run
- which guardrails matter
- what success looks like
- what should happen next

Automations refer to skills, and skills point to commands. That means the skill layer is the bridge between natural-language automation prompts and the local runtime.

## 2. Skill Categories

## 2.1 Monitoring And Reporting

- `ai-visibility-positive-monitor`
- `ai-visibility-negative-monitor`
- `client-report-dispatcher`
- `client-contact-completion-announce`
- `apify-worker-health-digest`
- `apify-actor-discovery`

## 2.2 Lead Generation And Qualification

- `gbp-lead-scraper`
- `lead-enrichment-and-scoring`
- `jose-queue-packager`
- `approval-gated-outreach-planner`
- `generated-lead-ghl-sync`

## 2.3 GBP / Blitz Operations

- `blitz-gbp-operator`
- `blitz-gbp-readiness-audit`
- `blitz-gbp-post-queue-manager`

## 2.4 Outbound Channels

- `outbound-email-automation`
- `vapi-credit-watch`
- `vapi-phone-pool-manager`
- `vapi-voice-batch-automation`
- `vapi-operator`
- `outbound-sms-followup-automation`

## 2.5 Artifact And Admin Operations

- `drive-share-operator`
- `ops-relay-and-google-share`
- `repo-sync-publisher`

## 3. Detailed Skill Notes

## 3.1 `gbp-lead-scraper`

### Role

Stages a real Apify-backed batch of lead opportunities.

### Command

- `npm run lead:scrape -- --client <client-id> --worker gbp-weakness-scan --limit 200`

### What It Produces

- live lead rows from Apify
- Desktop CSV under `/Users/jarvis/Desktop/Leads`
- preserved contact and social enrichment data

### Guardrails

- do not fabricate missing leads
- do not expand fixtures when the source is live Apify
- scraping alone must not trigger outreach

### Used By

- `TRD Lead Pipeline`

## 3.2 `lead-enrichment-and-scoring`

### Role

Scores staged leads and turns them into structured decision objects.

### Command

- `npm run lead:score -- --client <client-id>`

### What It Produces

- updated lead qualification
- approval IDs
- dispatch plans

### Guardrails

- stay local-first
- do not treat scoring as permission to send

### Used By

- `TRD Lead Pipeline`
- any manual approval-review workflow

## 3.3 `jose-queue-packager`

### Role

Packages a clean outbound queue for Jose.

### Commands

1. `npm run lead:scrape -- --client <client-id> --worker gbp-weakness-scan --limit 200`
2. `npm run lead:score -- --client <client-id>`
3. `npm run jose:queue -- --client <client-id>`

### What It Produces

- Jose queue export
- call-ready summary

### Guardrails

- preserve tri-state targeting
- preserve service-business/high-ticket filtering
- do not auto-send outreach

### Used By

- `TRD Lead Pipeline`

## 3.4 `drive-share-operator`

### Role

Flushes queued share jobs to Google Drive.

### Command

- `npm run share:drive`

### What It Produces

- uploaded and shared artifacts
- updated share-job status

### Guardrails

- queued is not the same as delivered
- keep uploads idempotent
- the local Desktop/export artifact remains the source file
- for lead artifacts, make sure Jon is included in sharing

### Used By

- `TRD Lead Pipeline`
- `TRD AI Visibility`
- `TRD Blitz Readiness`

## 3.5 `outbound-email-automation`

### Role

Builds outbound email previews from generated leads.

### Command

- `npm run outreach:email-send -- --client <clientId> --limit 200`

### What It Produces

- HTML email previews
- Gmail payload JSON
- share jobs

### Tone Intent

- direct
- human
- slightly humorous
- not bland

### Used By

- `TRD Outbound Email Prep`

## 3.6 `outbound-sms-followup-automation`

### Role

Builds post-call SMS follow-ups for generated leads.

### Commands

- Preview: `npm run sms:followup -- --client <clientId> --limit 10`
- Live: `npm run sms:followup -- --client <clientId> --limit 10 --live`

### What It Produces

- SMS preview/export artifacts
- optional live sends

### Content Rules

- mention the earlier email
- include the booking link
- keep the copy slightly comical

### Used By

- `TRD SMS Follow-up Prep`

## 3.7 `vapi-credit-watch`

### Role

Monitors Vapi budget health and runway.

### Commands

- `npm run vapi:credits`
- `npm run vapi:credits -- --export`

### What It Produces

- credit snapshot
- runway estimate when data exists
- stop-dialing signal when needed

### Used By

- `TRD Vapi Credit Watch`
- `TRD Voice Batch Prep`

## 3.8 `vapi-phone-pool-manager`

### Role

Maintains the outbound phone-number pool for Vapi voice rotation.

### Commands

- `npm run vapi:numbers`
- `npm run vapi:numbers:ensure -- --count 10 --area-codes 651,540,774`

### What It Produces

- phone inventory visibility
- number creation/assignment when required

### Used By

- `TRD Vapi Phone Pool`

## 3.9 `vapi-voice-batch-automation`

### Role

Builds the rotating 10-lead voice batch.

### Commands

- Preview: `npm run voice:batch -- --client <clientId> --batch-size 10`
- Live: `npm run voice:batch -- --client <clientId> --batch-size 10 --live`

### What It Produces

- voice batch export
- lead-specific assistant/call context
- optional live queueing in live mode

### Important Note

- this skill operates on generated leads, not GHL-origin contacts

### Used By

- `TRD Voice Batch Prep`

## 3.10 `generated-lead-ghl-sync`

### Role

Pushes generated leads into GHL without shifting the workflow source of truth away from this repo.

### Command

- `npm run lead:sync-ghl -- --client <clientId> --limit 200`

### What It Produces

- synced CRM contacts
- tags and notes for filterability
- export JSON

### Used By

- `TRD Lead To GHL Sync`

## 3.11 `repo-sync-publisher`

### Role

Publishes the repo’s own operational trail.

### Command

- `npm run log:publish`

### What It Produces

- run-summary export
- Git commit and push when needed

### Used By

- `TRD Repo Sync`

## 3.12 `apify-worker-health-digest`

### Role

Produces the operational Apify digest.

### Command Sequence

1. `npm run apify:healthcheck -- --queue`
2. `npm run announce:payload -- --announcement-id <id>`
3. Gmail send
4. `npm run announce:mark-sent -- --announcement-id <id> --message-id <gmail-id>`

### What It Produces

- JSON digest
- HTML announcement
- send-ready Gmail payload

### Used By

- `TRD Apify Worker Digest`

## 3.13 `apify-actor-discovery`

### Role

Searches the Apify store for new relevant actors.

### Command Sequence

1. `npm run apify:discover -- --queue`
2. `npm run announce:payload -- --announcement-id <id>`
3. Gmail send
4. `npm run announce:mark-sent -- --announcement-id <id> --message-id <gmail-id>`

### Used By

- `TRD Apify Actor Discovery`

## 3.14 `blitz-gbp-readiness-audit`

### Role

Audits which clients are actually ready for Blitz GBP operations.

### Command

- `npm run blitz:readiness`

### What It Produces

- readiness export
- internal announcement

### Used By

- `TRD Blitz Readiness`

## 3.15 `blitz-gbp-post-queue-manager`

### Role

Builds GBP post queue plans from live Blitz readiness and asset state.

### Command

- `npm run blitz:post-plan -- --client <client-id>`

### Used By

- `TRD Blitz Post Plans`

## 3.16 `client-contact-completion-announce`

### Role

Handles the one-time internal completion email around the client-contact automation milestone.

### Command Sequence

1. `npm run announce:queue -- --type client-contact-completion`
2. `npm run announce:payload -- --announcement-id <id>`
3. Gmail send
4. `npm run announce:mark-sent -- --announcement-id <id> --message-id <gmail-id>`

### Used By

- `Client Contact Announce`

## 3.17 `ai-visibility-positive-monitor`

### Role

Runs the positive-only monitoring pipeline.

### Command Sequence

1. `npm run worker:run -- --client <client-id>`
2. `npm run signal:split -- --client <client-id>`
3. `npm run report:queue -- --client <client-id>`

### Used By

- `TRD AI Visibility`

## 3.18 `ai-visibility-negative-monitor`

### Role

Runs the internal optimization side of monitoring.

### Typical Use

- manual/internal backlog work
- negative or neutral issue review

### Current Automation Usage

- not currently wired into a named recurring TRD automation, but it is part of the repo’s capability surface

## 3.19 `client-report-dispatcher`

### Role

Handles client report queueing, payload exposure, and sent-state marking.

### Commands

- `npm run report:queue -- --client <client-id>`
- `npm run report:payload -- --client <client-id>`
- `npm run report:mark-sent -- --client <client-id> --report-id <id> --message-id <gmail-id>`

### Used By

- `TRD AI Visibility`

## 3.20 `approval-gated-outreach-planner`

### Role

Provides the approval-review surface for outbound drafts and dispatch plans.

### Commands

- `npm run lead:score -- --client <client-id>`
- `npm run approval:list -- --status PENDING`

### Current Use

- supports the outbound architecture even if not directly named in an active recurring automation prompt

## 3.21 `blitz-gbp-operator`, `vapi-operator`, `ops-relay-and-google-share`

### Role

These are operator-facing support skills.

They exist for:

- deeper Blitz repo/platform handling
- direct Vapi operator control
- broader artifact relay/share tasks

They are useful when a human or Codex needs a more manual, contextual workflow outside the narrower recurring automation prompts.

## 4. Skill Reuse Map

| Skill | Main Downstream Effect |
| --- | --- |
| `gbp-lead-scraper` | creates the live lead pool |
| `lead-enrichment-and-scoring` | makes leads decision-ready |
| `jose-queue-packager` | makes leads operator-ready |
| `generated-lead-ghl-sync` | mirrors local leads into CRM |
| `outbound-email-automation` | builds email previews |
| `vapi-credit-watch` | protects voice budget |
| `vapi-phone-pool-manager` | protects phone inventory |
| `vapi-voice-batch-automation` | prepares the next call wave |
| `outbound-sms-followup-automation` | prepares text follow-up |
| `ai-visibility-positive-monitor` | creates reportable wins |
| `client-report-dispatcher` | turns wins into Gmail payloads |
| `blitz-gbp-readiness-audit` | separates ready vs blocked GBP clients |
| `blitz-gbp-post-queue-manager` | turns readiness into actionable post plans |
| `apify-worker-health-digest` | keeps scraping transparent and budget-aware |
| `apify-actor-discovery` | keeps tooling research alive |
| `repo-sync-publisher` | preserves change history |
