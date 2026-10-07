import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../components/Toast";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Contact, GitMerge, Plus, Undo2, UserPlus } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { Modal, useConfirm, usePrompt } from "../components/Modal";
import { PersonPicker } from "../components/PersonPicker";
import { PersonMergeDialog, type MergeCandidate } from "../features/people/PersonMergeDialog";
import { personMatchesSearch } from "../../shared/personMatching";

const ROLE_LABELS: Record<string, string> = { director: "Director", officer: "Officer", member: "Member", controller: "Significant individual" };
const PAGE_SIZE = 50;

/**
 * Permission-scoped people directory with linked person history profiles.
 */
export function PeopleDirectoryPage() {
  const society = useSociety();
  const toast = useToast();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("members:write");
  const [saving, setSaving] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  const people = useQuery(api.peopleDirectory.list, society ? { societyId: society._id } : "skip") as
    | Array<{
        _id: string;
        fullName: string;
        firstName?: string;
        lastName?: string;
        dob?: string;
        isIndividual?: boolean;
        editable?: boolean;
      }>
    | undefined;

  const matches = useQuery(
    api.peopleDirectory.searchByPrefix,
    prefix && society ? { prefix, societyId: society._id } : "skip",
  ) as
    | Array<{ id: string; fullName: string; firstName?: string; lastName?: string; dob?: string; editable?: boolean }>
    | undefined;

  const duplicateGroups = useQuery(api.peopleDirectory.duplicates, society ? { societyId: society._id } : "skip") as
    | Array<Array<{ id: string; fullName: string; dob?: string }>>
    | undefined;

  const suggestions = useQuery(api.personHistory.duplicateSuggestions, society && can("members:read") ? { societyId: society._id } : "skip") as
    | Array<{ ids: [string, string]; names: [string, string]; score: number; reasons: string[]; sharedMeetings: number; occurrences: [number, number]; observed: [string, string] }>
    | undefined;
  const mergeHistory = useQuery(api.personHistory.mergeHistory, society && can("members:read") ? { societyId: society._id } : "skip") as any[] | undefined;
  const upsert = useMutation(api.peopleDirectory.upsert);
  const dismiss = useMutation(api.personHistory.dismissDuplicate);
  const unmerge = useMutation(api.personHistory.unmergePeople);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mergePair, setMergePair] = useState<{ people: [MergeCandidate, MergeCandidate]; reasons?: string[] } | null>(null);
  const [mergeFrom, setMergeFrom] = useState<{ id: string; fullName: string } | null>(null);
  const [addTo, setAddTo] = useState<{ id: string; fullName: string } | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [page, setPage] = useState(0);
  const filteredPeople = useMemo(() => (people ?? []).filter((p: any) => personMatchesSearch(p, listQuery)), [people, listQuery]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const dismissSuggestion = async (ids: [string, string], names: [string, string]) => {
    const rationale = await prompt({ title: "Different people?", message: `Record why ${names[0]} and ${names[1]} are different people. The suggestion will not be shown again.`, placeholder: "e.g. different organizations in the same year", confirmLabel: "Not the same person", required: true });
    if (!rationale) return;
    try { await dismiss({ societyId: society._id, personIds: ids as any, rationale }); toast.success("Suggestion dismissed"); }
    catch (error) { toast.error("Could not dismiss", error instanceof Error ? error.message : undefined); }
  };

  const undoMerge = async (row: any) => {
    const ok = await confirm({ title: `Undo merge of ${row.mergedName}?`, message: `${row.mergedName} becomes a separate profile again. The ${row.movedReferences} links moved into ${row.survivorName} by this merge go back, except any that were changed since.`, confirmLabel: "Undo merge", tone: "warn" });
    if (!ok) return;
    try { const result: any = await unmerge({ societyId: society._id, mergeId: row._id }); toast.success("Merge undone", `${result.restored} links restored${result.skipped ? `, ${result.skipped} left in place` : ""}`); }
    catch (error) { toast.error("Could not undo the merge", error instanceof Error ? error.message : undefined); }
  };

  const openNew = () => {
    setEditingId(null);
    setForm({
      fullName: "",
      firstName: "",
      lastName: "",
      dob: "",
      isIndividual: true,
      defaultAddress: "",
      gender: "",
      pronouns: "",
    });
    setOpen(true);
  };

  const openEdit = (person: { id: string; fullName: string; firstName?: string; lastName?: string; dob?: string; isIndividual?: boolean; editable?: boolean }) => {
    if (!canManage || person.editable === false) return;
    setEditingId(person.id);
    setForm({
      fullName: person.fullName ?? "",
      firstName: person.firstName ?? "",
      lastName: person.lastName ?? "",
      dob: person.dob ?? "",
      isIndividual: person.isIndividual ?? true,
      // Only supplied fields are patched server-side, so leaving these blank
      // never clears the stored values.
      defaultAddress: "",
      gender: "",
      pronouns: "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!canManage || saving || !form?.fullName.trim()) return;
    setSaving(true);
    try {
      await upsert({
      societyId: society._id,
      id: (editingId ?? undefined) as any,
      fullName: form.fullName.trim(),
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      dob: form.dob || undefined,
      isIndividual: form.isIndividual,
      defaultAddress: form.defaultAddress || undefined,
      gender: form.gender || undefined,
      pronouns: form.pronouns || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
    setEditingId(null);
    } catch (error) {
      toast.error("Person could not be saved", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <PageHeader
        title="People directory"
        icon={<Contact size={16} />}
        iconColor="blue"
        subtitle="People in this workspace and existing linked records. Search before creating a new person, and review possible duplicates."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canManage}>
            <Plus size={12} /> New person
          </button>
        }
      />

      <p className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        Create and maintain people for this workspace. Shared legacy records remain available through this organization's existing role links. To manage governance roles, see{" "}
        <Link to="/app/people-history">Review source identities and history</Link>. See <Link to="/app/directors">Directors</Link> or <Link to="/app/role-holders">Role holders</Link>.
      </p>

      <div className="card">
        <Field label="Search people">
          <input
            className="input"
            placeholder="Start typing a name…"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Field>
        {prefix && (
          <div style={{ marginTop: 8 }}>
            {matches === undefined ? (
              <p>Searching…</p>
            ) : matches.length === 0 ? (
              <p>No matches for “{prefix}”.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {matches.map((m) => (
                  <div
                    key={m.id}
                    className="row"
                    style={{ gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}
                  >
                    <span>{m.fullName}</span>
                    <span className="row" style={{ gap: 8, alignItems: "center" }}>
                      {m.dob && <span style={{ opacity: 0.6 }}>{m.dob}</span>}
                      <button className="btn btn--ghost" onClick={() => openEdit(m)} disabled={!canManage || m.editable === false}>
                        Edit
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="card people-duplicates">
          <h2 className="page__title-text">Possible duplicates ({suggestions.length})</h2>
          <p style={{ opacity: 0.7 }}>
            Profiles with spelling variants, nicknames, a first name only, or one name inside another. Check the sources before merging; profiles listed at the same meeting are probably different people.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {(showAllSuggestions ? suggestions : suggestions.slice(0, 12)).map((s) => (
              <div key={s.ids.join(":")} className="row people-duplicates__row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                <span style={{ minWidth: 0, flex: "1 1 260px", overflowWrap: "anywhere" }}>
                  <Link to={`/app/people-directory/${s.ids[0]}`}>{s.names[0]}</Link> <span className="muted">({s.occurrences[0]})</span>
                  {" ↔ "}
                  <Link to={`/app/people-directory/${s.ids[1]}`}>{s.names[1]}</Link> <span className="muted">({s.occurrences[1]})</span>
                  <br />
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{s.reasons.join(" · ")}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn--sm" disabled={!canManage} onClick={() => setMergePair({ people: [{ id: s.ids[0], fullName: s.names[0], occurrences: s.occurrences[0], observed: s.observed[0] }, { id: s.ids[1], fullName: s.names[1], occurrences: s.occurrences[1], observed: s.observed[1] }], reasons: s.reasons })}>
                    <GitMerge size={12} /> Merge…
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => void dismissSuggestion(s.ids, s.names)}>Not the same</button>
                </span>
              </div>
            ))}
          </div>
          {suggestions.length > 12 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowAllSuggestions(!showAllSuggestions)}>
              {showAllSuggestions ? "Show fewer" : `Show all ${suggestions.length}`}
            </button>
          )}
        </div>
      )}

      {duplicateGroups && duplicateGroups.length > 0 && (
        <div className="card">
          <h2 className="page__title-text">Same name and date of birth</h2>
          <p style={{ opacity: 0.7 }}>
            These people share a normalized name and date of birth.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {duplicateGroups.map((group, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {group.map((p) => (
                  <div
                    key={p.id}
                    className="row"
                    style={{ gap: 8, justifyContent: "space-between" }}
                  >
                    <Link style={{ minWidth: 0, overflowWrap: "anywhere" }} to={`/app/people-directory/${p.id}`}>{p.fullName}</Link>
                    {p.dob && <span style={{ opacity: 0.6 }}>{p.dob}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="page__title-text">All people{people ? ` (${people.length})` : ""}</h2>
        {people && people.length > 10 && (
          <input className="input" aria-label="Filter the list" placeholder="Filter by any part of a name" value={listQuery} onChange={(e) => { setListQuery(e.target.value); setPage(0); }} style={{ margin: "8px 0" }} />
        )}
        {people === undefined ? (
          <p>Loading…</p>
        ) : people.length === 0 ? (
          <p>No people in the directory yet. <Link to="/app/people-history">Review source identities</Link></p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {filteredPeople.length === 0 && <p className="muted">No one matches “{listQuery}”.</p>}
            {filteredPeople.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((p: any) => (
              <div
                key={p._id}
                className="row"
                style={{ gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}
              >
                <Link style={{ minWidth: 0, overflowWrap: "anywhere" }} to={`/app/people-directory/${p._id}`}>{p.fullName}</Link>
                <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {p.dob && <span style={{ opacity: 0.6 }}>{p.dob}</span>}
                  {p.isIndividual === false && <span style={{ opacity: 0.6 }}>Organization</span>}
                  {!!p.aliases?.length && <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>also {p.aliases.slice(0, 2).join(", ")}</span>}
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage || p.editable === false} onClick={() => setMergeFrom({ id: p._id, fullName: p.fullName })} aria-label={`Merge ${p.fullName} with another profile`}>
                    <GitMerge size={12} /> Merge
                  </button>
                  <button type="button" className="btn btn--sm" disabled={!canManage} onClick={() => setAddTo({ id: p._id, fullName: p.fullName })} aria-label={`Add ${p.fullName} to this society`}>
                    <UserPlus size={12} /> Add to society…
                  </button>
                </span>
              </div>
            ))}
            {filteredPeople.length > PAGE_SIZE && (
              <div className="row" style={{ gap: 12, alignItems: "center", marginTop: 8 }}>
                <button type="button" className="btn btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="muted">Page {page + 1} of {Math.ceil(filteredPeople.length / PAGE_SIZE)}</span>
                <button type="button" className="btn btn--sm" disabled={(page + 1) * PAGE_SIZE >= filteredPeople.length} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        )}
      </div>

      {!!mergeHistory?.length && (
        <div className="card">
          <h2 className="page__title-text">Merge history</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {mergeHistory.map((row) => (
              <div key={row._id} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ flex: "1 1 260px" }}>
                  {row.createdAtISO.slice(0, 10)} · <strong>{row.mergedName}</strong> into <Link to={`/app/people-directory/${row.survivorId}`}>{row.survivorName}</Link> · {row.movedReferences} links moved · {row.rationale}
                  {row.status === "undone" && <span className="muted"> · undone {String(row.undoneAtISO ?? "").slice(0, 10)}</span>}
                </span>
                {row.status === "applied" && <button type="button" className="btn btn--ghost btn--sm" disabled={!canManage} onClick={() => void undoMerge(row)}><Undo2 size={12} /> Undo</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {mergePair && <PersonMergeDialog societyId={society._id} people={mergePair.people} reasons={mergePair.reasons} onClose={() => setMergePair(null)} />}
      {mergeFrom && (
        <ChooseMergeTarget
          person={mergeFrom}
          people={(people ?? []) as any}
          onClose={() => setMergeFrom(null)}
          onChoose={(other) => { setMergeFrom(null); setMergePair({ people: [{ id: mergeFrom.id, fullName: mergeFrom.fullName }, other] }); }}
        />
      )}
      {addTo && <AddToSocietyDialog societyId={society._id} person={addTo} onClose={() => setAddTo(null)} />}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit person" : "New person"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save} disabled={!canManage || saving || !form?.fullName.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Full name">
              <input
                className="input"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="First name">
                <input
                  className="input"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </Field>
              <Field label="Last name">
                <input
                  className="input"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Date of birth">
              <DatePicker
                value={form.dob}
                onChange={(value) => setForm({ ...form, dob: value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Default address">
                <input
                  className="input"
                  value={form.defaultAddress}
                  onChange={(e) => setForm({ ...form, defaultAddress: e.target.value })}
                />
              </Field>
              <Field label="Gender (for document grammar)">
                <Select
                  value={form.gender}
                  onChange={(value) => setForm({ ...form, gender: value })}
                  options={[
                    { value: "", label: "—" },
                    { value: "M", label: "Male (he/his)" },
                    { value: "F", label: "Female (she/her)" },
                    { value: "X", label: "Neutral (they/their)" },
                  ]}
                />
              </Field>
              <Field label="Stated pronouns (override gender)">
                <input
                  className="input"
                  placeholder="e.g. they/them, xe/xir"
                  value={form.pronouns ?? ""}
                  onChange={(e) => setForm({ ...form, pronouns: e.target.value })}
                />
              </Field>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isIndividual}
                onChange={(e) => setForm({ ...form, isIndividual: e.target.checked })}
              />{" "}
              This is an individual (not an organization)
            </label>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function ChooseMergeTarget({ person, people, onClose, onChoose }: { person: { id: string; fullName: string }; people: Array<{ _id: string; fullName: string; aliases?: string[] }>; onClose: () => void; onChoose: (other: MergeCandidate) => void }) {
  const [otherId, setOtherId] = useState("");
  const other = people.find((p) => p._id === otherId);
  return (
    <Modal open onClose={onClose} title={`Merge ${person.fullName} with…`} size="sm" footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn--accent" disabled={!other} onClick={() => other && onChoose({ id: other._id, fullName: other.fullName })}>Continue</button>
    </>}>
      <p style={{ marginTop: 0 }}>Choose the other profile for the same person. You pick which one to keep on the next step.</p>
      <PersonPicker people={people.filter((p) => p._id !== person.id)} value={otherId} onChange={setOtherId} sourceName={person.fullName} ariaLabel="Profile to merge with" />
    </Modal>
  );
}

/** P14: adding a person to the society is a register change: confirm it, with a start date and source. */
function AddToSocietyDialog({ societyId, person, onClose }: { societyId: string; person: { id: string; fullName: string }; onClose: () => void }) {
  const addToSociety = useMutation(api.peopleDirectory.addToSociety);
  const toast = useToast();
  const [roleType, setRoleType] = useState("director");
  const [startDate, setStartDate] = useState("");
  const [position, setPosition] = useState("Director");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const validDate = !startDate || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(startDate);
  const needsDate = roleType === "director";
  return (
    <Modal open onClose={onClose} title={`Add ${person.fullName} to this society`} size="md" footer={<>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn--accent" disabled={busy || !validDate || (needsDate && !startDate) || !sourceReference.trim()} onClick={async () => {
        setBusy(true);
        try {
          await addToSociety({ directoryPersonId: person.id as any, societyId: societyId as any, roleType, ...(startDate ? { startDate } : {}), ...(roleType === "director" && position.trim() ? { position: position.trim() } : {}), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), sourceReference: sourceReference.trim(), nowISO: new Date().toISOString() });
          toast.success(`${person.fullName} added as ${ROLE_LABELS[roleType]}`, roleType === "director" ? "Listed on the Directors register. Record consent and residency there." : undefined);
          onClose();
        } catch (error) {
          toast.error("Could not add", error instanceof Error ? error.message : undefined);
        } finally { setBusy(false); }
      }}>{busy ? "Adding…" : `Add as ${ROLE_LABELS[roleType]}`}</button>
    </>}>
      <Field label="Role">
        <Select value={roleType} onChange={setRoleType} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
      </Field>
      {roleType === "director" && (
        <p className="muted" style={{ marginTop: 0 }}>
          This creates an <strong>Active</strong> entry on the Directors register (and a role-holder record). Consent and BC residency start as not recorded.
          For a person only seen on an old roster, use the Directors page to add them as “needs review” instead.
        </p>
      )}
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label={`Start date${needsDate ? "" : " (optional)"} — YYYY, YYYY-MM or YYYY-MM-DD`}><input className="input" aria-invalid={!validDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="2025-06-12" /></Field>
        {roleType === "director" && <Field label="Position"><input className="input" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>}
      </div>
      <Field label="Source URL (optional)"><input className="input" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" /></Field>
      <Field label="Source (resolution, minutes or filing that establishes the role)"><input className="input" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="e.g. AGM 2025 minutes, election results" /></Field>
    </Modal>
  );
}

export default PeopleDirectoryPage;
