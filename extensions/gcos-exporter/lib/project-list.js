export async function fetchGcosProjectsInPage() {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const base = "https://srv136.services.gc.ca";
  const authRisk = /gckey|clegc-gckey|interac|sign-?in|signin|login|credential|auth/i;
  if (authRisk.test(location.href) || !/srv136\.services\.gc\.ca/i.test(location.hostname)) {
    return { ok: false, error: "Open any logged-in GCOS page under srv136.services.gc.ca/OSR/pro before loading projects." };
  }

  const response = await fetch(`${base}/OSR/pro/Project?pagesize=0`, {
    credentials: "include",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const html = await response.text();
  if (!response.ok) return { ok: false, error: `GCOS project list failed with HTTP ${response.status}.` };
  if (authRisk.test(response.url) || /Sign in with GCKey|Welcome to GCKey|session has expired|Start with GCKey/i.test(html)) {
    return { ok: false, error: "GCOS session is not authenticated or has expired." };
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const luxonDate = (element) => {
    const node = element.querySelector?.(".luxon, .luxon-format");
    return node?.dataset?.date?.replace(/T(\d{2})_(\d{2})_(\d{2})Z$/, "T$1:$2:$3Z") || "";
  };
  const cards = [...doc.querySelectorAll(".card.card-default, #containerResult .card, #containerResult article, article, .panel")];
  const projects = [];
  const seen = new Set();

  for (const card of cards) {
    const links = {};
    let projectId = "";
    for (const anchor of card.querySelectorAll('a[href*="/OSR/pro/Project/Project/"], a[href*="/Project/Project/"]')) {
      const href = new URL(anchor.getAttribute("href"), base).href;
      const match = href.match(/\/Project\/Project\/([^/?#]+)\/([^/?#]+)/i);
      if (!match) continue;
      links[match[1]] = href;
      projectId = projectId || match[2];
    }
    if (!projectId || seen.has(projectId)) continue;
    seen.add(projectId);

    const fields = {};
    for (const node of card.querySelectorAll(".flex-auto, .row, li, p, div")) {
      const label = clean(node.querySelector(".fw-bold, strong, b, dt, label")?.textContent).replace(/:$/, "");
      const value = clean(node.querySelector("span:not(.fw-bold), dd")?.textContent)
        || clean(node.textContent).replace(label, "").replace(/^:\s*/, "");
      if (label && value && label.length <= 90 && value !== label) fields[label] = value;
    }
    for (const line of clean(card.textContent).split(/\s{2,}|\n+/).map(clean).filter(Boolean)) {
      const match = line.match(/^([^:]{2,90}):\s*(.+)$/);
      if (match) fields[clean(match[1])] = clean(match[2]);
    }

    const title = clean(card.querySelector(".card-header, .card-title, h2, h3, h4")?.textContent)
      || clean(card.querySelector("a[href*='/Display/']")?.textContent)
      || `GCOS project ${projectId}`;

    projects.push({
      title,
      projectId,
      status: fields.Status || fields["Project Status"] || "",
      trackingNumber: fields["Tracking Number"] || fields["Tracking number"] || "",
      projectNumber: fields["Project Number"] || fields["Project number"] || "",
      program: fields.Program || fields["Program Name"] || "",
      programGroup: fields["Program Group"] || "",
      dateUpdated: luxonDate(card) || fields["Date Updated"] || fields["Date updated"] || "",
      cfpIdentifier: fields["Call For Proposal Identifier"] || fields["CFP Identifier"] || "",
      fields,
      links,
    });
  }

  return {
    ok: true,
    projects,
    currentUrl: location.href,
    fetchedAtISO: new Date().toISOString(),
  };
}
