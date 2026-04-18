import { type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ShieldCheck,
  Gavel,
  Users,
  FileCheck2,
  CalendarClock,
  FileText,
  Scale,
  Lock,
  Banknote,
  ListChecks,
  Vote,
  History,
  Sparkles,
  Command,
  Zap,
  Moon,
  Sun,
  CheckCircle2,
  AlertTriangle,
  Github,
  FileSpreadsheet,
  Mail,
  FolderOpen,
  HelpCircle,
  Server,
  Clock,
} from "lucide-react";
import { isBetterAuthMode } from "../lib/authMode";
import { useThemePreference } from "../hooks/useThemePreference";

const FEATURE_GROUPS = [
  {
    title: "Governance",
    icon: <Gavel size={16} />,
    evidence: "§ 20–59",
    items: [
      "Board & member meetings with agendas, minutes, motions and decisions",
      "AGM workflow, written resolutions, proxy voting and member proposals",
      "Action items tied to directors with status, owners and due dates",
    ],
  },
  {
    title: "Compliance",
    icon: <ShieldCheck size={16} />,
    evidence: "§ 11, 44, 76",
    items: [
      "Auto-checked Act flags: ≥3 directors, BC residency, consents on file",
      "CRA + BC Societies Online filing tracker with status and pre-fill helper",
      "Statutory deadline calendar, retention policy and bylaw redlines",
    ],
  },
  {
    title: "People",
    icon: <Users size={16} />,
    evidence: "§ 20, 24, 56",
    items: [
      "Members and directors registers with roles, terms and consents",
      "Committees, employees, auditors and inspections of records",
      "Conflict of interest disclosures with vote recusal tracking",
    ],
  },
  {
    title: "Records",
    icon: <FileText size={16} />,
    evidence: "§ 20, 24, PIPA",
    items: [
      "Constitution, bylaws, policies and financial statements with retention",
      "Donation receipts, insurance, court orders and attestations",
      "PIPA checklist, training log and privacy officer record",
    ],
  },
];

const FLAG_EXAMPLES = [
  { label: "≥3 directors on the board", state: "ok" as const },
  { label: "At least one BC-resident director", state: "ok" as const },
  { label: "All director consents on file", state: "warn" as const, note: "1 missing" },
  { label: "Annual report filed with BC Registries", state: "err" as const, note: "Overdue 14 days" },
  { label: "PIPA privacy policy published", state: "ok" as const },
  { label: "Bylaws filed match adopted version", state: "ok" as const },
];

const UPCOMING_DEADLINES = [
  { label: "Annual report — BC Registries", due: "Overdue 14d", tone: "err" as const },
  { label: "T3010 — CRA", due: "in 23 days", tone: "warn" as const },
  { label: "Director consent renewal — M. Singh", due: "in 45 days", tone: "ok" as const },
  { label: "AGM notice (14-day minimum)", due: "in 62 days", tone: "ok" as const },
];

const PAIN_POINTS = [
  {
    icon: <FileSpreadsheet size={16} />,
    headline: "Registers live in Excel",
    body: "Director terms, member emails, consent forms — every spreadsheet slightly out of sync with what was filed.",
  },
  {
    icon: <Mail size={16} />,
    headline: "Filings live in email",
    body: "Annual report, T3010, PIPA program. Known only to whoever had the login last year.",
  },
  {
    icon: <FolderOpen size={16} />,
    headline: "Minutes live in a Drive folder",
    body: "Motions drift. Action items don't come back. Bylaw versions pile up with no audit trail.",
  },
];

const WORKFLOW_STEPS = [
  { icon: <CalendarClock size={14} />, label: "Agenda" },
  { icon: <Gavel size={14} />, label: "Motion" },
  { icon: <Vote size={14} />, label: "Vote" },
  { icon: <FileText size={14} />, label: "Minute" },
  { icon: <ListChecks size={14} />, label: "Action" },
  { icon: <ShieldCheck size={14} />, label: "Audit trail" },
];

