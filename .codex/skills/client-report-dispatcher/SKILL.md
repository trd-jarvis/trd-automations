---
name: client-report-dispatcher
description: Use this skill when the task is to queue a branded client report, expose the Gmail-ready payload, and mark it sent only after Gmail succeeds.
---

# Client Report Dispatcher

Use this skill for positive-only report delivery.

## Workflow

1. Run `npm run report:queue -- --client <client-id>`.
2. Run `npm run report:payload -- --client <client-id>`.
3. Send the subject and HTML body with the Gmail connector.
4. Run `npm run report:mark-sent -- --client <client-id> --report-id <report-id> --message-id <gmail-message-id>`.

## Guardrails

- Do not send when there is no queued report.
- Use Gmail connector delivery, not SMTP.
