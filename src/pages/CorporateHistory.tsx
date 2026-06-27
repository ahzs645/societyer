import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { History, Plus, Trash2 } from "lucide-react";

/**
 * Corporate history — effective-dated corporate NAME history plus the
 * CONSTATING-document timeline (incorporation, transitions, continuances,
 * amalgamations, restatements). Each section renders a server-built
 * narrative string followed by an editable, date-ordered list. The two
 * "add" drawers (name vs constating event) keep separate open state.
 */
export function CorporateHistoryPage() {
  const society = useSociety();

  const names = useQuery(
    api.nameHistory.list,
    society ? { societyId: society._id } : "skip",
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
    society ? { societyId: society._id } : "skip",
  ) as string | undefined;

  const constating = useQuery(
    api.constating.list,
    society ? { societyId: society._id } : "skip",
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
    society ? { societyId: society._id } : "skip",
  ) as string | undefined;

  const nameUpsert = useMutation(api.nameHistory.upsert);
  const nameRemove = useMutation(api.nameHistory.remove);
  const constatingCreate = useMutation(api.constating.create);
  const constatingRemove = useMutation(api.constating.remove);

  const [nameOpen, setNameOpen] = useState(false);
  const [nameForm, setNameForm] = useState<any>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm, setEventForm] = useState<any>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openName = () => {
    setNameForm({
      name: "",
      shortName: "",
      startISO: new Date().toISOString().slice(0, 10),
      regPosn: "",
    });
    setNameOpen(true);
  };

  const saveName = async () => {
    await nameUpsert({
      societyId: society._id,
      name: nameForm.name,
      shortName: nameForm.shortName || undefined,
      startISO: nameForm.startISO,
      regPosn: nameForm.regPosn === "" ? undefined : Number(nameForm.regPosn),
      nowISO: new Date().toISOString(),
    });
    setNameOpen(false);
  };

  const openEvent = () => {
    setEventForm({
      action: "incorporated",
      jurisdiction: "",
      legislation: "",
      regNumber: "",
      startISO: new Date().toISOString().slice(0, 10),
    });
    setEventOpen(true);
  };

  const saveEvent = async () => {
    await constatingCreate({
      societyId: society._id,
      action: eventForm.action,
      jurisdiction: eventForm.jurisdiction,
      legislation: eventForm.legislation,
      regNumber: eventForm.regNumber || undefined,
      startISO: eventForm.startISO,
      nowISO: new Date().toISOString(),
    });
    setEventOpen(false);
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
            <button className="btn-action btn-action--primary" onClick={openName}>
              <Plus size={12} /> Add name
            </button>
            <button className="btn-action btn-action--primary" onClick={openEvent}>
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
        {names === undefined ? (
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
                  <span style={{ color: "var(--text-tertiary)" }}> — since {n.startISO}</span>
                </span>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove name ${n.name}`}
                  onClick={() => n._id && nameRemove({ id: n._id })}
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
        {constating === undefined ? (
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
                  {c.action} — {c.legislation} ({c.jurisdiction}) — {c.startISO}
                  {c.regNumber ? ` — No. ${c.regNumber}` : ""}
                </span>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove ${c.action} event`}
                  onClick={() => c._id && constatingRemove({ id: c._id })}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={openEvent}>
            <Plus size={12} /> Add event
          </button>
        </div>
      </div>

      <Drawer
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title="Add corporate name"
        footer={
          <>
            <button className="btn" onClick={() => setNameOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={saveName}>
              Save
            </button>
          </>
        }
      >
        {nameForm && (
          <div>
            <Field label="Name">
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
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        title="Add constating event"
        footer={
          <>
            <button className="btn" onClick={() => setEventOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={saveEvent}>
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
                options={[
                  { value: "incorporated", label: "incorporated" },
                  { value: "transitioned", label: "transitioned" },
                  { value: "continued", label: "continued" },
                  { value: "amalgamated", label: "amalgamated" },
                  { value: "restated", label: "restated" },
                  { value: "other", label: "other" },
                ]}
              />
            </Field>
            <Field label="Jurisdiction">
              <input
                className="input"
                value={eventForm.jurisdiction}
                onChange={(e) => setEventForm({ ...eventForm, jurisdiction: e.target.value })}
              />
            </Field>
            <Field label="Legislation">
              <input
                className="input"
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
