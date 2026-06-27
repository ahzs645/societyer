import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useBylawRules } from "../hooks/useBylawRules";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { Toggle } from "../components/Controls";
import { ChevronDown, Info, Plus, RefreshCw, Save, Scale, Trash2 } from "lucide-react";
import { builtInResolutionTypes, RESOLUTION_BASES } from "../lib/motionGovernance";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { LegalGuideTrackList } from "../components/LegalGuide";
import {
  getJurisdictionGuidePack,
  getLegalGuideRules,
  resolveJurisdictionCode,
} from "../lib/jurisdictionGuideTracks";

export function BylawRulesPage() {
  const { society, rules } = useBylawRules();
  const history = useQuery(
    api.bylawRules.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsert = useMutation(api.bylawRules.upsertActive);
  const reset = useMutation(api.bylawRules.resetToDefault);
  const toast = useToast();
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    if (rules && !form) setForm({ ...rules });
  }, [form, rules]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!form) return <PageLoading />;

  const jurisdictionCode = resolveJurisdictionCode(society);
  const jurisdictionPack = getJurisdictionGuidePack(jurisdictionCode);
  const legalGuideDateISO = form.effectiveFromISO || new Date().toISOString();
  const legalGuideRules = getLegalGuideRules({
    jurisdictionCode,
    dateISO: legalGuideDateISO,
    topics: [
      "bylaw_requirements",
      "bylaw_effective_date",
      "general_meeting_notice",
      "agm_timing",
      "annual_report",
      "member_proposals",
      "requisitioned_meetings",
      "quorum",
      "electronic_participation",
      "proxy_voting",
      "special_resolution",
      "records",
      "model_bylaws_quorum",
      "model_bylaws_proxy",
      "directors_quorum",
    ],
  });

  const save = async () => {
    await upsert({
      id: form._id,
      societyId: society._id,
      effectiveFromISO: form.effectiveFromISO || undefined,
      sourceBylawDocumentId: form.sourceBylawDocumentId,
      sourceAmendmentId: form.sourceAmendmentId,
      generalNoticeMinDays: Number(form.generalNoticeMinDays),
      generalNoticeMaxDays: Number(form.generalNoticeMaxDays),
      allowElectronicMeetings: !!form.allowElectronicMeetings,
      allowHybridMeetings: !!form.allowHybridMeetings,
      allowElectronicVoting: !!form.allowElectronicVoting,
      allowProxyVoting: !!form.allowProxyVoting,
      proxyHolderMustBeMember: !!form.proxyHolderMustBeMember,
      proxyLimitPerGrantorPerMeeting: Number(
        form.proxyLimitPerGrantorPerMeeting,
      ),
      quorumType: form.quorumType,
      quorumValue: Number(form.quorumValue),
      quorumMinimumCount:
        form.quorumType === "percentage" && form.quorumMinimumCount !== ""
          ? Number(form.quorumMinimumCount ?? 0)
          : undefined,
      memberProposalThresholdPct: Number(form.memberProposalThresholdPct),
      memberProposalMinSignatures: Number(form.memberProposalMinSignatures),
      memberProposalLeadDays: Number(form.memberProposalLeadDays),
      requisitionMeetingThresholdPct: Number(
        form.requisitionMeetingThresholdPct,
      ),
      annualReportDueDaysAfterMeeting: Number(
        form.annualReportDueDaysAfterMeeting,
      ),
      requireAgmFinancialStatements: !!form.requireAgmFinancialStatements,
      requireAgmElections: !!form.requireAgmElections,
      ballotIsAnonymous: !!form.ballotIsAnonymous,
      voterMustBeMemberAtRecordDate: !!form.voterMustBeMemberAtRecordDate,
      inspectionMemberRegisterByMembers:
        !!form.inspectionMemberRegisterByMembers,
      inspectionMemberRegisterByPublic: !!form.inspectionMemberRegisterByPublic,
      inspectionDirectorRegisterByMembers:
        !!form.inspectionDirectorRegisterByMembers,
      inspectionCopiesAllowed: !!form.inspectionCopiesAllowed,
      ordinaryResolutionThresholdPct: Number(
        form.ordinaryResolutionThresholdPct,
      ),
      specialResolutionThresholdPct: Number(form.specialResolutionThresholdPct),
      unanimousWrittenSpecialResolution:
        !!form.unanimousWrittenSpecialResolution,
      // Persist custom resolution types only (built-ins are derived). Drop
      // blank rows and normalize id/order/defaults.
      resolutionTypes: (form.resolutionTypes ?? [])
        .filter((t: any) => String(t?.label ?? "").trim())
        .map((t: any, i: number) => ({
          id: slugifyResolutionType(t.label, i),
          label: String(t.label).trim(),
          builtIn: false,
          base: t.base || "votesCast",
          thresholdPct: Number(t.thresholdPct) || 50,
          tieBreak: t.tieBreak || "fails",
          order: i,
        })),
    });
    setForm(null);
    toast.success("Bylaw rule set saved");
  };

  const updateCustomType = (index: number, patch: Record<string, unknown>) => {
    const next = [...(form.resolutionTypes ?? [])];
    next[index] = { ...next[index], ...patch };
    setForm({ ...form, resolutionTypes: next });
  };
  const removeCustomType = (index: number) => {
    const next = [...(form.resolutionTypes ?? [])];
    next.splice(index, 1);
    setForm({ ...form, resolutionTypes: next });
  };
  const addCustomType = () => {
    const next = [...(form.resolutionTypes ?? [])];
    next.push({ label: "", base: "votesCast", thresholdPct: 66.67, order: next.length });
    setForm({ ...form, resolutionTypes: next });
  };

  return (
    <div className="page bylaw-rules">
      <PageHeader
        title="Bylaw rules"
        icon={<Scale size={16} />}
        iconColor="purple"
        subtitle="Configure the active rules derived from the society's bylaws. AGM, proxy, proposal, meeting, election, and inspection workflows read from here first."
        actions={
          <>
            <button
              className="btn-action"
              onClick={async () => {
                await reset({ societyId: society._id });
                setForm(null);
                toast.info("Reverted to BC Model Bylaw baseline");
              }}
            >
              <RefreshCw size={12} /> Reset to defaults
            </button>
            <button className="btn-action btn-action--primary" onClick={save}>
              <Save size={12} /> Save new version
            </button>
          </>
        }
      />

      {rules?.isFallback && (
        <div className="bylaw-rules__notice" role="status">
          <Info size={14} aria-hidden="true" />
          <div>
            No active custom rule set exists yet. The app is using BC Model
            Bylaw baseline assumptions until you save a bylaw-specific
            configuration.
          </div>
        </div>
      )}

      <div className="card bylaw-rules__card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Legal minimum guide tracks</h2>
          <span className="card__subtitle">
            {jurisdictionPack.name} · {formatDate(legalGuideDateISO)}
          </span>
        </div>
        <div className="card__body bylaw-rules__body">
          <LegalGuideTrackList
            rules={legalGuideRules}
            jurisdictionCode={jurisdictionCode}
            dateISO={legalGuideDateISO}
          />
        </div>
      </div>

      <div className="card bylaw-rules__card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Rule source timeline</h2>
          <span className="card__subtitle">
            {form.isFallback ? "Default assumptions" : `Editing from v${form.version}`}
          </span>
        </div>
        <div className="card__body bylaw-rules__body">
          <div className="bylaw-rules__field-grid">
            <Field label="Effective from">
              <DatePicker
                value={toDateInputValue(form.effectiveFromISO)}
                onChange={(value) =>
                  setForm({
                    ...form,
                    effectiveFromISO: value
                      ? `${value}T00:00:00.000Z`
                      : "",
                  })
                }
              />
            </Field>
            <Field label="Current version">
              <div className="row" style={{ minHeight: 36, gap: 6 }}>
                <Badge tone={form.isFallback ? "warn" : "info"}>
                  {form.isFallback ? "Fallback" : `v${form.version}`}
                </Badge>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Saving creates v{Number(form.version ?? 0) + 1}
                </span>
              </div>
            </Field>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {(history ?? []).slice(0, 6).map((row: any) => (
              <div
                key={row._id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={row.status === "Active" ? "success" : "neutral"}>
                    v{row.version} · {row.status}
                  </Badge>
                  <span>{row.quorumType === "percentage" ? `${row.quorumValue}%` : `${row.quorumValue} present`}</span>
                </div>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Effective {row.effectiveFromISO ? formatDate(row.effectiveFromISO) : "from first use"}
                </span>
              </div>
            ))}
            {(history ?? []).length === 0 && (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                No saved rule versions yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bylaw-rules__layout">
        <div className="bylaw-rules__column">
          <div className="card bylaw-rules__card">
            <div className="card__head">
              <h2 className="card__title">General meetings</h2>
            </div>
            <div className="card__body bylaw-rules__body">
              <div className="bylaw-rules__field-grid">
                <Field label="Notice minimum (days)">
                  <input
                    className="input"
                    type="number"
                    value={form.generalNoticeMinDays}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        generalNoticeMinDays: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Notice maximum (days)">
                  <input
                    className="input"
                    type="number"
                    value={form.generalNoticeMaxDays}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        generalNoticeMaxDays: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Quorum model">
                  <Select
                    value={form.quorumType}
                    onChange={(value) =>
                      setForm({ ...form, quorumType: value })
                    }
                    options={[
                      { value: "fixed", label: "Fixed count" },
                      { value: "percentage", label: "Percentage of eligible voters" },
                    ]}
                  />
                </Field>
                <Field
                  label={
                    form.quorumType === "percentage"
                      ? "Quorum %"
                      : "Quorum count"
                  }
                >
                  <input
                    className="input"
                    type="number"
                    value={form.quorumValue}
                    onChange={(e) =>
                      setForm({ ...form, quorumValue: Number(e.target.value) })
                    }
                  />
                </Field>
                {form.quorumType === "percentage" && (
                  <Field label="Minimum quorum count">
                    <input
                      className="input"
                      type="number"
                      value={form.quorumMinimumCount ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          quorumMinimumCount:
                            e.target.value === "" ? "" : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                )}
              </div>
              <div className="bylaw-rules__switches">
                <Toggle
                  checked={!!form.allowElectronicMeetings}
                  onChange={(value) =>
                    setForm({ ...form, allowElectronicMeetings: value })
                  }
                  label="Allow fully electronic meetings"
                />
                <Toggle
                  checked={!!form.allowHybridMeetings}
                  onChange={(value) =>
                    setForm({ ...form, allowHybridMeetings: value })
                  }
                  label="Allow hybrid meetings"
                />
              </div>
            </div>
          </div>

          <div className="card bylaw-rules__card">
            <div className="card__head">
              <h2 className="card__title">Voting and proxies</h2>
            </div>
            <div className="card__body bylaw-rules__body">
              <div className="bylaw-rules__switches">
                <Toggle
                  checked={!!form.allowProxyVoting}
                  onChange={(value) =>
                    setForm({ ...form, allowProxyVoting: value })
                  }
                  label="Allow proxy voting"
                />
                <Toggle
                  checked={!!form.proxyHolderMustBeMember}
                  onChange={(value) =>
                    setForm({ ...form, proxyHolderMustBeMember: value })
                  }
                  label="Require proxy holder to be a member"
                />
                <Toggle
                  checked={!!form.allowElectronicVoting}
                  onChange={(value) =>
                    setForm({ ...form, allowElectronicVoting: value })
                  }
                  label="Allow electronic voting"
                />
                <Toggle
                  checked={!!form.ballotIsAnonymous}
                  onChange={(value) =>
                    setForm({ ...form, ballotIsAnonymous: value })
                  }
                  label="Anonymous ballots"
                />
                <Toggle
                  checked={!!form.voterMustBeMemberAtRecordDate}
                  onChange={(value) =>
                    setForm({ ...form, voterMustBeMemberAtRecordDate: value })
                  }
                  label="Voter must be a member at the record date"
                />
              </div>
              <div className="bylaw-rules__field-grid bylaw-rules__field-grid--single">
                <Field label="Proxy limit per grantor per meeting">
                  <input
                    className="input"
                    type="number"
                    value={form.proxyLimitPerGrantorPerMeeting}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        proxyLimitPerGrantorPerMeeting: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="bylaw-rules__column">
          <div className="card bylaw-rules__card">
            <div className="card__head">
              <h2 className="card__title">AGM and proposals</h2>
            </div>
            <div className="card__body bylaw-rules__body">
              <div className="bylaw-rules__field-grid">
                <Field label="Annual report due after AGM (days)">
                  <input
                    className="input"
                    type="number"
                    value={form.annualReportDueDaysAfterMeeting}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        annualReportDueDaysAfterMeeting: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Proposal lead time before notice (days)">
                  <input
                    className="input"
                    type="number"
                    value={form.memberProposalLeadDays}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        memberProposalLeadDays: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Proposal threshold (%)">
                  <input
                    className="input"
                    type="number"
                    value={form.memberProposalThresholdPct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        memberProposalThresholdPct: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Minimum proposal signatures">
                  <input
                    className="input"
                    type="number"
                    value={form.memberProposalMinSignatures}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        memberProposalMinSignatures: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="bylaw-rules__field-grid bylaw-rules__field-grid--single">
                <Field label="Meeting requisition threshold (%)">
                  <input
                    className="input"
                    type="number"
                    value={form.requisitionMeetingThresholdPct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        requisitionMeetingThresholdPct: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="bylaw-rules__switches">
                <Toggle
                  checked={!!form.requireAgmFinancialStatements}
                  onChange={(value) =>
                    setForm({ ...form, requireAgmFinancialStatements: value })
                  }
                  label="Require financial statements to be presented at the AGM"
                />
                <Toggle
                  checked={!!form.requireAgmElections}
                  onChange={(value) =>
                    setForm({ ...form, requireAgmElections: value })
                  }
                  label="Require elections at the AGM"
                />
              </div>
            </div>
          </div>

          <div className="card bylaw-rules__card">
            <div className="card__head">
              <h2 className="card__title">Resolutions and inspections</h2>
            </div>
            <div className="card__body bylaw-rules__body">
              <div className="bylaw-rules__field-grid">
                <Field label="Ordinary resolution threshold (%)">
                  <input
                    className="input"
                    type="number"
                    value={form.ordinaryResolutionThresholdPct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ordinaryResolutionThresholdPct: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Special resolution threshold (%)">
                  <input
                    className="input"
                    type="number"
                    value={form.specialResolutionThresholdPct}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        specialResolutionThresholdPct: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="bylaw-rules__switches">
                <Toggle
                  checked={!!form.unanimousWrittenSpecialResolution}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      unanimousWrittenSpecialResolution: value,
                    })
                  }
                  label="Require unanimous written consent for special resolutions outside a meeting"
                />
                <Toggle
                  checked={!!form.inspectionMemberRegisterByMembers}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      inspectionMemberRegisterByMembers: value,
                    })
                  }
                  label="Members may inspect the member register"
                />
                <Toggle
                  checked={!!form.inspectionMemberRegisterByPublic}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      inspectionMemberRegisterByPublic: value,
                    })
                  }
                  label="Public may inspect the member register"
                />
                <Toggle
                  checked={!!form.inspectionDirectorRegisterByMembers}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      inspectionDirectorRegisterByMembers: value,
                    })
                  }
                  label="Members may inspect the director register"
                />
                <Toggle
                  checked={!!form.inspectionCopiesAllowed}
                  onChange={(value) =>
                    setForm({ ...form, inspectionCopiesAllowed: value })
                  }
                  label="Copies of inspected records are allowed"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card bylaw-rules__card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Resolution types</h2>
          <span className="card__subtitle">
            How a motion passes. Ordinary, Special, and Unanimous are built in
            (their thresholds come from the percentages above). Add your own for
            cases like a required founder consent or a higher bar.
          </span>
        </div>
        <div className="card__body bylaw-rules__body">
          <div className="col" style={{ gap: 4 }}>
            {builtInResolutionTypes(form).map((t) => (
              <div
                key={t.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <Badge tone="info">Built-in</Badge>
                  <strong>{t.label}</strong>
                </div>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  ≥ {t.thresholdPct}% of votes cast
                </span>
              </div>
            ))}
          </div>

          {(form.resolutionTypes ?? []).map((t: any, i: number) => (
            <CustomTypeRow
              key={i}
              type={t}
              defaultExpanded={i >= (rules?.resolutionTypes ?? []).length}
              onChange={(patch) => updateCustomType(i, patch)}
              onRemove={() => removeCustomType(i)}
            />
          ))}

          {/* One new type at a time: "Add" is hidden while an unsaved custom
              type is in progress (form has more custom types than the saved
              rule set); it returns after Save creates the next version. Save
              lives here too so the add → save → add loop doesn't require
              scrolling back up to the page header. */}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            {(form.resolutionTypes ?? []).length <=
              (rules?.resolutionTypes ?? []).length && (
              <button className="btn-action" onClick={addCustomType}>
                <Plus size={12} /> Add resolution type
              </button>
            )}
            <button className="btn-action btn-action--primary" onClick={save}>
              <Save size={12} /> Save new version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function slugifyResolutionType(label: string, index: number): string {
  const slug = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `custom-${index + 1}`;
}

/** A custom resolution type: collapses to a one-line summary (like the
 *  built-ins) and expands to the edit fields on click. New (unsaved) types start
 *  expanded so they can be filled in. */
function CustomTypeRow({
  type,
  defaultExpanded,
  onChange,
  onRemove,
}: {
  type: any;
  defaultExpanded: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const baseLabel =
    type.base === "eligibleMembers"
      ? "of eligible members"
      : type.base === "quorum"
        ? "of the quorum"
        : "of votes cast";
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="row"
          style={{
            gap: 8,
            alignItems: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "inherit",
            padding: 0,
          }}
        >
          <ChevronDown
            size={14}
            style={{ transform: expanded ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}
          />
          <Badge tone="neutral">Custom</Badge>
          <strong>{String(type.label ?? "").trim() || "Untitled type"}</strong>
        </button>
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          ≥ {type.thresholdPct ?? 50}% {baseLabel}
        </span>
      </div>
      {expanded && (
        <div className="bylaw-rules__field-grid" style={{ marginTop: 10 }}>
          <Field label="Name">
            <input
              className="input"
              value={type.label ?? ""}
              placeholder="e.g. Founder consent"
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </Field>
          <Field label="Requirement base">
            <Select
              value={type.base ?? "votesCast"}
              onChange={(value) => onChange({ base: value })}
              options={RESOLUTION_BASES}
            />
          </Field>
          <Field label="Threshold (%)">
            <input
              className="input"
              type="number"
              value={type.thresholdPct ?? 50}
              onChange={(e) => onChange({ thresholdPct: Number(e.target.value) })}
            />
          </Field>
          <Field label="On a tie">
            <Select
              value={type.tieBreak ?? "fails"}
              onChange={(value) => onChange({ tieBreak: value })}
              options={[
                { value: "fails", label: "Motion fails" },
                { value: "chairCasts", label: "Chair casts deciding vote" },
              ]}
            />
          </Field>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <button className="btn-action btn-action--danger" onClick={onRemove}>
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function toDateInputValue(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}
