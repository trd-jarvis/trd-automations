---
name: lead-enrichment-and-scoring
description: Use this skill when the task is to score staged leads and generate approval-ready outreach previews.
---

# Lead Enrichment And Scoring

Use this skill after leads have been staged.

## Workflow

1. Run `npm run lead:score -- --client <client-id>`.
2. Review the generated approval IDs and dispatch plan previews.
3. Only move into dispatch after a human grants approval.

## Notes

- The workflow template lives at `templates/lead-enrichment-and-scoring.yaml`.
- This pass is intentionally safe and local-first.
