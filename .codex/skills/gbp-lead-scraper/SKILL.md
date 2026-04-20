---
name: gbp-lead-scraper
description: Use this skill when the task is to stage a real Apify-backed batch of Google Business Profile leads with weakness signals, contact fields, and social data for Jose.
---

# GBP Lead Scraper

Use this skill for outbound lead generation.

## Workflow

1. Run `npm run lead:scrape -- --client <client-id> --worker gbp-weakness-scan --limit 200`.
2. Confirm the run returned a live `actorRunId` and saved a CSV under `/Users/jarvis/Desktop/Leads`.
3. Review the staged leads for weakness signals, contact fields, and raw social/contact enrichment columns.
3. Hand the queue into `lead-enrichment-and-scoring` when ready.

## Notes

- The workflow template lives at `templates/gbp-lead-scraper.yaml`.
- The `gbp-weakness-scan` worker is Apify-backed and should not duplicate/sample-expand leads when the actor returns fewer results.
- Scraping alone should never trigger outreach.
