import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexProvider } from "convex/react";
import { AuthProvider } from "../../../src/auth/AuthProvider";
import { ConfirmProvider, PromptProvider } from "../../../src/components/Modal";
import { ToastProvider } from "../../../src/components/Toast";
import { ProcurementReader } from "../../../src/features/procurementReview/reader/ProcurementReader";
import { ProcurementInsuranceWorkspace } from "../../../src/features/procurementReview/reader/insuranceWorkspace";
import type { ReaderSource } from "../../../src/features/procurementReview/reader/source";
import { useSociety } from "../../../src/hooks/useSociety";
import { localDataClient } from "../../../src/lib/localDataClient";
import "../../../src/i18n";
import "../../../src/theme/palette.css";
import "../../../src/theme/tokens.css";
import "../../../src/styles/index.scss";

const summary = {
  recordKey: "hall-design",
  kind: "opportunity",
  title: "Professional services for the community hall",
  organization: "Example Municipality",
  status: "Open",
  date: "2027-02-15",
};
const description = [
  "Maintain CAD 3 million commercial general liability per occurrence.",
  "Provide a certificate to the municipality at award.",
  "Maintain professional liability insurance.",
].join(" ");

const source: ReaderSource = {
  catalog: { counts: { opportunity: 1 }, generation: "sample", publishedAt: "2027-01-04" },
  useList: () => ({ rows: [], total: 0, done: true }),
  useRecord: () => ({ summary, dataJson: JSON.stringify({ summary: description }) }),
  useReviews: () => ({ rows: [], truncated: false }),
  useReview: () => ({ rows: [], truncated: false }),
  useDocuments: () => ({ page: [], isDone: true, continueCursor: "" }),
  readDocument: async () => { throw new Error("This sample uses the notice description."); },
  previewId: (doc) => doc.documentKey,
};

function Opportunity() {
  const society = useSociety();
  if (!society) return null;
  return (
    <ProcurementInsuranceWorkspace.Provider value={{ societyId: society._id, name: society.name }}>
      <main className="page procurement-review">
        <ProcurementReader source={source} header={<h1>Procurement review</h1>} />
      </main>
    </ProcurementInsuranceWorkspace.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={localDataClient}>
    <AuthProvider><ToastProvider><ConfirmProvider><PromptProvider><BrowserRouter>
      <Opportunity />
    </BrowserRouter></PromptProvider></ConfirmProvider></ToastProvider></AuthProvider>
  </ConvexProvider>,
);
