---
name: ai-visibility-negative-monitor
description: Use this skill when the task is to isolate neutral and negative AI visibility findings into an internal optimization queue.
---

# AI Visibility Negative Monitor

Use this skill for internal optimization backlogs.

## Workflow

1. Run `npm run worker:run -- --client <client-id>`.
2. Run `npm run signal:split -- --client <client-id>`.
3. Review the negative and neutral outputs before relaying anything externally.

## Notes

- The workflow template lives at `templates/ai-visibility-negative-monitor.yaml`.
- Negative findings should never be included in the client-facing wins email.