const HIGHLIGHTS = [
  {
    icon: <Zap size={18} />,
    title: "Live-reactive",
    body: "Built on Convex. Every change syncs across boards, committees and viewers instantly — no refresh, no stale state.",
  },
  {
    icon: <Command size={18} />,
    title: "Keyboard-native",
    body: "Cmd+K jumps to any society record. File a deadline, draft a motion or open a register without leaving the keyboard.",
  },
  {
    icon: <Sparkles size={18} />,
    title: "Drafted minutes",
    body: "First-pass minutes from agenda, attendance and motions. Edit in place — every change is in the audit trail.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Is this legal advice?",
    a: "No. Societyer organizes the compliance work your society already has to do. It is not a substitute for advice from a lawyer, accountant, or BC Registries.",
  },
  {
    q: "Does it file my annual report for me?",
    a: "No — but it tracks deadlines, stores confirmations, and pre-fills the data you'll type into BC Societies Online or CRA. You still submit. You keep the receipt of submission.",
  },
  {
    q: "Can I self-host?",
    a: "Yes. The Convex backend runs locally in Docker. Full data residency, no vendor on your registers. Or point at hosted Convex if you prefer.",
  },
  {
    q: "What happens to the audit trail if I delete something?",
    a: "Mutations are logged separately from the record. Deletion is soft by default and the log survives — so you can prove what the state was on any past date.",
  },
  {
    q: "Is this production-ready?",
    a: "Public preview. The static demo at /demo is fully explorable; the full app runs locally with the Convex backend. Riverside Community Society is seeded as example data.",
  },
];

