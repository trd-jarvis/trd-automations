---
name: ghl-sync-and-activity-logger
description: Use this skill when the task is to persist CRM-facing notes, tags, and activity logs without building a second CRM path.
---

# GHL Sync And Activity Logger

Use this skill to keep CRM activity attached to the same runtime.

## Workflow

1. Confirm the target dispatch plan or lead context exists.
2. Run `npm run dispatch:run -- --plan-id <plan-id> --mode preview`.
3. Review the CRM activity log entry created as part of the preview.

## Notes

- The workflow template lives at `templates/ghl-sync-and-activity-logger.yaml`.
- Live GHL writes should remain env-backed and idempotent.
