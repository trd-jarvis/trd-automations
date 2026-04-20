# Vapi Voice Batch Automation

Use this skill when you need to rotate up to 10 generated leads through outbound Vapi calling with per-lead assistant context.

## Purpose
- Analyze the next best generated leads.
- Build or queue lead-specific Vapi assistants.
- Attach assistants to rotating phone-number slots.
- Prepare or queue live calls in batches of 10.

## Commands
Preview batch:
```bash
npm run voice:batch -- --client <clientId> --batch-size 10
```

Live batch:
```bash
npm run voice:batch -- --client <clientId> --batch-size 10 --live
```

Inspect inventory:
```bash
npm run vapi:numbers
npm run vapi:assistants
```

## Notes
- This skill is built for generated leads, not GHL-origin contacts.
- Live mode requires Vapi numbers to exist and uses the live TRD-VOICE env-backed credentials.
