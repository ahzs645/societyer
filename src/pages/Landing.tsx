import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
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
} from "lucide-react";
import { isBetterAuthMode } from "../lib/authMode";

const FEATURE_GROUPS = [
  {
    title: "Governance",
    icon: <Gavel size={16} />,
    items: [
      "Board & member meetings with agendas, minutes, motions and decisions",
      "AGM workflow, written resolutions, proxy voting and member proposals",
      "Action items tied to directors with status, owners and due dates",
    ],
  },
  {
    title: "Compliance",
    icon: <ShieldCheck size={16} />,
    items: [
      "Auto-checked Societies Act flags: ≥3 directors, BC residency, consents on file",
      "CRA + BC Societies Online filing tracker with status and pre-fill helper",
      "Statutory deadline calendar, retention policy and bylaw redlines",
    ],
  },
  {
    title: "People",
    icon: <Users size={16} />,
    items: [
      "Members and directors registers with roles, terms and consents",
      "Committees, employees, auditors and inspections of records",
      "Conflict of interest disclosures with vote recusal tracking (s. 56)",
    ],
  },
  {
    title: "Records",
    icon: <FileText size={16} />,
    items: [
      "Constitution, bylaws, policies and financial statements with retention",
      "Donation receipts, insurance, court orders and attestations",
      "PIPA compliance checklist, training log and privacy officer record",
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

const HIGHLIGHTS = [
  {
    icon: <Zap size={18} />,
    title: "Live-reactive data",
    body: "Built on Convex — every change syncs across boards, committees and viewers instantly. No refresh, no stale state.",
  },
  {
    icon: <Command size={18} />,
    title: "Cmd+K everything",
    body: "Jump to any society record, file a deadline, draft a motion or open a register without leaving the keyboard.",
  },
  {
    icon: <Sparkles size={18} />,
    title: "Drafted minutes",
    body: "Generate first-pass minutes from agenda, attendance and motions. Edit in place — the audit trail records every change.",
  },
  {
    icon: <Moon size={18} />,
    title: "Dense, calm UI",
    body: "A monochrome, data-first interface inspired by Twenty. Built for people who actually run the society, not for screenshots.",
  },
];

export function LandingPage() {
  const authEnabled = isBetterAuthMode();
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
  }, [theme]);

  const appHref = authEnabled ? "/login" : "/app";
  const navCtaLabel = authEnabled ? "Sign in" : "Open app";
  const primaryCtaLabel = authEnabled
    ? "Sign in to the demo"
    : "Open the demo society";
  const authMeta = authEnabled
    ? "Optional Better Auth login for staff and members"
    : "No login wall in demo mode";
  const sourceHref = "https://github.com/ahzs645/societyer";

  return (
    <div className="landing">
      <header className="landing__nav">
        <div className="landing__nav-inner">
          <Link to="/" className="landing__brand">
            <span className="landing__brand-mark">S</span>
            <span className="landing__brand-name">Societyer</span>
          </Link>
          <nav className="landing__nav-links">
            <a href="#features" onClick={scrollTo("features")}>Features</a>
            <a href="#compliance" onClick={scrollTo("compliance")}>Compliance</a>
            <a href="#built-for" onClick={scrollTo("built-for")}>Who it's for</a>
            <a href="#stack" onClick={scrollTo("stack")}>Stack</a>
          </nav>
          <div className="landing__nav-actions">
            <button
              type="button"
              className="landing__btn landing__btn--ghost landing__theme-toggle"
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span className="landing__theme-label">
                {theme === "dark" ? "Light" : "Dark"}
              </span>
            </button>
            <Link to={appHref} className="landing__btn landing__btn--primary">
              {navCtaLabel} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      <section className="landing__hero">
        <div className="landing__container">
          <div className="landing__eyebrow">
            <ShieldCheck size={12} /> BC Societies Act compliance, end-to-end
          </div>
          <h1 className="landing__h1">
            Run your society like the{" "}
            <span className="landing__h1-accent">law actually expects.</span>
          </h1>
          <p className="landing__lede">
            Societyer is a governance and compliance workspace for British Columbia nonprofit
            societies. Directors, members, meetings, minutes, filings, bylaws and PIPA stay in
            one live workspace, with the Societies Act checks running in the background.
          </p>
          <div className="landing__cta-row">
            <Link to={appHref} className="landing__btn landing__btn--primary landing__btn--lg">
              {primaryCtaLabel} <ArrowRight size={16} />
            </Link>
            <a
              href="#features"
              onClick={scrollTo("features")}
              className="landing__btn landing__btn--ghost landing__btn--lg"
            >
              See what's inside
            </a>
          </div>
          <div className="landing__hero-meta">
            <span><CheckCircle2 size={12} /> Pre-seeded with Riverside Community Society</span>
            <span><CheckCircle2 size={12} /> Self-host with Convex or run locally</span>
            <span><CheckCircle2 size={12} /> {authMeta}</span>
          </div>
        </div>

        <div className="landing__hero-preview">
          <div className="landing__preview-card">
            <div className="landing__preview-head">
              <span className="landing__preview-dot landing__preview-dot--r" />
              <span className="landing__preview-dot landing__preview-dot--y" />
              <span className="landing__preview-dot landing__preview-dot--g" />
              <span className="landing__preview-title">Compliance — Riverside Community Society</span>
            </div>
            <div className="landing__preview-body">
              <div className="landing__preview-stat-row">
                <Stat label="Active members" value="84" />
                <Stat label="Directors" value="7" />
                <Stat label="Open filings" value="3" tone="warn" />
                <Stat label="Overdue" value="1" tone="danger" />
              </div>
              <div className="landing__preview-flags">
                {FLAG_EXAMPLES.map((f) => (
                  <FlagRow key={f.label} {...f} />
                ))}
              </div>
            </div>
          </div>
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

      <section id="compliance" className="landing__section landing__section--alt">
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
              <li><CalendarClock size={14} /> Annual report and CRA T3010 deadlines surfaced before they slip</li>
              <li><Vote size={14} /> Conflict of interest disclosures linked to the votes they affect</li>
              <li><History size={14} /> Bylaw redlines and version history so you can prove what was adopted</li>
              <li><Lock size={14} /> PIPA records inspection rules and privacy officer documented</li>
            </ul>
            <div className="landing__cta-row">
              <Link to={appHref} className="landing__btn landing__btn--primary">
                Try the compliance dashboard <ArrowRight size={14} />
              </Link>
            </div>
          </div>
          <div className="landing__split-visual">
            <div className="landing__panel">
              <div className="landing__panel-head">
                <AlertTriangle size={14} /> Compliance flags
              </div>
              <div className="landing__panel-body">
                {FLAG_EXAMPLES.map((f) => (
                  <FlagRow key={f.label} {...f} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing__section">
        <div className="landing__container">
          <SectionHead
            kicker="Why it feels different"
            title="Built for the people who actually do the work."
          />
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

      <section id="built-for" className="landing__section landing__section--alt">
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

      <section id="stack" className="landing__section">
        <div className="landing__container landing__stack-section">
          <SectionHead
            kicker="Under the hood"
            title="Modern, boring, fast."
            sub="React + TypeScript on a Convex live-reactive backend. Self-host the whole thing or point it at hosted Convex. No vendor lock-in on your registers."
          />
          <div className="landing__stack">
            <StackChip label="React 18" />
            <StackChip label="TypeScript" />
            <StackChip label="Vite" />
            <StackChip label="Convex" />
            <StackChip label="React Router" />
            <StackChip label="Sass" />
            <StackChip label="Lucide" />
            <StackChip label="date-fns" />
          </div>
          <div className="landing__stack-features">
            <div><ListChecks size={14} /> Schema-driven Convex backend with audit logs on every mutation</div>
            <div><Zap size={14} /> Live queries — no polling, no manual refresh</div>
            <div><Lock size={14} /> Self-host the Convex backend in Docker for full data residency</div>
          </div>
        </div>
      </section>

      <section className="landing__cta">
        <div className="landing__container">
          <h2>Stop reconstructing the registers the night before the AGM.</h2>
          <p>
            Explore the seeded society with realistic data, or inspect the code and run it
            locally.
          </p>
          <div className="landing__cta-row landing__cta-row--center">
            <Link to={appHref} className="landing__btn landing__btn--primary landing__btn--lg">
              {primaryCtaLabel} <ArrowRight size={16} />
            </Link>
            <a
              href={sourceHref}
              className="landing__btn landing__btn--ghost landing__btn--lg"
              target="_blank"
              rel="noreferrer"
            >
              View the source <Github size={16} />
            </a>
          </div>
        </div>
      </section>

      <footer className="landing__footer">
        <div className="landing__container landing__footer-inner">
          <div className="landing__brand">
            <span className="landing__brand-mark">S</span>
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "danger";
}) {
  return (
    <div className={`landing__stat${tone ? ` landing__stat--${tone}` : ""}`}>
      <div className="landing__stat-value">{value}</div>
      <div className="landing__stat-label">{label}</div>
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

// HashRouter intercepts URL hash changes — using href="#section" would trigger
// a router navigation. Scroll manually instead and swallow the default.
function scrollTo(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}
