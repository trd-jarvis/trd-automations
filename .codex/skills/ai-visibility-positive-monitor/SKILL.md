---
name: ai-visibility-positive-monitor
description: Use this skill when the task is to run AI visibility workers, split the findings, and keep only positive wins ready for reporting.
---

# AI Visibility Positive Monitor

Use this skill when you need positive-only AI visibility monitoring.

## Workflow

1. Run `npm run worker:run -- --client <client-id>`.
2. Run `npm run signal:split -- --client <client-id>`.
3. Run `npm run report:queue -- --client <client-id>`.
4. Stop quietly if there are no positive findings.

## Notes

- The workflow template lives at `templates/ai-visibility-positive-monitor.yaml`.
- Use the Gmail connector only after loading the queued payload with `npm run report:payload`.
