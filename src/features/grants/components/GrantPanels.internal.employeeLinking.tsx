// GrantPanels: grant-funded employee assignment parsing, validation, and linking UI.
import { type ReactNode, useEffect, useState } from "react";
import { ExternalLink, ListChecks, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Field, InspectorNote } from "../../../components/ui";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { StructuredAddressFields } from "../../../components/StructuredAddressFields";
import { formatDate, money } from "../../../lib/format";
import {
  asAnswerLibrary,
  asComplianceFlags,
  asContacts,
  asNextSteps,
  asRequirements,
  asTimelineEvents,
  asUseOfFunds,
  cleanStringList,
  detectRequirementTemplateKey,
  GRANT_REQUIREMENT_TEMPLATES,
  type GrantRequirement,
  type GrantRequirementStatus,
  mergeTemplateRequirements,
  optionalString,
  REQUIREMENT_STATUSES,
  requirementStatusTone,
  requirementSummary,
  requirementTemplateCoverage,
  type RequirementTemplateKey,
} from "../lib/grantDrafts";

import {
  detailPanelStyle,
  employeeLinkStyle,
} from "./GrantPanels.internal.styles";
import {
  findKeyFactNumber,
} from "./GrantPanels.internal.documentLookup";
import {
  DossierSection,
} from "./GrantPanels.internal.dossierPanels";

