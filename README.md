# Entity Solutions Timesheet Automation

Cursor agent skill and config for filling weekly timesheets on the [People2.0 / Entity Solutions APAC portal](https://portal.entitysolutions.com.au/webcenter/portal/login).

## Weekly defaults

| Day | Hours |
|-----|-------|
| Monday (if worked) | 7.5 (09:00–17:00, 30 min break) |
| Tuesday–Friday | 7.5 each |
| Weekend | 0 |

Skip days with no work (public holidays, leave) — leave at 0.

## Usage

1. Open Cursor Agent chat in this project.
2. Say: **"Fill my Entity Solutions timesheet for this week."**
3. Log in and complete Gmail OTP in the embedded browser.
4. Agent fills from [`timesheet-config.json`](timesheet-config.json) using [`.cursor/skills/timesheet/SKILL.md`](.cursor/skills/timesheet/SKILL.md).
5. Review in the browser, then submit when ready.

Shortcut if already logged in:

> I'm on the timesheet page — fill Tue–Fri, don't submit.

## Files

- `timesheet-config.json` — portal URL, contract assignment, default times
- `.cursor/skills/timesheet/SKILL.md` — agent instructions (login, fill flow, never auto-submit unless asked)

## Security

No credentials are stored. You always handle login and 2FA yourself.
