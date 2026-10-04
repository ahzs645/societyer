import { useState } from "react";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isSociety } from "../../shared/organizationDomain";
import { evaluateLegalDecision, type LegalDecisionInput } from "../../shared/legalDecision";
import { Select } from "./Select";
import { Field, Badge } from "./ui";

/** Evidence-aware arithmetic preview; it does not adopt a resolution or update registers. */
export function DecisionAssessmentCard({ organization }: { organization: any }) {
  const society = isSociety(organization);
  const [body, setBody] = useState<LegalDecisionInput["body"]>(society ? "members" : "shareholders");
  const [mode, setMode] = useState<LegalDecisionInput["mode"]>("meeting");
  const [resolution, setResolution] = useState<LegalDecisionInput["resolution"]>("ordinary");
  const [votesFor, setVotesFor] = useState("");
  const [votesAgainst, setVotesAgainst] = useState("");
  const [eligible, setEligible] = useState("");
  const [instrument, setInstrument] = useState("");
  const [quorumMet, setQuorumMet] = useState(false);
  const [circulated, setCirculated] = useState(false);
  const [specialMajority, setSpecialMajority] = useState<"two_thirds" | "three_quarters">("two_thirds");
  const jurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  if (!["CA-BC", "CA-FED-CBCA", "CA-ON-OBCA"].includes(jurisdiction)) return null;
  const result = evaluateLegalDecision({
    jurisdiction: jurisdiction as LegalDecisionInput["jurisdiction"],
    entityType: society ? "society" : "corporation__business_",
    body, mode, resolution,
    votesFor: votesFor === "" ? NaN : Number(votesFor),
    votesAgainst: votesAgainst === "" ? NaN : Number(votesAgainst),
    eligibleVotes: eligible === "" ? undefined : Number(eligible),
    governingInstrumentEvidence: instrument.trim() || undefined,
    quorumMet, circulatedToAll: circulated, specialMajority,
  });
  return <section className="card" style={{ marginBottom: 16 }}>
    <div className="card__head"><div><h2 className="card__title">Decision threshold preview</h2><span className="card__subtitle">Use the legal electorate and operative governing documents.</span></div>
      <Badge tone={result.carries === null ? "warn" : result.carries ? "success" : "neutral"}>{result.carries === null ? "Needs evidence / review" : result.carries ? "Threshold met" : "Threshold not met"}</Badge>
    </div>
    <div className="card__body">
      <p className="muted" style={{ marginTop: 0 }}>This preview checks arithmetic. A workspace role does not establish voting or signing authority. Shareholder totals use eligible votes and share-class rights; abstentions are excluded from votes cast.</p>
      <div className="form-grid">
        <Field label="Decision body"><Select value={body} onChange={setBody} options={[{ value: society ? "members" : "shareholders", label: society ? "Legal members" : "Shareholders" }, { value: "directors", label: "Legal directors" }]} /></Field>
        <Field label="Decision mode"><Select value={mode} onChange={setMode} options={[{ value: "meeting", label: "Meeting vote" }, { value: "written", label: "Written resolution" }, { value: "electronic_ballot", label: "Non-meeting electronic ballot — review required" }]} /></Field>
        <Field label="Resolution"><Select value={resolution} onChange={setResolution} options={[{ value: "ordinary", label: "Ordinary" }, { value: "special", label: "Special" }, { value: "unanimous", label: "Unanimous" }]} /></Field>
        <Field label="Votes for / signed consent"><input className="input" type="number" min={0} step={1} value={votesFor} onChange={(event) => setVotesFor(event.target.value)} /></Field>
        <Field label="Votes against"><input className="input" type="number" min={0} step={1} value={votesAgainst} onChange={(event) => setVotesAgainst(event.target.value)} /></Field>
        <Field label="All eligible votes"><input className="input" type="number" min={0} step={1} value={eligible} onChange={(event) => setEligible(event.target.value)} /></Field>
        {!society && jurisdiction === "CA-BC" && <Field label="Applicable special majority"><Select value={specialMajority} onChange={setSpecialMajority} options={[{ value: "two_thirds", label: "Two thirds — ordinary private company baseline" }, { value: "three_quarters", label: "Three quarters — verify articles / pre-existing company" }]} /></Field>}
        <Field label="Articles / bylaws and electorate evidence"><input className="input" value={instrument} onChange={(event) => setInstrument(event.target.value)} placeholder="Document and legal register reference" /></Field>
      </div>
      {mode === "meeting" ? <label className="checkbox"><input type="checkbox" checked={quorumMet} onChange={(event) => setQuorumMet(event.target.checked)} /> Quorum was established under the operative governing documents</label>
        : <label className="checkbox"><input type="checkbox" checked={circulated} onChange={(event) => setCirculated(event.target.checked)} /> Distribution to every eligible voter is evidenced</label>}
      <p>{result.denominator === "eligible_votes" ? "All eligible votes" : "Votes cast"}: {Number.isFinite(result.denominatorCount) ? result.denominatorCount : "not supplied"} · {result.strict ? "More than" : "At least"} {result.thresholdNumerator}/{result.thresholdDenominator}</p>
      <p className="muted">{result.citation}</p>
      {result.warnings.length > 0 && <ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </div>
  </section>;
}
