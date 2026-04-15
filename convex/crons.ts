import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

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

export default crons;
