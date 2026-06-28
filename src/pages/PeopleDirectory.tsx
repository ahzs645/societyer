import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Contact, Plus } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";

/**
 * Cross-tenant people directory. The directory is GLOBAL — its queries take no
 * societyId — but the page lives inside the app shell, so it still renders the
 * standard society loading/seed guards for layout consistency.
 */
export function PeopleDirectoryPage() {
  const society = useSociety();
  const [prefix, setPrefix] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  const people = useQuery(api.peopleDirectory.list, {}) as
    | Array<{
        _id: string;
        fullName: string;
        firstName?: string;
        lastName?: string;
        dob?: string;
        isIndividual?: boolean;
      }>
    | undefined;

  const matches = useQuery(
    api.peopleDirectory.searchByPrefix,
    prefix ? { prefix } : "skip",
  ) as
    | Array<{ id: string; fullName: string; firstName?: string; lastName?: string; dob?: string }>
    | undefined;

  const duplicateGroups = useQuery(api.peopleDirectory.duplicates, {}) as
    | Array<Array<{ id: string; fullName: string; dob?: string }>>
    | undefined;

  const upsert = useMutation(api.peopleDirectory.upsert);
  const addToSociety = useMutation(api.peopleDirectory.addToSociety);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const addPersonToSociety = async (personId: string, roleType: string) => {
    await addToSociety({
      directoryPersonId: personId,
      societyId: society._id,
      roleType,
      nowISO: new Date().toISOString(),
    });
    setAddedId(personId);
    setTimeout(() => setAddedId(null), 2000);
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

  const openEdit = (person: { id: string; fullName: string; firstName?: string; lastName?: string; dob?: string; isIndividual?: boolean }) => {
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
    await upsert({
      id: (editingId ?? undefined) as any,
      fullName: form.fullName,
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
  };

  return (
    <div className="page">
      <PageHeader
        title="People directory"
        icon={<Contact size={16} />}
        iconColor="blue"
        subtitle="A global, cross-tenant directory of people. Search by name to find an existing person before creating a new one, and review possible duplicates."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New person
          </button>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
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
                    style={{ gap: 8, justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span>{m.fullName}</span>
                    <span className="row" style={{ gap: 8, alignItems: "center" }}>
                      {m.dob && <span style={{ opacity: 0.6 }}>{m.dob}</span>}
                      <button className="btn btn--ghost" onClick={() => openEdit(m)}>
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

      {duplicateGroups && duplicateGroups.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="page__title-text">Possible duplicates</h2>
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
                    <span>{p.fullName}</span>
                    {p.dob && <span style={{ opacity: 0.6 }}>{p.dob}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="page__title-text">All people</h2>
        {people === undefined ? (
          <p>Loading…</p>
        ) : people.length === 0 ? (
          <p>No people in the directory yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {people.map((p) => (
              <div
                key={p._id}
                className="row"
                style={{ gap: 8, justifyContent: "space-between", alignItems: "center" }}
              >
                <span>{p.fullName}</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {p.dob && <span style={{ opacity: 0.6 }}>{p.dob}</span>}
                  {p.isIndividual === false && <span style={{ opacity: 0.6 }}>Organization</span>}
                  {addedId === p._id ? (
                    <span style={{ color: "var(--accent, green)" }}>Added ✓</span>
                  ) : (
                    <Select
                      value=""
                      onChange={(value) => {
                        if (value) {
                          addPersonToSociety(p._id, value);
                        }
                      }}
                      options={[
                        { value: "", label: "Add to society…" },
                        { value: "director", label: "as Director" },
                        { value: "officer", label: "as Officer" },
                        { value: "member", label: "as Member" },
                        { value: "controller", label: "as Significant individual" },
                      ]}
                      aria-label="Add to current society as…"
                      style={{ width: 150 }}
                    />
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit person" : "New person"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save}>
              Save
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

export default PeopleDirectoryPage;
