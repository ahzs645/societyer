import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { Plus, Receipt, FileDown } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Banner, Drawer, Field } from "../components/ui";
import { dollarInputToCents, formatDate } from "../lib/format";
import { formatMoney } from "../lib/money";
import { Money } from "../components/Money";
import { exportPdfDownload } from "../lib/pdf";
import { buildDonationReceiptDocument } from "../lib/donationReceiptDocument";
import { openDocumentFile } from "../lib/documentOpen";
import { openDocumentDownloadTarget } from "../lib/documentStorage";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { DatePicker } from "../components/DatePicker";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { RecordTable, RecordTableScope, RecordTableViewToolbar, RecordTableFilterChips, RecordTableFilterPopover, RecordTableEmpty, useObjectRecordTableData } from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { todayDateOnly } from "../../shared/dateOnly";
import { receiptDocumentLabel, type ReceiptDocumentKind } from "../../shared/receipting/policy";
import { officialReceiptOrganizationIssues, resolveOrganizationContext } from "../../shared/organization/resolveContext";
import { DocumentPreviewButton } from "../components/DocumentFilePreview";

export function ReceiptsPage() {
  const { canWrite, canExport } = useFinancePermissions();
  const permissions = usePermissions();
  const canReadDocuments = permissions.loaded && permissions.can("documents:read");
  const canReadOrganization = permissions.loaded && permissions.can("society:read");
  const society = useSociety();
  const items = useQuery(api.receipts.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const registration = useQuery(api.receipts.registrationHistory, society && canReadOrganization ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.listSummaries, society && canReadDocuments ? { societyId: society._id } : "skip") as any[] | undefined;
  const issue = useMutation(api.receipts.issue);
  const finalize = useMutation(api.receipts.finalizeOfficial);
  const voidReceipt = useMutation(api.receipts.voidReceipt);
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const convex = useConvex();
  const prompt = usePrompt();
  const toast = useToast();
  const [form, setForm] = useState<any>(null);
  const [signatureForm, setSignatureForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const signatureEvidence = useQuery(api.receipts.evidenceForReview, society && canReadOrganization && canReadDocuments && signatureForm?.signedCopyDocumentId
    ? { societyId: society._id, documentIds: [signatureForm.signedCopyDocumentId], requireFile: true } : "skip");
  const selectedProof = signatureEvidence?.[0];
  const signedProofReady = Boolean(selectedProof?.fingerprint && !selectedProof.reviewIssue && selectedProof.documentId === signatureForm?.signedCopyDocumentId);
  useEffect(() => {
    setSignatureForm((previous: any) => previous?.expectedSignedCopyRevision && (!signedProofReady || previous.expectedSignedCopyRevision !== selectedProof?.fingerprint)
      ? { ...previous, expectedSignedCopyRevision: "", authorityConfirmed: false } : previous);
  }, [selectedProof?.fingerprint, signedProofReady]);
  const tableData = useObjectRecordTableData({ societyId: society?._id, nameSingular: "donationReceipt", viewId: currentViewId });
  const records = useMemo(() => (items ?? []).map(row => ({ ...row, status: receiptDocumentLabel(row) })), [items]);
  const historicalCount = records.filter(row => !row.documentKind).length;
  const organizationIssues = officialReceiptOrganizationIssues(resolveOrganizationContext(society));
  const officialReady = registration?.assessment.readiness === "ready" && organizationIssues.length === 0;
  const onDate = registration?.onDate || todayDateOnly();

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = (documentKind: ReceiptDocumentKind = "acknowledgement", source?: any, replacement = false) => {
    setError("");
    setForm({
      documentKind,
      idempotencyKey: crypto.randomUUID(),
      donorName: source?.donorName || "",
      donorEmail: source?.donorEmail || "",
      donorAddress: source?.donorAddress || "",
      amountDollars: source ? String(source.amountCents / 100) : "",
      receivedOnISO: source?.receivedOnISO || onDate,
      intendedIssueDate: onDate,
      location: source?.location || "",
      isNonCash: source?.isNonCash || false,
      description: source?.description || "",
      giftEligibilityConfirmed: false,
      ...(replacement ? { replacesReceiptId: source._id, ...(source.sourceAcknowledgementId ? { sourceAcknowledgementId: source.sourceAcknowledgementId } : {}) }
        : source ? { sourceAcknowledgementId: source._id } : {}),
    });
  };

  const save = async () => {
    if (!form || busy) return;
    setError("");
    setBusy(true);
    try {
      const amountCents = dollarInputToCents(form.amountDollars);
      if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Enter a positive gift amount in Canadian dollars.");
      const official = form.documentKind === "official_tax_receipt";
      const { amountDollars: _amount, ...input } = form;
      await issue({
        societyId: society._id,
        ...input,
        amountCents,
        eligibleAmountCents: official ? amountCents : 0,
        ...(official ? { advantageAmountCents: 0 } : {}),
      });
      setForm(null);
      toast.success(official ? "Receipt prepared for signature" : "Acknowledgement recorded");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const recordSignature = async () => {
    if (!signatureForm || busy) return;
    setError("");
    setBusy(true);
    try {
      await finalize({
        id: signatureForm.id,
        signedCopyDocumentId: signatureForm.signedCopyDocumentId,
        expectedSignedCopyRevision: signatureForm.expectedSignedCopyRevision || "",
        signedOn: signatureForm.signedOn,
        signatoryName: signatureForm.signatoryName,
        authorityConfirmed: signatureForm.authorityConfirmed,
      });
      setSignatureForm(null);
      toast.success("Signed issue recorded");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };

  const downloadRecord = async (receipt: any) => {
    try {
      const replaced = receipt.replacesReceiptId ? items?.find(row => row._id === receipt.replacesReceiptId) : undefined;
      await exportPdfDownload(buildDonationReceiptDocument({ ...receipt, ...(replaced ? { replacesReceiptNumber: replaced.receiptNumber } : {}) }));
    } catch (caught) { toast.error("Could not prepare the PDF", caught instanceof Error ? caught.message : String(caught)); }
  };

  const downloadSignedCopy = async (receipt: any) => {
    const snapshot = receipt.signedCopySnapshot;
    if (!snapshot) return;
    try {
      // Check the document ACL before opening even a locally cached immutable version.
      const source = await convex.query(api.documents.get, { id: snapshot.documentId });
      if (!source || source.inCameraWithheld) throw new Error("The signed copy is unavailable or you do not have access.");
      if (snapshot.documentVersionId) {
        const result = await openDocumentFile({
          _id: snapshot.documentId, latestVersionId: snapshot.documentVersionId, versionOnly: true,
          fileName: snapshot.fileName, mimeType: snapshot.mimeType, sha256: snapshot.sha256,
        }, { getDownloadTarget: args => getDownloadTarget({ versionId: args.versionId as Id<"documentVersions"> }) });
        if (result === "none" || result === "simulated") throw new Error("The retained signed file is not available.");
      } else {
        const url = await convex.query(api.files.getUrl, { storageId: snapshot.storageId });
        if (!url) throw new Error("The retained signed file is not available.");
        await openDocumentDownloadTarget({ kind: "url", provider: "convex", key: snapshot.storageId, url, fileName: snapshot.fileName });
      }
    } catch (caught) { toast.error("Could not open the signed copy", caught instanceof Error ? caught.message : String(caught)); }
  };

  const registrationMessage = organizationIssues.length
    ? organizationIssues.map(issue => issue.message).join(" ")
    : officialReady ? "Registration evidence is reviewed. Each cash gift and the signed issue still need their own checks."
      : registration?.assessment.reasons.map((reason: any) => reason.message).join(" ") || "Record and review the applicable registration evidence to prepare an official receipt.";

  return (
    <div className="page" data-testid="donation-receipts-page">
      <PageHeader
        title="Donations and receipts"
        icon={<Receipt size={16} />} iconColor="pink"
        subtitle="Record contributions, prepare supported official receipts, and retain signed originals."
        actions={<button type="button" className="btn-action btn-action--primary" onClick={() => openNew()} disabled={!canWrite || busy}><Plus size={12} /> New donation record</button>}
      />
      <Banner tone={officialReady ? "info" : "warn"} title={officialReady ? "Official receipt preparation available" : "Acknowledgements available"}>
        <p>{registrationMessage} <Link to="/app/society">Review organization registrations</Link></p>
        <p>The official route currently supports cash gifts in CAD with no donor advantage. Print the preparation for an authorized paper signature, then retain the signed copy and record its issue.</p>
      </Banner>
      {historicalCount > 0 && <Banner tone="info" title="Historical records retained">
        {historicalCount} historical record{historicalCount === 1 ? "" : "s"} lack an explicit document kind or eligibility snapshot. Their original values remain on file; exporting them creates a labelled historical record.
      </Banner>}

      {!tableData.loading && !tableData.objectMetadata ? <RecordTableMetadataEmpty societyId={society._id} objectLabel="donation receipt" />
        : tableData.objectMetadata ? (
          <RecordTableScope tableId="receipts" objectMetadata={tableData.objectMetadata} hydratedView={tableData.hydratedView} records={records}>
            <RecordTableViewToolbar societyId={society._id} objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">} icon={<Receipt size={14} />} label="All donation records" views={tableData.views} currentViewId={currentViewId ?? tableData.views[0]?._id ?? null} onChangeView={value => setCurrentViewId(value as Id<"views">)} onOpenFilter={() => setFilterOpen(value => !value)} />
            <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
            <RecordTableFilterChips />
            <RecordTable loading={tableData.loading || items === undefined}
              emptyState={<RecordTableEmpty title="No donation records yet" description="Start with an acknowledgement, or prepare an official receipt when registration and gift checks are ready." action={canWrite ? <button className="btn-action btn-action--primary" onClick={() => openNew()}><Plus size={12} /> Record first contribution</button> : undefined} />}
              renderCell={({ record, field }) => {
                if (field.name === "receiptNumber") return <span className="mono">{record.receiptNumber}</span>;
                if (field.name === "receivedOnISO") return <span>{formatDate(record.receivedOnISO)}</span>;
                if (field.name === "issuedAtISO") return <span>{record.issueStatus === "prepared" ? "Awaiting signature" : formatDate(record.issuedOn || record.issuedAtISO)}</span>;
                if (field.name === "amountCents") return <Money cents={record.amountCents} struck={Boolean(record.voidedAtISO)} />;
                if (field.name === "eligibleAmountCents") return record.documentKind === "acknowledgement" ? <span>Not a tax receipt</span> : <Money cents={record.eligibleAmountCents} struck={Boolean(record.voidedAtISO)} />;
                if (field.name === "status") return <Badge tone={record.voidedAtISO ? "danger" : !record.documentKind || record.issueStatus === "prepared" ? "warn" : "info"}>{receiptDocumentLabel(record)}</Badge>;
                return undefined;
              }}
              renderRowActions={row => {
                const linked = items?.some(item => item.sourceAcknowledgementId === row._id && !item.voidedAtISO);
                return <>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={!canExport} onClick={() => void downloadRecord(row)}><FileDown size={12} />{row.documentKind === "official_tax_receipt" && row.issueStatus === "prepared" && !row.voidedAtISO ? "PDF for signature" : "Record PDF"}</button>
                  {row.signedCopySnapshot && <button type="button" className="btn btn--ghost btn--sm" disabled={!canExport || !canReadDocuments} onClick={() => void downloadSignedCopy(row)}>Signed copy</button>}
                  {row.documentKind === "acknowledgement" && !row.voidedAtISO && !linked && <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite || !officialReady} onClick={() => openNew("official_tax_receipt", row)}>Prepare official receipt</button>}
                  {row.documentKind === "official_tax_receipt" && row.issueStatus === "prepared" && !row.voidedAtISO && <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite || !canReadDocuments || !canReadOrganization} title={!canReadDocuments || !canReadOrganization ? "Reading the organization and retained evidence is required to review a signed issue." : undefined} onClick={() => { setError(""); setSignatureForm({ id: row._id, receiptNumber: row.receiptNumber, amountCents: row.amountCents, signedOn: row.intendedIssueDate, signedCopyDocumentId: "", signatoryName: "", authorityConfirmed: false }); }}>Record signed issue</button>}
                  {row.voidedAtISO && row.documentKind && !row.replacementReceiptId && <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => openNew(row.documentKind, row, true)}>Prepare replacement</button>}
                  {!row.voidedAtISO && <button type="button" className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={async () => {
                    const reason = await prompt({ title: "Void donation record", message: "The record and serial number stay in the history. A replacement must be prepared separately.", placeholder: "Reason", confirmLabel: "Void record", required: true });
                    if (!reason) return;
                    try { await voidReceipt({ id: row._id, reason }); toast.success("Record voided"); }
                    catch (caught) { toast.error("Could not void the record", caught instanceof Error ? caught.message : String(caught)); }
                  }}>Void</button>}
                </>;
              }}
            />
          </RecordTableScope>
        ) : null}

      <Drawer open={Boolean(form)} onClose={() => { if (!busy) setForm(null); }} title={form?.documentKind === "official_tax_receipt" ? "Prepare official receipt" : "Record donation acknowledgement"}
        footer={<><button className="btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button><button className="btn btn--accent" onClick={() => void save()} disabled={!canWrite || busy || (form?.documentKind === "official_tax_receipt" && !officialReady)}>{busy ? "Saving…" : form?.documentKind === "official_tax_receipt" ? "Prepare for signature" : "Record acknowledgement"}</button></>}>
        {form && <div>
          {error && <Banner tone="danger">{error}</Banner>}
          <Field label="Document kind"><select className="input" value={form.documentKind} disabled={Boolean(form.sourceAcknowledgementId || form.replacesReceiptId)} onChange={event => setForm({ ...form, documentKind: event.target.value, giftEligibilityConfirmed: false })}><option value="acknowledgement">Donation acknowledgement</option><option value="official_tax_receipt" disabled={!officialReady}>Official tax receipt — paper signature</option></select></Field>
          {form.documentKind === "official_tax_receipt" ? <Banner tone="info" title="Prepare, sign, then record issue">The number, registered issuer, gift facts and intended issue date are fixed when prepared. Obtain an authorized paper signature, upload the signed copy, then choose Record signed issue.</Banner> : <p>This document acknowledges the contribution and makes no tax-deductibility claim.</p>}
          <Field label="Donor full name" hint="For an individual, include the middle initial when applicable." required><input className="input" value={form.donorName} readOnly={Boolean(form.sourceAcknowledgementId)} onChange={event => setForm({ ...form, donorName: event.target.value })} /></Field>
          <Field label="Donor address" required={form.documentKind === "official_tax_receipt"}><textarea className="input" rows={3} value={form.donorAddress} onChange={event => setForm({ ...form, donorAddress: event.target.value })} /></Field>
          <Field label="Donor email"><input className="input" type="email" value={form.donorEmail} onChange={event => setForm({ ...form, donorEmail: event.target.value })} /></Field>
          <Field label="Gift amount (CAD)" required><input className="input" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amountDollars} readOnly={Boolean(form.sourceAcknowledgementId)} onChange={event => setForm({ ...form, amountDollars: event.target.value })} /></Field>
          <Field label="Gift received on" required><DatePicker value={form.receivedOnISO} disabled={Boolean(form.sourceAcknowledgementId)} onChange={value => setForm({ ...form, receivedOnISO: value })} /></Field>
          <Field label="Place of issue" hint="City, town or municipality." required><input className="input" value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} /></Field>
          {form.documentKind === "official_tax_receipt" ? <>
            <p>Intended issue date: <strong>{formatDate(form.intendedIssueDate)}</strong>. The gift amount is also the eligible amount for this supported no-advantage route.</p>
            <label className="checkbox"><input type="checkbox" checked={form.giftEligibilityConfirmed} onChange={event => setForm({ ...form, giftEligibilityConfirmed: event.target.checked })} /> I reviewed the donor identity and confirm this is an eligible voluntary cash gift in CAD with no advantage provided to the donor or an associated person.</label>
          </> : <label className="checkbox"><input type="checkbox" checked={form.isNonCash} onChange={event => setForm({ ...form, isNonCash: event.target.checked })} /> Non-cash contribution</label>}
          <Field label="Gift description"><textarea className="input" rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></Field>
          {form.replacesReceiptId && <p>This preparation will link to the earlier voided record as its replacement.</p>}
        </div>}
      </Drawer>

      <Drawer open={Boolean(signatureForm)} onClose={() => { if (!busy) setSignatureForm(null); }} title="Record signed issue"
        footer={<><button className="btn" onClick={() => setSignatureForm(null)} disabled={busy}>Cancel</button><button className="btn btn--accent" onClick={() => void recordSignature()} disabled={!canWrite || busy || !signedProofReady || !signatureForm?.authorityConfirmed || signatureForm?.expectedSignedCopyRevision !== selectedProof?.fingerprint}>{busy ? "Saving…" : "Record signed issue"}</button></>}>
        {signatureForm && <div>
          {error && <Banner tone="danger">{error}</Banner>}
          <p>Receipt <strong>{signatureForm.receiptNumber}</strong> · {formatMoney(signatureForm.amountCents)} · Printed issue date {formatDate(signatureForm.signedOn)}</p>
          <p>Retain the signed paper receipt as a PDF or image in <Link to="/app/documents?intent=new&category=Other&title=Signed%20donation%20receipt">Documents</Link>, then select it below. If the actual issue date changed, void this preparation and prepare a replacement.</p>
          <Field label="Signed copy document" required><select className="input" value={signatureForm.signedCopyDocumentId} onChange={event => setSignatureForm({ ...signatureForm, signedCopyDocumentId: event.target.value, expectedSignedCopyRevision: "", authorityConfirmed: false })}><option value="">Choose a retained signed copy</option>{(documents ?? []).filter(document => !document.flaggedForDeletion && !document.archivedAtISO).map(document => <option key={document._id} value={document._id}>{document.title || document.fileName || "Untitled document"}</option>)}</select></Field>
          {selectedProof?.reviewIssue && <Banner tone="warn">{selectedProof.reviewIssue}</Banner>}
          {signedProofReady && selectedProof && <DocumentPreviewButton document={{ _id: selectedProof.documentId, latestVersionId: selectedProof.documentVersionId, storageId: selectedProof.storageId, fileName: selectedProof.fileName, mimeType: selectedProof.mimeType, sha256: selectedProof.sha256, fileSizeBytes: selectedProof.fileSizeBytes, versionOnly: Boolean(selectedProof.documentVersionId) }} label="Review retained signed copy" />}
          <Field label="Authorized signatory name" required><input className="input" value={signatureForm.signatoryName} onChange={event => setSignatureForm({ ...signatureForm, signatoryName: event.target.value })} /></Field>
          <label className="checkbox"><input type="checkbox" disabled={!signedProofReady} checked={signatureForm.authorityConfirmed} onChange={event => setSignatureForm({ ...signatureForm, authorityConfirmed: event.target.checked, expectedSignedCopyRevision: event.target.checked && signedProofReady ? selectedProof!.fingerprint : "" })} /> I checked that the signed copy matches this receipt number, donor, amount and printed issue date, and that the signer was authorized to acknowledge gifts.</label>
          <p>This records your review of the retained signed copy. Societyer does not verify a handwritten signature automatically.</p>
        </div>}
      </Drawer>
    </div>
  );
}
