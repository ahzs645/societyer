import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FileText,
  Gavel,
  Globe,
  HandCoins,
  History,
  Home,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Vote,
} from "lucide-react";
import { Avatar, Badge, Pill, TintedIconTile } from "../components/ui";

const SIDEBAR_ITEMS = [
  {
    heading: "Workspace",
    items: [
      { label: "Dashboard", href: "#dashboard", icon: <Home size={14} />, tone: "gray" as const, active: true },
      { label: "Meetings", href: "#governance", icon: <Gavel size={14} />, tone: "orange" as const },
      { label: "Filings", href: "#compliance", icon: <ClipboardList size={14} />, tone: "orange" as const },
      { label: "Members", href: "#members", icon: <Users size={14} />, tone: "blue" as const },
      { label: "Records", href: "#records", icon: <FileText size={14} />, tone: "gray" as const },
    ],
  },
  {
    heading: "Modules",
    items: [
      { label: "Voting", href: "#governance", icon: <Vote size={14} />, tone: "purple" as const, count: "2" },
      { label: "Privacy (PIPA)", href: "#compliance", icon: <Lock size={14} />, tone: "green" as const },
      { label: "Financials", href: "#records", icon: <Banknote size={14} />, tone: "green" as const },
      { label: "Public transparency", href: "#records", icon: <Globe size={14} />, tone: "blue" as const },
    ],
  },
];

const COMPLIANCE_FLAGS = [
  { label: "At least three directors in office", tone: "success" as const, note: "7 active" },
  { label: "BC resident threshold met", tone: "success" as const, note: "4 resident directors" },
  { label: "Director consents on file", tone: "warn" as const, note: "1 follow-up due" },
  { label: "Annual report filed with BC Registries", tone: "danger" as const, note: "14 days overdue" },
  { label: "PIPA policy published", tone: "success" as const, note: "Live on public page" },
];

const TIMELINE = [
  { when: "Apr 18", title: "Finance committee packet due", note: "Board package locked 48 hours before meeting." },
  { when: "Apr 23", title: "Q2 board meeting", note: "Agenda approved, attendance at 6 of 7." },
  { when: "May 01", title: "Annual report filing", note: "Draft ready, waiting on director consent." },
  { when: "May 14", title: "Member newsletter", note: "AGM save-the-date and volunteer intake." },
];

const DOCUMENT_ROWS = [
  { title: "2025 Annual report draft", category: "Filing evidence", retention: "Permanent", status: "Needs review" },
  { title: "Director consent forms", category: "Corporate register", retention: "Permanent", status: "6 of 7 signed" },
  { title: "AGM notice package", category: "Member communications", retention: "7 years", status: "Ready to publish" },
  { title: "PIPA training log", category: "Privacy", retention: "Current + 2 years", status: "Complete" },
];

const MEETING_NOTES = [
  "Approval of Riverside grant budget and restricted-fund release.",
  "Conflict disclosure recorded before motion 2026-04-03.",
  "Draft minutes generated from agenda, attendance, and motion log.",
];

const MEMBERS = [
  { name: "Mina Patel", role: "Board secretary", status: "Director" },
  { name: "Jordan Lee", role: "Treasurer", status: "Director" },
  { name: "Avery Santos", role: "Privacy officer", status: "Staff" },
  { name: "Devon Clarke", role: "Member at large", status: "Voting member" },
];

