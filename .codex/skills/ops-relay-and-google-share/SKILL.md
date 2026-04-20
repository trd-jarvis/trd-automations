---
name: ops-relay-and-google-share
description: Use this skill when the task is to export evidence, prepare internal relay payloads, and queue file-sharing actions for the TRD team.
---

# Ops Relay And Google Share

Use this skill for internal reporting and artifact distribution.

## Workflow

1. Run `npm run log:publish`.
2. Review the exported summary in `logs/exports/run-summary.json`.
3. Use Slack or Gmail connectors as needed after checking the placeholder channel configuration.

## Notes

- The workflow template lives at `templates/ops-relay-and-google-share.yaml`.
- Share jobs should include `jose@`, `jon@`, `eric@`, `jesse@`, and `bishop@truerankdigital.com`.
