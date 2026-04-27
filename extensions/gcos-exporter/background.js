import { exportGcosSnapshotInPage } from "./lib/page-exporter.js";
import { bytesToBase64, createStoredZip } from "./lib/zip.js";

const JOB_KEY = "gcosExportJob";

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === "gcos:startExport") {
    startExportJob(request.input)
      .then((job) => sendResponse({ ok: true, job }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (request?.action === "gcos:getExportJob") {
    chrome.storage.local.get([JOB_KEY])
      .then((result) => sendResponse({ ok: true, job: result[JOB_KEY] || null }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (request?.action === "gcos:clearExportJob") {
    chrome.storage.local.remove([JOB_KEY])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  return false;
});

async function startExportJob(input) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab was found.");

  const job = {
    id: crypto.randomUUID(),
    status: "running",
    phase: "Preparing export",
    progress: 5,
    input,
    tabId: tab.id,
    startedAtISO: new Date().toISOString(),
  };
  await writeJob(job);
  void runExportJob(job).catch(async (error) => {
    await writeJob({
      ...job,
      status: "error",
      phase: "Export failed",
      progress: 100,
      error: error?.message || String(error),
      finishedAtISO: new Date().toISOString(),
    });
  });
  return job;
}

async function runExportJob(job) {
  await writeJob({ ...job, phase: "Reading GCOS pages", progress: 20 });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: job.tabId },
    func: exportGcosSnapshotInPage,
    args: [job.input],
    world: "MAIN",
  });
  if (!result?.ok) throw new Error(result?.error || "GCOS export failed.");

  const snapshot = result.snapshot;
  const json = JSON.stringify(snapshot, null, 2);
  await writeJob({
    ...job,
    status: "running",
    phase: job.input?.format === "zip" ? "Downloading agreement PDFs" : "Downloading JSON",
    progress: 85,
    snapshot,
    jsonLength: json.length,
  });

  let downloadedFilename = filenameFor(snapshot, "json");
  if (job.input?.format === "zip") {
    const bundle = await buildZipBundle(snapshot, json);
    downloadedFilename = filenameFor(snapshot, "zip");
    await chrome.downloads.download({
      url: `data:application/zip;base64,${bytesToBase64(bundle)}`,
      filename: downloadedFilename,
      saveAs: false,
    });
  } else {
    await chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
      filename: downloadedFilename,
      saveAs: false,
    });
  }

  const completeJob = {
    ...job,
    status: "complete",
    phase: "Export downloaded",
    progress: 100,
    snapshot,
    jsonLength: json.length,
    filename: downloadedFilename,
    finishedAtISO: new Date().toISOString(),
  };
  await writeJob(completeJob);
  return completeJob;
}

async function writeJob(job) {
  await chrome.storage.local.set({ [JOB_KEY]: job });
}

async function buildZipBundle(snapshot, json) {
  const files = [{ name: "snapshot.json", data: json }];
  const attachments = [];
  const agreements = Array.isArray(snapshot?.structured?.agreements) ? snapshot.structured.agreements : [];
  for (const agreement of agreements.slice(0, 10)) {
    if (!agreement?.viewDocumentUrl) continue;
    const documentId = agreement.documentId || agreement.viewDocumentUrl.match(/OpenDocument\/(\d+)/i)?.[1] || "agreement";
    const filename = safeFilename(`agreements/agreement-${agreement.agreementNumber || documentId}-document-${documentId}.pdf`);
    try {
      const response = await fetch(agreement.viewDocumentUrl, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      files.push({ name: filename, data: bytes });
      attachments.push({
        kind: "agreement",
        agreementNumber: agreement.agreementNumber,
        documentId,
        filename,
        bytes: bytes.length,
        sourceUrl: agreement.viewDocumentUrl,
      });
    } catch (error) {
      attachments.push({
        kind: "agreement",
        agreementNumber: agreement.agreementNumber,
        documentId,
        filename,
        sourceUrl: agreement.viewDocumentUrl,
        error: error?.message || String(error),
      });
    }
  }
  files.push({ name: "manifest.json", data: JSON.stringify({ exportedAtISO: new Date().toISOString(), attachments }, null, 2) });
  return createStoredZip(files);
}

function filenameFor(snapshot, extension = "json") {
  const project = snapshot?.projectId || snapshot?.normalizedGrant?.confirmationCode || "gcos";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `societyer-gcos-${String(project).replace(/[^a-z0-9_-]+/gi, "-")}-${stamp}.${extension}`;
}

function safeFilename(value) {
  return String(value).replace(/(^|\/)\.+(?=\/|$)/g, "$1").replace(/[^a-z0-9_./ -]+/gi, "-");
}
