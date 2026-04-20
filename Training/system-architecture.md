# TRD Automation System Architecture

## 1. System Purpose

The TRD automation stack is a local-first orchestration repo that turns Codex into an operations layer for:

- AI visibility monitoring
- Google Business Profile readiness and posting operations
- outbound lead generation
- generated-lead enrichment and scoring
- approval-gated outreach preparation
- internal reporting, artifact sharing, and repo logging

The repo is not just a script bucket. It is a workflow runtime with:

- a typed CLI
- local Codex skills
- YAML workflow templates
- SQLite state
- queued report and announcement payloads
- provider integrations
- artifact exports
- recurring Codex automations

## 2. Runtime Philosophy

The stack is built around a few core principles:

### Local-first orchestration

Work is executed from this repo, with state and exports stored locally first. External systems such as Gmail, Drive, Blitz, Apify, GoHighLevel, Twilio, and Vapi are treated as provider surfaces around the local runtime.

### Approval-gated outbound

The system can scrape, normalize, score, analyze, package, and prepare outreach automatically. It should not treat live sending as the default. Preview, auditability, and operator review come first.

### Artifact-driven operations

Nearly every major workflow produces artifacts:

- JSON exports
- HTML reports
- HTML announcements
- Desktop CSV files
- queue payloads
- repo log summaries

Those artifacts are what make the system auditable, shareable, and trainable.

### Skill-directed automation

Automations are not opaque jobs. Each recurring automation points to one or more repo-local skills, and each skill points to the actual CLI command sequence.

## 3. Major Repo Surfaces

## 3.1 CLI Layer

Primary entrypoint:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/src/cli.ts`

This file exposes the repo’s operational command surface. It is the bridge between:

- Codex skills
- human operator runs
- recurring automations

Important commands include:

- `bootstrap`
- `health:check`
- `worker:run`
- `signal:split`
- `report:queue`
- `report:payload`
- `report:mark-sent`
- `announce:queue`
- `announce:payload`
- `announce:mark-sent`
- `contacts:audit`
- `lead:scrape`
- `apify:healthcheck`
- `apify:discover`
- `lead:score`
- `lead:sync-ghl`
- `outreach:email-prepare`
- `voice:batch`
- `sms:followup`
- `vapi:numbers`
- `vapi:numbers:ensure`
- `vapi:assistants`
- `vapi:credits`
- `jose:queue`
- `blitz:readiness`
- `blitz:post-plan`
- `share:drive`
- `approval:list`
- `approval:grant`
- `dispatch:run`
- `log:publish`

## 3.2 Local Skills Layer

Path:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/.codex/skills/`

Each skill explains:

- what workflow it owns
- which CLI commands it runs
- what guardrails apply
- what the operator should look for after execution

Skills are the behavioral contract for Codex automations.

## 3.3 Template Layer

Path:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/templates/`

These YAML files are the workflow inventory. They define the named workflow surfaces that mirror the skills and automations.

They matter for:

- consistency
- bootstrapping
- documentation
- future template-driven orchestration

## 3.4 Library Layer

Path:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/src/lib/`

Key modules:

- `workers.ts`
  Runs monitoring and lead-source workers, including pooled Apify lead scraping.
- `apify.ts`
  Computes Apify worker health, spend, and actor discovery exports.
- `outreach.ts`
  Scores leads, prepares email, voice, and SMS sequences, and packages Jose’s queue.
- `blitz.ts`
  Audits live Blitz readiness and builds GBP post plans.
- `ghl.ts`
  Syncs generated leads into GoHighLevel and records CRM-facing activity.
- `vapi.ts`
  Works with Vapi assistants and phone numbers.
- `vapiCredits.ts`
  Exports Vapi credit state and runway forecasting.
- `vapiPhonePool.ts`
  Keeps the outbound phone inventory at the desired pool size.
- `reports.ts`
  Queues client-facing HTML positive-findings reports.
- `announcements.ts`
  Queues internal HTML announcements and Gmail-ready payloads.
- `drive.ts`
  Uploads and shares queued artifacts to Google Drive.
- `logs.ts`
  Publishes automation logs and optionally pushes repo changes.
- `db.ts`
  Owns SQLite persistence for runs, leads, approvals, plans, reports, announcements, and share jobs.

## 3.5 Config Layer

