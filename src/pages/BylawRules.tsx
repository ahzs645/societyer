import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useBylawRules } from "../hooks/useBylawRules";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Toggle } from "../components/Controls";
import { Info, RefreshCw, Save, Scale } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";

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

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!form) return <div className="page">Loading…</div>;

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
    });
    setForm(null);
    toast.success("Bylaw rule set saved");
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
                toast.info("Reverted to BC default rules");
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
            No active custom rule set exists yet. The app is using BC default
            assumptions until you save a bylaw-specific configuration.
          </div>
        </div>
      )}

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
              <input
                className="input"
                type="date"
                value={toDateInputValue(form.effectiveFromISO)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    effectiveFromISO: event.target.value
                      ? `${event.target.value}T00:00:00.000Z`
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
                  <select
                    className="input"
                    value={form.quorumType}
                    onChange={(e) =>
                      setForm({ ...form, quorumType: e.target.value })
                    }
                  >
                    <option value="fixed">Fixed count</option>
                    <option value="percentage">
                      Percentage of eligible voters
                    </option>
                  </select>
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
