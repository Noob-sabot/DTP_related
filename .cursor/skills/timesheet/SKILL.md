---
name: timesheet
description: Fill Entity Solutions / People2.0 APAC weekly timesheets in the browser. Use when the user asks to fill, submit, or update their timesheet on portal.entitysolutions.com.au.
---

# Entity Solutions Timesheet Fill

Read defaults from [timesheet-config.json](../../timesheet-config.json) in this project before filling.

## Authentication (user only)

- Open `portalUrl` from config in the embedded browser.
- **Never** enter credentials or OTP codes — the user logs in and completes Gmail 6-digit verification manually.
- Wait until the user confirms they are logged in, or detect the timesheet/submit page in the browser.

## Navigation to week grid

1. Go to **My Timesheets → Submit Timesheet** (or `timesheetPath` from config).
2. Confirm **Contract Assignment** matches config (`CRREW_LOGAN_464459` unless user says otherwise).
3. Select the **current timesheet period** (first "Not submitted" week unless user specifies another).
4. Click **Next** to open the week grid.

## Fill each work day

For each day the user wants filled (default: Tue–Fri from config):

1. On the week grid, click **Edit** under that day (Mon = 1st Edit, Tue = 2nd, Wed = 3rd, Thu = 4th, Fri = 5th).
2. On the day detail page, ensure **Rates** is `Consulting Fee`.
3. Fill fields by accessibility name:
   - `startTime` → `09:00`
   - `endTime` → `17:00`
   - `nonWorkedTime` → `00:30`
4. Click the **description** field to trigger hour recalculation (expect **7.5** hours / `07:30` total time).
5. Click **OK** to return to the week grid.
6. Verify the day shows **7.5** in the grid.

### Skip days (public holidays, leave)

- Leave the day at **0** on the grid, or open Edit and set all times to `00:00`, then OK.
- Ask the user which days to skip if not specified.

## Save and submit rules

- Click **Save** on the week grid when all days are done.
- **Never** click **Submit for Approval** unless the user explicitly says to submit.
- After saving, tell the user to review the browser and submit themselves when ready.

## Weekly chat prompts

- Full run: *"Fill my Entity Solutions timesheet for this week."*
- Already logged in: *"I'm on the timesheet page — fill Tue–Fri, don't submit."*
- Skip days: *"Monday was a public holiday — skip Monday, fill the rest."*

## Troubleshooting

- Element refs change every snapshot — always take a fresh `browser_snapshot` and find fields by name (`startTime`, `endTime`, `nonWorkedTime`).
- If hours stay at 0 after filling: refill end time, click break field, click description, then OK (same as Tuesday trial).
- If the wrong week is selected, go back and change **Select Timesheet Period** before filling.
