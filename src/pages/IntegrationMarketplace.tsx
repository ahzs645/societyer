import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { INTEGRATION_CATALOG } from "../../shared/integrationCatalog";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Button, Drawer, Field, SettingsShell } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FolderSync,
  HeartHandshake,
  PackageCheck,
  Plug,
  RefreshCw,
} from "lucide-react";

type CatalogItem = {
  slug: string;
  name: string;
  kind: string;
  category: string;
  summary: string;
  description: string;
  status: string;
  capabilities: string[];
  requiredSecrets: string[];
  dataMappings: string[];
  auditEvents: string[];
  healthChecks: string[];
  actions: Array<{ id: string; label: string; description: string; kind: string; scope: string }>;
  installed: boolean;
  installation?: { _id: string; name: string; slug: string; status: string; capabilities: string[]; configJson?: string };
  health: { status: string; checkedAtISO?: string; messages: string[] };
};

type Installation = NonNullable<CatalogItem["installation"]>;

const CATEGORY_ICONS: Record<string, JSX.Element> = {
  Governance: <PackageCheck size={14} />,
  Calendar: <CalendarDays size={14} />,
  Documents: <FolderSync size={14} />,
  CRM: <HeartHandshake size={14} />,
  Automation: <Plug size={14} />,
};

// Friendlier display labels for raw catalog "kind" enum values (e.g. "plugin_integration"
// becomes "Plugin integration") so admins configuring a connector don't see raw snake_case.
const KIND_LABELS: Record<string, string> = {
  plugin_integration: "Plugin integration",
  browser_connector: "Browser-based connector",
  api_integration: "API integration",
  calendar_sync: "Calendar sync",
};

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

