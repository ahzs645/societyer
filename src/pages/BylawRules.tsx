import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useBylawRules } from "../hooks/useBylawRules";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Field } from "../components/ui";
import { Toggle } from "../components/Controls";
import { Scale, RefreshCw } from "lucide-react";
import { useToast } from "../components/Toast";

export function BylawRulesPage() {
  const { society, rules } = useBylawRules();
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
      proxyLimitPerGrantorPerMeeting: Number(form.proxyLimitPerGrantorPerMeeting),
      quorumType: form.quorumType,
      quorumValue: Number(form.quorumValue),
      memberProposalThresholdPct: Number(form.memberProposalThresholdPct),
      memberProposalMinSignatures: Number(form.memberProposalMinSignatures),
      memberProposalLeadDays: Number(form.memberProposalLeadDays),
      requisitionMeetingThresholdPct: Number(form.requisitionMeetingThresholdPct),
      annualReportDueDaysAfterMeeting: Number(form.annualReportDueDaysAfterMeeting),
      requireAgmFinancialStatements: !!form.requireAgmFinancialStatements,
      requireAgmElections: !!form.requireAgmElections,
      ballotIsAnonymous: !!form.ballotIsAnonymous,
      voterMustBeMemberAtRecordDate: !!form.voterMustBeMemberAtRecordDate,
      inspectionMemberRegisterByMembers: !!form.inspectionMemberRegisterByMembers,
      inspectionMemberRegisterByPublic: !!form.inspectionMemberRegisterByPublic,
      inspectionDirectorRegisterByMembers: !!form.inspectionDirectorRegisterByMembers,
      inspectionCopiesAllowed: !!form.inspectionCopiesAllowed,
      ordinaryResolutionThresholdPct: Number(form.ordinaryResolutionThresholdPct),
      specialResolutionThresholdPct: Number(form.specialResolutionThresholdPct),
      unanimousWrittenSpecialResolution: !!form.unanimousWrittenSpecialResolution,
    });
    toast.success("Bylaw rule set saved");
  };

  return (
    <div className="page">
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
              Save rules
            </button>
          </>
        }
      />

      {rules?.isFallback && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body">
            No active custom rule set exists yet. The app is using BC default assumptions
            until you save a bylaw-specific configuration.
          </div>
        </div>
      )}

      <div className="two-col">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">General meetings</h2>
          </div>
          <div className="card__body">
            <div className="row" style={{ gap: 12 }}>
              <Field label="Notice minimum (days)">
                <input
                  className="input"
                  type="number"
                  value={form.generalNoticeMinDays}
                  onChange={(e) =>
                    setForm({ ...form, generalNoticeMinDays: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Notice maximum (days)">
                <input
                  className="input"
                  type="number"
                  value={form.generalNoticeMaxDays}
                  onChange={(e) =>
                    setForm({ ...form, generalNoticeMaxDays: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Quorum model">
                <select
                  className="input"
                  value={form.quorumType}
                  onChange={(e) => setForm({ ...form, quorumType: e.target.value })}
                >
                  <option value="fixed">Fixed count</option>
                  <option value="percentage">Percentage of eligible voters</option>
                </select>
              </Field>
              <Field
                label={form.quorumType === "percentage" ? "Quorum %" : "Quorum count"}
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
            <Toggle
              checked={!!form.allowElectronicMeetings}
              onChange={(value) => setForm({ ...form, allowElectronicMeetings: value })}
              label="Allow fully electronic meetings"
            />
            <Toggle
              checked={!!form.allowHybridMeetings}
              onChange={(value) => setForm({ ...form, allowHybridMeetings: value })}
              label="Allow hybrid meetings"
            />
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">AGM and proposals</h2>
          </div>
          <div className="card__body">
            <div className="row" style={{ gap: 12 }}>
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
                    setForm({ ...form, memberProposalLeadDays: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
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
            <Toggle
              checked={!!form.requireAgmFinancialStatements}
              onChange={(value) =>
                setForm({ ...form, requireAgmFinancialStatements: value })
              }
              label="Require financial statements to be presented at the AGM"
            />
            <Toggle
              checked={!!form.requireAgmElections}
              onChange={(value) => setForm({ ...form, requireAgmElections: value })}
              label="Require elections at the AGM"
            />
          </div>
        </div>
      </div>

      <div className="spacer-6" />

      <div className="two-col">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Voting and proxies</h2>
          </div>
          <div className="card__body">
            <Toggle
              checked={!!form.allowProxyVoting}
              onChange={(value) => setForm({ ...form, allowProxyVoting: value })}
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
              onChange={(value) => setForm({ ...form, ballotIsAnonymous: value })}
              label="Anonymous ballots"
            />
            <Toggle
              checked={!!form.voterMustBeMemberAtRecordDate}
              onChange={(value) =>
                setForm({ ...form, voterMustBeMemberAtRecordDate: value })
              }
              label="Voter must be a member at the record date"
            />
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

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Resolutions and inspections</h2>
          </div>
          <div className="card__body">
            <div className="row" style={{ gap: 12 }}>
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
  );
}
