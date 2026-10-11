/**
 * "Members & representatives" (A2, B1, B2, P1).
 *
 * Organization members, the seats they hold and the people who represent
 * them. Replaces the raw-ID seat grid: only one page of organizations renders
 * at a time, a seat's history (and its identity links) loads only when the
 * seat is opened, and person/seat/meeting choices are pickers.
 */
import { useEffect, useMemo, useState } from "react";
import { evidenceUrl } from "../../shared/evidenceReview";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Building2, ChevronDown, ChevronRight, History, Plus, UserRoundPen } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "./Toast";
import { Badge, Drawer, Field } from "./ui";
import { Select } from "./Select";
import { Checkbox } from "./Controls";
import { PersonPicker, useDirectoryPeople, type DirectoryPersonOption } from "./PersonPicker";
import { PersonRecordLinks } from "./PersonRecordLinks";
import { sourceRoleLabel } from "../../shared/personHistory";

const PAGE_SIZE = 15;
const PARTIAL_DATE_HINT = "YYYY, YYYY-MM or YYYY-MM-DD";
const isPartialDate = (value: string) => !value || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);

type SeatSummary = {
  _id: string; seatKey: string; organizationName: string; memberId?: string; status: string; rosterSheet?: string;
  committeeId?: string; committeeName?: string; current: any[]; observationCount: number; liveCount: number;
};
type OrganizationGroup = { key: string; organizationName: string; member: any | null; seats: SeatSummary[]; linked: boolean };

function term(o: any) {
  const start = o.termStart ?? o.startDate;
  const end = o.termEnd ?? o.endDate;
  if (!start && !end) return o.observedDate ? `observed ${o.observedDate}` : "dates unknown";
  return `${start ?? "?"} – ${end ?? "present"}`;
}

const blankOrganizationMember = (linkSeatIds: string[] = [], organizationName = "") => ({ organizationName, membershipClass: "Organization", status: "Active", joinedAt: "", leftAt: "", votingRights: true, notes: "", linkSeatIds });

/**
 * createRequest: bump to open the "Add organization member" drawer — the
 * Members page ⋯ menu uses it while the card is hidden because nothing exists yet.
 */
