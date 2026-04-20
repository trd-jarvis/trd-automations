# Vapi Credit Watch

Use this skill when you need to inspect Vapi credits, estimate runway, and publish a shareable forecast artifact.

## Commands
Quick status:
```bash
npm run vapi:credits
```

Shareable snapshot:
```bash
npm run vapi:credits -- --export
```

## Notes
- The runway estimate uses recent Vapi call-cost history when present.
- If there is no recent call history, the forecast stays unset instead of inventing a burn rate.
