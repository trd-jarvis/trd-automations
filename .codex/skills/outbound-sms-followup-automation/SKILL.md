# Outbound SMS Follow-up Automation

Use this skill after voice outreach to send or preview SMS follow-ups for the same generated leads.

## Purpose
- Reference the earlier email.
- Keep the copy slightly comical without sounding spammy.
- Include the booking link and remind the lead that a team member may reach out before the meeting.

## Commands
Preview:
```bash
npm run sms:followup -- --client <clientId> --limit 10
```

Live send:
```bash
npm run sms:followup -- --client <clientId> --limit 10 --live
```
