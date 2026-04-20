# TRD Automations

Node/TypeScript automation stack for True Rank Digital inside Codex.

## What is in here

- Shared CLI for monitoring, reporting, lead staging, approvals, dispatch planning, and log exports
- HTML announcement payloads for internal ops delivery and contact-setup escalation
- Blitz-native readiness auditing and GBP post planning against the cloned Supabase-backed platform
- Google Drive artifact upload/share support through a service account
- Local SQLite state for worker runs, signal findings, leads, approvals, queued reports, and share jobs
- Repo-local Codex skills under `.codex/skills/`
- YAML workflow templates under `templates/`
- Config-driven workers and channel placeholders under `config/`

## Quick start

```bash
npm install
npm run bootstrap
npm run health:check
npm run contacts:audit
npm run blitz:readiness
```

## Safe defaults

- External email/SMS/voice dispatch is approval-gated
- Slack destinations are placeholders until real channel IDs are configured
- Example workers use local fixtures so the repo can be verified without live provider access
- Client-facing positive-findings emails are suppressed when client contact data is missing
