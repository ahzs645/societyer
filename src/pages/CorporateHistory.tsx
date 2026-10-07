import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { calendarDateKey } from "../lib/calendarDates";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { formatDate } from "../lib/format";

const CONSTATING_ACTION_LABELS: Record<string, string> = {
  incorporated: "Incorporated",
  transitioned: "Transitioned",
  continued: "Continued",
  amalgamated: "Amalgamated",
  restated: "Restated",
  other: "Other",
};
const constatingActionLabel = (action: string) => CONSTATING_ACTION_LABELS[action] ?? action;

/**
 * Corporate history — effective-dated corporate NAME history plus the
 * CONSTATING-document timeline (incorporation, transitions, continuances,
 * amalgamations, restatements). Each section renders a server-built
 * narrative string followed by an editable, date-ordered list. The two
 * "add" drawers (name vs constating event) keep separate open state.
 */
export function CorporateHistoryPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canReadNames = loaded && can("settings:read");
  const canWriteNames = loaded && can("settings:write");
  const canReadEvents = loaded && can("documents:read");
  const canWriteEvents = loaded && can("documents:write");

  const names = useQuery(
    api.nameHistory.list,
    society && canReadNames ? { societyId: society._id } : "skip",
  ) as
    | Array<{
        _id?: string;
        name: string;
        shortName?: string;
        startISO: string;
        regPosn?: number;
      }>
    | undefined;
  const nameNarrative = useQuery(
    api.nameHistory.narrative,
    society && canReadNames ? { societyId: society._id } : "skip",
  ) as string | undefined;

  const constating = useQuery(
    api.constating.list,
    society && canReadEvents ? { societyId: society._id } : "skip",
  ) as
    | Array<{
        _id?: string;
        action: string;
        jurisdiction: string;
        legislation: string;
        regNumber?: string;
        startISO: string;
      }>
    | undefined;
  const constatingNarrative = useQuery(
    api.constating.narrative,
    society && canReadEvents ? { societyId: society._id } : "skip",
  ) as string | undefined;

  const nameUpsert = usePermissionedMutation(api.nameHistory.upsert, canWriteNames);
  const nameRemove = usePermissionedMutation(api.nameHistory.remove, canWriteNames);
  const constatingCreate = usePermissionedMutation(api.constating.create, canWriteEvents);
  const constatingRemove = usePermissionedMutation(api.constating.remove, canWriteEvents);
  const constatingUpdate = usePermissionedMutation(api.constating.update, canWriteEvents);
  const toast = useToast();
  const confirm = useConfirm();

  const [nameOpen, setNameOpen] = useState(false);
  const [nameForm, setNameForm] = useState<any>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm, setEventForm] = useState<any>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const nameProblems = nameForm
    ? [
        ...(!String(nameForm.name ?? "").trim() ? ["Enter the corporate name."] : []),
        ...(!/^\d{4}-\d{2}-\d{2}$/.test(String(nameForm.startISO ?? "")) ? ["Choose the date the name took effect."] : []),
      ]
    : [];
  const eventProblems = eventForm
    ? [
        ...(!String(eventForm.jurisdiction ?? "").trim() ? ["Enter the jurisdiction."] : []),
        ...(!String(eventForm.legislation ?? "").trim() ? ["Enter the legislation (the Act)."] : []),
        ...(!/^\d{4}-\d{2}-\d{2}$/.test(String(eventForm.startISO ?? "")) ? ["Choose the effective date."] : []),
      ]
    : [];

  const editName = (row: any) => {
    if (!canWriteNames || !row._id) return;
    setNameForm({ id: row._id, name: row.name, shortName: row.shortName ?? "", startISO: row.startISO, regPosn: row.regPosn ?? "" });
    setNameOpen(true);
  };
  const removeName = async (row: any) => {
    if (!canWriteNames || !row._id) return;
    const ok = await confirm({
      title: `Remove "${row.name}"?`,
      message: `The name record effective ${formatDate(row.startISO)} will be removed from the name history and the as-of name lookups used in documents.`,
      confirmLabel: "Remove name",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await nameRemove({ id: row._id });
      toast.success("Name removed");
    } catch (error) {
      toast.error("Could not remove the name", error instanceof Error ? error.message : String(error));
    }
  };
  const editEvent = (row: any) => {
    if (!canWriteEvents || !row._id) return;
    setEventForm({ id: row._id, action: row.action, jurisdiction: row.jurisdiction, legislation: row.legislation, regNumber: row.regNumber ?? "", startISO: row.startISO });
    setEventOpen(true);
  };
  const removeEvent = async (row: any) => {
    if (!canWriteEvents || !row._id) return;
    const ok = await confirm({
      title: `Remove the ${constatingActionLabel(row.action).toLowerCase()} event?`,
      message: `${constatingActionLabel(row.action)} under ${row.legislation} (${row.jurisdiction}) on ${formatDate(row.startISO)} will be removed from the constating timeline and the governing-Act lookup.`,
      confirmLabel: "Remove event",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await constatingRemove({ id: row._id });
      toast.success("Event removed");
    } catch (error) {
      toast.error("Could not remove the event", error instanceof Error ? error.message : String(error));
    }
  };

  const openName = () => {
    if (!canWriteNames) return;
    setNameForm({
      name: "",
      shortName: "",
      startISO: calendarDateKey(new Date()),
      regPosn: "",
    });
    setNameOpen(true);
  };

  const saveName = async () => {
    if (!canWriteNames) return;
    if (nameProblems.length) {
      toast.error("Name not saved", nameProblems[0]);
      return;
    }
    try {
      await nameUpsert({
        id: nameForm.id || undefined,
        societyId: society._id,
        name: nameForm.name.trim(),
        shortName: nameForm.shortName?.trim() || undefined,
        startISO: nameForm.startISO,
        regPosn: nameForm.regPosn === "" ? undefined : Number(nameForm.regPosn),
        nowISO: new Date().toISOString(),
      });
      setNameOpen(false);
      toast.success(nameForm.id ? "Name updated" : "Name added");
    } catch (error) {
      toast.error("Name not saved", error instanceof Error ? error.message : String(error));
    }
  };

  const openEvent = () => {
    if (!canWriteEvents) return;
    setEventForm({
      action: "incorporated",
      jurisdiction: "",
      legislation: "",
      regNumber: "",
      startISO: calendarDateKey(new Date()),
    });
    setEventOpen(true);
  };

  const saveEvent = async () => {
    if (!canWriteEvents) return;
    if (eventProblems.length) {
      toast.error("Event not saved", eventProblems[0]);
      return;
    }
    try {
      const values = {
        action: eventForm.action,
        jurisdiction: eventForm.jurisdiction.trim(),
        legislation: eventForm.legislation.trim(),
        regNumber: eventForm.regNumber?.trim() || undefined,
        startISO: eventForm.startISO,
      };
      if (eventForm.id) await constatingUpdate({ id: eventForm.id, ...values });
      else await constatingCreate({ societyId: society._id, ...values, nowISO: new Date().toISOString() });
      setEventOpen(false);
      toast.success(eventForm.id ? "Event updated" : "Event added");
    } catch (error) {
      toast.error("Event not saved", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Corporate history"
        icon={<History size={16} />}
        iconColor="blue"
        subtitle="Effective-dated corporate name history and the constating-document timeline — incorporation, transitions, continuances, amalgamations and restatements."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-action btn-action--primary" disabled={!canWriteNames} onClick={openName}>
              <Plus size={12} /> Add name
            </button>
            <button className="btn-action btn-action--primary" disabled={!canWriteEvents} onClick={openEvent}>
              <Plus size={12} /> Add event
            </button>
          </div>
        }
      />

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>Name history</h3>
        {nameNarrative && (
          <p style={{ color: "var(--text-secondary)" }}>{nameNarrative}</p>
        )}
        {loaded && !canReadNames ? (
          <p className="muted">Name history requires settings access.</p>
        ) : names === undefined ? (
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        ) : names.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>No name history yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {names.map((n) => (
              <li
                key={n._id ?? `${n.name}-${n.startISO}`}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span>
                  {n.name}
                  {n.shortName ? ` — ${n.shortName}` : ""}
                  <span style={{ color: "var(--text-tertiary)" }}> — since {formatDate(n.startISO)}</span>
                </span>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Edit name ${n.name}`}
                  disabled={!canWriteNames || !n._id}
                  onClick={() => editName(n)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove name ${n.name}`}
                  disabled={!canWriteNames || !n._id}
                  onClick={() => removeName(n)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>Constating documents</h3>
        {constatingNarrative && (
          <p style={{ color: "var(--text-secondary)" }}>{constatingNarrative}</p>
        )}
        {loaded && !canReadEvents ? (
          <p className="muted">Constating documents require document access.</p>
        ) : constating === undefined ? (
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        ) : constating.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)" }}>No constating events yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {constating.map((c) => (
              <li
                key={c._id ?? `${c.action}-${c.startISO}`}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span>
                  <strong>{constatingActionLabel(c.action)}</strong> — {c.legislation} ({c.jurisdiction}) — {formatDate(c.startISO)}
                  {c.regNumber ? ` — No. ${c.regNumber}` : ""}
                </span>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Edit ${c.action} event`}
                  disabled={!canWriteEvents || !c._id}
                  onClick={() => editEvent(c)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove ${c.action} event`}
                  disabled={!canWriteEvents || !c._id}
                  onClick={() => removeEvent(c)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn" disabled={!canWriteEvents} onClick={openEvent}>
            <Plus size={12} /> Add event
          </button>
        </div>
      </div>

      <Drawer
        open={nameOpen && canWriteNames}
        onClose={() => setNameOpen(false)}
        title={nameForm?.id ? "Edit corporate name" : "Add corporate name"}
        footer={
          <>
            <button className="btn" onClick={() => setNameOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" disabled={!canWriteNames || nameProblems.length > 0} onClick={saveName}>
              Save
            </button>
          </>
        }
      >
        {nameForm && (
          <div>
            <Field label="Name" error={nameProblems.find((p) => /name/.test(p))}>
              <input
                className="input"
                value={nameForm.name}
                onChange={(e) => setNameForm({ ...nameForm, name: e.target.value })}
              />
            </Field>
            <Field label="Short name">
              <input
                className="input"
                value={nameForm.shortName}
                onChange={(e) => setNameForm({ ...nameForm, shortName: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Effective from">
                <DatePicker
                  value={nameForm.startISO}
                  onChange={(value) => setNameForm({ ...nameForm, startISO: value })}
                />
              </Field>
              <Field label="Register position">
                <input
                  className="input"
                  type="number"
                  value={nameForm.regPosn}
                  onChange={(e) => setNameForm({ ...nameForm, regPosn: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={eventOpen && canWriteEvents}
        onClose={() => setEventOpen(false)}
        title={eventForm?.id ? "Edit constating event" : "Add constating event"}
        footer={
          <>
            <button className="btn" onClick={() => setEventOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" disabled={!canWriteEvents || eventProblems.length > 0} onClick={saveEvent}>
              Save
            </button>
          </>
        }
      >
        {eventForm && (
          <div>
            <Field label="Action">
              <Select
                value={eventForm.action}
                onChange={(value) => setEventForm({ ...eventForm, action: value })}
                options={Object.entries(CONSTATING_ACTION_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Jurisdiction" error={eventProblems.find((p) => /jurisdiction/.test(p))}>
              <input
                className="input"
                placeholder="e.g. British Columbia"
                value={eventForm.jurisdiction}
                onChange={(e) => setEventForm({ ...eventForm, jurisdiction: e.target.value })}
              />
            </Field>
            <Field label="Legislation" error={eventProblems.find((p) => /legislation/.test(p))}>
              <input
                className="input"
                placeholder="e.g. Societies Act"
                value={eventForm.legislation}
                onChange={(e) => setEventForm({ ...eventForm, legislation: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Registration number">
                <input
                  className="input"
                  value={eventForm.regNumber}
                  onChange={(e) => setEventForm({ ...eventForm, regNumber: e.target.value })}
                />
              </Field>
              <Field label="Effective from">
                <DatePicker
                  value={eventForm.startISO}
                  onChange={(value) => setEventForm({ ...eventForm, startISO: value })}
                />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default CorporateHistoryPage;
