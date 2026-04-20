---
name: apify-worker-health-digest
description: Use this skill when the task is to check configured Apify workers, export a usage and health digest, and queue an internal HTML summary for Gmail delivery.
---

# Apify Worker Health Digest

## Workflow

1. Run `npm run apify:healthcheck -- --queue`.
2. Capture the returned `announcementId`, `exportPath`, and `consoleUrl`.
3. Run `npm run announce:payload -- --announcement-id <announcement-id>` to get the Gmail-ready subject and HTML.
4. Send the digest to `jon@truerankdigital.com` and cc `bishop@truerankdigital.com`.
5. After Gmail succeeds, run `npm run announce:mark-sent -- --announcement-id <announcement-id> --message-id <gmail-message-id>`.

## Notes

- The export captures observed actor spend over the last 24 hours and 7 days plus worker run health.
- Keep the email operational and concise; this is an internal admin digest, not a client-facing report.