export function MembersRepresentativesCard({ societyId, createRequest = 0 }: { societyId: string; createRequest?: number }) {
  const { can } = usePermissions();
  const canWrite = can("members:write");
  const data = useQuery(api.memberGovernance.organizationMembers, can("members:read") ? { societyId } : "skip") as
    | { organizations: OrganizationGroup[]; seatCount: number; organizationMemberCount: number; unlinkedSeatCount: number }
    | undefined;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "members" | "unlinked">("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState<any | null>(null);
  const [repForm, setRepForm] = useState<{ seat: SeatSummary } | null>(null);
  const [proxyOpen, setProxyOpen] = useState(false);
  // Directory and committees load only once the section is opened.
  const people = useDirectoryPeople(open || memberForm ? societyId : undefined);
  useEffect(() => {
    if (createRequest > 0) setMemberForm(blankOrganizationMember());
  }, [createRequest]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return (data?.organizations ?? []).filter((g) => {
      if (filter === "members" && !g.member) return false;
      if (filter === "unlinked" && g.member) return false;
      if (!q) return true;
      return [g.organizationName, ...g.seats.flatMap((s) => [s.seatKey, s.rosterSheet ?? "", ...s.current.map((c) => c.personName)])]
        .join(" ").toLocaleLowerCase().includes(q);
    });
  }, [data, search, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const drawers = (
    <>
      {memberForm && <OrganizationMemberDrawer societyId={societyId} form={memberForm} setForm={setMemberForm} seats={(data?.organizations ?? []).flatMap((g) => g.seats)} />}
      {repForm && <RepresentativeDrawer seat={repForm.seat} people={people} onClose={() => setRepForm(null)} />}
      {proxyOpen && <SeatProxyDrawer societyId={societyId} people={people} seats={(data?.organizations ?? []).flatMap((g) => g.seats)} onClose={() => setProxyOpen(false)} />}
    </>
  );
  // Nothing to show until an organization member or seat exists.
  if (!data || (data.organizationMemberCount === 0 && data.seatCount === 0 && !data.organizations.length)) return drawers;

  return (
    <details className="card members-reps" style={{ marginBottom: 16 }} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card__head" style={{ cursor: "pointer" }}>
        <h2 className="card__title"><Building2 size={14} /> Members &amp; representatives</h2>
        <span className="card__subtitle">
          {data ? `${data.organizationMemberCount} organization member${data.organizationMemberCount === 1 ? "" : "s"} · ${data.seatCount} seat${data.seatCount === 1 ? "" : "s"}${data.unlinkedSeatCount ? ` (${data.unlinkedSeatCount} not linked to a member)` : ""}` : "Loading…"}
        </span>
      </summary>
      {open && (
        <div className="card__body col" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
            A new representative ends the earlier term; seat history is kept.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" aria-label="Search organizations, seats and representatives" placeholder="Search organizations, seats or people" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ flex: "1 1 220px" }} />
            <Select
              aria-label="Organization filter"
              value={filter}
              onChange={(v) => { setFilter(v as any); setPage(0); }}
              style={{ width: 230, maxWidth: "100%" }}
              options={[
                { value: "all", label: "All organizations" },
                { value: "members", label: "Organization members" },
                { value: "unlinked", label: "Seats without a member record" },
              ]}
            />
            <button type="button" className="btn btn--accent btn--sm" disabled={!canWrite} onClick={() => setMemberForm(blankOrganizationMember())}>
              <Plus size={12} /> Add organization member
            </button>
            <button type="button" className="btn btn--sm" disabled={!can("proxies:write")} onClick={() => setProxyOpen(true)}>Record seat proxy</button>
          </div>
          {data === undefined ? <p className="muted">Loading organizations…</p> : filtered.length === 0 ? (
            <p className="muted">{data.organizations.length ? "No organizations match." : "No organization members or seats yet."}</p>
          ) : (
            <ul className="members-reps__list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {visible.map((group) => (
                <OrganizationRow
                  key={group.key}
                  group={group}
                  expanded={expanded === group.key}
                  onToggle={() => setExpanded(expanded === group.key ? null : group.key)}
                  canWrite={canWrite}
                  people={people}
                  societyId={societyId}
                  onCreateMember={() => setMemberForm({ organizationName: group.organizationName, membershipClass: "Organization", status: "Active", joinedAt: "", leftAt: "", votingRights: true, notes: "", linkSeatIds: group.seats.filter((s) => !s.memberId).map((s) => s._id) })}
                  onEditMember={() => setMemberForm({ memberId: group.member._id, organizationName: group.member.organizationName ?? group.member.firstName, membershipClass: group.member.membershipClass, status: group.member.status, joinedAt: group.member.joinedAt ?? "", leftAt: group.member.leftAt ?? "", votingRights: group.member.votingRights, notes: group.member.notes ?? "", linkSeatIds: group.seats.filter((s) => !s.memberId).map((s) => s._id) })}
                  onChangeRepresentative={(seat) => setRepForm({ seat })}
                />
              ))}
            </ul>
          )}
          {pages > 1 && (
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <button type="button" className="btn btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="muted">Page {page + 1} of {pages} · {filtered.length} organizations</span>
              <button type="button" className="btn btn--sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
      {drawers}
    </details>
  );
}

function OrganizationRow({ group, expanded, onToggle, canWrite, people, societyId, onCreateMember, onEditMember, onChangeRepresentative }: {
  group: OrganizationGroup; expanded: boolean; onToggle: () => void; canWrite: boolean; people: DirectoryPersonOption[] | undefined; societyId: string;
  onCreateMember: () => void; onEditMember: () => void; onChangeRepresentative: (seat: SeatSummary) => void;
}) {
  const reps = Array.from(new Set(group.seats.flatMap((s) => s.current.map((c) => c.personName))));
  return (
    <li className="members-reps__org" style={{ border: "1px solid var(--border)", borderRadius: 6 }}>
      <div className="row" style={{ gap: 8, padding: "8px 10px", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} seats for ${group.organizationName}`} onClick={onToggle}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{group.organizationName}</strong>
        {group.member ? (
          <Badge tone={group.member.status === "Active" ? "success" : "neutral"}>Member · {group.member.status}</Badge>
        ) : (
          <Badge tone="warn">No member record</Badge>
        )}
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {group.seats.length} seat{group.seats.length === 1 ? "" : "s"}{reps.length ? ` · ${reps.slice(0, 3).join(", ")}${reps.length > 3 ? ` +${reps.length - 3}` : ""}` : ""}
        </span>
        <span style={{ marginLeft: "auto" }} className="row">
          {group.member ? (
            <>
              <Link className="btn btn--ghost btn--sm" to={`/app/members/${group.member._id}`}>Open member</Link>
              <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={onEditMember}>Edit</button>
            </>
          ) : (
            <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={onCreateMember}>Create member record</button>
          )}
        </span>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 10px" }} className="col">
          {group.seats.length === 0 && <p className="muted">No seats recorded. Add one from a representative change.</p>}
          {group.seats.map((seat) => (
            <SeatRow key={seat._id} seat={seat} canWrite={canWrite} people={people} societyId={societyId} onChangeRepresentative={() => onChangeRepresentative(seat)} />
          ))}
          {group.member && canWrite && <AddSeatButton societyId={societyId} memberId={group.member._id} organizationName={group.organizationName} />}
        </div>
      )}
    </li>
  );
}

function AddSeatButton({ societyId, memberId, organizationName }: { societyId: string; memberId: string; organizationName: string }) {
  const add = useMutation(api.memberGovernance.addSeat);
  const toast = useToast();
  const [sheet, setSheet] = useState("");
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <input className="input" aria-label="New seat body or roster" placeholder="Body or roster for a new seat (e.g. Board)" value={sheet} onChange={(e) => setSheet(e.target.value)} style={{ flex: "1 1 220px" }} />
      <button type="button" className="btn btn--sm" disabled={!sheet.trim()} onClick={async () => {
        try { await add({ societyId, organizationName, memberId, rosterSheet: sheet.trim() }); setSheet(""); toast.success("Seat added"); }
        catch (e: any) { toast.error("Seat not added", e.message); }
      }}><Plus size={12} /> Add seat</button>
    </div>
  );
}

function SeatRow({ seat, canWrite, people, societyId, onChangeRepresentative }: { seat: SeatSummary; canWrite: boolean; people: DirectoryPersonOption[] | undefined; societyId: string; onChangeRepresentative: () => void }) {
  const [history, setHistory] = useState(false);
  return (
    <div className="members-reps__seat" style={{ padding: "6px 0", borderBottom: "1px dashed var(--border)" }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span><strong>{seat.rosterSheet ?? seat.seatKey}</strong>{seat.committeeName && <span className="muted"> · {seat.committeeName}</span>}</span>
        {seat.status !== "active" && <Badge>{seat.status}</Badge>}
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {seat.current.length ? seat.current.map((c) => `${c.personName} (${sourceRoleLabel(c.roleTitle)}, ${term(c)})`).join("; ") : <span className="muted">No current representative recorded</span>}
        </span>
        <span style={{ marginLeft: "auto" }} className="row">
          <button type="button" className="btn btn--sm" disabled={!canWrite} onClick={onChangeRepresentative}><UserRoundPen size={12} /> Change representative</button>
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={history} onClick={() => setHistory(!history)}><History size={12} /> History ({seat.observationCount})</button>
        </span>
      </div>
      {history && <SeatHistory seatId={seat._id} canWrite={canWrite} people={people} societyId={societyId} />}
    </div>
  );
}

function SeatHistory({ seatId, canWrite, people, societyId }: { seatId: string; canWrite: boolean; people: DirectoryPersonOption[] | undefined; societyId: string }) {
  const detail = useQuery(api.memberGovernance.seatDetail, { seatId }) as any;
  const [correcting, setCorrecting] = useState<any | null>(null);
  if (!detail) return <p className="muted">Loading seat history…</p>;
  const observations = [...(detail.observations ?? [])].sort((a: any, b: any) => String(a.recordedAtISO ?? a.observedDate ?? "").localeCompare(String(b.recordedAtISO ?? b.observedDate ?? "")));
  return (
    <div className="col" style={{ gap: 6, marginTop: 6, paddingLeft: 12 }}>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {observations.map((o: any) => (
          <li key={o.id} style={{ opacity: o.supersededById ? 0.6 : 1 }}>
            <span style={{ textDecoration: o.supersededById ? "line-through" : undefined }}>
              {o.kind}: {o.personName || "Vacant / unknown"} · {sourceRoleLabel(o.roleTitle)} · {term(o)} · {o.reviewStatus}
            </span>
            {o.supersedes && <span className="muted"> · corrects an earlier entry{o.supersedeReason ? ` (${o.supersedeReason})` : ""}</span>}
            {o.supersededById && <span className="muted"> · superseded</span>}
            {" · "}{o.sourceUrl ? <a href={o.sourceUrl} target="_blank" rel="noreferrer">{o.sourceReference}</a> : <span className="muted">{o.sourceReference}</span>}
            {!o.supersededById && canWrite && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCorrecting(o)}>Correct</button>}
          </li>
        ))}
      </ol>
      {detail.proxies?.length > 0 && <p className="muted">Proxy authorizations: {detail.proxies.map((p: any) => `${p.principalName} → ${p.proxyName}`).join("; ")}</p>}
      <PersonRecordLinks societyId={societyId} recordTable="organizationSeats" recordId={seatId} people={people} />
      {correcting && <CorrectObservationDrawer seatId={seatId} observation={correcting} people={people} onClose={() => setCorrecting(null)} />}
    </div>
  );
}

function OrganizationMemberDrawer({ societyId, form, setForm, seats }: { societyId: string; form: any; setForm: (f: any) => void; seats: SeatSummary[] }) {
  const save = useMutation(api.memberGovernance.saveOrganizationMember);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const candidates = seats.filter((s) => !s.memberId && (form.linkSeatIds.includes(s._id) || s.organizationName.toLocaleLowerCase() === form.organizationName.trim().toLocaleLowerCase()));
  // Roster sheets hold placeholders such as "?" where the affiliation was unknown.
  const nameProblem = form.organizationName.trim() && !/[\p{L}\p{N}]/u.test(form.organizationName) ? `“${form.organizationName.trim()}” is a placeholder from the source; enter the organization's name.` : null;
  const valid = form.organizationName.trim() && !nameProblem && form.membershipClass.trim() && form.joinedAt && isPartialDate(form.joinedAt) && isPartialDate(form.leftAt);
  return (
    <Drawer open onClose={() => setForm(null)} title={form.memberId ? "Edit organization member" : "Add organization member"} footer={<>
      <button className="btn" onClick={() => setForm(null)}>Cancel</button>
      <button className="btn btn--accent" disabled={busy || !valid} onClick={async () => {
        setBusy(true);
        try {
          await save({ societyId, ...(form.memberId ? { memberId: form.memberId } : {}), organizationName: form.organizationName, membershipClass: form.membershipClass, status: form.status, joinedAt: form.joinedAt, ...(form.leftAt ? { leftAt: form.leftAt } : {}), votingRights: form.votingRights, ...(form.notes ? { notes: form.notes } : {}), linkSeatIds: form.linkSeatIds });
          toast.success(form.memberId ? "Organization member updated" : "Organization member added", form.organizationName);
          setForm(null);
        } catch (e: any) { toast.error("Could not save", e.message); } finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Save"}</button>
    </>}>
      <Field label="Organization" required error={nameProblem ?? undefined}><input className="input" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label="Membership class"><input className="input" value={form.membershipClass} onChange={(e) => setForm({ ...form, membershipClass: e.target.value })} /></Field>
        <Field label="Status"><Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["Active", "NeedsReview", "Inactive", "Resigned", "Removed"].map((s) => ({ value: s, label: s === "NeedsReview" ? "Needs review" : s }))} /></Field>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label={`Joined (${PARTIAL_DATE_HINT})`} required><input className="input" aria-invalid={!isPartialDate(form.joinedAt)} value={form.joinedAt} onChange={(e) => setForm({ ...form, joinedAt: e.target.value })} placeholder="2019" /></Field>
        <Field label="Left (if any)"><input className="input" aria-invalid={!isPartialDate(form.leftAt)} value={form.leftAt} onChange={(e) => setForm({ ...form, leftAt: e.target.value })} /></Field>
      </div>
      <Checkbox checked={form.votingRights} onChange={(v) => setForm({ ...form, votingRights: v })} label="Has voting rights (exercised by its representative)" />
      <Field label="Notes"><textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      {candidates.length > 0 && (
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend className="muted">Seats held by this organization</legend>
          {candidates.map((s) => (
            <Checkbox key={s._id} checked={form.linkSeatIds.includes(s._id)} onChange={(v) => setForm({ ...form, linkSeatIds: v ? [...form.linkSeatIds, s._id] : form.linkSeatIds.filter((id: string) => id !== s._id) })} label={`${s.seatKey}${s.current.length ? ` — ${s.current.map((c) => c.personName).join(", ")}` : ""}`} />
          ))}
        </fieldset>
      )}
    </Drawer>
  );
}

/** The server requires both a web link to the source and a citation inside it (shared/evidenceReview.ts). */
function sourceReady(value: { sourceUrl: string; sourceReference: string }) {
  return evidenceUrl(value.sourceUrl.trim()) && Boolean(value.sourceReference.trim());
}

function urlError(value: string) {
  return value.trim() && !evidenceUrl(value.trim()) ? "Enter a full web address starting with https:// (for example the file's link in your drive or document library)." : undefined;
}

function SourceFields({ value, onChange }: { value: { sourceUrl: string; sourceReference: string; reviewStatus: string }; onChange: (v: any) => void }) {
  return (
    <>
      <Field label="Source URL" required hint="Link to the letter, minutes or roster that records this." error={urlError(value.sourceUrl)}><input className="input" type="url" value={value.sourceUrl} onChange={(e) => onChange({ ...value, sourceUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Citation (page, section, resolution or cell)" required><input className="input" value={value.sourceReference} onChange={(e) => onChange({ ...value, sourceReference: e.target.value })} /></Field>
      <Field label="Source review"><Select value={value.reviewStatus} onChange={(v) => onChange({ ...value, reviewStatus: v })} options={[{ value: "pending", label: "Pending review" }, { value: "verified", label: "Verified against the source" }]} /></Field>
    </>
  );
}

function RepresentativeDrawer({ seat, people, onClose }: { seat: SeatSummary; people: DirectoryPersonOption[] | undefined; onClose: () => void }) {
  const record = useMutation(api.memberGovernance.recordRepresentative);
  const toast = useToast();
  const [form, setForm] = useState({ endPreviousObservationId: seat.current.length === 1 ? seat.current[0].id : "", personId: "", personName: "", roleTitle: "Representative", termStart: "", termEnd: "", notes: "" });
  const [source, setSource] = useState({ sourceUrl: "", sourceReference: "", reviewStatus: "pending" });
  const [busy, setBusy] = useState(false);
  const datesOk = isPartialDate(form.termStart) && isPartialDate(form.termEnd) && (!form.endPreviousObservationId || !!form.termStart);
  return (
    <Drawer open onClose={onClose} title={`Change representative — ${seat.organizationName}`} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn--accent" disabled={busy || !(form.personId || form.personName.trim()) || !datesOk || !sourceReady(source)} onClick={async () => {
        setBusy(true);
        try {
          await record({ seatId: seat._id, ...(form.personId ? { personId: form.personId } : {}), ...(form.personName.trim() ? { personName: form.personName.trim() } : {}), ...(form.roleTitle ? { roleTitle: form.roleTitle } : {}), ...(form.termStart ? { termStart: form.termStart } : {}), ...(form.termEnd ? { termEnd: form.termEnd } : {}), ...(form.endPreviousObservationId ? { endPreviousObservationId: form.endPreviousObservationId } : {}), ...(form.notes ? { notes: form.notes } : {}), source });
          toast.success("Representative recorded", form.endPreviousObservationId ? "The earlier term was ended, not overwritten." : undefined);
          onClose();
        } catch (e: any) { toast.error("Could not record the representative", e.message); } finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Record representative"}</button>
    </>}>
      <p className="muted">Seat: {seat.seatKey}. The new term is added to the seat's history; the previous representative's term ends on the new start date.</p>
      <Field label="Previous representative to end">
        <Select value={form.endPreviousObservationId} onChange={(v) => setForm({ ...form, endPreviousObservationId: v })} clearable clearLabel="Keep current representatives (add another)" options={seat.current.map((c) => ({ value: c.id, label: `${c.personName} (${term(c)})` }))} />
      </Field>
      <Field label="New representative">
        <PersonPicker people={people} value={form.personId} onChange={(v) => setForm({ ...form, personId: v })} clearLabel="Not in the directory yet" ariaLabel="New representative" />
      </Field>
      {!form.personId && <Field label="Name as written in the source"><input className="input" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} /></Field>}
      <Field label="Role at the seat"><input className="input" value={form.roleTitle} onChange={(e) => setForm({ ...form, roleTitle: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label={`Term starts (${PARTIAL_DATE_HINT})`}><input className="input" aria-invalid={!isPartialDate(form.termStart)} value={form.termStart} onChange={(e) => setForm({ ...form, termStart: e.target.value })} placeholder="2021-09" /></Field>
        <Field label="Term ends (if stated)"><input className="input" aria-invalid={!isPartialDate(form.termEnd)} value={form.termEnd} onChange={(e) => setForm({ ...form, termEnd: e.target.value })} /></Field>
      </div>
      {form.endPreviousObservationId && !form.termStart && <p className="muted" role="alert">Enter the start date so the previous term can end on it.</p>}
      <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. appointed by special resolution" /></Field>
      <SourceFields value={source} onChange={setSource} />
    </Drawer>
  );
}

function CorrectObservationDrawer({ seatId, observation, people, onClose }: { seatId: string; observation: any; people: DirectoryPersonOption[] | undefined; onClose: () => void }) {
  const supersede = useMutation(api.memberGovernance.supersedeSeatObservation);
  const toast = useToast();
  const [form, setForm] = useState({ kind: observation.kind, personId: observation.personId ?? "", personName: observation.personName ?? "", roleTitle: observation.roleTitle ?? "", termStart: observation.termStart ?? observation.startDate ?? "", termEnd: observation.termEnd ?? observation.endDate ?? "", reviewStatus: observation.reviewStatus ?? "pending", notes: observation.notes ?? "" });
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Drawer open onClose={onClose} title="Correct seat observation" footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn--accent" disabled={busy || !rationale.trim() || !isPartialDate(form.termStart) || !isPartialDate(form.termEnd)} onClick={async () => {
        setBusy(true);
        try {
          await supersede({ seatId, observationId: observation.id, rationale, changes: { kind: form.kind, personId: form.personId || null, personName: form.personName, roleTitle: form.roleTitle, termStart: form.termStart, termEnd: form.termEnd, reviewStatus: form.reviewStatus, notes: form.notes } });
          toast.success("Correction saved", "The original observation stays in the history.");
          onClose();
        } catch (e: any) { toast.error("Could not save the correction", e.message); } finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Save correction"}</button>
    </>}>
      <p className="muted">Original: {observation.kind}: {observation.personName || "Vacant"} · {observation.sourceReference}</p>
      <Field label="Kind"><Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={["representative", "contact", "staff", "vacant", "organization_member"].map((k) => ({ value: k, label: k.replace("_", " ") }))} /></Field>
      <Field label="Person"><PersonPicker people={people} value={form.personId} onChange={(v) => setForm({ ...form, personId: v })} sourceName={observation.personName} ariaLabel="Observed person" /></Field>
      <Field label="Name as written"><input className="input" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} /></Field>
      <Field label="Role"><input className="input" value={form.roleTitle} onChange={(e) => setForm({ ...form, roleTitle: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label={`Term start (${PARTIAL_DATE_HINT})`}><input className="input" value={form.termStart} onChange={(e) => setForm({ ...form, termStart: e.target.value })} /></Field>
        <Field label="Term end"><input className="input" value={form.termEnd} onChange={(e) => setForm({ ...form, termEnd: e.target.value })} /></Field>
      </div>
      <Field label="Review"><Select value={form.reviewStatus} onChange={(v) => setForm({ ...form, reviewStatus: v })} options={["pending", "verified", "rejected"].map((s) => ({ value: s, label: s }))} /></Field>
      <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <Field label="Why is this being corrected?"><input className="input" value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
    </Drawer>
  );
}

function SeatProxyDrawer({ societyId, people, seats, onClose }: { societyId: string; people: DirectoryPersonOption[] | undefined; seats: SeatSummary[]; onClose: () => void }) {
  const meetings = useQuery(api.meetings.list, { societyId }) as any[] | undefined;
  const authorize = useMutation(api.memberGovernance.authorizeSeatProxy);
  const toast = useToast();
  const [form, setForm] = useState({ seatId: "", meetingId: "", principalId: "", principalName: "", proxyId: "", proxyName: "", authorityUrl: "", authorityReference: "", sourceUrl: "", sourceReference: "" });
  const [busy, setBusy] = useState(false);
  const seat = seats.find((s) => s._id === form.seatId);
  const nameOf = (id: string, fallback: string) => people?.find((p) => p._id === id)?.fullName ?? fallback;
  const principal = form.principalId ? nameOf(form.principalId, form.principalName) : form.principalName;
  const proxy = form.proxyId ? nameOf(form.proxyId, form.proxyName) : form.proxyName;
  const ready = form.seatId && form.meetingId && principal.trim() && proxy.trim() && evidenceUrl(form.authorityUrl.trim()) && form.authorityReference.trim() && evidenceUrl(form.sourceUrl.trim()) && form.sourceReference.trim();
  return (
    <Drawer open onClose={onClose} title="Record a seat proxy for a meeting" footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn--accent" disabled={busy || !ready} onClick={async () => {
        setBusy(true);
        try {
          await authorize({ seatId: form.seatId, meetingId: form.meetingId, principalName: principal, proxyName: proxy, authority: { sourceUrl: form.authorityUrl, sourceReference: form.authorityReference, reviewStatus: "verified" }, source: { sourceUrl: form.sourceUrl, sourceReference: form.sourceReference, reviewStatus: "verified" } });
          toast.success("Proxy authorization recorded"); onClose();
        } catch (e: any) { toast.error("Could not record the proxy", e.message); } finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Record reviewed proxy"}</button>
    </>}>
      <p className="muted">A proxy is valid for one meeting. The bylaw clause that allows proxies and the appointment itself must both be checked against their sources.</p>
      <Field label="Seat"><Select searchable value={form.seatId} onChange={(v) => { const s = seats.find((x) => x._id === v); setForm({ ...form, seatId: v, principalName: s?.current[0]?.personName ?? form.principalName, principalId: s?.current[0]?.personId ?? "" }); }} options={seats.map((s) => ({ value: s._id, label: s.seatKey, hint: s.current.map((c) => c.personName).join(", ") || undefined }))} placeholder="Choose a seat" /></Field>
      <Field label="Meeting"><Select searchable value={form.meetingId} onChange={(v) => setForm({ ...form, meetingId: v })} placeholder={meetings === undefined ? "Loading meetings…" : "Choose a meeting"} options={(meetings ?? []).slice().sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt))).map((m) => ({ value: m._id, label: m.title, hint: String(m.scheduledAt ?? "").slice(0, 10) }))} /></Field>
      <Field label={`Principal (normally the seat's representative${seat?.current[0] ? `: ${seat.current[0].personName}` : ""})`}>
        <PersonPicker people={people} value={form.principalId} onChange={(v) => setForm({ ...form, principalId: v })} sourceName={form.principalName} clearLabel="Type the name instead" ariaLabel="Proxy principal" />
      </Field>
      {!form.principalId && <input className="input" aria-label="Principal name" value={form.principalName} onChange={(e) => setForm({ ...form, principalName: e.target.value })} />}
      <Field label="Proxy holder"><PersonPicker people={people} value={form.proxyId} onChange={(v) => setForm({ ...form, proxyId: v })} clearLabel="Type the name instead" ariaLabel="Proxy holder" /></Field>
      {!form.proxyId && <input className="input" aria-label="Proxy holder name" value={form.proxyName} onChange={(e) => setForm({ ...form, proxyName: e.target.value })} />}
      <Field label="Authority (bylaw clause) URL" required error={urlError(form.authorityUrl)}><input className="input" type="url" value={form.authorityUrl} onChange={(e) => setForm({ ...form, authorityUrl: e.target.value })} /></Field>
      <Field label="Authority clause" required><input className="input" value={form.authorityReference} onChange={(e) => setForm({ ...form, authorityReference: e.target.value })} placeholder="e.g. Bylaw 5.4" /></Field>
      <Field label="Appointment source URL" required error={urlError(form.sourceUrl)}><input className="input" type="url" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></Field>
      <Field label="Appointment citation" required><input className="input" value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} /></Field>
    </Drawer>
  );
}
