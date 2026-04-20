# Daily And Weekly Operations Runbook

This document is the operator-oriented guide to how the automations should be understood as a working day and working week, not just as isolated jobs.

## 1. Weekday Timeline

## 6:15 AM - Vapi inventory check

Automation:

- `TRD Vapi Phone Pool`

Objective:

- confirm there are 10 phone slots available for voice prep later in the day

If it fails:

- voice prep later should be treated as at risk
- check `npm run vapi:numbers`
- check `npm run vapi:numbers:ensure -- --count 10 --area-codes 651,540,774`

## 7:00 AM - Lead acquisition

Automation:

- `TRD Lead Pipeline`

Objective:

- generate the day’s real lead pool
- score the leads
- package Jose’s queue

Expected outputs:

- Desktop CSV in `/Users/jarvis/Desktop/Leads`
- scored leads in SQLite
- Jose queue export in `data/exports`

Human checkpoint:

- confirm the actual count
- if below target, understand why instead of padding fake leads

## 7:10 AM - CRM mirroring

Automation:

- `TRD Lead To GHL Sync`

Current state:

- paused

If resumed:

- use it to mirror generated leads into GHL for filters/tags
- do not let it become the outbound source of truth

## 8:00 AM - Client visibility reporting

Automation:

- `TRD AI Visibility`

Objective:

- run the AI monitoring workers
- queue positive wins
- send only when a real client contact exists

Human checkpoint:

- review suppressed reports caused by missing contacts

## 8:15 AM - Outbound email preparation

Automation:

- `TRD Outbound Email Prep`

Objective:

- prepare prospecting emails based on live lead analysis

Expected outputs:

- HTML email previews
- Gmail payloads

Human checkpoint:

- spot-check tone and relevance on the first few emails

## 9:00 AM - Blitz readiness

Automation:

- `TRD Blitz Readiness`

Objective:

- distinguish clients that are operationally ready for GBP work from clients still blocked by setup gaps

Human checkpoint:

- review blocked-client reasons
- prioritize fixes for the highest-value accounts

## 9:30 AM - Blitz post planning

Automation:

- `TRD Blitz Post Plans`

Objective:

- convert readiness into actual post-planning outputs

Human checkpoint:

- review eligible clients
- verify asset coverage and landing URLs before live posting

## 10:00 AM - Voice batch prep

Automation:

- `TRD Voice Batch Prep`

Objective:

- check credits
- check phone pool
- prepare the next 10 lead-specific Vapi call slots

Human checkpoint:

- if credits are weak or the phone pool is short, do not force voice ops

## 11:00 AM - SMS follow-up prep

Automation:

- `TRD SMS Follow-up Prep`

Objective:

- prepare the text layer that follows the voice lane

Human checkpoint:

- make sure the SMS references the email and includes the booking link

## 11:30 AM - Apify governance digest

Automation:

- `TRD Apify Worker Digest`

Objective:

- email Jon and Bishop the pooled Apify usage/health state after the main run window

Human checkpoint:

- if costs spike or workers degrade, investigate before the next weekday run

## Hourly - Infrastructure governance

Automations:

- `TRD Repo Sync`
- `TRD Vapi Credit Watch`

Objective:

- preserve the Git trail
- keep Vapi credit/runway awareness current

## 2. Weekly Timeline

## Monday 12:30 PM - Apify tooling research

Automation:

- `TRD Apify Actor Discovery`

Objective:

- scan for new actors that could improve GBP, local SEO, citation, review, or lead workflows

Human checkpoint:

- review findings before introducing a new actor into production

## 3. Human Roles In The Loop

## Jose

Jose is the call operator downstream of the lead pipeline.

He needs:

- a clean Jose queue export
- clear weakness context
- consistent tri-state targeting
- high-ticket bias

## Jon

Jon is the primary internal digest recipient for:

- Apify worker health
- weekly Apify actor discovery

## Bishop

Bishop is the default executive/internal copy recipient for:

- internal digests
- milestone notifications

## Operators / Admin

Operators are responsible for:

- validating contact-roster completeness
- deciding when preview assets should become live sends
- reviewing blocked readiness states
- keeping Drive and Gmail delivery surfaces healthy

## 4. Failure Modes By Lane

## Lead generation failure modes

- Apify returns fewer than target leads
- actor cost ceiling is reached
- search matrices are too narrow
- enrichment fields are sparse

Operational response:

- inspect the latest CSV and JSON exports
- review Apify spend in the digest
- adjust worker or query design instead of inventing leads

## Reporting failure modes

- no positive findings
- no valid client contact
- Gmail send not completed

Operational response:

- confirm whether suppression was intentional
- update contact roster when needed

## Blitz failure modes

- missing client sitemap/default URL
- missing approved media assets
- missing seeded location or broken integration

Operational response:

- use the readiness export as the fix list

## Voice failure modes

- credit runway too weak
- phone pool below 10
- missing lead analysis context

Operational response:

- pause dialing
- restore inventory or credits first

## SMS failure modes

- booking URL missing
- voice predecessor state missing
- outbound copy too thin or too generic

Operational response:

- fix configuration before enabling live sends

## 5. Recommended Operator Review Cadence

Daily:

- review lead count and Jose queue quality
- review any suppressed email/report sends
- review Blitz blocked-client summary
- review Apify health digest

Weekly:

- review new Apify actor candidates
- review whether any paused automation should be re-enabled
- review repo sync logs and artifacts
- review credit and spend patterns across Apify and Vapi

## 6. Best Practices For Trainers

- Teach the stack as a chain, not as isolated commands.
- Emphasize source-of-truth boundaries.
- Show where every artifact lands on disk.
- Teach operators to read the exports before trusting the automation summary.
- Teach the difference between preview/preparation and live dispatch.

