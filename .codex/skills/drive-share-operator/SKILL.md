---
name: drive-share-operator
description: Use this skill when the task is to upload queued artifacts to Google Drive and share them with the TRD team.
---

# Drive Share Operator

## Workflow

1. Run `npm run share:drive`.
2. Review any failed jobs and correct missing Google API credentials or folder access.

## Guardrails

- Do not mark a report or artifact delivered just because a share job exists.
- Keep retries idempotent by using the queued share-job state.