export function GrantFundedEmployeesPanel({
  grant,
  employees,
  employeeLinks,
  secretVaultItems = [],
  onLinkEmployee,
  onUnlinkEmployee,
  onCreateEmployee,
  onQueueEmployeeOrientationEmail,
  onCreateSinVaultRecord,
}: {
  grant: any;
  employees: any[];
  employeeLinks: any[];
  secretVaultItems?: any[];
  onLinkEmployee?: (employeeId: string, patch?: Record<string, unknown>) => void | Promise<void>;
  onUnlinkEmployee?: (linkId: string) => void | Promise<void>;
  onCreateEmployee?: (draft: Record<string, unknown>) => Promise<string | void>;
  onQueueEmployeeOrientationEmail?: (employee: any, grant: any) => void | Promise<void>;
  onCreateSinVaultRecord?: (draft: Record<string, unknown>) => Promise<string | void>;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [showNewEmployee, setShowNewEmployee] = useState(false);
  const [employeeDraft, setEmployeeDraft] = useState(() => defaultGrantEmployeeDraft(grant));
  const [showSinVaultForm, setShowSinVaultForm] = useState(false);
  const [sinVaultDraft, setSinVaultDraft] = useState(() => defaultSinVaultDraft());
  const [endDateOverridden, setEndDateOverridden] = useState(false);
  const grantId = String(grant._id ?? grant.id ?? "");
  const grantAssignmentKey = grantFundedAssignmentKey(grant);
  const links = employeeLinks.filter((link) => String(link.grantId) === grantId);
  const linkedEmployeeIds = new Set(links.map((link) => String(link.employeeId)));
  const availableEmployees = employees.filter((employee) => !linkedEmployeeIds.has(String(employee._id)));
  const approvedParticipants = findKeyFactNumber(grant.keyFacts, /approved participants:\s*(\d+(?:\.\d+)?)/i);
  const remaining = approvedParticipants === undefined ? undefined : Math.max(0, approvedParticipants - links.length);
  const canLinkMoreEmployees = remaining === undefined || remaining > 0;
  const lockedAssignment = grantFundedAssignment(grant);

  useEffect(() => {
    setEmployeeDraft((current) => ({
      ...current,
      role: lockedAssignment.role ?? current.role,
      employmentType: lockedAssignment.employmentType ?? current.employmentType,
      hoursPerWeek: lockedAssignment.hoursPerWeek ?? current.hoursPerWeek,
      hourlyWageDollars: lockedAssignment.hourlyWageDollars ?? current.hourlyWageDollars,
      endDate: !endDateOverridden ? calculatedGrantEndDate(current.startDate, lockedAssignment.weeks) ?? current.endDate : current.endDate,
    }));
  }, [grantAssignmentKey, endDateOverridden]);

  useEffect(() => {
    if (!canLinkMoreEmployees) {
      setSelectedEmployeeId("");
      setShowNewEmployee(false);
    }
  }, [canLinkMoreEmployees]);

  if (!links.length && !onLinkEmployee) return null;

  const linkSelected = async () => {
    if (!selectedEmployeeId || !onLinkEmployee) return;
    const employee = employees.find((item) => String(item._id) === selectedEmployeeId);
    await onLinkEmployee(selectedEmployeeId, patchFromEmployee(employee));
    setSelectedEmployeeId("");
  };

  const createAndLink = async () => {
    if (!onCreateEmployee || !onLinkEmployee || !canCreateGrantEmployee(employeeDraft)) return;
    const employeeId = await onCreateEmployee({
      firstName: employeeDraft.firstName.trim(),
      lastName: employeeDraft.lastName.trim(),
      email: employeeDraft.email.trim() || undefined,
      phone: employeeDraft.phone.trim() || undefined,
      birthDate: employeeDraft.birthDate || undefined,
      addressLine1: employeeDraft.addressLine1.trim() || undefined,
      addressLine2: employeeDraft.addressLine2.trim() || undefined,
      city: employeeDraft.city.trim() || undefined,
      province: employeeDraft.province.trim() || undefined,
      postalCode: employeeDraft.postalCode.trim() || undefined,
      country: employeeDraft.country.trim() || undefined,
      sinSecretVaultItemId: employeeDraft.sinSecretVaultItemId || undefined,
      role: employeeDraft.role.trim(),
      startDate: employeeDraft.startDate,
      endDate: employeeDraft.endDate || undefined,
      employmentType: employeeDraft.employmentType,
      hourlyWageCents: dollarsToCents(employeeDraft.hourlyWageDollars),
      cppExempt: false,
      eiExempt: false,
      notes: "Created from the GCOS grant EED preparation workflow. SIN is stored only through the Secrets vault link; do not place raw SIN in notes.",
    });
    if (employeeId) {
      await onLinkEmployee(String(employeeId), {
        status: "eed_pending",
        source: "gcos",
        role: employeeDraft.role.trim(),
        startDate: employeeDraft.startDate,
        endDate: employeeDraft.endDate || undefined,
        fundedHoursPerWeek: Number(employeeDraft.hoursPerWeek) || undefined,
        fundedHourlyWageCents: dollarsToCents(employeeDraft.hourlyWageDollars),
        notes: "Created from GCOS EED prep. Confirm participant-only sensitive fields in GCOS before submission.",
      });
      setEmployeeDraft(defaultGrantEmployeeDraft(grant));
      setEndDateOverridden(false);
      setShowNewEmployee(false);
    }
  };

  const createSinVaultRecord = async () => {
    if (!onCreateSinVaultRecord || !canCreateSinVaultRecord(sinVaultDraft)) return;
    const firstName = employeeDraft.firstName.trim();
    const lastName = employeeDraft.lastName.trim();
    const employeeName = [firstName, lastName].filter(Boolean).join(" ");
    const id = await onCreateSinVaultRecord({
      name: sinVaultDraft.name.trim() || `SIN - ${employeeName || "funded employee"}`,
      custodianPersonName: sinVaultDraft.custodianPersonName.trim() || undefined,
      custodianEmail: sinVaultDraft.custodianEmail.trim() || undefined,
      externalLocation: sinVaultDraft.externalLocation.trim() || undefined,
      secretValue: sinVaultDraft.secretValue.trim() || undefined,
      notes: [
        `Created from grant ${grant.title ?? "GCOS grant"} funded-employee workflow.`,
        employeeName ? `Employee: ${employeeName}.` : undefined,
        "Raw SIN is retained only in the Secrets vault record.",
      ].filter(Boolean).join(" "),
    });
    if (id) {
      setEmployeeDraft({ ...employeeDraft, sinSecretVaultItemId: String(id) });
      setSinVaultDraft(defaultSinVaultDraft());
      setShowSinVaultForm(false);
    }
  };

  return (
    <DossierSection title="Funded Employees" id="funded-employees">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone={links.length ? "success" : "warn"}>{links.length} linked</Badge>
          {approvedParticipants !== undefined && <Badge tone={remaining === 0 ? "success" : "warn"}>{remaining} participant slot{remaining === 1 ? "" : "s"} open</Badge>}
        </div>
        {links.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {links.map((link) => {
              const employee = employees.find((item) => String(item._id) === String(link.employeeId));
              const name = employee ? `${employee.firstName} ${employee.lastName}` : "Linked employee";
              const readiness = eedPrepReadiness(employee, link);
              return (
                <div key={String(link._id)} style={{ ...employeeLinkStyle, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{name}</strong>
                      <Badge tone={readiness.ready ? "success" : "warn"}>{readiness.ready ? "Ready to prepare" : "Missing EED prep fields"}</Badge>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {[link.role ?? employee?.role, link.status, employee?.startDate ? `Starts ${formatDate(link.startDate ?? employee.startDate)}` : undefined].filter(Boolean).join(" · ")}
                    </div>
                    {!readiness.ready && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Add: {readiness.missing.join(", ")}</div>}
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      SIN must stay in Secrets. GCOS-only fields still required before submission: citizenship/eligibility and demographic declarations.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {employee && onQueueEmployeeOrientationEmail && (
                      <button className="btn btn--accent btn--sm" type="button" disabled={!employee.email} onClick={() => onQueueEmployeeOrientationEmail(employee, grant)}>
                        Queue orientation email
                      </button>
                    )}
                    {onUnlinkEmployee && (
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => onUnlinkEmployee(String(link._id))}>
                        Unlink
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>No Societyer employees are linked to this grant yet.</div>
        )}
        {onLinkEmployee && availableEmployees.length > 0 && canLinkMoreEmployees && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="input" style={{ flex: "1 1 220px" }} value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
              <option value="">Select an employee to link</option>
              {availableEmployees.map((employee) => (
                <option key={String(employee._id)} value={String(employee._id)}>
                  {employee.firstName} {employee.lastName} · {employee.role}
                </option>
              ))}
            </select>
            <button className="btn btn--accent" type="button" disabled={!selectedEmployeeId} onClick={linkSelected}>
              Link employee
            </button>
          </div>
        )}
        {onCreateEmployee && onLinkEmployee && canLinkMoreEmployees && (
          <div style={{ display: "grid", gap: 8, borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowNewEmployee((value) => !value)}>
              {showNewEmployee ? "Cancel new employee" : "Add and link new employee"}
            </button>
            {showNewEmployee && (
              <div style={{ display: "grid", gap: 8 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Societyer collects EED prep fields here, including birth date and home address. Store SIN only in Access custody, then link the vault record below.
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="First name"><input className="input" value={employeeDraft.firstName} onChange={(event) => setEmployeeDraft({ ...employeeDraft, firstName: event.target.value })} /></Field>
                  <Field label="Last name"><input className="input" value={employeeDraft.lastName} onChange={(event) => setEmployeeDraft({ ...employeeDraft, lastName: event.target.value })} /></Field>
                </div>
                <Field label="Email"><input className="input" type="email" value={employeeDraft.email} onChange={(event) => setEmployeeDraft({ ...employeeDraft, email: event.target.value })} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Phone"><input className="input" inputMode="tel" value={employeeDraft.phone} onChange={(event) => setEmployeeDraft({ ...employeeDraft, phone: event.target.value })} /></Field>
                  <Field label="Birth date"><input className="input" type="date" value={employeeDraft.birthDate} onChange={(event) => setEmployeeDraft({ ...employeeDraft, birthDate: event.target.value })} /></Field>
                </div>
                <StructuredAddressFields
                  value={{
                    street: employeeDraft.addressLine1,
                    unit: employeeDraft.addressLine2,
                    city: employeeDraft.city,
                    provinceState: employeeDraft.province,
                    postalCode: employeeDraft.postalCode,
                    country: employeeDraft.country,
                  }}
                  onChange={(address) => setEmployeeDraft({
                    ...employeeDraft,
                    addressLine1: address.street ?? "",
                    addressLine2: address.unit ?? "",
                    city: address.city ?? "",
                    province: address.provinceState ?? "",
                    postalCode: address.postalCode ?? "",
                    country: address.country ?? "",
                  })}
                />
                <Field label="SIN vault record" hint="Raw SIN stays in Secrets; this links only the vault metadata record.">
                  <select className="input" value={employeeDraft.sinSecretVaultItemId} onChange={(event) => setEmployeeDraft({ ...employeeDraft, sinSecretVaultItemId: event.target.value })}>
                    <option value="">No SIN vault record linked</option>
                    {secretVaultItems.map((secret) => (
                      <option key={String(secret._id)} value={String(secret._id)}>
                        {[secret.name, secret.service, secret.secretPreview].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {onCreateSinVaultRecord && (
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowSinVaultForm((value) => !value)}>
                      {showSinVaultForm ? "Cancel SIN vault record" : "Add SIN vault record"}
                    </button>
                  )}
                  <span className="muted" style={{ fontSize: 12 }}>
                    You can also manage access records in <Link to="/app/secrets">Secrets</Link>.
                  </span>
                </div>
                {showSinVaultForm && (
                  <div style={{ ...detailPanelStyle, display: "grid", gap: 8 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      This creates a restricted Secrets record. Do not put SIN in employee notes, grant notes, or documents unless the document is intentionally access-controlled.
                    </div>
                    <Field label="Record name"><input className="input" value={sinVaultDraft.name} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, name: event.target.value })} /></Field>
                    <Field label="SIN" hint="Stored encrypted in Secrets only. Leave blank if the SIN is held externally."><input className="input" type="password" inputMode="numeric" autoComplete="off" value={sinVaultDraft.secretValue} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, secretValue: event.target.value })} /></Field>
                    <Field label="External custody location" hint="Use when the SIN is stored outside Societyer."><input className="input" value={sinVaultDraft.externalLocation} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, externalLocation: event.target.value })} /></Field>
                    <div className="row" style={{ gap: 8 }}>
                      <Field label="Custodian name"><input className="input" value={sinVaultDraft.custodianPersonName} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, custodianPersonName: event.target.value })} /></Field>
                      <Field label="Custodian email"><input className="input" type="email" value={sinVaultDraft.custodianEmail} onChange={(event) => setSinVaultDraft({ ...sinVaultDraft, custodianEmail: event.target.value })} /></Field>
                    </div>
                    <button className="btn btn--accent btn--sm" type="button" disabled={!canCreateSinVaultRecord(sinVaultDraft)} onClick={createSinVaultRecord}>
                      Create and link SIN vault record
                    </button>
                  </div>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Job / role" hint={lockedAssignment.role ? "From approved GCOS job" : undefined}>
                    <input className="input" readOnly={Boolean(lockedAssignment.role)} value={employeeDraft.role} onChange={(event) => setEmployeeDraft({ ...employeeDraft, role: event.target.value })} />
                  </Field>
                  <Field label="Type" hint={lockedAssignment.employmentType ? "From grant-funded role" : undefined}>
                    <select className="input" disabled={Boolean(lockedAssignment.employmentType)} value={employeeDraft.employmentType} onChange={(event) => setEmployeeDraft({ ...employeeDraft, employmentType: event.target.value })}>
                      <option>FullTime</option>
                      <option>PartTime</option>
                      <option>Casual</option>
                      <option>Contractor</option>
                    </select>
                  </Field>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Start">
                    <input
                      className="input"
                      type="date"
                      value={employeeDraft.startDate}
                      onChange={(event) => {
                        const startDate = event.target.value;
                        setEmployeeDraft({
                          ...employeeDraft,
                          startDate,
                          endDate: !endDateOverridden ? calculatedGrantEndDate(startDate, lockedAssignment.weeks) ?? employeeDraft.endDate : employeeDraft.endDate,
                        });
                      }}
                    />
                  </Field>
                  <Field label="End" hint={endDateOverridden ? "Manual override" : lockedAssignment.weeks ? `${lockedAssignment.weeks} approved weeks from start` : undefined}>
                    <input
                      className="input"
                      type="date"
                      value={employeeDraft.endDate}
                      onChange={(event) => {
                        setEndDateOverridden(true);
                        setEmployeeDraft({ ...employeeDraft, endDate: event.target.value });
                      }}
                    />
                  </Field>
                </div>
                {endDateOverridden && (
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => {
                      setEndDateOverridden(false);
                      setEmployeeDraft({
                        ...employeeDraft,
                        endDate: calculatedGrantEndDate(employeeDraft.startDate, lockedAssignment.weeks) ?? employeeDraft.endDate,
                      });
                    }}
                  >
                    Use calculated end date
                  </button>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Hours/week" hint={lockedAssignment.hoursPerWeek ? "From approved GCOS job" : undefined}>
                    <input className="input" readOnly={Boolean(lockedAssignment.hoursPerWeek)} type="number" inputMode="decimal" min="0" step="0.25" value={employeeDraft.hoursPerWeek} onChange={(event) => setEmployeeDraft({ ...employeeDraft, hoursPerWeek: event.target.value })} />
                  </Field>
                  <Field label="Hourly wage" hint={lockedAssignment.hourlyWageDollars ? "From approved GCOS job" : "Dollars"}>
                    <input className="input" readOnly={Boolean(lockedAssignment.hourlyWageDollars)} type="number" inputMode="decimal" min="0" step="0.01" value={employeeDraft.hourlyWageDollars} onChange={(event) => setEmployeeDraft({ ...employeeDraft, hourlyWageDollars: event.target.value })} />
                  </Field>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn--accent btn--sm" type="button" disabled={!canCreateGrantEmployee(employeeDraft)} onClick={createAndLink}>
                    Create and link employee
                  </button>
                  {!canCreateGrantEmployee(employeeDraft) && <span className="muted" style={{ fontSize: 12 }}>First name, last name, role, start, hourly wage, birth date, home address, phone, and SIN vault record are required.</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DossierSection>
  );
}

export function defaultGrantEmployeeDraft(grant: any) {
  const assignment = grantFundedAssignment(grant);
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    birthDate: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    province: "British Columbia",
    postalCode: "",
    country: "Canada",
    sinSecretVaultItemId: "",
    role: assignment.role ?? "",
    employmentType: assignment.employmentType ?? "FullTime",
    startDate: grant.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: calculatedGrantEndDate(grant.startDate ?? new Date().toISOString().slice(0, 10), assignment.weeks) ?? grant.endDate ?? "",
    hoursPerWeek: assignment.hoursPerWeek ?? "35",
    hourlyWageDollars: assignment.hourlyWageDollars ?? "",
  };
}

export function defaultSinVaultDraft() {
  return {
    name: "",
    secretValue: "",
    externalLocation: "",
    custodianPersonName: "",
    custodianEmail: "",
  };
}

export function canCreateSinVaultRecord(draft: ReturnType<typeof defaultSinVaultDraft>) {
  return Boolean(draft.name.trim() || draft.secretValue.trim() || draft.externalLocation.trim());
}

export function grantFundedAssignment(grant: any) {
  const role = approvedJobTitle(grant);
  const isCanadaSummerJobs = /canada summer jobs|csj/i.test(`${grant.program ?? ""} ${cleanStringList(grant.keyFacts).join(" ")}`);
  return {
    role,
    employmentType: isCanadaSummerJobs ? "FullTime" : undefined,
    hoursPerWeek: grantHoursPerWeek(grant) ?? (isCanadaSummerJobs ? "35" : undefined),
    hourlyWageDollars: grantHourlyWageDollars(grant),
    weeks: grantApprovedWeeks(grant),
  };
}

export function grantFundedAssignmentKey(grant: any) {
  const assignment = grantFundedAssignment(grant);
  return [
    grant._id ?? grant.id ?? "",
    assignment.role ?? "",
    assignment.employmentType ?? "",
    assignment.hoursPerWeek ?? "",
    assignment.hourlyWageDollars ?? "",
  ].join("|");
}

export function approvedJobTitle(grant: any) {
  const line = asUseOfFunds(grant.useOfFunds).find((item) => /approved esdc contribution:/i.test(item.label));
  return line?.label.split(":").slice(1).join(":").trim() || undefined;
}

export function grantHoursPerWeek(grant: any) {
  const text = cleanStringList(grant.keyFacts).join(" ");
  return text.match(/approved hours\/week:\s*(\d+(?:\.\d+)?)/i)?.[1];
}

export function grantHourlyWageDollars(grant: any) {
  const match = cleanStringList(grant.keyFacts).join(" ").match(/(?:approved )?hourly wage:\s*\$?(\d+(?:\.\d{1,2})?)/i);
  return match?.[1];
}

export function grantApprovedWeeks(grant: any) {
  return findKeyFactNumber(grant.keyFacts, /approved weeks:\s*(\d+(?:\.\d+)?)/i);
}

export function calculatedGrantEndDate(startDate: unknown, weeks: unknown) {
  const start = String(startDate ?? "").trim();
  const parsedWeeks = typeof weeks === "number" ? weeks : Number(weeks);
  if (!start || !Number.isFinite(parsedWeeks) || parsedWeeks <= 0) return undefined;
  const date = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + Math.round(parsedWeeks * 7) - 1);
  return date.toISOString().slice(0, 10);
}

export function canCreateGrantEmployee(draft: ReturnType<typeof defaultGrantEmployeeDraft>) {
  return Boolean(
    draft.firstName.trim() &&
    draft.lastName.trim() &&
    draft.role.trim() &&
    draft.startDate &&
    draft.phone.trim() &&
    draft.birthDate &&
    draft.addressLine1.trim() &&
    draft.city.trim() &&
    draft.province.trim() &&
    draft.postalCode.trim() &&
    draft.sinSecretVaultItemId &&
    dollarsToCents(draft.hourlyWageDollars) !== undefined,
  );
}

export function dollarsToCents(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
}

export function draftAmountCents(draft: any, centsKey: string, dollarsKey: string) {
  if (typeof draft[centsKey] === "number") return draft[centsKey];
  return draft[dollarsKey] === "" || draft[dollarsKey] === undefined ? undefined : dollarsToCents(draft[dollarsKey]);
}

export function patchFromEmployee(employee: any) {
  return {
    status: "eed_pending",
    source: "manual",
    role: employee?.role,
    startDate: employee?.startDate,
    endDate: employee?.endDate,
    fundedHourlyWageCents: employee?.hourlyWageCents,
  };
}

export function eedPrepReadiness(employee: any, link: any) {
  const checks = [
    ["first name", employee?.firstName],
    ["last name", employee?.lastName],
    ["email", employee?.email],
    ["phone", employee?.phone],
    ["birth date", employee?.birthDate],
    ["home address", employee?.addressLine1],
    ["city", employee?.city],
    ["province", employee?.province],
    ["postal code", employee?.postalCode],
    ["SIN vault record", employee?.sinSecretVaultItemId],
    ["job/role", link?.role ?? employee?.role],
    ["start date", link?.startDate ?? employee?.startDate],
    ["end date", link?.endDate ?? employee?.endDate],
    ["hourly wage", link?.fundedHourlyWageCents ?? employee?.hourlyWageCents],
  ] as const;
  const missing = checks
    .filter(([, value]) => value === undefined || value === null || String(value).trim() === "")
    .map(([label]) => label);
  return { ready: missing.length === 0, missing };
}
