import { DecisionAssessmentCard } from "../components/DecisionAssessmentCard";
import { isCorporation } from "../../shared/organizationDomain";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
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
import { useConfirm } from "../components/Modal";
import { bylawRuleContextFor, bylawRuleEffectiveDateProblem, bylawRuleProblems } from "../../shared/bylawGovernance";
import { formatDate } from "../lib/format";
import { calendarDateKey } from "../lib/calendarDates";
import { LegalGuideTrackList } from "../components/LegalGuide";
import { cleanQuorumRule, describeQuorumRule, quorumRuleProblems, type BodyQuorumRule } from "../../shared/bodyQuorum";
import { QuorumRuleFields, quorumRuleDraft, quorumRuleFromDraft } from "../features/committees/QuorumRuleFields";
import {
  getJurisdictionGuidePack,
  getLegalGuideRules,
  resolveJurisdictionCode,
} from "../lib/jurisdictionGuideTracks";

export function BylawRulesPage() {
  const { society, rules } = useBylawRules();
  const permissions = usePermissions();
  const canWrite = permissions.loaded && permissions.can("documents:write");
  const history = useQuery(
    api.bylawRules.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsert = usePermissionedMutation(api.bylawRules.upsertActive, canWrite);
  const reset = usePermissionedMutation(api.bylawRules.resetToDefault, canWrite);
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    // A saved version is the starting point for the NEXT version, which takes
    // effect prospectively (today by default), never on the old version's date.
    if (rules && (!form || form.societyId !== rules.societyId || form._id !== rules._id)) {
      setForm({
        ...rules,
        baseEffectiveFromISO: rules.effectiveFromISO,
        effectiveFromISO: `${calendarDateKey(new Date())}T00:00:00.000Z`,
      });
    }
  }, [form, rules]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!form) return <PageLoading />;

  const corporate = isCorporation(society);
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

  const nextVersion = Math.max(0, ...(history ?? []).map((row: any) => Number(row.version) || 0)) + 1;
  const customTypesForSave = (form.resolutionTypes ?? []).map((t: any, i: number) => ({
    id: slugifyResolutionType(t.label, i),
    label: String(t.label ?? "").trim(),
    builtIn: false,
    base: t.base || "votesCast",
    thresholdPct: Number(t.thresholdPct),
    tieBreak: t.tieBreak || "fails",
    order: i,
  }));
  const ruleProblems = bylawRuleProblems(
    {
      ...form,
      generalNoticeMinDays: Number(form.generalNoticeMinDays),
      generalNoticeMaxDays: Number(form.generalNoticeMaxDays),
      quorumValue: Number(form.quorumValue),
      quorumMinimumCount: form.quorumType === "percentage" && form.quorumMinimumCount !== "" && form.quorumMinimumCount != null ? Number(form.quorumMinimumCount) : undefined,
      ordinaryResolutionThresholdPct: Number(form.ordinaryResolutionThresholdPct),
      specialResolutionThresholdPct: Number(form.specialResolutionThresholdPct),
      memberProposalThresholdPct: Number(form.memberProposalThresholdPct),
      requisitionMeetingThresholdPct: Number(form.requisitionMeetingThresholdPct),
      annualReportDueDaysAfterMeeting: Number(form.annualReportDueDaysAfterMeeting),
      proxyLimitPerGrantorPerMeeting: Number(form.proxyLimitPerGrantorPerMeeting),
      resolutionTypes: customTypesForSave,
    },
    bylawRuleContextFor(society),
  ).concat(bodyQuorumRowProblems(form.bodyQuorumRules));

  const save = async () => {
    if (!canWrite) return;
    if (ruleProblems.length) {
      toast.error("Fix the rule set before saving", ruleProblems[0]);
      return;
    }
    let allowBackdated = false;
    const backdated = bylawRuleEffectiveDateProblem(form.effectiveFromISO, history ?? []);
    if (backdated) {
      const ok = await confirm({
        title: "Record a backdated rule version?",
        message: `${backdated} Held meetings after that date will be checked against this version.`,
        confirmLabel: "Record historical version",
        tone: "warn",
      });
      if (!ok) return;
      allowBackdated = true;
    }
    try {
    await upsert({
      id: form._id,
      societyId: society._id,
      allowBackdated: allowBackdated || undefined,
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
      // Persist custom resolution types only (built-ins are derived). Blank or
      // out-of-range rows are rejected by validation above, never dropped.
      resolutionTypes: customTypesForSave,
      // A3: per-body quorum rules carry over to the new version; leaving them
      // out would silently drop rules recorded earlier (or imported).
      bodyQuorumRules: bodyQuorumRulesForSave(form.bodyQuorumRules),
    });
    setForm(null);
    toast.success(`Bylaw rule set v${nextVersion} saved`);
    } catch (error) {
      toast.error("Bylaw rule set not saved", error instanceof Error ? error.message : String(error));
    }
  };

  const updateCustomType = (index: number, patch: Record<string, unknown>) => {
    if (!canWrite) return;
    const next = [...(form.resolutionTypes ?? [])];
    next[index] = { ...next[index], ...patch };
    setForm({ ...form, resolutionTypes: next });
  };
  const removeCustomType = (index: number) => {
    if (!canWrite) return;
    const next = [...(form.resolutionTypes ?? [])];
    next.splice(index, 1);
    setForm({ ...form, resolutionTypes: next });
  };
  const addCustomType = () => {
    if (!canWrite) return;
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
        subtitle="Configure rules derived from the operative bylaws or articles. Draft baselines require review; workspace roles do not establish legal voting rights."
        actions={
          <>
            <button
              className="btn-action"
              disabled={!canWrite || corporate}
              title={corporate ? "Corporation rules must be configured from approved articles and by-laws; the society baseline cannot be adopted here." : undefined}
              onClick={async () => {
                if (!canWrite || corporate) return;
                const ok = await confirm({
                  title: "Reset to the statutory baseline?",
                  message: `This records a new rule version (v${nextVersion}) using the jurisdiction draft baseline, effective today. The current values${rules?.isFallback ? "" : ` from v${rules?.version}`} stay in the version history but stop applying to meetings from today.`,
                  confirmLabel: "Reset to defaults",
                  tone: "warn",
                });
                if (!ok) return;
                await reset({ societyId: society._id });
                setForm(null);
                toast.info("Using the jurisdiction draft baseline; governing instruments still require review");
              }}
            >
              <RefreshCw size={12} /> Reset to defaults
            </button>
            <button className="btn-action btn-action--primary" onClick={save} disabled={!canWrite || ruleProblems.length > 0}>
              <Save size={12} /> Save new version
            </button>
          </>
        }
      />

      {ruleProblems.length > 0 && (
        <div className="bylaw-rules__notice bylaw-rules__notice--error" role="alert" style={{ marginBottom: 12 }}>
          <Info size={14} aria-hidden="true" />
          <div>
            <strong>This rule set cannot be saved yet:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {ruleProblems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          </div>
        </div>
      )}

      <DecisionAssessmentCard key={String(society._id)} organization={society} />

      {rules?.isFallback && (
        <div className="bylaw-rules__notice" role="status">
          <Info size={14} aria-hidden="true" />
          <div>
            {rules?.baselineLabel ?? "Statutory draft baseline"}. This does not record adoption of model bylaws. {rules?.quorumRequiresLegalRegister ? "Corporate quorum requires the legal shareholder and issued voting share registers; attendee headcount cannot establish it." : "Review the filed bylaws and legal member electorate."}
          </div>
        </div>
      )}

      <div className="card bylaw-rules__card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Rule source timeline</h2>
          <span className="card__subtitle">
            {form.isFallback ? corporate ? "Unreviewed operational defaults" : "Default assumptions" : `Editing from v${form.version}`}
            {form.baseEffectiveFromISO ? ` · current version effective ${formatDate(String(form.baseEffectiveFromISO).slice(0, 10))}` : ""}
          </span>
        </div>
        <div className="card__body bylaw-rules__body">
          <div className="bylaw-rules__field-grid">
            <Field label="New version takes effect">
              <DatePicker
                disabled={!canWrite}
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
                  {form.isFallback ? (form.status === "Baseline" || (history ?? []).length ? "Statutory baseline" : "Fallback") : `v${form.version}`}
                </Badge>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Saving creates v{nextVersion}
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
                  Effective {row.effectiveFromISO ? formatDate(String(row.effectiveFromISO).slice(0, 10)) : "from first use"}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                      disabled={!canWrite}
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
                  disabled={!canWrite}
                  checked={!!form.allowElectronicMeetings}
                  onChange={(value) =>
                    setForm({ ...form, allowElectronicMeetings: value })
                  }
                  label="Allow fully electronic meetings"
                />
                <Toggle
                  disabled={!canWrite}
                  checked={!!form.allowHybridMeetings}
                  onChange={(value) =>
                    setForm({ ...form, allowHybridMeetings: value })
                  }
                  label="Allow hybrid meetings"
                />
              </div>
            </div>
          </div>

          <div className="card bylaw-rules__card" data-testid="body-quorum-rules">
            <div className="card__head">
              <h2 className="card__title">Quorum by body</h2>
              <span className="card__subtitle">Board and committee meetings</span>
            </div>
            <div className="card__body bylaw-rules__body col" style={{ gap: 12 }}>
              <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
                Bylaws often set a different quorum for board meetings (for example a majority of directors) than for general meetings. A committee's own terms of reference, set on the committee page, take precedence over the committee default here.
              </p>
              {(["board", "committee"] as const).map((body) => {
                const draft = bodyDraftFor(form.bodyQuorumRules, body);
                return (
                  <div key={body} className="col" style={{ gap: 4 }}>
                    <strong style={{ fontSize: "var(--fs-sm)" }}>{body === "board" ? "Board meetings" : "Committee meetings (default)"}</strong>
                    <QuorumRuleFields
                      idPrefix={`body-quorum-${body}`}
                      defaultBasis={body === "board" ? "directors_in_office" : "committee_members"}
                      disabled={!canWrite}
                      value={draft}
                      onChange={(draft) => setForm({ ...form, bodyQuorumRules: setBodyRule(form.bodyQuorumRules, body, draft) })}
                    />
                  </div>
                );
              })}
              {(form.bodyQuorumRules ?? []).filter((row: any) => row.committeeId || row.body === "general").map((row: any) => (
                <div key={`${row.body}:${row.committeeId ?? ""}`} className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  {row.body === "general" ? "General meetings" : row.committeeName ?? "A committee"}: {describeQuorumRule(row, row.body)} (kept from the current version)
                </div>
              ))}
            </div>
          </div>

          <div className="card bylaw-rules__card">
            <div className="card__head">
              <h2 className="card__title">Voting and proxies</h2>
            </div>
            <div className="card__body bylaw-rules__body">
              <div className="bylaw-rules__switches">
                <Toggle
                  disabled={!canWrite}
                  checked={!!form.allowProxyVoting}
                  onChange={(value) =>
                    setForm({ ...form, allowProxyVoting: value })
                  }
                  label="Allow proxy voting"
                />
                <Toggle
                  disabled={!canWrite}
                  checked={!!form.proxyHolderMustBeMember}
                  onChange={(value) =>
                    setForm({ ...form, proxyHolderMustBeMember: value })
                  }
                  label="Require proxy holder to be a member"
                />
                <Toggle
                  disabled={!canWrite}
                  checked={!!form.allowElectronicVoting}
                  onChange={(value) =>
                    setForm({ ...form, allowElectronicVoting: value })
                  }
                  label="Allow electronic voting"
                />
                <Toggle
                  disabled={!canWrite}
                  checked={!!form.ballotIsAnonymous}
                  onChange={(value) =>
                    setForm({ ...form, ballotIsAnonymous: value })
                  }
                  label="Anonymous ballots"
                />
                <Toggle
                  disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                  disabled={!canWrite}
                  checked={!!form.requireAgmFinancialStatements}
                  onChange={(value) =>
                    setForm({ ...form, requireAgmFinancialStatements: value })
                  }
                  label="Require financial statements to be presented at the AGM"
                />
                <Toggle
                  disabled={!canWrite}
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
                    disabled={!canWrite}
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
                    disabled={!canWrite}
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
                  disabled={!canWrite}
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
                  disabled={!canWrite}
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
                  disabled={!canWrite}
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
                  disabled={!canWrite}
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
                  disabled={!canWrite}
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
                  {t.id === "ordinary" && t.thresholdPct === 50
                    ? "> 50% of votes cast (simple majority; a tie fails)"
                    : `≥ ${t.thresholdPct}% of votes cast`}
                </span>
              </div>
            ))}
          </div>

          {(form.resolutionTypes ?? []).map((t: any, i: number) => (
            <CustomTypeRow
              key={i}
              type={t}
              canWrite={canWrite}
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
              <button className="btn-action" onClick={addCustomType} disabled={!canWrite}>
                <Plus size={12} /> Add resolution type
              </button>
            )}
            <button className="btn-action btn-action--primary" onClick={save} disabled={!canWrite || ruleProblems.length > 0}>
              <Save size={12} /> Save new version
            </button>
          </div>
        </div>
      </div>

      <details className="card bylaw-rules__card">
        <summary>
          Legal minimum guide tracks
          <span className="card__subtitle">
            {jurisdictionPack.name} · {legalGuideRules.length} tracks
          </span>
        </summary>
        <div className="card__body bylaw-rules__body">
          <LegalGuideTrackList
            rules={legalGuideRules}
            jurisdictionCode={jurisdictionCode}
            dateISO={legalGuideDateISO}
          />
        </div>
      </details>
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
  canWrite,
  type,
  defaultExpanded,
  onChange,
  onRemove,
}: {
  canWrite: boolean;
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
              disabled={!canWrite}
              className="input"
              value={type.label ?? ""}
              placeholder="e.g. Founder consent"
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </Field>
          <Field label="Requirement base">
            <Select
              disabled={!canWrite}
              value={type.base ?? "votesCast"}
              onChange={(value) => onChange({ base: value })}
              options={RESOLUTION_BASES}
            />
          </Field>
          <Field label="Threshold (%)">
            <input
              disabled={!canWrite}
              className="input"
              type="number"
              value={type.thresholdPct ?? 50}
              onChange={(e) => onChange({ thresholdPct: Number(e.target.value) })}
            />
          </Field>
          <Field label="On a tie">
            <Select
              disabled={!canWrite}
              value={type.tieBreak ?? "fails"}
              onChange={(value) => onChange({ tieBreak: value })}
              options={[
                { value: "fails", label: "Motion fails" },
                { value: "chairCasts", label: "Chair casts deciding vote" },
              ]}
            />
          </Field>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <button className="btn-action btn-action--danger" onClick={onRemove} disabled={!canWrite}>
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

type BodyRuleDraftRow = BodyQuorumRule & { _draft?: ReturnType<typeof quorumRuleDraft> };

function bodyDraftFor(rows: BodyRuleDraftRow[] | undefined, body: "board" | "committee") {
  const row = (rows ?? []).find((candidate) => candidate.body === body && !candidate.committeeId);
  return row?._draft ?? quorumRuleDraft(row);
}

/** Replace (or remove) the generic rule for one body, keeping the typed draft so half-typed numbers survive. */
function setBodyRule(rows: BodyRuleDraftRow[] | undefined, body: "board" | "committee", draft: ReturnType<typeof quorumRuleDraft>): BodyRuleDraftRow[] {
  const others = (rows ?? []).filter((candidate) => !(candidate.body === body && !candidate.committeeId));
  if (!draft.quorumType) return others;
  const rule = quorumRuleFromDraft(draft)!;
  return [...others, { ...rule, body, _draft: draft }];
}

function bodyQuorumRowProblems(rows: BodyRuleDraftRow[] | undefined): string[] {
  return (rows ?? []).flatMap((row) => {
    const rule = row._draft ? quorumRuleFromDraft(row._draft) : row;
    const label = row.body === "board" ? "Board quorum" : row.body === "general" ? "General meeting quorum" : `${row.committeeName ?? "Committee"} quorum`;
    return quorumRuleProblems(rule).map((problem) => `${label}: ${problem}`);
  });
}

function bodyQuorumRulesForSave(rows: BodyRuleDraftRow[] | undefined): BodyQuorumRule[] | undefined {
  if (!rows) return undefined;
  return rows.map((row) => {
    const rule = row._draft ? quorumRuleFromDraft(row._draft)! : row;
    const out: BodyQuorumRule = { body: row.body, ...cleanQuorumRule(rule) };
    if (row.committeeId) out.committeeId = row.committeeId;
    if (row.committeeName) out.committeeName = row.committeeName;
    return out;
  });
}
