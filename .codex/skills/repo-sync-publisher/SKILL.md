---
name: repo-sync-publisher
description: Use this skill when the task is to export automation logs, commit repo changes, and push the current workspace to the configured Git remote.
---

# Repo Sync Publisher

## Workflow

1. Run `npm run log:publish`.
2. Confirm whether a commit was created and whether the push succeeded.
3. Report the exported log path, commit SHA, and any push failure.

## Guardrails

- Only push from the current workspace repo.
- Do not expose ignored local secrets such as `.env.local`.
