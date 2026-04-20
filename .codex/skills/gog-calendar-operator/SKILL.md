---
name: gog-calendar-operator
description: Use this skill when a task needs to inspect calendars, create or update Google Calendar events, check free/busy windows, or send calendar invitations with the local gog CLI.
---

# Gog Calendar Operator

Use this when the task needs Google Calendar actions through the authenticated `gog` account.

## Workflow

1. Confirm the available calendars with `gog calendar calendars --json --no-input`.
2. For scheduling checks, use:
   - `gog calendar events <calendar-id> --json --no-input`
   - `gog calendar freebusy <calendar-id> --json --no-input`
3. To create an event or calendar send, use `gog calendar create <calendar-id> ... --json --no-input`.
4. To adjust an existing meeting, use `gog calendar update <calendar-id> <eventId> ... --json --no-input`.
5. To respond to invitations, use `gog calendar respond <calendar-id> <eventId> ... --json --no-input`.

## Guardrails

- Prefer the primary account calendar unless the workflow names a different calendar explicitly.
- Include the exact meeting URL, attendee list, and timezone in the output when an event is created or changed.
- Use free/busy before proposing times when schedule collisions matter.
