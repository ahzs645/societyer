import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clear sign-in throttle buckets that have long since refilled.
crons.daily(
  "purge idle sign-in throttles",
  { hourUTC: 9, minuteUTC: 30 },
  internal.authThrottle.purgeIdle,
  {},
);

// AI connector OAuth state: ended requests, token rows and sessions past their
// retention window, old deployment events, and registered clients nobody
// connected (convex/mcpOAuth.ts). Hourly, and each run chains more rounds
// while its batches come back full, so token rotation can't outpace it.
crons.hourly(
  "purge stale AI connector OAuth state",
  { minuteUTC: 45 },
  internal.mcpOAuth.purgeStale,
  {},
);

// Daily 7am UTC (midnight Pacific-ish) — scan for deadlines/filings due within
// the next 14 days and drop notifications into the in-app center.
crons.daily(
  "scan upcoming compliance",
  { hourUTC: 7, minuteUTC: 0 },
  internal.notifications.scanUpcoming,
  {},
);

// Mid-afternoon pass — catch same-day additions and surface any newly-overdue
// items at 3pm Pacific.
crons.daily(
  "afternoon compliance scan",
  { hourUTC: 22, minuteUTC: 0 },
  internal.notifications.scanUpcoming,
  {},
);

// Daily 1pm UTC (~6am Pacific) — bundle each member's unread items into a
// digest email (and opt-in SMS) so people get a morning summary without living
// in the bell. Honors per-user notification prefs; snoozed items are excluded.
crons.daily(
  "daily notification digest",
  { hourUTC: 13, minuteUTC: 0 },
  internal.notifications.sendDailyDigests,
  {},
);

// Mondays 1:15pm UTC — the opt-in weekly summary: what's due, claims waiting
// for approval and transactions needing attention.
crons.weekly(
  "weekly notification summary",
  { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 15 },
  internal.notifications.sendWeeklyDigests,
  {},
);

// Weekly retention review — flag documents past their retention period so a
// human can decide whether to purge (CRA 7y for financial, 10y for most other
// records; bylaws/constitution kept indefinitely).
crons.weekly(
  "retention review",
  { dayOfWeek: "monday", hourUTC: 8, minuteUTC: 0 },
  internal.retention.flagExpired,
  {},
);

// Yearly director-eligibility attestation reminder — runs on Jan 2 so the
// current year's attestations show up in the new-year dashboard.
crons.cron(
  "annual attestation reminder",
  "0 8 2 1 *",
  internal.retention.openAttestationYear,
  {},
);

// Daily 6am UTC — permanently delete notifications the user cleared from the
// bell more than the retention window ago (see DISMISSED_RETENTION_DAYS).
crons.daily(
  "purge dismissed notifications",
  { hourUTC: 6, minuteUTC: 0 },
  internal.notifications.purgeDismissed,
  {},
);

// Every 15 minutes — pick up any workflow whose nextRunAtISO has elapsed
// and fire its runner. This is the only scheduler for configured workflows;
// per-workflow cadence is stored on the workflow row itself.
crons.interval(
  "workflow scan",
  { minutes: 15 },
  internal.workflows.scan,
  {},
);

// Durable fallback for temporal material/committee grants and operator maintenance.
crons.interval("offline meeting authorization repair", { minutes: 1 }, internal.offlineMeetings.repairDownloads, {});

export default crons;
