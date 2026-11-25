import { FileUp } from "lucide-react";
import { FileDropZone } from "./FileDropZone";
import { useEffect, useRef, useState } from "react";
import { useAction, useConvex, useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { Modal } from "./Modal";
import { Segmented } from "./primitives";
import { Field } from "./ui";
import { useWorkspaceStoragePolicy } from "../hooks/useWorkspaceStoragePolicy";
import { uploadDocumentVersion } from "../lib/documentVersionUpload";
import { EvidenceRowsEditor } from "./EvidenceRowsEditor";
import { isDemoMode } from "../lib/demoMode";
import { prepareImportBundle } from "../lib/importBundleIntake";
import {
  insuranceTermTextFields,
  insuranceAmount,
} from "../../shared/insuranceRegister";
import { validateInsurancePolicyInput } from "../../shared/recordValidation";
import { exactDay } from "../../shared/evidenceReview";
import type { RenewalFile } from "../lib/insuranceRenewalImport";

function RenewalOriginal({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const local = URL.createObjectURL(file);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [file]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      Open original PDF
    </a>
  ) : null;
}

const documentViews = (["Policy", "Coverage", "Extracted data"] as const).map(
  (id) => ({ id, label: id }),
);

export function InsuranceRenewalImport({ society }: { society: any }) {
  const client = useConvex();
  const stage = useMutation(api.importSessions.createFromBundle);
  const approve = useMutation(api.importSessions.bulkSetStatus);
  const docs = useMutation(api.importSessions.applyApprovedDocuments);
  const apply = useMutation(api.importSessions.applyApprovedSectionRecords);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(
    api.documentVersions.recordUploadedVersion,
  );
  const workspaceStoresFiles = useWorkspaceStoragePolicy().documentVersions;
  const native = workspaceStoresFiles && !isDemoMode();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<RenewalFile[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [archiveName, setArchiveName] = useState("");
  const [bundleName, setBundleName] = useState("");
  const [currency, setCurrency] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [done, setDone] = useState(false);
  const [screen, setScreen] = useState<
    "upload" | "files" | "document" | "confirm"
  >("upload");
  const [documentId, setDocumentId] = useState("");
  const selectedFile = sources.find((file) => file.id === documentId);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    const scroller = body?.closest(".modal__body");
    if (scroller) scroller.scrollTop = 0;
    const focusTarget =
      screen === "files" && documentId
        ? body?.querySelector<HTMLButtonElement>("[data-return-focus]")
        : null;
    if (focusTarget) focusTarget.focus();
    else body?.focus({ preventScroll: true });
  }, [open, screen, documentId, done]);
  const included = sources.filter((file) => file.selected);
  const declarations = sources.filter((s) => s.policy && s.selected);
  const update = (id: string, patch: Partial<RenewalFile>) => {
    setSources((current) =>
      current.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
    setReviewed(false);
  };
  async function read(file: File) {
    setScreen("upload");
    setDocumentId("");
    setCurrency("");
    setArchiveName(file.name);
    setBundleName("");
    setBusy("Reading archive");
    setError("");
    setReviewed(false);
    setSources([]);
    setSession(null);
    setDone(false);
    try {
      const { readRenewalPackage } =
        await import("../lib/insuranceRenewalImport");
      setSources(
        await readRenewalPackage(file, (name) => setBusy(`Reading ${name}`)),
      );
      setScreen("files");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this ZIP.");
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("Checking policy fields");
    setError("");
    try {
      const { renewalBundle } = await import("../lib/insuranceRenewalImport");
      const bundle = renewalBundle(sources, currency, society.name);
      if (!declarations.length)
        throw new Error("Select at least one declaration.");
      const seenTerms = new Set<string>();
      for (const [index, d] of declarations.entries()) {
        const fields = {
          ...d.policy,
          currency: d.policy!.currency || currency,
        };
        const problem = Object.values(validateInsurancePolicyInput(fields))[0];
        if (problem) throw new Error(`${d.name} · ${problem}`);
        for (const invoice of bundle.insurancePolicies[index]
          .invoiceObservations) {
          if (
            !/^[A-Z]{3}$/.test(invoice.currency) ||
            (invoice.amountCents != null &&
              (!Number.isSafeInteger(invoice.amountCents) ||
                invoice.amountCents < 0))
          )
            throw new Error("Check the invoice currency and amount in cents.");
        }
        const key = JSON.stringify([
          d.policy!.insurer,
          d.policy!.policyNumber,
          d.policy!.startDate,
        ]);
        if (seenTerms.has(key))
          throw new Error("Select one declaration per policy term.");
        seenTerms.add(key);
      }
      for (const s of sources.filter((s) => s.selected && !s.policy)) {
        if (!s.links.some((id) => declarations.some((d) => d.id === id)))
          throw new Error(`Link ${s.name} to a selected policy.`);
        if (
          s.invoice &&
          (!exactDay(s.invoice.observedDate) ||
            (s.invoice.dueDate && !exactDay(s.invoice.dueDate)))
        )
          throw new Error(`Check the invoice dates for ${s.name}.`);
      }
      setBusy("Staging reviewed originals");
      const sessionId =
        session ??
        (await stage({
          societyId: society._id,
          name: "Insurance renewal",
          bundle: prepareImportBundle(
            JSON.parse(JSON.stringify(bundle)),
            society,
            true,
          ),
        }));
      setSession(sessionId);
      await approve({ sessionId, status: "Approved" });
      await docs({ sessionId });
      const detail = await client.query(api.importSessions.get, { sessionId });
      const candidates = detail.records.filter(
        (r: any) => r.recordKind === "documentCandidate",
      );
      for (const source of sources.filter((s) => s.selected)) {
        const row = candidates.find((r: any) =>
          r.sourceExternalIds?.includes(source.id),
        );
        const documentId = row?.importedTargets?.documents;
        if (!documentId)
          throw new Error(`Could not resolve the original for ${source.name}.`);
        setBusy(`Saving ${source.name}`);
        const versions = await client.query(
          api.documentVersions.listForDocument,
          { documentId },
        );
        const hash = source.id.slice("local:sha256:".length);
        if (
          versions.some(
            (v: any) =>
              v.sha256 === hash || v.changeNote === `Insurance renewal ${hash}`,
          )
        )
          continue;
        await uploadDocumentVersion({
          societyId: society._id,
          documentId,
          file: source.file,
          changeNote: `Insurance renewal ${hash}`,
          createDemoVersion,
          beginUpload,
          completeUpload,
          recordUploadedVersion,
        });
      }
      setBusy("Saving policy terms");
      await apply({ sessionId });
      const result = await client.query(api.importSessions.get, { sessionId });
      const records = result.records.filter(
        (r: any) => r.recordKind === "insurancePolicy",
      );
      if (
        records.length !== declarations.length ||
        records.some((r: any) => !r.importedTargets?.sections)
      )
        throw new Error(
          "Some policy terms still require review in the import session.",
        );
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The renewal could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <button
        className="btn-action"
        aria-label="Import renewal ZIP"
        title="Import renewal ZIP"
        onClick={() => {
          if (done) {
            setScreen("upload");
            setCurrency("");
            setSources([]);
            setArchiveName("");
            setBundleName("");
            setDone(false);
            setSession(null);
            setReviewed(false);
          }
          setOpen(true);
        }}
      >
        <FileUp size={16} aria-hidden="true" />
        <span className="insurance-action-label">Import renewal ZIP</span>
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={
          done
            ? "Renewal imported"
            : screen === "upload"
              ? "Import renewal ZIP"
              : screen === "files"
                ? "Review renewal files"
                : screen === "document"
                  ? "Review document"
                  : "Confirm import"
        }
        className="insurance-import-dialog"
        size={screen === "upload" || done ? "sm" : "lg"}
        resizable={false}
        footer={
          done ? (
            <button className="btn btn--accent" onClick={() => setOpen(false)}>
              Done
            </button>
          ) : screen === "upload" ? (
            sources.length > 0 && (
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => setScreen("files")}
              >
                Back to files
              </button>
            )
          ) : screen === "document" ? (
            <button
              className="btn btn--accent"
              onClick={() => setScreen("files")}
            >
              Back to files
            </button>
          ) : screen === "files" ? (
            <>
              <button
                className="btn"
                disabled={!!busy || !!session}
                onClick={() => setScreen("upload")}
              >
                Change ZIP
              </button>
              <button
                className="btn btn--accent"
                disabled={
                  !!busy || !declarations.length || !/^[A-Z]{3}$/.test(currency)
                }
                onClick={() => setScreen("confirm")}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button
                className="btn"
                disabled={!!busy || !!session}
                onClick={() => setScreen("files")}
              >
                Back to files
              </button>
              <button
                className="btn btn--accent"
                disabled={!native || !reviewed || !!busy}
                onClick={save}
              >
                Save reviewed renewal
              </button>
            </>
          )
        }
      >
        <div
          className="insurance-import"
          tabIndex={-1}
          ref={bodyRef}
          key={done ? "done" : screen}
        >
          {done ? (
            <p role="status">
              {declarations.length} policy terms and {included.length} original
              documents are in the register.
            </p>
          ) : (
            <>
              {!native && (
                <p role="alert">
                  Saving the original PDFs requires workspace document storage.
                </p>
              )}
              {screen === "upload" && (
                <FileDropZone
                  className="insurance-upload"
                  ariaLabel="Renewal ZIP"
                  accept=".zip"
                  title="Renewal ZIP"
                  chooseLabel={archiveName ? "Replace ZIP" : "Choose ZIP"}
                  disabled={Boolean(session) || Boolean(busy)}
                  onFiles={([file]) => read(file)}
                />
              )}
              {screen === "files" && (
                <>
                  <p className="insurance-import__filename">{archiveName}</p>
                  <Field label="Package currency">
                    <input
                      className="input"
                      disabled={!!busy || !!session}
                      placeholder="CAD"
                      maxLength={3}
                      value={currency}
                      onChange={(e) => {
                        setCurrency(e.target.value.trim().toUpperCase());
                        setReviewed(false);
                      }}
                    />
                  </Field>

                  <ul className="insurance-import__list">
                    {sources.map((file) => (
                      <li key={file.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={file.selected}
                            disabled={!!session || !!busy}
                            onChange={(e) =>
                              update(file.id, { selected: e.target.checked })
                            }
                          />
                          <span>
                            {file.name}
                            <small>{file.role}</small>
                          </span>
                        </label>
                        <button
                          className="btn btn--sm"
                          data-return-focus={
                            file.id === documentId || undefined
                          }
                          aria-label={`Review ${file.name}`}
                          disabled={!!busy}
                          onClick={() => {
                            setDocumentId(file.id);
                            setScreen("document");
                          }}
                        >
                          Review
                        </button>
                      </li>
                    ))}
                  </ul>
                  <FileDropZone
                    className="insurance-upload"
                    ariaLabel="Previously reviewed policy fields"
                    accept=".json"
                    title={
                      bundleName || "Previously reviewed fields (optional)"
                    }
                    chooseLabel="Choose JSON"
                    disabled={Boolean(session) || Boolean(busy)}
                    onFiles={async ([file]) => {
                      setBusy("Reading reviewed fields");
                      try {
                        const { applyReviewedPolicyFields } =
                          await import("../lib/insuranceRenewalImport");
                        setSources(
                          applyReviewedPolicyFields(
                            sources,
                            JSON.parse(await file.text()),
                          ),
                        );
                        setBundleName(file.name);
                        setReviewed(false);
                        setError("");
                      } catch (failure) {
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : "Could not read the field bundle.",
                        );
                      } finally {
                        setBusy("");
                      }
                    }}
                  />
                </>
              )}
              {screen === "document" && selectedFile && (
                <RenewalDocumentEditor
                  key={selectedFile.id}
                  selectedFile={selectedFile}
                  declarations={declarations}
                  currency={currency}
                  locked={!!busy || !!session}
                  update={update}
                />
              )}
              {screen === "confirm" && (
                <>
                  <p>
                    {declarations.length} policy terms · {included.length}{" "}
                    original documents · {currency}
                  </p>
                  <ul className="insurance-import__list">
                    {declarations.map((d) => (
                      <li key={d.id}>
                        <span>
                          <strong>{d.policy!.insurer || d.name}</strong>
                          <small>
                            {d.policy!.policyNumber} · {d.policy!.startDate} –{" "}
                            {d.policy!.endDate}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={!!busy || !!session}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{" "}
                    I reviewed the policy fields and original document links for{" "}
                    {society.name}.
                  </label>
                </>
              )}
            </>
          )}
          {busy && <p role="status">{busy}…</p>}
          {error && <p role="alert">{error}</p>}
          {session && (
            <Link to={`/app/imports?sessionId=${session}`}>
              Open import session
            </Link>
          )}
        </div>
      </Modal>
    </>
  );
}

function RenewalDocumentEditor({
  selectedFile,
  declarations,
  currency,
  locked,
  update,
}: {
  selectedFile: RenewalFile;
  declarations: RenewalFile[];
  currency: string;
  locked: boolean;
  update: (id: string, patch: Partial<RenewalFile>) => void;
}) {
  const [view, setView] = useState<"Policy" | "Coverage" | "Extracted data">(
    "Policy",
  );
  return (
    <div className="insurance-import__document">
      <header>
        <h3>{selectedFile.name}</h3>
        <RenewalOriginal file={selectedFile.file} />
      </header>
      <fieldset disabled={locked}>
        {selectedFile.policy ? (
          <>
            <Segmented
              aria-label="Document views"
              className="insurance-segments"
              value={view}
              onChange={setView}
              items={documentViews}
            />
            {view === "Policy" && (
              <div className="insurance-import__fields">
                {" "}
                {[
                  ["policyNumber", "Policy number"],
                  ["namedInsured", "Named insured"],
                  ["insurer", "Insurer"],
                  ["startDate", "Term start"],
                  ["endDate", "Term end"],
                ].map(([key, label]) => (
                  <Field label={label} key={key}>
                    <input
                      className="input"
                      type={key.endsWith("Date") ? "date" : "text"}
                      value={selectedFile.policy![key] ?? ""}
                      onChange={(e) =>
                        update(selectedFile.id, {
                          policy: {
                            ...selectedFile.policy,
                            [key]: e.target.value,
                            ...(key === "endDate"
                              ? { renewalDate: e.target.value }
                              : {}),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
                <p>
                  Premium{" "}
                  {insuranceAmount(selectedFile.policy.premiumCents, currency)}
                </p>
                <Field label="Policy kind">
                  <input
                    className="input"
                    value={selectedFile.policy.kind}
                    onChange={(e) =>
                      update(selectedFile.id, {
                        policy: {
                          ...selectedFile.policy,
                          kind: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                {[
                  ["broker", "Broker"],
                  ...insuranceTermTextFields.filter(
                    ([key]) => key !== "namedInsured",
                  ),
                ].map(([key, label]) => (
                  <Field label={label} key={key}>
                    <input
                      className="input"
                      value={selectedFile.policy![key] ?? ""}
                      onChange={(e) =>
                        update(selectedFile.id, {
                          policy: {
                            ...selectedFile.policy,
                            [key]: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </Field>
                ))}
                {[
                  ["premiumCents", "Policy premium (cents)"],
                  ["grossReceiptsCents", "Rating receipts (cents)"],
                  [
                    "minimumRetainedPremiumPercent",
                    "Minimum retained premium (%)",
                  ],
                ].map(([key, label]) => (
                  <Field label={label} key={key}>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={selectedFile.policy![key] ?? ""}
                      onChange={(e) =>
                        update(selectedFile.id, {
                          policy: {
                            ...selectedFile.policy,
                            [key]:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            {view === "Coverage" && (
              <>
                {" "}
                <EvidenceRowsEditor
                  title="Coverage lines"
                  columns={[
                    { key: "label", label: "Coverage" },
                    {
                      key: "coverageType",
                      label: "Coverage type",
                    },
                    { key: "limitBasis", label: "Limit basis" },
                    {
                      key: "limitCents",
                      label: "Limit (cents)",
                      type: "number",
                    },
                    {
                      key: "deductibleCents",
                      label: "Deductible (cents)",
                      type: "number",
                    },
                    { key: "formNumber", label: "Form" },
                    {
                      key: "citationId",
                      label: "Page or section",
                    },
                    {
                      key: "summary",
                      label: "Wording and conditions",
                    },
                  ]}
                  rows={selectedFile.policy.coverageItems ?? []}
                  onChange={(rows) =>
                    update(selectedFile.id, {
                      policy: {
                        ...selectedFile.policy,
                        coverageItems: rows.map(({ id, ...row }) => ({
                          ...row,
                          lineId: row.lineId || id,
                        })),
                      },
                    })
                  }
                />
              </>
            )}
            {view === "Extracted data" && (
              <pre>{JSON.stringify(selectedFile.policy, null, 2)}</pre>
            )}
          </>
        ) : (
          <div className="insurance-import__fields">
            {" "}
            {declarations.map((d) => (
              <label key={d.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={selectedFile.links.includes(d.id)}
                  onChange={(e) =>
                    update(selectedFile.id, {
                      links: e.target.checked
                        ? [...selectedFile.links, d.id]
                        : selectedFile.links.filter((id) => id !== d.id),
                    })
                  }
                />{" "}
                Link to {d.policy!.policyNumber}
              </label>
            ))}
            {selectedFile.invoice && (
              <>
                {selectedFile.links.filter((id) =>
                  declarations.some((d) => d.id === id),
                ).length > 1 && (
                  <p>
                    This invoice will be linked to each selected policy. Record
                    the individual amounts once you have an allocation.
                  </p>
                )}
                {[
                  ["currency", "Invoice currency override"],
                  ["reference", "Invoice number"],
                  ["itemNumber", "Item number"],
                  ["observedDate", "Invoice date"],
                  ["dueDate", "Due date"],
                  ["amountCents", "Invoice amount in cents"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      className="input"
                      type={
                        key.endsWith("Date")
                          ? "date"
                          : key === "amountCents"
                            ? "number"
                            : "text"
                      }
                      value={selectedFile.invoice![key] ?? ""}
                      onChange={(e) =>
                        update(selectedFile.id, {
                          invoice: {
                            ...selectedFile.invoice,
                            [key]:
                              key === "amountCents" && e.target.value
                                ? Number(e.target.value)
                                : e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </>
            )}
            <button
              type="button"
              className="btn-action"
              onClick={() =>
                update(selectedFile.id, {
                  role: "Declaration",
                  invoice: undefined,
                  links: [selectedFile.id],
                  policy: {
                    kind: "Other",
                    status: "NeedsReview",
                    coverageItems: [],
                  },
                })
              }
            >
              Use as policy declaration
            </button>
          </div>
        )}
      </fieldset>
    </div>
  );
}
