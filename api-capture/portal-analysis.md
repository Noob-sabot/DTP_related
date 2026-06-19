# Entity Solutions Timesheet — API / Network Analysis

Captured during week **15/06/2026 – 21/06/2026** fill session (browser network hook + CDP).

## Summary

**This is not a simple REST JSON API.** The portal is **Oracle ADF (Application Development Framework)** on **Apache MyFaces / JSF**. Every action is a `POST` returning **XML partial-response** fragments that patch the DOM.

A “capture two tokens and POST JSON” approach **will not work** without reimplementing the ADF partial-page lifecycle.

## Architecture

| Layer | Technology |
|-------|------------|
| UI framework | Oracle ADF Rich Faces |
| Server | JSF (JavaServer Faces) / Trinidad |
| Transport | `application/x-www-form-urlencoded` POST |
| Response | `<?xml version="1.0"?><partial-response>...` |
| Auth | Session cookies (after login + OTP) — no bearer token API |

## Session tokens (required on every request)

These rotate or increment as you navigate:

| Field | Example | Notes |
|-------|---------|-------|
| `Adf-Window-Id` | `bhn8xhpk6` | Stable for browser tab/session |
| `javax.faces.ViewState` | `!-1vqr0ga9` | **Rotates after every POST** — must parse from last response |
| `Adf-Page-Id` | `4` → `11` | Increments per screen (period select → week grid → day edit) |
| `org.apache.myfaces.trinidad.faces.FORM` | `f1` | Form name, constant |

Cookie-based session from login is also required (not captured here — use browser devtools after manual auth).

## Endpoint

All timesheet actions hit the same path:

```
POST https://portal.entitysolutions.com.au/webcenter/portal/IPro/pages_home/mytimesheets/submittimesheet
     ?Adf-Window-Id={windowId}&Adf-Page-Id={pageId}
```

## Day edit request (OK button)

Example body when saving a normal 7.5h day (URL-decoded for readability):

```
T:dclay:oc_227352442rg3WMa1:t1:0:soc12=0          # rate: Consulting Fee (index 0)
T:dclay:oc_227352442rg3WMa1:t1:0:it8=09:00        # startTime
T:dclay:oc_227352442rg3WMa1:t1:0:it9=17:00        # endTime
T:dclay:oc_227352442rg3WMa1:t1:0:it10=00:30       # nonWorkedTime (break)
T:dclay:oc_227352442rg3WMa1:t1:0:it4=              # description
org.apache.myfaces.trinidad.faces.FORM=f1
Adf-Window-Id=bhn8xhpk6
javax.faces.ViewState=!-1vqr0ga9
Adf-Page-Id=11
oracle.adf.view.rich.DELTAS={T:dclay:oc_227352442rg3WMa1:t1={rows=1}}
event=T:dclay:oc_227352442rg3WMa1:cb2
event.T:dclay:oc_227352442rg3WMa1:cb2=<m xmlns="http://oracle.com/richClient/comm"><k v="type"><s>action</s></k></m>
oracle.adf.view.rich.PROCESS=T:dclay:oc_227352442rg3WMa1,T:dclay:oc_227352442rg3WMa1:cb2
```

Partial day (5h): use `it9=14:30` with same break `it10=00:30`.

## Save week grid

```
event=T:dclay:oc_227352442rg3WMa1:j_idt62          # Save button component
oracle.adf.view.rich.PROCESS=T:dclay:oc_227352442rg3WMa1,T:dclay:oc_227352442rg3WMa1:j_idt62
oracle.adf.view.rich.RENDER=T:dclay:oc_227352442rg3WMa1
```

Response confirms save with XML update + redirect to period selection (“Timesheet saved”).

## Component ID problem

Prefixes like `T:dclay:oc_227352442rg3WMa1` are **opaque, session-scoped JSF client IDs**. They can change between:

- Portal upgrades
- New login sessions
- Different contract assignments

Any HTTP replay script must **scrape IDs from the initial HTML** after login, not hardcode them.

## Recommended streamlining paths (ranked)

### 1. Playwright + saved auth state (best balance)

- User logs in once manually (OTP).
- Export `storageState` (cookies) to a local file (gitignored).
- Script navigates to timesheet, fills fields via stable accessibility names (`startTime`, `endTime`, etc.).
- **~5× faster** than agent clicking through chat; same reliability as today.

### 2. Hybrid: browser login → HTTP fill

- After login, parse HTML for `ViewState`, `Adf-Window-Id`, component IDs.
- POST form-urlencoded day edits directly (one request per day + one save).
- **Fragile** if component IDs or ADF event XML format changes.
- Still need cookie jar + ViewState chaining.

### 3. Pure JSON API

- **Not available** on this portal for timesheet submission.

## Logical timesheet JSON (for config only)

Use this shape in `timesheet-config.json` / a future script — map to ADF fields at runtime:

```json
{
  "period": "15/06/2026-21/06/2026",
  "contract": "CRREW_LOGAN_464459",
  "days": [
    { "day": "Monday", "hours": 5, "start": "09:00", "end": "14:30", "break": "00:30", "note": "Some time taken off as child was in hospital" },
    { "day": "Tuesday", "hours": 5, "start": "09:00", "end": "14:30", "break": "00:30", "note": "Some time taken off as child was in hospital" },
    { "day": "Wednesday", "hours": 7.5, "start": "09:00", "end": "17:00", "break": "00:30" },
    { "day": "Thursday", "hours": 7.5, "start": "09:00", "end": "17:00", "break": "00:30" },
    { "day": "Friday", "hours": 7.5, "start": "09:00", "end": "17:00", "break": "00:30" }
  ]
}
```

## Security notes

- Do **not** commit `ViewState`, session cookies, or `storageState.json`.
- OTP/login must remain manual.
- Rotating `javax.faces.ViewState` prevents simple token reuse across weeks without an active session.

## Next step (if you want automation v2)

Add a Playwright script that:

1. Loads gitignored `auth-state.json` (or prompts login).
2. Reads week definition from `timesheet-config.json`.
3. Fills each day in one browser session.
4. Saves; optionally submits when `--submit` flag passed.
