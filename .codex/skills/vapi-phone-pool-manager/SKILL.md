# Vapi Phone Pool Manager

Use this skill when you need to create or maintain the outbound Vapi phone-number pool for lead rotation.

## Commands
Inspect:
```bash
npm run vapi:numbers
```

Ensure pool:
```bash
npm run vapi:numbers:ensure -- --count 10 --area-codes 651,540,774
```

## Notes
- This uses the Vapi API to create free Vapi numbers.
- The command attaches a default pool assistant if one is needed so inbound configuration is not blank.
