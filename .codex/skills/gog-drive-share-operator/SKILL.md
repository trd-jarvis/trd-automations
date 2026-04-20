---
name: gog-drive-share-operator
description: Use this skill when a task needs to upload a local artifact to Google Drive with gog, place it in the TRD Drive folder, and share it with one or more recipients such as jon@truerankdigital.com.
---

# Gog Drive Share Operator

Use this when the task is about moving a local file into Drive and sharing it without relying on the Google API client in the repo.

## Workflow

1. Confirm `gog` auth with `gog status --json`.
2. Choose the Drive folder:
   - Use `GOG_DRIVE_FOLDER_ID` or `GOOGLE_DRIVE_FOLDER_ID` if configured.
   - Otherwise search for `TRD Automations Leads` with `gog drive search`.
   - If it does not exist, create it with `gog drive mkdir "TRD Automations Leads"`.
3. Upload the local file with `gog drive upload <localPath> --parent=<folder-id> --json --no-input`.
4. Share the uploaded file with each recipient using `gog drive share <fileId> --to=user --email=<recipient> --role=writer --json --no-input`.
5. Capture the resulting file ID and Drive URL in the workflow output.

## Guardrails

- Keep the local file as the source artifact even after upload.
- Prefer explicit recipient emails over open links.
- If the upload is for leads, make sure `jon@truerankdigital.com` is included.
