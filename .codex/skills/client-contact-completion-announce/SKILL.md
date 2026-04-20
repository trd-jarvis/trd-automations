---
name: client-contact-completion-announce
description: Use this skill when the task is to queue, send, and mark the internal HTML completion email for the client-contact automation.
---

# Client Contact Completion Announce

## Workflow

1. Run `npm run announce:queue -- --type client-contact-completion`.
2. Run `npm run announce:payload -- --announcement-id <announcement-id>`.
3. Send the HTML body with the Gmail connector to Bishop and CC Jon.
4. Run `npm run announce:mark-sent -- --announcement-id <announcement-id> --message-id <gmail-message-id>`.

## Guardrails

- Use Gmail connector delivery, not SMTP.
- Keep this announcement internal-only.
