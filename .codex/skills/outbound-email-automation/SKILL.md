# Outbound Email Automation

Use this skill when generated leads need prospecting email sent from negative AI visibility analysis.

## Purpose
- Build the negative AI analysis for each lead.
- Generate the outbound HTML email from the TRD template.
- Send the email through `gog` before the voice batch runs.
- End the run with an internal recap email to `jon@truerankdigital.com` with `bishop@truerankdigital.com` cc'd.
- Keep the tone direct with a light touch of humor.

## Command
```bash
npm run outreach:email-send -- --client <clientId> --limit 200
```

## Output
- HTML files land in `data/reports/`.
- Send/export JSON lands in `data/exports/`.
- An internal recap email is sent to Jon with Bishop copied.
- Team share jobs are queued automatically.
