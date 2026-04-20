---
name: gbp-lead-scraper
description: Use this skill when the task is to stage 50 to 75 Google Business Profile leads with obvious weakness signals for Jose.
---

# GBP Lead Scraper

Use this skill for outbound lead generation.

## Workflow

1. Run `npm run lead:scrape -- --client <client-id> --worker gbp-weakness-scan --limit 75`.
2. Review the staged leads for weakness signals and basic data quality.
3. Hand the queue into `lead-enrichment-and-scoring` when ready.

## Notes

- The workflow template lives at `templates/gbp-lead-scraper.yaml`.
- Scraping alone should never trigger outreach.
