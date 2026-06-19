# Entity Solutions Timesheet Automation

Playwright scripts for filling weekly timesheets on the [People2.0 / Entity Solutions APAC portal](https://portal.entitysolutions.com.au/webcenter/portal/login).

## Setup

```bash
npm install
npx playwright install chromium
```

## First-time auth

```bash
npm run auth
```

Log in and complete Gmail OTP in the opened browser, then click **Resume** in the Playwright inspector. Session is saved to `auth-state.json` (not committed).

## Fill this week

Edit [`timesheet-config.json`](timesheet-config.json) `currentWeek`, then:

```bash
npm run fill -- --headed
```

Review in the browser. Submit manually on the portal, or:

```bash
npm run fill -- --submit
```

## Current week example (15/06/2026 – 21/06/2026)

| Day | Hours | Note |
|-----|-------|------|
| Mon | 5 | Some time taken off as child was in hospital |
| Tue | 5 | Same |
| Wed–Thu | 7.5 | Normal |
| Fri | 7.5 | Thankyou, have a good weekend :) |
| Sat/Sun | 0 | — |

## Files

- `timesheet-config.json` — portal settings + `currentWeek` day definitions
- `scripts/fill-timesheet.ts` — main fill script
- `scripts/auth.ts` — manual login + save session
- `.cursor/skills/timesheet/SKILL.md` — Cursor agent instructions
- `api-capture/portal-analysis.md` — ADF network analysis (reference)

## Security

No credentials in the repo. Login and 2FA are always manual via `npm run auth`.
