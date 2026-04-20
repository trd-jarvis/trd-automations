---
name: jose-queue-packager
description: Use this skill when the task is to package a tri-state, high-ticket, service-business lead batch for Jose.
---

# Jose Queue Packager

## Workflow

1. Run `npm run lead:scrape -- --client <client-id> --worker gbp-weakness-scan --limit 200`.
2. Run `npm run lead:score -- --client <client-id>`.
3. Run `npm run jose:queue -- --client <client-id>`.

## Guardrails

- Keep the lead pool tri-state, service-business only, and biased to high-ticket opportunities.
- Do not execute live outreach from this workflow.
