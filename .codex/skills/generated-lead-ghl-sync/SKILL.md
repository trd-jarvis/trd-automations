# Generated Lead GHL Sync

Use this skill when generated leads need to be pushed into GoHighLevel without switching the source of truth away from the local lead-capture pipeline.

## Purpose
- Sync generated leads into GHL.
- Tag them so Jose and the team can filter by source, client, state, and sequence stage.
- Keep outreach operating on generated leads in this repo, not on the GHL contact list.

## Command
```bash
npm run lead:sync-ghl -- --client <clientId> --limit 200
```

## Notes
- This command uses the TRD-VOICE production env path for GHL credentials.
- It writes a JSON export to `data/exports/` and queues a share job for the TRD team.
- Failure on one lead should not block the rest of the sync batch.
