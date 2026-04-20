---
name: blitz-gbp-post-queue-manager
description: Use this skill when the task is to prepare a Blitz-native GBP post queue plan from the live client readiness model.
---

# Blitz GBP Post Queue Manager

## Workflow

1. Run `npm run blitz:post-plan -- --client <client-id>`.
2. Review the exported plan for landing URL, sitemap coverage, and approved media availability.
3. Use the Blitz platform to queue or approve the matching post burst.

## Guardrails

- Default to planning and review before live artifact creation.
- Respect Blitz-approved asset selection and existing sitemap/default post URL data.