Path:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/src/config.ts`
- `/Users/jarvis/Documents/TRD-AUTOMATIONS/config/*.json`

This layer defines:

- clients
- workers
- contact records
- relay destinations
- environment parsing

Key point: config is what tells the runtime which clients exist, which workers they use, which areas to scrape, who receives reports, and what platform URLs should be used in CTA buttons.

## 4. State And Storage Model

## 4.1 SQLite

Local database:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/data/trd-automations.sqlite`

This is the system of record for the repo runtime.

It stores:

- worker runs
- raw findings
- split signals
- lead records
- approvals
- dispatch plans
- reports
- announcements
- Drive share jobs
- CRM activity references

## 4.2 Artifact Directories

Important output locations:

- `/Users/jarvis/Documents/TRD-AUTOMATIONS/data/exports/`
  JSON exports and queue artifacts
- `/Users/jarvis/Documents/TRD-AUTOMATIONS/data/reports/`
  client-facing HTML reports and outbound email previews
- `/Users/jarvis/Documents/TRD-AUTOMATIONS/data/announcements/`
  internal operational HTML announcements
- `/Users/jarvis/Desktop/Leads/`
  live scraped lead CSV files for operator visibility and downstream use

## 5. External Provider Surfaces

## 5.1 Apify

Role:

- live GBP lead scraping
- worker health monitoring
- actor discovery research

Current production behavior:

- `lead:scrape` partitions search queries across the full Apify token pool
- actor runs are deduped locally by listing identity
- daily Apify health digests summarize run health and spend
- weekly actor discovery scans look for new actors relevant to GBP, local SEO, reviews, citations, and lead generation

## 5.2 Gmail

Role:

- sending internal HTML announcements
- sending client-facing positive-findings HTML reports

Important boundary:

- Gmail is the send surface
- queued payloads are generated locally first
- items are only marked sent after Gmail succeeds

## 5.3 Google Drive

Role:

- uploading and sharing artifacts with the TRD team

Important boundary:

- share jobs are queued locally
- an artifact is not considered delivered just because a share job exists
- Drive configuration is still a runtime dependency for live uploads

## 5.4 Blitz

Role:

- source of truth for GBP-connected client readiness
- post planning
- review operations context
- client/location/asset relationship inspection

This repo currently uses Blitz in planning and audit mode more than live publishing mode.

## 5.5 GoHighLevel

Role:

- CRM sink for generated leads
- tagging and note organization

Important boundary:

- leads originate in this repo
- GHL is updated for organization and filtering
- outbound workflows still operate on the generated lead pool in SQLite, not the GHL contact list

## 5.6 Vapi

Role:

- outbound phone inventory
- assistant orchestration
- voice batch preparation
- credit runway monitoring

Important boundary:

- voice prep is capped by phone-pool size and credit state
- voice workflows are designed around 10-number rotation batches

## 5.7 Twilio

Role:

- SMS follow-up delivery

Operational expectation:

- SMS comes after voice preparation in the designed outbound chain
- the system supports preview-first workflows before live dispatch

## 6. Automation Layers

The current system has four operational layers.

### Layer 1: Monitoring and readiness

- AI visibility
- Blitz readiness
- Apify health
- Vapi credit watch
- Vapi phone pool

### Layer 2: Lead acquisition

- Apify-backed GBP weakness scraping
- local CSV export
- scoring and queue packaging

### Layer 3: Outreach preparation

- email prep
- voice batch prep
- SMS follow-up prep
- optional GHL sync

### Layer 4: Reporting and admin

- client report dispatch
- internal announcements
- Drive sharing
- repo sync
- weekly actor discovery

## 7. Current Daily Operating Order

The live weekday sequence is roughly:

1. `TRD Vapi Phone Pool`
2. `TRD Lead Pipeline`
3. `TRD Lead To GHL Sync` if unpaused
4. `TRD AI Visibility`
5. `TRD Outbound Email Prep`
6. `TRD Blitz Readiness`
7. `TRD Blitz Post Plans`
8. `TRD Voice Batch Prep`
9. `TRD SMS Follow-up Prep`
10. `TRD Apify Worker Digest`
11. `TRD Repo Sync`
12. `TRD Vapi Credit Watch`

The weekly cadence also includes:

- `TRD Apify Actor Discovery`

## 8. Training Takeaways

If a new operator only remembers a few things, they should remember these:

- the repo is the source of workflow truth
- skills define behavior, not just commands
- artifacts matter as much as execution
- live sends should follow queued payloads and explicit confirmation
- lead scraping is now real and Apify-backed, not fixture-based
- GHL is an organizational sink, not the campaign source of truth
- Gmail and Drive are delivery layers on top of local runtime artifacts

