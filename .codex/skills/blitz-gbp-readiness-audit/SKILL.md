---
name: blitz-gbp-readiness-audit
description: Use this skill when the task is to audit Blitz client readiness, export the results, and queue the internal readiness announcement.
---

# Blitz GBP Readiness Audit

## Workflow

1. Run `npm run blitz:readiness`.
2. Review the exported readiness JSON and queued announcement payload.
3. Upload the export with `npm run share:drive` when Google Drive credentials are configured.

## Guardrails

- Treat the Supabase-backed Blitz data as read-only during audits.
- Use the readiness output to separate post-ready clients from setup-blocked clients.
