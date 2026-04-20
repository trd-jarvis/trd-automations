---
name: approval-gated-outreach-planner
description: Use this skill when the task is to build outbound drafts and approval records without sending anything externally yet.
---

# Approval Gated Outreach Planner

Use this skill for outbound planning with explicit checkpoints.

## Workflow

1. Run `npm run lead:score -- --client <client-id>`.
2. Run `npm run approval:list -- --status PENDING`.
3. Review the dispatch preview artifacts in `data/exports/`.

## Guardrails

- No email, SMS, or voice send before approval.
- Keep the tone direct and concise.