export function DemoPage() {
  return (
    <div className="app-shell demo-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__workspace">
            <div className="sidebar__brand-logo">S</div>
            <span className="sidebar__brand-name">Riverside Community Society</span>
            <span className="sidebar__brand-workspace">Demo workspace</span>
          </div>
        </div>

        <div className="sidebar__spotlight">
          <div className="sidebar__spotlight-label">Static preview</div>
          <div className="sidebar__spotlight-title">What the product looks like without a backend.</div>
          <div className="sidebar__spotlight-meta">
            <span>Custom-domain safe</span>
            <Badge tone="info">/demo</Badge>
          </div>
          <div className="sidebar__spotlight-meta">
            <span>Live app</span>
            <span>Requires Convex + auth</span>
          </div>
        </div>

        <nav className="sidebar__nav">
          {SIDEBAR_ITEMS.map((section) => (
            <div key={section.heading}>
              <div className="sidebar__section sidebar__section--compact">
                <span className="sidebar__section-meta">{section.heading}</span>
              </div>
              {section.items.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className={`sidebar__item${item.active ? " is-active" : ""}`}
                >
                  <TintedIconTile tone={item.tone} size="sm" className="sidebar__icon-chip">
                    {item.icon}
                  </TintedIconTile>
                  <span className="sidebar__label">{item.label}</span>
                  {item.count && (
                    <Pill size="sm" className="sidebar__count">
                      {item.count}
                    </Pill>
                  )}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <Sparkles size={12} />
          <span className="sidebar__footer-text">Static walkthrough for the public site</span>
        </div>
      </aside>

      <main className="main">
        <div className="workbench">
          <div className="workbench__panel">
            <div className="topbar">
              <span className="topbar__crumb">Societyer</span>
              <span className="topbar__crumb-sep">/</span>
              <span className="topbar__crumb">Product demo</span>
              <div className="topbar__spacer" />
              <div className="topbar__search">
                <Search />
                <input readOnly value="" placeholder="Search registers, meetings, filings..." />
              </div>
              <Link to="/" className="btn">
                <ArrowLeft size={14} /> Marketing page
              </Link>
            </div>

            <div className="workbench__body">
              <div className="workbench__content">
                <div className="page demo-page">
                  <div className="page__header" id="dashboard">
                    <div className="page__header-main">
                      <TintedIconTile tone="blue" size="md" className="page__icon">
                        <ShieldCheck size={16} />
                      </TintedIconTile>
                      <div className="page__intro">
                        <div className="page__eyebrow">Static product walkthrough</div>
                        <h1 className="page__title">BC society governance, filings, and records in one workspace</h1>
                        <p className="page__subtitle">
                          This route is intentionally static. Visitors can inspect the layout, modules,
                          and information density without needing login, Convex, or seeded data.
                        </p>
                      </div>
                    </div>
                    <div className="page__actions">
                      <Badge tone="info">No backend</Badge>
                      <Badge tone="accent">Static preview</Badge>
                      <a href="https://github.com/ahzs645/societyer" className="btn btn--primary" target="_blank" rel="noreferrer">
                        View source <ArrowRight size={14} />
                      </a>
                    </div>
                  </div>

                  <div className="demo-note">
                    <Sparkles size={14} />
                    <span>
                      The full app adds live data sync, member auth, audit logs, file uploads, and
                      workflow actions. This public route is only for showing how the interface looks.
                    </span>
                  </div>

                  <div className="stat-grid">
                    <div className="stat">
                      <div className="stat__label"><ShieldCheck size={12} /> Compliance score</div>
                      <div className="stat__value">83%</div>
                      <div className="stat__sub">1 overdue filing, 1 consent follow-up</div>
                    </div>
                    <div className="stat">
                      <div className="stat__label"><Users size={12} /> Active members</div>
                      <div className="stat__value">84</div>
                      <div className="stat__sub">7 directors, 3 committees, 12 volunteers</div>
                    </div>
                    <div className="stat">
                      <div className="stat__label"><CalendarClock size={12} /> Upcoming deadlines</div>
                      <div className="stat__value">4</div>
                      <div className="stat__sub">Annual report, AGM packet, privacy review</div>
                    </div>
                    <div className="stat">
                      <div className="stat__label"><Bell size={12} /> Notices queued</div>
                      <div className="stat__value">18</div>
                      <div className="stat__sub">Member newsletter and board packet reminders</div>
                    </div>
                  </div>

                  <div className="two-col">
                    <div className="col">
                      <section className="card" id="compliance">
                        <div className="card__head">
                          <div>
                            <div className="card__title">Compliance posture</div>
                            <div className="card__subtitle">The statutory checks that run across the workspace.</div>
                          </div>
                        </div>
                        <div className="card__body demo-flag-list">
                          {COMPLIANCE_FLAGS.map((flag) => (
                            <div key={flag.label} className="demo-flag-row">
                              <div className="demo-flag-copy">
                                <CheckCircle2 size={14} />
                                <span>{flag.label}</span>
                              </div>
                              <div className="demo-flag-meta">
                                <Badge
                                  tone={
                                    flag.tone === "success"
                                      ? "success"
                                      : flag.tone === "warn"
                                        ? "warn"
                                        : "danger"
                                  }
                                >
                                  {flag.note}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="card" id="governance">
                        <div className="card__head">
                          <div>
                            <div className="card__title">Board meeting workspace</div>
                            <div className="card__subtitle">Agenda, motions, minutes, and decision tracking.</div>
                          </div>
                        </div>
                        <div className="card__body demo-card-stack">
                          <div className="demo-inline-metrics">
                            <Badge tone="accent">Q2 board meeting</Badge>
                            <Badge tone="info">Apr 23, 2026</Badge>
                            <Badge tone="success">Quorum confirmed</Badge>
                          </div>
                          <ul className="landing__bullets demo-bullets">
                            {MEETING_NOTES.map((note) => (
                              <li key={note}>
                                <Gavel size={14} />
                                <span>{note}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="demo-grid-2">
                            <div className="demo-mini-panel">
                              <div className="demo-mini-panel__title">Open action items</div>
                              <div className="action-list">
                                <div className="action-item">
                                  <span className="action-item__text">Collect final consent from new director</span>
                                  <span className="action-item__due">Apr 20</span>
                                </div>
                                <div className="action-item">
                                  <span className="action-item__text">Approve annual report filing package</span>
                                  <span className="action-item__due">Apr 22</span>
                                </div>
                              </div>
                            </div>
                            <div className="demo-mini-panel">
                              <div className="demo-mini-panel__title">Voting surfaces</div>
                              <div className="demo-chip-row">
                                <Badge tone="accent">Proxy tracking</Badge>
                                <Badge tone="accent">Written resolutions</Badge>
                                <Badge tone="accent">Election tally</Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>

                    <div className="col">
                      <section className="card">
                        <div className="card__head">
                          <div>
                            <div className="card__title">Upcoming timeline</div>
                            <div className="card__subtitle">What the secretary and ED see next.</div>
                          </div>
                        </div>
                        <div className="card__body timeline">
                          {TIMELINE.map((item) => (
                            <div key={item.title} className="timeline__item">
                              <div className="timeline__date">{item.when}</div>
                              <div>
                                <div className="timeline__title">{item.title}</div>
                                <div className="timeline__desc">{item.note}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="card">
                        <div className="card__head">
                          <div>
                            <div className="card__title">Module coverage</div>
                            <div className="card__subtitle">Breadth across governance, records, and finance.</div>
                          </div>
                        </div>
                        <div className="card__body demo-module-list">
                          <div className="demo-module-row">
                            <TintedIconTile tone="orange" size="sm"><ClipboardList size={14} /></TintedIconTile>
                            <div>
                              <strong>Filings and deadlines</strong>
                              <div className="card__subtitle">BC annual reports, CRA, payroll, GST/HST, bylaw amendments.</div>
                            </div>
                          </div>
                          <div className="demo-module-row">
                            <TintedIconTile tone="green" size="sm"><Lock size={14} /></TintedIconTile>
                            <div>
                              <strong>PIPA and records inspection</strong>
                              <div className="card__subtitle">Privacy officer, retention periods, inspection workflows.</div>
                            </div>
                          </div>
                          <div className="demo-module-row">
                            <TintedIconTile tone="purple" size="sm"><Vote size={14} /></TintedIconTile>
                            <div>
                              <strong>Elections and member proposals</strong>
                              <div className="card__subtitle">AGM voting paths, written resolutions, member motions.</div>
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>

                  <section className="card" id="members">
                    <div className="card__head">
                      <div>
                        <div className="card__title">People and roles</div>
                        <div className="card__subtitle">Registers for directors, members, staff, and committee owners.</div>
                      </div>
                    </div>
                    <div className="card__body demo-member-grid">
                      {MEMBERS.map((member) => (
                        <div key={member.name} className="record-chip">
                          <Avatar label={member.name} />
                          <span className="record-chip__content">
                            <span className="record-chip__label">{member.name}</span>
                            <span className="record-chip__meta">{member.role}</span>
                          </span>
                          <Badge>{member.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="table-wrap" id="records">
                    <div className="table-toolbar">
                      <div className="table-toolbar__state">
                        <Badge tone="info">Documents</Badge>
                        <Badge tone="accent">Retention-aware</Badge>
                      </div>
                      <div className="table-toolbar__summary">Static sample rows from the public demo route</div>
                    </div>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Category</th>
                          <th>Retention</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {DOCUMENT_ROWS.map((row) => (
                          <tr key={row.title}>
                            <td>
                              <div className="record-chip">
                                <TintedIconTile tone="gray" size="sm" className="record-chip__avatar">
                                  <BookOpen size={14} />
                                </TintedIconTile>
                                <span className="record-chip__content">
                                  <span className="record-chip__label">{row.title}</span>
                                </span>
                              </div>
                            </td>
                            <td>{row.category}</td>
                            <td>{row.retention}</td>
                            <td>
                              <Badge
                                tone={
                                  row.status === "Needs review"
                                    ? "warn"
                                    : row.status === "6 of 7 signed"
                                      ? "danger"
                                      : "success"
                                }
                              >
                                {row.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  <section className="demo-footer-cta">
                    <div>
                      <h2>Want the live version?</h2>
                      <p>
                        The repository includes the full React + Convex app. The public site stays
                        static so the custom domain can show the product safely with no backend.
                      </p>
                    </div>
                    <div className="landing__cta-row">
                      <Link to="/" className="btn">
                        <ArrowLeft size={14} /> Back to marketing
                      </Link>
                      <a href="https://github.com/ahzs645/societyer" className="btn btn--accent" target="_blank" rel="noreferrer">
                        Open GitHub <ArrowRight size={14} />
                      </a>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
