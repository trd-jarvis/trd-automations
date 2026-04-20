---
name: drive-share-operator
description: Use this skill when the task is to upload queued artifacts to Google Drive with the local gog CLI and share them with the TRD team.
---

# Drive Share Operator

## Workflow

1. Run `npm run share:drive`.
2. Confirm the uploader used the `gog` Drive account and either the configured Drive folder ID or the auto-created `TRD Automations Leads` folder.
3. Review any failed jobs and correct Gog auth, Drive folder access, or recipient sharing errors.

## Guardrails

- Do not mark a report or artifact delivered just because a share job exists.
- Keep retries idempotent by using the queued share-job state.
- Share lead artifacts with `jon@truerankdigital.com` at minimum when the workflow calls for team delivery.
