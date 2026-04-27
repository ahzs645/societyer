export async function exportGcosSnapshotInPage(input) {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const currentUrl = location.href;
  const authRisk = /gckey|clegc-gckey|interac|sign-?in|signin|login|credential|auth/i;
  if (authRisk.test(currentUrl) || !/srv136\.services\.gc\.ca|canada\.ca/i.test(location.hostname)) {
    return { ok: false, error: "Open the logged-in GCOS tab under srv136.services.gc.ca/OSR/pro before exporting." };
  }

  const urlFromPath = (pathOrUrl) => /^https?:/i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, "https://srv136.services.gc.ca").href;
  const projectIdFromUrl = (url) => {
    try {
      return new URL(url).pathname.match(/\/Project\/Project\/(?:Display|Manage|Agreement|Correspondence|ViewDocument)\/([^/?#]+)/i)?.[1];
    } catch {
      return undefined;
    }
  };
  const programCodeFromUrl = (url) => {
    try {
      const match = new URL(url).pathname.match(/\/OSR\/pro\/([^/?#]+)/i)?.[1];
      return match && !/^(Project|Agreement|DD|EED|DocumentBundle|GCOS)$/i.test(match) ? match : undefined;
    } catch {
      return undefined;
    }
  };
  const isSensitive = (text) => /social insurance|\bSIN\b|account number|direct deposit|bank|financial institution|branch number|transit|routing/i.test(String(text ?? ""));
  const addField = (fields, label, value, name, id) => {
    const normalizedLabel = clean(label).replace(/[:*]+$/, "").trim();
    const normalizedValue = clean(value);
    if (!normalizedLabel || !normalizedValue || isSensitive(`${normalizedLabel} ${name || ""} ${id || ""}`)) return;
    fields.push({ label: normalizedLabel, value: normalizedValue, name: name || undefined, id: id || undefined });
  };
  const extractFromDocument = (doc, url) => {
    const fields = [];
    const hidden = {};
    const links = [];
    for (const input of doc.querySelectorAll("input[type=hidden][name]")) {
      const name = input.getAttribute("name");
      if (name && !isSensitive(name)) hidden[name] = input.value ?? "";
    }
    for (const element of doc.querySelectorAll("input, textarea, select")) {
      const type = (element.getAttribute("type") || "").toLowerCase();
      const name = element.getAttribute("name") || "";
      const id = element.getAttribute("id") || "";
      if (type === "hidden" || type === "password" || isSensitive(`${name} ${id}`)) continue;
      const label = id ? doc.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      let value = "";
      if (element.tagName === "SELECT") value = element.options?.[element.selectedIndex]?.textContent || element.value || "";
      else if (type === "checkbox" || type === "radio") {
        if (!element.checked) continue;
        value = doc.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || element.value || "Selected";
      } else value = element.value || "";
      addField(fields, label || name || id, value, name, id);
    }
    for (const row of doc.querySelectorAll("dt, th, .control-label, label, strong")) {
      const label = clean(row.textContent);
      if (!isSensitive(label) && row.nextElementSibling) addField(fields, label, row.nextElementSibling.textContent, undefined, row.nextElementSibling.id || undefined);
    }
    for (const link of doc.querySelectorAll("a[href]")) {
      const href = new URL(link.getAttribute("href"), url).href;
      const text = clean(link.textContent);
      if (!isSensitive(`${text} ${href}`)) links.push({ text, href });
    }
    return {
      url,
      title: doc.title,
      screenIdentifier: clean(doc.querySelector("#screenIdentifier, [name=ScreenIdentifier], [id*=ScreenIdentifier]")?.textContent) || hidden.ScreenIdentifier || hidden.screenIdentifier || "",
      hidden,
      fields,
      links,
      text: clean(doc.body?.innerText).slice(0, 20000),
    };
  };
  const fetchPage = async (pathOrUrl) => {
    const url = urlFromPath(pathOrUrl);
    const response = await fetch(url, { credentials: "include", headers: { accept: "text/html,application/xhtml+xml" } });
    const html = await response.text();
    if (!response.ok) throw new Error(`GCOS page request failed: ${response.status} ${url}`);
    if (authRisk.test(response.url) || /Sign in with GCKey|Welcome to GCKey|session has expired|Start with GCKey/i.test(html)) throw new Error("GCOS session is not authenticated or has expired.");
    return extractFromDocument(new DOMParser().parseFromString(html, "text/html"), response.url || url);
  };
  const moneyCents = (value) => {
    const match = String(value ?? "").replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
    return match ? Math.round(Number(match[1]) * 100) : undefined;
  };
  const dateOnly = (value) => {
    const text = String(value ?? "");
    const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (iso) return iso;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
  };
  const fieldValue = (pageData, patterns) => {
    const fields = Array.isArray(pageData?.fields) ? pageData.fields : [];
    return fields.find((field) => patterns.some((pattern) => pattern.test(String(field.label ?? ""))))?.value;
  };
  const normalize = (snapshot) => {
    const summary = snapshot.summary || {};
    const approved = snapshot.approvedJobs || {};
    const projectNumber = fieldValue(summary, [/project number/i, /tracking number/i]);
    const requested = moneyCents(fieldValue(summary, [/total contribution.*esdc/i, /amount requested/i, /requested/i]));
    const awarded = moneyCents(fieldValue(approved, [/total contribution.*esdc/i, /approved/i, /contribution.*esdc/i]));
    return {
      title: fieldValue(summary, [/project title/i]) || snapshot.project?.title || "GCOS project",
      funder: "Employment and Social Development Canada",
      program: fieldValue(summary, [/cfp title/i, /call for proposal/i]) || "ESDC GCOS",
      status: /closed/i.test(String(snapshot.project?.status ?? "")) ? "Closed" : /active|agreement|approved/i.test(String(snapshot.project?.status ?? "")) ? "Active" : "Submitted",
      amountRequestedCents: requested,
      amountAwardedCents: awarded,
      startDate: dateOnly(fieldValue(summary, [/start date/i])),
      endDate: dateOnly(fieldValue(summary, [/end date/i])),
      confirmationCode: projectNumber,
      sourceExternalIds: [snapshot.projectId ? `gcos:project:${snapshot.projectId}` : undefined, projectNumber ? `gcos:project-number:${projectNumber}` : undefined].filter(Boolean),
      opportunityUrl: snapshot.currentUrl,
      keyFacts: [
        projectNumber ? `Project number: ${projectNumber}` : undefined,
        snapshot.projectId ? `GCOS project ID: ${snapshot.projectId}` : undefined,
        snapshot.programCode ? `Program code: ${snapshot.programCode}` : undefined,
        awarded != null && requested != null ? `Approved/requested delta: $${((awarded - requested) / 100).toFixed(2)}` : undefined,
      ].filter(Boolean),
      sourceNotes: "Imported from a read-only GCOS Chrome extension snapshot. Sensitive employee and banking fields are intentionally excluded.",
    };
  };

  try {
    let projectId = clean(input?.projectId) || projectIdFromUrl(currentUrl);
    let programCode = clean(input?.programCode) || programCodeFromUrl(currentUrl);
    if (projectId) {
      const display = await fetchPage(`/OSR/pro/Project/Project/Display/${encodeURIComponent(projectId)}`);
      programCode = programCode || programCodeFromUrl(display.url);
    }
    if (!programCode) return { ok: false, error: "Open a GCOS project page or enter the program code, such as CSJ." };
    const landing = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}`);
    projectId = projectId || landing.text.match(/Project ID[:\s]+(\d+)/i)?.[1] || Object.values(landing.hidden).find((value) => /^\d{5,}$/.test(String(value)));
    const summary = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/Summary/Summary`).catch((error) => ({ error: error.message }));
    const approvedJobs = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/JobDetails/IndexApproved`).catch((error) => ({ error: error.message }));
    const agreement = await fetchPage("/OSR/pro/Agreement").catch((error) => ({ error: error.message }));
    const correspondence = await fetchPage("/OSR/pro/Project/Correspondence").catch((error) => ({ error: error.message }));
    const eed = await fetchPage("/OSR/pro/EED").catch((error) => ({ error: error.message }));
    const documents = await fetchPage("/OSR/pro/DocumentBundle").catch((error) => ({ error: error.message }));
    const agreementLinks = Array.isArray(agreement?.links) ? agreement.links.filter((link) => /OpenDocument\/\d+/i.test(String(link.href)) && /IsAgreement=True/i.test(String(link.href))) : [];
    const viewLinks = Array.isArray(correspondence?.links) ? correspondence.links.filter((link) => /ViewCorrespondence\/\d+/i.test(String(link.href))) : [];
    const bodies = [];
    for (const link of viewLinks.slice(0, 20)) bodies.push(await fetchPage(link.href).catch((error) => ({ url: link.href, error: error.message })));
    const snapshot = {
      source: "societyer-gcos-chrome-extension",
      schemaVersion: 1,
      projectId,
      programCode,
      currentUrl,
      exportedAtISO: new Date().toISOString(),
      project: { title: fieldValue(summary, [/project title/i]) || fieldValue(landing, [/project title/i]), status: fieldValue(landing, [/status/i]) },
      landing,
      summary,
      approvedJobs,
      agreement: { ...agreement, agreementLinks },
      correspondence: { ...correspondence, viewLinks, bodies },
      eed,
      documents,
      resultLog: [{ level: "info", step: "extension-export", message: "Collected GCOS project snapshot from a normal Chrome session.", timestampISO: new Date().toISOString() }],
    };
    snapshot.normalizedGrant = normalize(snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
