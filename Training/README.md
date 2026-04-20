# TRD Automations Training Base

This folder is the operator and training documentation set for the live automation stack in `/Users/jarvis/Documents/TRD-AUTOMATIONS`.

These documents are written from the current repo state, the local skill definitions, the CLI surface, and the active Codex automation TOML files.

## Training Files

- `automation-workflow-guide.md`
  Deep guide to every TRD automation, what it does, when it runs, what inputs it needs, what outputs it produces, and how it connects to the rest of the stack.
- `skills-reference.md`
  Catalog of the repo-local skills, what each skill is responsible for, the commands it runs, and which automations depend on it.
- `daily-and-weekly-operations.md`
  Operator timeline for the weekday cadence, weekly review loops, downstream handoffs, and recommended human checkpoints.
- `system-architecture.md`
  Runtime map of the repo, CLI, provider surfaces, storage model, artifact locations, and approval boundaries.

## How To Use This Training Set

1. Start with `system-architecture.md` to understand the stack layout and boundaries.
2. Read `automation-workflow-guide.md` to understand each live automation end to end.
3. Use `skills-reference.md` when you need to know what a specific skill actually does and which command it drives.
4. Use `daily-and-weekly-operations.md` as the operator runbook for routine execution, reviews, and troubleshooting.

## Scope Notes

- This training set focuses on the TRD automations owned by this repo.
- It documents the current Codex automations that are named `TRD ...` plus the one-time `client-contact-announce` helper.
- It does not attempt to document unrelated personal or legacy automations that happen to exist under `/Users/jarvis/.codex/automations`.

## Current Core Categories

- AI visibility monitoring and client reporting
- Blitz GBP readiness and post planning
- Apify-based outbound lead generation and actor discovery
- Generated-lead scoring, queue packaging, and GoHighLevel sync
- Outbound email, voice, and SMS preparation
- Vapi phone inventory and credit governance
- Drive sharing, Gmail delivery, and Git-based repo sync

