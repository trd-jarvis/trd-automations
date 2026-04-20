---
name: apify-actor-discovery
description: Use this skill when the task is to scan the Apify store for new actors relevant to TRD lead generation, GBP operations, reviews, or local SEO and queue an internal summary.
---

# Apify Actor Discovery

## Workflow

1. Run `npm run apify:discover -- --queue`.
2. Capture the returned `announcementId` and `exportPath`.
3. Run `npm run announce:payload -- --announcement-id <announcement-id>` to get the Gmail-ready subject and HTML.
4. Send the scan summary to `jon@truerankdigital.com` and cc `bishop@truerankdigital.com`.
5. After Gmail succeeds, run `npm run announce:mark-sent -- --announcement-id <announcement-id> --message-id <gmail-message-id>`.

## Notes

- Prefer actors that fit GBP, local SEO, review monitoring, citations, or lead generation and have credible review/usage signals.
- Discovery is advisory only; do not add a newly found actor to production workers without operator review.