export function LandingPage() {
  const { preference: themePreference, resolvedTheme, setPreference: setTheme } = useThemePreference();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
  const nextThemeLabel = nextTheme === "dark" ? "Dark" : "Light";
  const themeTitle =
    themePreference === "system"
      ? `Using system ${resolvedTheme} mode. Switch to ${nextTheme} mode.`
      : `Switch to ${nextTheme} mode`;

  const authEnabled = isBetterAuthMode();
  const demoHref = "/demo";
  const navCtaLabel = "Open demo";
  const primaryCtaLabel = "Open the live demo";
  const authMeta = authEnabled
    ? "Staff auth in the full app; this public demo stays backend-free"
    : "Public site stays static; full app runs separately with a backend";
  const sourceHref = "https://github.com/ahzs645/societyer";

  return (
    <div className="landing">
      <header className="landing__nav">
        <div className="landing__nav-inner">
          <Link to="/" className="landing__brand">
            <span className="landing__brand-name">Societyer</span>
            <span className="landing__brand-tag">preview</span>
          </Link>
          <nav className="landing__nav-links">
            <a href="#problem" onClick={scrollTo("problem")}>Problem</a>
            <a href="#features" onClick={scrollTo("features")}>Features</a>
            <a href="#compliance" onClick={scrollTo("compliance")}>Compliance</a>
            <a href="#self-host" onClick={scrollTo("self-host")}>Self-host</a>
            <a href="#faq" onClick={scrollTo("faq")}>FAQ</a>
          </nav>
          <div className="landing__nav-actions">
            <a
              href={sourceHref}
              className="landing__nav-icon-link"
              target="_blank"
              rel="noreferrer"
              aria-label="View source on GitHub"
              title="View source on GitHub"
            >
              <Github size={14} />
            </a>
            <button
              type="button"
              className="landing__btn landing__btn--ghost landing__theme-toggle"
              onClick={() => setTheme(nextTheme)}
              aria-label={`Switch to ${nextTheme} mode`}
              title={themeTitle}
            >
              {resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span className="landing__theme-label">{nextThemeLabel}</span>
            </button>
            <a href={demoHref} className="landing__btn landing__btn--primary">
              {navCtaLabel} <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </header>

      <section className="landing__hero">
        <div className="landing__container landing__hero-inner">
          <div className="landing__eyebrow">
            <ShieldCheck size={12} /> BC Societies Act · PIPA · CRA
          </div>
          <h1 className="landing__h1">
            Run your society the way the{" "}
            <span className="landing__h1-accent">law actually expects.</span>
          </h1>
          <p className="landing__lede">
            Societyer is a governance workspace for British Columbia nonprofit societies.
            Directors, members, meetings, minutes, filings, bylaws and PIPA in one live
            register — with the Societies Act checks running in the background.
          </p>
          <div className="landing__cta-row">
            <a href={demoHref} className="landing__btn landing__btn--primary landing__btn--lg">
              {primaryCtaLabel} <ArrowRight size={16} />
            </a>
            <a
              href={sourceHref}
              className="landing__btn landing__btn--ghost landing__btn--lg"
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} /> Source on GitHub
            </a>
          </div>
          <div className="landing__hero-meta">
            <span><CheckCircle2 size={12} /> Seeded with Riverside Community Society</span>
            <span><CheckCircle2 size={12} /> No login for the <code>/demo</code> walkthrough</span>
            <span><CheckCircle2 size={12} /> {authMeta}</span>
          </div>
        </div>

        <div className="landing__trust">
          <TrustItem value="80+" label="wired registers" />
          <TrustItem value="1" label="source of truth" />
          <TrustItem value="∞" label="audit history" />
          <TrustItem value="0" label="vendor lock-in" />
        </div>
      </section>

      <section id="problem" className="landing__section landing__section--alt">
        <div className="landing__container">
          <SectionHead
            kicker="The old way"
            title="Minutes in a Drive. Registers in Excel. Filings in email."
            sub="It works until the AGM. Then somebody has to reconstruct a year of governance in a week."
          />
          <div className="landing__pain-grid">
            {PAIN_POINTS.map((p) => (
              <div key={p.headline} className="landing__pain">
                <span className="landing__pain-icon">{p.icon}</span>
                <h3>{p.headline}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
          <p className="landing__pain-closer">
            Societyer replaces all three with live, audited registers in one place.
          </p>
        </div>
      </section>

      <section id="features" className="landing__section">
        <div className="landing__container">
          <SectionHead
            kicker="What's inside"
            title="Every register the Societies Act wants you to keep — already wired up."
            sub="Members, directors, meetings, minutes, filings, conflicts, bylaws, financials, PIPA. One workspace, one source of truth."
          />
          <div className="landing__feature-grid">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.title} className="landing__feature">
                <div className="landing__feature-head">
                  <span className="landing__feature-icon">{g.icon}</span>
                  <h3>{g.title}</h3>
                  <span className="landing__feature-evidence">{g.evidence}</span>
                </div>
                <ul className="landing__feature-list">
                  {g.items.map((it) => (
                    <li key={it}>
                      <CheckCircle2 size={13} /> <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing__section landing__section--alt">
        <div className="landing__container">
          <SectionHead
            kicker="One record, end to end"
            title={"Agenda → motion → minute → audit. No re\u2011keying."}
            sub="Every step writes into the same underlying records, so Tuesday's motion is Friday's minute is next year's audit answer."
          />
          <div className="landing__workflow">
            {WORKFLOW_STEPS.map((s, i) => (
              <div key={s.label} className="landing__workflow-step">
                <div className="landing__workflow-node">
                  <span className="landing__workflow-icon">{s.icon}</span>
                  <span className="landing__workflow-label">{s.label}</span>
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <span className="landing__workflow-arrow" aria-hidden="true">
                    <ArrowRight size={12} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="compliance" className="landing__section">
        <div className="landing__container landing__split">
          <div className="landing__split-text">
            <SectionHead
              kicker="Compliance posture"
              title="The Societies Act, on a dashboard."
              sub="Societyer reads your registers and runs the statutory checks for you. You see what's green, what's about to slip, and what's already overdue — before the AGM does."
              align="left"
            />
            <ul className="landing__bullets">
              <li><Scale size={14} /> Director composition, residency and consents continuously verified</li>
              <li><CalendarClock size={14} /> Annual report and CRA T3010 surfaced before they slip</li>
              <li><Vote size={14} /> Conflict of interest disclosures linked to the votes they affect</li>
              <li><History size={14} /> Bylaw redlines and version history so you can prove what was adopted</li>
              <li><Lock size={14} /> PIPA records inspection rules and privacy officer documented</li>
            </ul>
            <div className="landing__cta-row landing__cta-row--start">
              <a href={demoHref} className="landing__btn landing__btn--primary">
                Try the compliance dashboard <ArrowRight size={14} />
              </a>
            </div>
          </div>
          <div className="landing__split-visual">
            <div className="landing__panel">
              <div className="landing__panel-head">
                <AlertTriangle size={14} /> Compliance flags
                <span className="landing__panel-count">{FLAG_EXAMPLES.length}</span>
              </div>
              <div className="landing__panel-body">
                {FLAG_EXAMPLES.map((f) => (
                  <FlagRow key={f.label} {...f} />
                ))}
              </div>
            </div>
            <div className="landing__panel">
              <div className="landing__panel-head">
                <Clock size={14} /> Upcoming deadlines
              </div>
              <div className="landing__panel-body">
                {UPCOMING_DEADLINES.map((d) => (
                  <div key={d.label} className="landing__flag">
                    <span className={`landing__flag-dot landing__flag-dot--${d.tone}`} />
                    <span className="landing__flag-label">{d.label}</span>
                    <span className={`landing__flag-note landing__flag-note--${d.tone}`}>{d.due}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing__section landing__section--alt">
        <div className="landing__container">
          <SectionHead kicker="The feel" title="Built for the people who do the work." />
          <div className="landing__highlight-grid">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="landing__highlight">
                <span className="landing__highlight-icon">{h.icon}</span>
                <h3>{h.title}</h3>
                <p>{h.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="built-for" className="landing__section">
        <div className="landing__container">
          <SectionHead
            kicker="Who it's for"
            title="Designed around three people in every BC society."
          />
          <div className="landing__persona-grid">
            <Persona
              icon={<Gavel size={18} />}
              role="Board secretary"
              body="Drafts minutes, tracks motions, manages the directors register and keeps consents current. Stops chasing email threads."
            />
            <Persona
              icon={<FileCheck2 size={18} />}
              role="Executive director"
              body="Owns the filings calendar, AGM workflow, PIPA program and document retention. Sees the whole compliance posture at a glance."
            />
            <Persona
              icon={<Banknote size={18} />}
              role="Treasurer"
              body="Manages annual financial statements, donation receipts, audit status and remuneration disclosure. One register, fewer spreadsheets."
            />
          </div>
        </div>
      </section>

      <section id="self-host" className="landing__section landing__section--alt">
        <div className="landing__container">
          <SectionHead
            kicker="Own your data"
            title="Self-host the whole thing. No vendor on your registers."
            sub="React + TypeScript on a Convex live-reactive backend. Run the Convex backend in Docker for full data residency, or point at hosted Convex when you want less ops."
          />
          <div className="landing__selfhost-points">
            <div><Server size={14} /> Convex backend runs in Docker — your database, your disk</div>
            <div><ListChecks size={14} /> Schema-driven mutations with audit logs on every write</div>
            <div><Zap size={14} /> Live queries — no polling, no manual refresh</div>
            <div><Lock size={14} /> Export everything as JSON or CSV at any point</div>
          </div>
          <div className="landing__stack">
            <StackChip label="React 18" />
            <StackChip label="TypeScript" />
            <StackChip label="Vite" />
            <StackChip label="Convex" />
            <StackChip label="React Router" />
            <StackChip label="Sass" />
            <StackChip label="Lucide" />
          </div>
        </div>
      </section>

      <section id="faq" className="landing__section">
        <div className="landing__container landing__faq-container">
          <SectionHead
            kicker="Common questions"
            title="The things people ask before trusting a compliance tool."
          />
          <div className="landing__faq">
            {FAQ_ITEMS.map((item, i) => (
              <details key={item.q} className="landing__faq-item" open={i === 0}>
                <summary>
                  <HelpCircle size={14} />
                  <span>{item.q}</span>
                  <span className="landing__faq-plus" aria-hidden="true">+</span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
          <p className="landing__fineprint">
            Societyer helps organize compliance work; it is not legal advice and does not replace advice
            from a lawyer, accountant, or the BC Registry.
          </p>
        </div>
      </section>

      <section className="landing__cta">
        <div className="landing__container">
          <div className="landing__cta-eyebrow">
            <Sparkles size={12} /> Public preview · seeded demo
          </div>
          <h2>Stop reconstructing the registers the night before the AGM.</h2>
          <p>
            Click through the seeded demo in under a minute. Then clone it, self-host it,
            or point it at your real registers.
          </p>
          <div className="landing__cta-row landing__cta-row--center">
            <a href={demoHref} className="landing__btn landing__btn--primary landing__btn--lg">
              {primaryCtaLabel} <ArrowRight size={16} />
            </a>
            <a
              href={sourceHref}
              className="landing__btn landing__btn--ghost landing__btn--lg"
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} /> View the source
            </a>
          </div>
        </div>
      </section>

      <footer className="landing__footer">
        <div className="landing__container landing__footer-inner">
          <div className="landing__brand">
            <span className="landing__brand-name">Societyer</span>
          </div>
          <div className="landing__footer-meta">
            <span>BC Societies Act compliance workspace</span>
            <a href={sourceHref} className="landing__footer-link" target="_blank" rel="noreferrer">
              <Github size={12} /> Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  sub,
  align = "center",
}: {
  kicker: string;
  title: string;
  sub?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={`landing__section-head landing__section-head--${align}`}>
      <div className="landing__kicker">{kicker}</div>
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

function FlagRow({
  label,
  state,
  note,
}: {
  label: string;
  state: "ok" | "warn" | "err";
  note?: string;
}) {
  return (
    <div className="landing__flag">
      <span className={`landing__flag-dot landing__flag-dot--${state}`} />
      <span className="landing__flag-label">{label}</span>
      {note && <span className={`landing__flag-note landing__flag-note--${state}`}>{note}</span>}
    </div>
  );
}

function Persona({
  icon,
  role,
  body,
}: {
  icon: ReactNode;
  role: string;
  body: string;
}) {
  return (
    <div className="landing__persona">
      <span className="landing__persona-icon">{icon}</span>
      <h3>{role}</h3>
      <p>{body}</p>
    </div>
  );
}

function StackChip({ label }: { label: string }) {
  return <span className="landing__stack-chip">{label}</span>;
}

function TrustItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="landing__trust-item">
      <div className="landing__trust-value">{value}</div>
      <div className="landing__trust-label">{label}</div>
    </div>
  );
}

function scrollTo(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}
