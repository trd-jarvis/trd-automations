# Vapi Operator

Use this skill when you need direct control of the Vapi inventory used by the outbound sequence.

## Purpose
- Inspect available phone numbers.
- Inspect existing assistants.
- Verify whether the current repo can rotate leads through live Vapi slots.

## Commands
```bash
npm run vapi:numbers
npm run vapi:assistants
```

## Notes
- Lead-specific assistant creation happens through the voice batch automation.
- This skill is for visibility and operator control, not for generic calling outside the generated-lead sequence.
