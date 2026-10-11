import type { LegalSourceRecord } from "./legalGovernanceTypes";

/** Calendar interpretation is separate from a rule's nominal day/month count.
 * These sources do not provide a universal Saturday-to-Monday algorithm. */
export const LEGAL_CALENDAR_SOURCES: readonly LegalSourceRecord[] = [
  {
    id: "BC-IA-TIME",
    instrument: "Interpretation Act (British Columbia)",
    section: "ss. 2(1), 25(3)–(4), 25.2–25.5, 29 (holiday)",
    fullCitation: "Interpretation Act, R.S.B.C. 1996, c. 238, ss. 2(1), 25(3)–(4), 25.2–25.5, 29",
    url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96238_01",
    consolidatedThrough: "2026-10-06", reviewedOn: "2026-10-11", status: "in_force",
    summary: "A calculated holiday boundary moves to the next non-holiday when its reference day precedes the period, and to the previous non-holiday when the reference day follows it. Specified holiday deadlines move forward. Separate office-opening rules apply. Day, month and year calculations have distinct rules.",
    caveat: "Apply the governing enactment and any contrary intention first. A notice boundary before a meeting can move earlier. Saturday is not automatically a holiday; office availability and proclaimed holidays require review. The nominal calendar calculation does not establish the adjusted legal boundary.",
  },
  {
    id: "FED-IA-TIME",
    instrument: "Interpretation Act (Canada)",
    section: "ss. 3(1), 26–28, 35(1) (holiday)",
    fullCitation: "Interpretation Act, R.S.C. 1985, c. I-21, ss. 3(1), 26–28, 35(1)",
    url: "https://laws-lois.justice.gc.ca/eng/acts/I-21/FullText.html",
    consolidatedThrough: "2026-09-21", reviewedOn: "2026-10-11", status: "in_force",
    summary: "A time limit expiring on a holiday generally permits the act on the next non-holiday. Clear-day and ordinary day counts differ, and month periods follow their own calendar rule. The holiday definition includes applicable provincial and local holidays.",
    caveat: "Check the particular federal provision, location and applicable holiday calendar. Do not import CRA weekend receipt relief into every registry deadline, or assume that extending an expiry establishes sufficient notice before a meeting.",
  },
  {
    id: "ON-LEGISLATION-TIME",
    instrument: "Legislation Act, 2006 (Ontario)",
    section: "ss. 47, 88–89",
    fullCitation: "Legislation Act, 2006, S.O. 2006, c. 21, Sched. F, ss. 47, 88–89",
    url: "https://www.ontario.ca/laws/statute/06l21",
    reviewedOn: "2026-10-11", status: "in_force",
    summary: "A time limit ending on a holiday extends through the next non-holiday. Filing and other acts at a place closed during its regular business hours extend to its next opening. The Act defines holidays and provides separate day-counting rules.",
    caveat: "The observed consolidation begins December 11, 2025; its independently dated e-Laws currency endpoint was not exposed in the retrieved text. Check statutory exceptions, proclaimed holidays and the actual place or filing channel. Saturday is not a universal statutory holiday.",
  },
  {
    id: "OBCA-TIME",
    instrument: "Business Corporations Act (Ontario)",
    section: "s. 1(8)",
    fullCitation: "Business Corporations Act, R.S.O. 1990, c. B.16, s. 1(8)",
    url: "https://www.ontario.ca/laws/statute/90b16",
    reviewedOn: "2026-10-11", status: "in_force",
    summary: "A period of days begins on the day after the triggering event and ends at midnight on its final day; a holiday on that final day moves expiry to midnight on the next non-holiday.",
    caveat: "Read with the applicable provision and Ontario holiday rules; this does not turn all periods into business days. The observed main consolidation begins October 1, 2025; an independently dated currency endpoint was not supplied in the retrieved body.",
  },
];
