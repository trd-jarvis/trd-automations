---
name: gog-drive-scan-operator
description: Use this skill when a task needs to search, inspect, or scan Google Drive content with gog, including locating folders, finding prior exports, and checking whether a file already exists before upload.
---

# Gog Drive Scan Operator

Use this when the task is about finding or auditing Drive content from the local Gog-authenticated account.

## Workflow

1. Use `gog drive search <query> --json --no-input` for filename or text search.
2. Use `--raw-query` only when you need Drive query syntax directly.
3. Use `gog drive get <fileId> --json --no-input` when you need metadata for a specific file.
4. Use `gog drive permissions <fileId> --json --no-input` to inspect whether a file is already shared to the right people.
5. Return the matched file IDs, names, URLs, and the decision the workflow should take next.

## Guardrails

- Search before uploading when duplicate files would cause confusion.
- Prefer exact artifact names plus client/date terms when scanning for automation outputs.
- Do not assume a file is shared just because it exists in Drive; check permissions if sharing matters.