export function IntegrationMarketplacePage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const installations = useQuery(api.apiPlatform.listPluginInstallations, society ? { societyId: society._id } : "skip") as Installation[] | undefined;
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const upsertPluginInstallation = useMutation(api.apiPlatform.upsertPluginInstallation);
  const createBoardPack = useMutation(api.workflowPackages.createBoardPack);
  const upsertWorkflowPackage = useMutation(api.workflowPackages.upsert);
  const createTask = useMutation(api.tasks.create);
  const setPackageReviewStatus = useMutation(api.meetings.setPackageReviewStatus);
  const toast = useToast();
  const [selectedSlug, setSelectedSlug] = useState("board-pack-workflow");
  const [detailOpen, setDetailOpen] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState("");
  const [healthDraft, setHealthDraft] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => mergeCatalogWithInstallations(installations ?? []),
    [installations],
  );
  const selected = rows.find((item) => item.slug === selectedSlug) ?? rows[0];
  const meetingOptions = useMemo(
    () => (meetings ?? []).slice().sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt))),
    [meetings],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const install = async (item: CatalogItem) => {
    setBusySlug(item.slug);
    try {
      await upsertPluginInstallation({
        id: item.installation?._id as any,
        societyId: society._id,
        name: item.name,
        slug: item.slug,
        status: "installed",
        capabilities: item.capabilities,
        configJson: JSON.stringify(catalogConfig(item), null, 2),
        installedByUserId: actingUserId as any,
      });
      toast.success("Integration installed", item.name);
    } catch (error: any) {
      toast.error("Could not install integration", error?.message);
    } finally {
      setBusySlug(null);
    }
  };

  const saveHealth = async (item: CatalogItem) => {
    if (!item.installation) return;
    setBusySlug(item.slug);
    try {
      const config = parseConfigJson(item.installation.configJson);
      await upsertPluginInstallation({
        id: item.installation._id as any,
        societyId: society._id,
        name: item.name,
        slug: item.slug,
        status: item.installation.status,
        capabilities: item.capabilities,
        configJson: JSON.stringify({
          ...config,
          secretStatus: healthDraft,
          healthMessages: ["Manual setup checklist reviewed from Integration Marketplace."],
          healthCheckedAtISO: new Date().toISOString(),
        }, null, 2),
        installedByUserId: actingUserId as any,
      });
      toast.success("Health checklist updated");
    } catch (error: any) {
      toast.error("Could not update health checklist", error?.message);
    } finally {
      setBusySlug(null);
    }
  };

  const startBoardPack = async () => {
    if (!meetingId) return;
    setBusySlug("board-pack-workflow");
    try {
      let result: any;
      try {
        result = await createBoardPack({
          societyId: society._id,
          meetingId: meetingId as any,
          actingUserId,
        });
      } catch {
        result = await createBoardPackFallback();
      }
      toast.success("Board pack created", `${result.taskIds.length} follow-up tasks opened`);
    } catch (error: any) {
      toast.error("Could not create board pack", error?.message);
    } finally {
      setBusySlug(null);
    }
  };

  const createBoardPackFallback = async () => {
    const meeting = meetingOptions.find((item) => item._id === meetingId);
    if (!meeting) throw new Error("Meeting not found.");
    const packageId = await upsertWorkflowPackage({
      societyId: society._id,
      eventType: "custom.event",
      effectiveDate: String(meeting.scheduledAt).slice(0, 10),
      status: "draft",
      packageName: `Board pack - ${meeting.title}`,
      parts: [
        "Agenda",
        "Meeting materials",
        "Notice of meeting",
        "Attendance and quorum",
        "Draft minutes",
        "Follow-up actions",
        "Minute-book publication",
      ],
      notes: `Board-pack workflow for ${meeting.title}. Created from frontend compatibility mode because the K8s Convex runtime does not have createBoardPack deployed yet.`,
      supportingDocumentIds: [],
      priceItems: [],
      signerRoster: [],
      signerEmails: [],
      signingPackageIds: [],
    });
    await setPackageReviewStatus({
      id: meeting._id,
      status: "needs_review",
      notes: `Board pack package ${String(packageId)} created from integration marketplace.`,
      actingUserId: actingUserId as any,
    });
    const taskIds: any[] = [];
    for (const task of boardPackTaskDrafts(meeting, String(packageId))) {
      taskIds.push(await createTask({
        societyId: society._id,
        meetingId: meeting._id,
        title: task.title,
        description: task.description,
        status: "Todo",
        priority: task.priority,
        dueDate: task.dueDate,
        eventId: task.eventId,
        tags: ["board-pack", task.key],
      }));
    }
    return { packageId, taskIds };
  };

  const openItem = (item: CatalogItem) => {
    setSelectedSlug(item.slug);
    setHealthDraft({});
    setDetailOpen(true);
  };

  return (
    <div className="page page--wide">
      <SettingsShell
        routeKey="/app/integrations"
        title="Integration marketplace"
        description="Technical setup area. Install and configure third-party connectors — board packs, calendar sync, office documents, CRM bridges, and automation actions. This is a one-time setup step typically done by an administrator, not something a board member needs to visit."
        tabs={[
          { id: "catalog", label: "Catalog", icon: <Plug size={14} /> },
          { id: "setup", label: "Setup" },
        ]}
        activeTab="catalog"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {rows.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="card"
              style={{
                minHeight: 190,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
              onClick={() => openItem(item)}
            >
              <div className="card__body col" style={{ gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    {CATEGORY_ICONS[item.category] ?? <Plug size={14} />}
                    <strong style={{ fontSize: "var(--fs-md)" }}>{item.name}</strong>
                  </span>
                  <Badge tone={item.installed ? "success" : item.status === "planned" ? "warn" : "info"}>
                    {item.installed ? "Installed" : statusLabel(item.status)}
                  </Badge>
                </div>
                <div className="muted">{item.summary}</div>
              </div>
              <div className="card__body" style={{ paddingTop: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <Badge>{item.category}</Badge>
                  <Badge tone={healthTone(item.health.status)}>{healthLabel(item.health.status)}</Badge>
                  <Badge>{item.capabilities.length} feature{item.capabilities.length === 1 ? "" : "s"}</Badge>
                </div>
              </div>
            </button>
          ))}
          {rows.length === 0 && <div className="muted">No integrations available.</div>}
        </div>

        <Drawer
          open={detailOpen && Boolean(selected)}
          onClose={() => setDetailOpen(false)}
          title={selected?.name ?? "Integration"}
          size="wide"
          footer={selected ? (
            <>
              <Button onClick={() => setDetailOpen(false)}>Close</Button>
              <Button
                variant={selected.installed ? "secondary" : "accent"}
                disabled={busySlug === selected.slug}
                onClick={() => install(selected)}
              >
                {selected.installed ? <RefreshCw size={12} /> : <Plug size={12} />}
                {selected.installed ? "Refresh setup" : "Install"}
              </Button>
            </>
          ) : undefined}
        >
          {selected && (
            <div className="col" style={{ gap: 18 }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge>{selected.category}</Badge>
                <Badge tone={selected.installed ? "success" : selected.status === "planned" ? "warn" : "info"}>
                  {selected.installed ? "Installed" : statusLabel(selected.status)}
                </Badge>
                <Badge tone={healthTone(selected.health.status)}>{healthLabel(selected.health.status)}</Badge>
                <Badge>{kindLabel(selected.kind)}</Badge>
              </div>
              <p className="muted" style={{ margin: 0 }}>{selected.description}</p>

              {selected.slug === "board-pack-workflow" && (
                <div
                  className="col"
                  style={{
                    gap: 10,
                    padding: 12,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--bg-panel-muted)",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <strong>Board-pack quick start</strong>
                    <Badge tone="success">uses existing workflow packages</Badge>
                  </div>
                  <Field label="Meeting">
                    <Select
                      value={meetingId}
                      onChange={(value) => setMeetingId(value)}
                      options={[
                        { value: "", label: "Select meeting" },
                        ...meetingOptions.map((meeting) => ({
                          value: meeting._id,
                          label: `${meeting.title} - ${String(meeting.scheduledAt).slice(0, 10)}`,
                        })),
                      ]}
                    />
                  </Field>
                  <Button variant="accent" disabled={!meetingId || busySlug === selected.slug} onClick={startBoardPack}>
                    <PackageCheck size={12} /> Create board pack
                  </Button>
                </div>
              )}

              <IntegrationDeepLinks item={selected} />

              <Section
                title="What this integration can do"
                hint="Actions this connector is allowed to perform once installed."
                values={selected.capabilities}
              />
              <Section
                title="Data it syncs"
                hint="Societyer records this integration reads from or writes to."
                values={selected.dataMappings}
              />
              <Section
                title="Activity log entries"
                hint="Events this integration records to the audit log for accountability."
                values={selected.auditEvents}
              />
              <Section
                title="Available actions"
                values={selected.actions.map((action) => `${action.label}: ${action.description}`)}
              />

              <div className="col" style={{ gap: 8 }}>
                <strong style={{ fontSize: "var(--fs-sm)" }}>Setup checklist</strong>
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Confirm each credential or connection this integration needs before relying on it.
                </div>
                {selected.requiredSecrets.length === 0 ? (
                  <div className="row muted" style={{ gap: 6 }}>
                    <CheckCircle2 size={14} /> No provider credentials required.
                  </div>
                ) : (
                  selected.requiredSecrets.map((secret) => (
                    <label key={secret} className="row" style={{ gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(healthDraft[secret])}
                        onChange={(event) => setHealthDraft({ ...healthDraft, [secret]: event.target.checked })}
                      />
                      <span className="mono">{secret}</span>
                    </label>
                  ))
                )}
                <div className="col" style={{ gap: 4 }}>
                  {selected.health.messages.map((message) => (
                    <div key={message} className="muted">{message}</div>
                  ))}
                </div>
                {selected.installation && selected.requiredSecrets.length > 0 && (
                  <Button disabled={busySlug === selected.slug} onClick={() => saveHealth(selected)}>
                    <CheckCircle2 size={12} /> Save setup checklist
                  </Button>
                )}
              </div>
            </div>
          )}
        </Drawer>
      </SettingsShell>
    </div>
  );
}

function IntegrationDeepLinks({ item }: { item: CatalogItem }) {
  const links = integrationLinksFor(item.slug);
  if (links.length === 0) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <strong style={{ fontSize: "var(--fs-sm)" }}>Open integration surface</strong>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {links.map((link) => (
          <Link key={link.to} className={`btn btn--sm${link.primary ? " btn--accent" : ""}`} to={link.to}>
            <ExternalLink size={12} /> {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function integrationLinksFor(slug: string) {
  const links: Record<string, Array<{ label: string; to: string; primary?: boolean }>> = {
    "paperless-ngx": [
      { label: "Paperless setup", to: "/app/paperless", primary: true },
      { label: "Review imports", to: "/app/imports?source=Paperless" },
    ],
    "wave-browser": [
      { label: "Wave workspace", to: "/app/browser-connectors?connector=wave", primary: true },
      { label: "Staged imports", to: "/app/imports?source=Wave%20browser%20connector" },
      { label: "Connector runs", to: "/app/workflow-runs?provider=browser-connector&triggeredBy=connector" },
    ],
    "bc-registry-browser": [
      { label: "BC Registry workspace", to: "/app/browser-connectors?connector=bc-registry", primary: true },
      { label: "Registry imports", to: "/app/imports?source=BC%20Registry%20browser%20connector" },
      { label: "Connector runs", to: "/app/workflow-runs?provider=browser-connector&triggeredBy=connector" },
    ],
    "gcos-browser": [
      { label: "GCOS workspace", to: "/app/browser-connectors?connector=gcos", primary: true },
      { label: "Grant imports", to: "/app/imports?source=GCOS%20browser%20connector" },
      { label: "Connector runs", to: "/app/workflow-runs?provider=browser-connector&triggeredBy=connector" },
    ],
    "google-calendar": [
      { label: "Calendar sync state", to: "/app/workflow-runs?provider=calendar-sync" },
    ],
    "microsoft-365": [
      { label: "Calendar sync state", to: "/app/workflow-runs?provider=calendar-sync" },
    ],
  };
  return links[slug] ?? [];
}

function Section({ title, hint, values }: { title: string; hint?: string; values: string[] }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <strong style={{ fontSize: "var(--fs-sm)" }}>{title}</strong>
      {hint && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{hint}</div>}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {values.map((value) => <Badge key={value}>{value}</Badge>)}
      </div>
    </div>
  );
}

function healthTone(status: string) {
  if (status === "ready") return "success";
  if (status === "needs_setup" || status === "planned") return "warn";
  if (status === "not_installed") return "neutral";
  return "info";
}

// Friendlier display text for raw status/health enum values shown in badges.
const STATUS_LABELS: Record<string, string> = {
  planned: "Coming soon",
  available: "Available",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

const HEALTH_LABELS: Record<string, string> = {
  ready: "Ready",
  needs_setup: "Needs setup",
  not_installed: "Not installed",
  planned: "Coming soon",
};

function healthLabel(status: string) {
  return HEALTH_LABELS[status] ?? status.replace(/_/g, " ");
}

function mergeCatalogWithInstallations(installations: Installation[]): CatalogItem[] {
  const bySlug = new Map((installations ?? []).map((row) => [row.slug, row]));
  return INTEGRATION_CATALOG.map((manifest) => {
    const installation = bySlug.get(manifest.slug);
    const config = parseConfigJson(installation?.configJson);
    const missingSecrets = manifest.requiredSecrets.filter((key) => !config.secretStatus?.[key] && !config.envStatus?.[key]);
    return {
      ...manifest,
      installation,
      installed: installation?.status === "installed",
      health: {
        status: !installation
          ? "not_installed"
          : installation.status !== "installed"
            ? installation.status
            : missingSecrets.length
              ? "needs_setup"
              : manifest.status === "planned" ? "planned" : "ready",
        checkedAtISO: config.healthCheckedAtISO,
        messages: !installation
          ? ["Install this integration to configure credentials, actions, and connections."]
          : [
              missingSecrets.length ? `Still needs setup: ${missingSecrets.join(", ")}` : "All required credentials are confirmed.",
              ...(Array.isArray(config.healthMessages) ? config.healthMessages : []),
            ],
      },
    };
  });
}

function catalogConfig(item: CatalogItem) {
  return {
    manifestVersion: 1,
    kind: item.kind,
    category: item.category,
    requiredSecrets: item.requiredSecrets,
    dataMappings: item.dataMappings,
    auditEvents: item.auditEvents,
    healthChecks: item.healthChecks,
    actions: item.actions,
    healthMessages: [`Installed from integration catalog at ${new Date().toISOString()}.`],
  };
}

function parseConfigJson(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as any : {};
  } catch {
    return {};
  }
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function boardPackTaskDrafts(meeting: any, packageId: string) {
  const meetingDate = String(meeting.scheduledAt ?? new Date().toISOString()).slice(0, 10);
  const title = String(meeting.title ?? "meeting");
  return [
    ["prepare-agenda", `Prepare agenda for ${title}`, "Confirm agenda items, bylaw-required business, motions, presenters, and time boxes.", "High", addDays(meetingDate, -14)],
    ["attach-materials", `Attach board materials for ${title}`, "Attach reports, motions, financials, policies, and supporting documents to the meeting materials list.", "High", addDays(meetingDate, -10)],
    ["send-notice", `Send meeting notice for ${title}`, "Queue or record notice delivery, including remote attendance instructions and material access.", "High", addDays(meetingDate, -7)],
    ["record-quorum", `Record attendance and quorum for ${title}`, "Capture present/absent/proxy attendance, quorum source, remote participation, and conflicts.", "High", meetingDate],
    ["draft-minutes", `Draft minutes for ${title}`, "Create draft minutes from agenda, transcript, notes, and motions without approving the record.", "High", addDays(meetingDate, 2)],
    ["publish-minute-book", `Publish minute-book entry for ${title}`, "After minutes approval, publish evidence into the minute book and close the board pack.", "Medium", addDays(meetingDate, 14)],
  ].map(([key, taskTitle, description, priority, dueDate]) => ({
    key,
    title: taskTitle,
    description,
    priority,
    dueDate,
    eventId: `boardPack:${packageId}:${key}`,
  }));
}
