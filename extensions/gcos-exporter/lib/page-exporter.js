export async function exportGcosSnapshotInPage(input) {
  const BASE = "https://srv136.services.gc.ca";
  const authRisk = /gckey|clegc-gckey|interac|sign-?in|signin|login|credential|auth/i;

  if (authRisk.test(location.href) || !/srv136\.services\.gc\.ca|canada\.ca/i.test(location.hostname)) {
    return { ok: false, error: "Open the logged-in GCOS tab under srv136.services.gc.ca/OSR/pro before exporting." };
  }

  const clean = (value) => String(value ?? "").replace(/\bHoneyBot\b/g, "").replace(/\s+/g, " ").trim();
  const stripSensitive = (text) => /social insurance|\bSIN\b|account number|direct deposit|bank|financial institution|branch number|transit|routing/i.test(String(text ?? ""));
  const urlFromPath = (pathOrUrl) => /^https?:/i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, BASE).href;
  const absoluteUrl = (href, base) => new URL(href, base || BASE).href;
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
  const moneyCents = (value) => {
    const match = String(value ?? "").replace(/,/g, "").match(/(-?)\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (!match) return undefined;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * Math.round(Number(match[2]) * 100);
  };
  const dateOnly = (value) => {
    const text = String(value ?? "");
    const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (iso) return iso;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
  };
  const numberText = (value) => String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0];

  const extractLuxonDate = (element) => {
    const node = element?.matches?.(".luxon, .luxon-format") ? element : element?.querySelector?.(".luxon, .luxon-format");
    const raw = node?.dataset?.date;
    if (!raw) return undefined;
    return raw.replace(/T(\d{2})_(\d{2})_(\d{2})Z$/, "T$1:$2:$3Z");
  };

  const extractScreenMeta = (doc, url) => {
    const text = clean(doc.body?.innerText);
    return {
      url,
      title: doc.title,
      screenId: text.match(/Screen Identifier:\s*([A-Za-z0-9-]+)/i)?.[1] || "",
      version: text.match(/Version:\s*([0-9.]+)/i)?.[1] || "",
      scrapedAtISO: new Date().toISOString(),
    };
  };

  const extractCardLabels = (card, baseUrl) => {
    const fields = {};
    for (const row of card.querySelectorAll(".flex-auto, .card-body > div, .row, li")) {
      const labelNode = row.querySelector(".fw-bold, strong, b, dt, label");
      if (!labelNode) continue;
      const label = clean(labelNode.textContent).replace(/[:*]+$/, "");
      if (!label || stripSensitive(label)) continue;
      let value = "";
      const valueNode = [...row.querySelectorAll("span, dd, div")]
        .find((node) => node !== labelNode && !node.classList.contains("fw-bold") && clean(node.textContent) && !node.querySelector(".fw-bold, strong, b, dt, label"));
      if (valueNode) value = clean(valueNode.textContent);
      if (!value) value = clean(row.textContent).replace(clean(labelNode.textContent), "").replace(/^:\s*/, "");
      if (value && value !== label && !stripSensitive(`${label} ${value}`)) fields[label] = value;
    }
    const links = {};
    for (const anchor of card.querySelectorAll("a[href]")) {
      const text = clean(anchor.textContent) || clean(anchor.getAttribute("aria-label"));
      if (!text) continue;
      links[text] = absoluteUrl(anchor.getAttribute("href"), baseUrl);
    }
    return { fields, links, text: clean(card.textContent), dateISO: extractLuxonDate(card) };
  };

  const extractFormState = (root) => {
    const out = { radios: {}, checkboxes: {}, textareas: {}, texts: {}, selects: {}, hidden: {} };
    for (const input of root.querySelectorAll("input[name], textarea[name], select[name]")) {
      const name = input.getAttribute("name");
      const type = (input.getAttribute("type") || input.tagName).toLowerCase();
      const id = input.getAttribute("id") || "";
      if (!name || /^__|HoneyBot/i.test(name) || type === "password" || stripSensitive(`${name} ${id}`)) continue;
      if (type === "hidden") {
        out.hidden[name] = clean(input.value);
        continue;
      }
      if (type === "radio") {
        if (input.checked) out.radios[name] = clean(input.value || labelFor(root, input));
        continue;
      }
      if (type === "checkbox") {
        if (!input.checked) continue;
        if (!out.checkboxes[name]) out.checkboxes[name] = [];
        out.checkboxes[name].push(clean(input.value || labelFor(root, input) || "Selected"));
        continue;
      }
      if (input.tagName === "TEXTAREA") {
        out.textareas[name] = clean(input.value);
        continue;
      }
      if (input.tagName === "SELECT") {
        out.selects[name] = {
          value: clean(input.value),
          text: clean(input.options?.[input.selectedIndex]?.textContent || input.value),
        };
        continue;
      }
      out.texts[name] = clean(input.value);
    }
    return out;
  };

  const labelFor = (root, input) => {
    const id = input.getAttribute("id");
    return id ? clean(root.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) : "";
  };

  const extractLinks = (doc, url) => [...doc.querySelectorAll("a[href]")]
    .map((anchor) => ({ text: clean(anchor.textContent), href: absoluteUrl(anchor.getAttribute("href"), url) }))
    .filter((link) => link.text && !stripSensitive(`${link.text} ${link.href}`));

  const extractPage = (doc, url) => {
    const hidden = {};
    for (const input of doc.querySelectorAll("input[type=hidden][name]")) {
      const name = input.getAttribute("name");
      if (name && !/^__|^HoneyBot$/i.test(name) && !stripSensitive(name)) hidden[name] = clean(input.value);
    }
    const cardLabels = [...doc.querySelectorAll(".card.card-info, .card.card-default, .card, .panel")]
      .map((card) => extractCardLabels(card, url))
      .filter((card) => Object.keys(card.fields).length || Object.keys(card.links).length);
    const fields = cardLabels.flatMap((card) => Object.entries(card.fields).map(([label, value]) => ({ label, value })));
    return {
      _meta: extractScreenMeta(doc, url),
      url,
      title: doc.title,
      screenIdentifier: extractScreenMeta(doc, url).screenId,
      hidden,
      fields,
      formState: extractFormState(doc),
      cardLabels,
      links: extractLinks(doc, url),
      text: clean(doc.body?.innerText).slice(0, 20000),
    };
  };

  const fetchDocument = async (pathOrUrl) => {
    const url = urlFromPath(pathOrUrl);
    const response = await fetch(url, { credentials: "include", headers: { accept: "text/html,application/xhtml+xml" } });
    const html = await response.text();
    if (!response.ok) throw new Error(`GCOS page request failed: ${response.status} ${url}`);
    if (authRisk.test(response.url) || /Sign in with GCKey|Welcome to GCKey|session has expired|Start with GCKey/i.test(html)) {
      throw new Error("GCOS session is not authenticated or has expired.");
    }
    return { doc: new DOMParser().parseFromString(html, "text/html"), url: response.url || url };
  };

  const fetchPage = async (pathOrUrl) => {
    const { doc, url } = await fetchDocument(pathOrUrl);
    return extractPage(doc, url);
  };

  const fieldMap = (page) => Object.fromEntries((page?.fields || []).map((field) => [field.label, field.value]));
  const firstField = (page, patterns) => {
    const fields = Array.isArray(page?.fields) ? page.fields : [];
    return fields.find((field) => patterns.some((pattern) => pattern.test(String(field.label ?? ""))))?.value;
  };
  const cardField = (card, patterns) => {
    const entries = Object.entries(card?.fields || {});
    return entries.find(([label]) => patterns.some((pattern) => pattern.test(label)))?.[1];
  };

  const extractProjectInfo = (page) => {
    const cards = page?.cardLabels || [];
    const card = cards.find((item) => item.fields["Project Number"] || item.fields["Project Title"]) || {};
    const fields = card.fields || fieldMap(page);
    return {
      projectNumber: fields["Project Number"],
      projectTitle: fields["Project Title"],
      startDate: fields["Start Date"],
      endDate: fields["End Date"],
    };
  };

  const extractCallForProposal = (page) => {
    const cards = page?.cardLabels || [];
    const card = cards.find((item) => Object.keys(item.fields || {}).some((label) => /Call For Proposal/i.test(label))) || {};
    const fields = card.fields || fieldMap(page);
    return {
      identifier: fields["Call For Proposal Identifier"],
      title: fields["Call For Proposal Title"],
      closingDate: fields["Call For Proposal Closing Date"],
      timeRemaining: fields["Call For Proposal Time remaining"] || fields["Call For Proposal Time Remaining"],
    };
  };

  const extractProjectCards = async () => {
    const { doc, url } = await fetchDocument("/OSR/pro/Project?pagesize=0");
    const cards = [...doc.querySelectorAll("#containerResult .card, .card.card-default, article, .panel")];
    const projects = [];
    const seen = new Set();
    for (const card of cards) {
      const links = {};
      let projectId = "";
      for (const anchor of card.querySelectorAll('a[href*="/Project/Project/"]')) {
        const href = absoluteUrl(anchor.getAttribute("href"), url);
        const match = href.match(/\/Project\/Project\/([^/?#]+)\/([^/?#]+)/i);
        if (!match) continue;
        links[match[1]] = href;
        projectId = projectId || match[2];
      }
      if (!projectId || seen.has(projectId)) continue;
      seen.add(projectId);
      const parsed = extractCardLabels(card, url);
      projects.push({
        title: clean(card.querySelector(".card-header, .card-title, h2, h3, h4")?.textContent) || parsed.fields["Project Title"] || `GCOS project ${projectId}`,
        projectId,
        status: parsed.fields.Status || "",
        trackingNumber: parsed.fields["Tracking Number"] || "",
        projectNumber: parsed.fields["Project Number"] || "",
        dateUpdated: parsed.fields["Date Updated"] || extractLuxonDate(card),
        programGroup: parsed.fields["Program Group"] || "",
        program: parsed.fields.Program || "",
        callForProposalIdentifier: parsed.fields["Call For Proposal Identifier"] || "",
        callForProposalTimeRemaining: parsed.fields["Call For Proposal Time remaining"] || "",
        createdBy: parsed.fields["Created By"] || "",
        modifiedBy: parsed.fields["Modified By"] || "",
        links,
      });
    }
    return { _meta: extractScreenMeta(doc, url), projects };
  };

  const extractApplicationSections = (landing) => {
    const sections = [];
    for (const card of landing?.cardLabels || []) {
      const viewText = Object.keys(card.links || {}).find((label) => /^View /i.test(label));
      if (!viewText) continue;
      const name = viewText.replace(/^View\s+/i, "").replace(/\s+Statement$/i, "");
      const text = card.text || Object.entries(card.fields || {}).map(([label, value]) => `${label}: ${value}`).join(" ");
      sections.push({
        name: clean(name).replace(/:$/, ""),
        status: /Completed/i.test(text) ? "completed" : /Optional/i.test(text) ? "optional" : /Error/i.test(text) ? "error" : undefined,
        savedOn: cleanStatusDate(text.match(/Successfully saved on\s+(.+?)(?:\s+View|\s+\(|$)/i)?.[1]),
        summary: clean(text.replace(/\s*\(Top of Page\).*/i, "")).slice(0, 500),
        links: card.links || {},
      });
    }
    return sections;
  };

  const extractJobList = (page, approved = false) => {
    const jobs = [];
    for (const card of page?.cardLabels || []) {
      const fields = card.fields || {};
      const viewLabel = Object.keys(card.links || {}).find((label) => /Job Title:/i.test(label));
      const title = clean(
        viewLabel?.match(/Job Title:\s*(.+)$/i)?.[1]
        || card.text?.match(/(?:All\s+)?(.+?)\s+Status:/i)?.[1]
        || Object.keys(fields).find((label) => /Media|Coordinator|Assistant|Worker|Student|Job/i.test(label))
        || cardField(card, [/job title/i]),
      );
      if (!title && !fields["Number of Participants"]) continue;
      jobs.push({
        title: title || clean(page?.text?.match(/All\s+(.+?)\s+Number of Participants:/i)?.[1]),
        participants: fields["Number of Participants"] || fields["Number of Participants Requested"],
        anticipatedStartDate: fields["Anticipated Start Date"] || extractLuxonDate({ querySelector: () => null }),
        weeks: fields["Number of Weeks"] || fields["Number of Weeks Requested"],
        hoursPerWeek: fields["Number of hours per Week"] || fields["Number of Hours per Week Requested"],
        totalHours: fields["Total Number Of Hours"],
        hourlyWage: fields["Hourly Wage Rate paid to participant"],
        esdcHourlyWage: fields["ESDC Hourly Wage"] || fields["Hourly Wage Funding Requested"],
        mercs: fields["Total MERCs"] || fields["Mandatory Employment Related Costs (MERCs) Requested"],
        contributionEsdc: fields["Total Contribution (ESDC)"] || fields["Total Contribution (ESDC) Requested"],
        employerContribution: fields["Total Employer Contribution"] || fields["Total Employer Contribution Requested"],
        jobBankUrl: Object.values(card.links || {}).find((href) => /jobbank\.gc\.ca/i.test(href)),
        links: card.links || {},
        approved,
      });
    }
    if (!jobs.length && page?.text) {
      const text = page.text;
      const title = clean(text.match(/All\s+(.+?)\s+Number of Participants:/i)?.[1]);
      if (title) jobs.push({
        title,
        participants: text.match(/Number of Participants:\s*([\d.]+)/i)?.[1],
        anticipatedStartDate: text.match(/Anticipated Start Date:\s*(.+?)\s+Number of Weeks:/i)?.[1]?.trim(),
        weeks: text.match(/Number of Weeks:\s*([\d.]+)/i)?.[1],
        hoursPerWeek: text.match(/Number of hours per Week:\s*([\d.]+)/i)?.[1],
        totalHours: text.match(/Total Number Of Hours:\s*([\d.]+)/i)?.[1],
        hourlyWage: text.match(/Hourly Wage Rate paid to participant:\s*([^E]+?)\s+ESDC Hourly Wage:/i)?.[1]?.trim(),
        esdcHourlyWage: text.match(/ESDC Hourly Wage:\s*([^T]+?)\s+Total MERCs:/i)?.[1]?.trim(),
        mercs: text.match(/Total MERCs:\s*([^T]+?)\s+Total Contribution/i)?.[1]?.trim(),
        contributionEsdc: text.match(/Total Contribution \(ESDC\):\s*([^T]+?)\s+Total Employer Contribution:/i)?.[1]?.trim(),
        employerContribution: text.match(/Total Employer Contribution:\s*([^J]+?)\s+Job Bank:/i)?.[1]?.trim(),
        approved,
      });
    }
    return jobs;
  };

  const extractJobDetail = (page) => ({
    _meta: page?._meta,
    url: page?.url,
    id: page?.url?.match(/\/JobDetails\/Display\/(\d+)/i)?.[1],
    formState: page?.formState,
    fields: fieldMap(page),
  });

  const extractProjectDetails = (page) => ({
    _meta: page?._meta,
    url: page?.url,
    formState: page?.formState,
    fields: fieldMap(page),
  });

  const extractManage = (page) => {
    const text = clean(page?.text);
    const sectionText = (name, nextNames = []) => {
      const names = nextNames.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const pattern = names
        ? new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+?)(?=\\s+(?:${names})\\b|\\s+Help and Support\\b|$)`, "i")
        : new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+?)(?=\\s+Help and Support\\b|$)`, "i");
      return clean(text.match(pattern)?.[1]);
    };
    const module = (name, viewPattern, addPattern) => ({
      name,
      state: viewPattern.test(text) ? "available" : "not-started",
      canView: viewPattern.test(text),
      canAdd: addPattern ? addPattern.test(text) : false,
      submittedOn: cleanStatusDate(sectionText(name, [
        "Application",
        "Approved Job Details",
        "Agreement Information",
        "Direct Deposit",
        "Employer and Employee Declaration",
        "Payment Claim and Activity Report Bundle",
        "Supporting Documents",
      ]).match(/Submitted on\s+(.+?)(?:\s+View|\s+\(Top|$)/i)?.[1]),
    });
    return {
      _meta: page?._meta,
      application: module("Application", /View Application/i),
      approvedJobDetails: module("Approved Job Details", /View Approved Job Details/i),
      agreement: {
        ...module("Agreement Information", /View Agreement Information/i),
        signedOn: cleanStatusDate(sectionText("Agreement Information", ["Direct Deposit"]).match(/Final Agreement signed on\s+(.+?)(?:\s+View|\s+\(Top|$)/i)?.[1]),
      },
      directDeposit: module("Direct Deposit", /View Direct Deposit/i),
      eed: module("Employer and Employee Declaration", /View Employer and Employee Declaration/i, /Add Employer and Employee Declaration/i),
      paymentClaimActivityReport: module("Payment Claim and Activity Report Bundle", /View Payment Claim and Activity Report/i),
      supportingDocuments: module("Supporting Documents", /View Supporting Documents/i, /Add Supporting Document/i),
    };
  };

  const extractAgreements = (page) => {
    const rows = [];
    for (const card of page?.cardLabels || []) {
      const fields = card.fields || {};
      const documentUrl = Object.values(card.links || {}).find((href) => /OpenDocument\/\d+/i.test(href));
      if (!documentUrl && !fields["Tracking Number"]) continue;
      const viewLabel = Object.keys(card.links || {}).find((label) => /Identifier:\s*\d+/i.test(label));
      const agreementNumber = clean(
        viewLabel?.match(/Identifier:\s*(\d+)/i)?.[1]
        || card.text?.match(/\b(\d{4,})\s+Tracking Number:/i)?.[1],
      );
      rows.push({
        agreementNumber,
        agreementTrackingNumber: fields["Tracking Number"],
        version: fields.Version,
        status: fields.Status,
        dateUpdated: fields["Date Updated"] || card.dateISO,
        viewDocumentUrl: documentUrl,
        documentId: documentUrl?.match(/OpenDocument\/(\d+)/i)?.[1],
      });
    }
    if (!rows.length && page?.text) rows.push({
      agreementNumber: page.text.match(/All\s+(\d{4,})\s+Tracking Number:/i)?.[1],
      agreementTrackingNumber: page.text.match(/Tracking Number:\s*([A-Z0-9]+)/i)?.[1],
      version: page.text.match(/Version:\s*(\d+)/i)?.[1],
      status: page.text.match(/Status:\s*(.+?)\s+Date Updated:/i)?.[1]?.trim(),
      viewDocumentUrl: page?.agreementLinks?.[0]?.href,
      documentId: page?.agreementLinks?.[0]?.href?.match(/OpenDocument\/(\d+)/i)?.[1],
    });
    const seen = new Set();
    return rows.filter((row) => {
      const key = row.documentId || row.agreementNumber;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const extractCorrespondence = async (page) => {
    const rows = [];
    if (page?._doc) {
      for (const card of page._doc.querySelectorAll(".card, .panel, #containerResult > div")) {
        const parsed = extractCardLabels(card, page.url);
        const fields = parsed.fields || {};
        const type = fields.Type || clean(card.textContent).match(/Type:\s*(.+?)\s+Date Sent:/i)?.[1];
        if (!type) continue;
        const viewUrl = Object.values(parsed.links || {}).find((href) => /ViewCorrespondence\/\d+/i.test(href));
        rows.push({
          type: clean(type),
          dateSent: extractLuxonDate(card) || fields["Date Sent"],
          sentBy: fields["Sent By"] || clean(card.textContent).match(/Sent By:\s*(Email|Information)/i)?.[1],
          viewUrl,
          correspondenceId: viewUrl?.match(/ViewCorrespondence\/(\d+)/i)?.[1],
        });
      }
    }
    if (!rows.length) {
      for (const card of page?.cardLabels || []) {
        const fields = card.fields || {};
        const type = fields.Type;
        if (!type) continue;
        const viewUrl = Object.values(card.links || {}).find((href) => /ViewCorrespondence\/\d+/i.test(href));
        rows.push({
          type: clean(type),
          dateSent: card.dateISO || fields["Date Sent"],
          sentBy: fields["Sent By"],
          viewUrl,
          correspondenceId: viewUrl?.match(/ViewCorrespondence\/(\d+)/i)?.[1],
        });
      }
    }
    if (!rows.length) {
      const pattern = /Type:\s*(.+?)\s+Date Sent:\s*(.*?)\s+Sent By:\s*(Email|Information)(?:\s+View)?/gi;
      for (const match of clean(page?.text).matchAll(pattern)) rows.push({ type: clean(match[1]), dateSent: clean(match[2]), sentBy: clean(match[3]) });
    }
    return rows;
  };

  const jobDeltas = (requestedJobs, approvedJobs) => requestedJobs.map((requested) => {
    const approved = approvedJobs.find((job) => clean(job.title).toLowerCase() === clean(requested.title).toLowerCase()) || approvedJobs[0];
    if (!approved) return { title: requested.title };
    const delta = (req, app) => {
      const r = Number(numberText(req));
      const a = Number(numberText(app));
      return Number.isFinite(r) && Number.isFinite(a) ? { requested: r, approved: a, delta: a - r } : undefined;
    };
    const deltaMoney = (req, app) => {
      const r = moneyCents(req);
      const a = moneyCents(app);
      return r != null && a != null ? { requestedCents: r, approvedCents: a, deltaCents: a - r } : undefined;
    };
    return {
      title: requested.title,
      weeks: delta(requested.weeks, approved.weeks),
      hoursPerWeek: delta(requested.hoursPerWeek, approved.hoursPerWeek),
      esdcHourlyWage: delta(requested.esdcHourlyWage, approved.esdcHourlyWage),
      mercs: deltaMoney(requested.mercs, approved.mercs),
      totalEsdcContribution: deltaMoney(requested.contributionEsdc, approved.contributionEsdc),
      totalEmployerContribution: deltaMoney(requested.employerContribution, approved.employerContribution),
    };
  });

  const buildStructured = async (snapshot) => {
    const requestedJobs = extractJobList(snapshot.appliedJobs, false).map((job, index) => ({
      ...job,
      detail: snapshot.appliedJobs?.details?.[index] ? extractJobDetail(snapshot.appliedJobs.details[index]) : undefined,
    }));
    const approvedJobs = extractJobList(snapshot.approvedJobs, true);
    const correspondenceRows = await extractCorrespondence(snapshot.correspondence);
    return {
      projectInformation: extractProjectInfo(snapshot.landing?.text ? snapshot.landing : snapshot.summary),
      callForProposal: extractCallForProposal(snapshot.landing),
      application: {
        _meta: snapshot.landing?._meta,
        sections: extractApplicationSections(snapshot.landing),
      },
      organization: {
        legalName: firstField(snapshot.summary, [/legal name/i]),
        operatingName: firstField(snapshot.summary, [/operating.*name/i]),
        businessRegistrationNumber: firstField(snapshot.summary, [/business.*registration/i]),
        organizationType: firstField(snapshot.summary, [/organization type/i]),
        yearEstablished: firstField(snapshot.summary, [/year established/i]),
        email: firstField(snapshot.summary, [/e-mail|email/i]),
        telephone: firstField(snapshot.summary, [/telephone/i]),
        website: firstField(snapshot.summary, [/website/i]),
        mandate: firstField(snapshot.summary, [/mandate/i]),
        signaturesRequiredForApplication: firstField(snapshot.summary, [/signatures.*application/i]),
      },
      jobsRequested: requestedJobs,
      jobsApproved: approvedJobs,
      jobDeltas: jobDeltas(requestedJobs, approvedJobs),
      projectDetails: extractProjectDetails(snapshot.projectDetails),
      manage: extractManage(snapshot.manage),
      agreements: extractAgreements(snapshot.agreement),
      correspondence: correspondenceRows,
      eed: pageEntryStatus(snapshot.eed),
      documents: pageEntryStatus(snapshot.documents),
      directDeposit: { skipped: true, reason: "Banking pages are intentionally not exported because they can contain account numbers and void-cheque documents." },
      appliedJob: requestedJobs[0] ? {
        ...requestedJobs[0],
        participantsRequested: requestedJobs[0].participants,
        weeksRequested: requestedJobs[0].weeks,
        hoursPerWeekRequested: requestedJobs[0].hoursPerWeek,
        esdcHourlyWageRequested: requestedJobs[0].esdcHourlyWage,
        contributionEsdcRequested: requestedJobs[0].contributionEsdc,
        employerContributionRequested: requestedJobs[0].employerContribution,
        mercsRequested: requestedJobs[0].mercs,
      } : {},
      approvedJob: approvedJobs[0] ? {
        ...approvedJobs[0],
        participantsApproved: approvedJobs[0].participants,
        weeksApproved: approvedJobs[0].weeks,
        hoursPerWeekApproved: approvedJobs[0].hoursPerWeek,
        esdcHourlyWageApproved: approvedJobs[0].esdcHourlyWage,
        contributionEsdcApproved: approvedJobs[0].contributionEsdc,
        employerContributionApproved: approvedJobs[0].employerContribution,
        mercsApproved: approvedJobs[0].mercs,
      } : {},
      agreement: extractAgreements(snapshot.agreement)[0] || {},
      appliedFunding: {
        contributionEsdcRequested: requestedJobs[0]?.contributionEsdc,
        employerContributionRequested: requestedJobs[0]?.employerContribution,
      },
    };
  };

  const pageEntryStatus = (pageData) => {
    if (pageData?.error) return { hasEntries: null, error: pageData.error };
    const text = clean(pageData?.text);
    if (!text) return { hasEntries: null };
    return { hasEntries: !/There are currently no entries/i.test(text) };
  };

  const cleanStatusDate = (value) => {
    const text = clean(value);
    if (!text || /^View\b/i.test(text)) return undefined;
    return text;
  };

  const normalize = (snapshot) => {
    const structured = snapshot.structured ?? {};
    const projectNumber = structured.projectInformation?.projectNumber;
    const requested = moneyCents(structured.appliedFunding?.contributionEsdcRequested);
    const awarded = moneyCents(structured.approvedJob?.contributionEsdc);
    return {
      title: structured.projectInformation?.projectTitle || snapshot.project?.title || "GCOS project",
      funder: "Employment and Social Development Canada",
      program: structured.callForProposal?.title || "ESDC GCOS",
      status: /closed/i.test(String(snapshot.project?.status ?? "")) ? "Closed" : /active|agreement|approved|final agreement/i.test(String(snapshot.project?.status ?? structured.agreement?.status ?? "")) ? "Active" : "Submitted",
      amountRequestedCents: requested,
      amountAwardedCents: awarded,
      startDate: dateOnly(structured.projectInformation?.startDate),
      endDate: dateOnly(structured.projectInformation?.endDate),
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
    const currentUrl = location.href;
    let projectId = clean(input?.projectId) || projectIdFromUrl(currentUrl);
    let programCode = clean(input?.programCode) || programCodeFromUrl(currentUrl);
    const projectListing = await extractProjectCards().catch((error) => ({ error: error.message, projects: [] }));
    if (projectId) {
      const display = await fetchPage(`/OSR/pro/Project/Project/Display/${encodeURIComponent(projectId)}`);
      programCode = programCode || programCodeFromUrl(display.url);
    }
    if (!programCode) return { ok: false, error: "Open a GCOS project page or enter the program code, such as CSJ." };

    const landing = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}`);
    projectId = projectId || landing.text.match(/Project ID[:\s]+(\d+)/i)?.[1] || Object.values(landing.hidden).find((value) => /^\d{5,}$/.test(String(value)));
    const summary = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/Summary/Summary`).catch((error) => ({ error: error.message }));
    const approvedJobs = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/JobDetails/IndexApproved`).catch((error) => ({ error: error.message }));
    const programSelection = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/ProgramSelection/Display`).catch((error) => ({ error: error.message }));
    const mailingAddress = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/MailingAddress/Display`).catch((error) => ({ error: error.message }));
    const orgContacts = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/OrgContact/Index`).catch((error) => ({ error: error.message }));
    const contactLinks = Array.isArray(orgContacts?.links) ? orgContacts.links.filter((link) => /\/OrgContact\/Display\/\d+/i.test(String(link.href))) : [];
    const contactDetails = [];
    for (const link of contactLinks.slice(0, 20)) contactDetails.push(await fetchPage(link.href).catch((error) => ({ url: link.href, error: error.message })));
    const projectLocations = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/ProjectLocation/Index`).catch((error) => ({ error: error.message }));
    const appliedJobs = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/JobDetails/Index`).catch((error) => ({ error: error.message }));
    const jobLinks = Array.isArray(appliedJobs?.links) ? appliedJobs.links.filter((link) => /\/JobDetails\/Display\/\d+/i.test(String(link.href))) : [];
    const appliedJobDetails = [];
    for (const link of jobLinks.slice(0, 20)) {
      const detail = await fetchPage(link.href).catch((error) => ({ url: link.href, error: error.message }));
      if (detail?.url && /\/OSR\/pro\/Project(?:$|[/?#])/i.test(detail.url)) {
        appliedJobDetails.push(await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/JobDetails/Display/${encodeURIComponent(link.href.match(/\/Display\/(\d+)/i)?.[1] || "")}`).catch((error) => ({ url: link.href, error: error.message })));
      } else {
        appliedJobDetails.push(detail);
      }
    }
    const projectDetails = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/ProjectDetails/Display`).catch((error) => ({ error: error.message }));
    const manage = await fetchPage(`/OSR/pro/${encodeURIComponent(programCode)}/${encodeURIComponent(programCode)}/Manage`).catch((error) => ({ error: error.message }));
    const agreement = await fetchPage("/OSR/pro/Agreement").catch((error) => ({ error: error.message }));
    const correspondenceDoc = await fetchDocument("/OSR/pro/Project/Correspondence").catch((error) => ({ error }));
    const correspondence = correspondenceDoc.error ? { error: correspondenceDoc.error.message } : { ...extractPage(correspondenceDoc.doc, correspondenceDoc.url), _doc: correspondenceDoc.doc };
    const eed = await fetchPage("/OSR/pro/EED").catch((error) => ({ error: error.message }));
    const documents = await fetchPage("/OSR/pro/DocumentBundle").catch((error) => ({ error: error.message }));
    const accountManagement = await fetchPage("/OSR/pro/GCOS/GCOS/AccountManagement").catch((error) => ({ error: error.message }));
    const organizationProfile = await fetchPage("/OSR/pro/GCOS/GCOS/Landing").catch((error) => ({ error: error.message }));
    const orgInfo = await fetchPage("/OSR/pro/GCOS/GCOS/OrgInfo").catch((error) => ({ error: error.message }));
    const orgMailingAddresses = await fetchPage("/OSR/pro/GCOS/GCOS/OrgMailingAddList").catch((error) => ({ error: error.message }));
    const contactUs = await fetchPage("/OSR/pro/Message/ContactUs/Index").catch((error) => ({ error: error.message }));

    const agreementLinks = Array.isArray(agreement?.links) ? agreement.links.filter((link) => /OpenDocument\/\d+/i.test(String(link.href)) && /IsAgreement=True/i.test(String(link.href))) : [];
    const viewLinks = Array.isArray(correspondence?.links) ? correspondence.links.filter((link) => /ViewCorrespondence\/\d+/i.test(String(link.href))) : [];
    const bodies = [];
    for (const link of viewLinks.slice(0, 20)) bodies.push(await fetchPage(link.href).catch((error) => ({ url: link.href, error: error.message })));

    const snapshot = {
      source: "societyer-gcos-chrome-extension",
      schemaVersion: 3,
      projectId,
      programCode,
      currentUrl,
      exportedAtISO: new Date().toISOString(),
      meta: {
        exporter: "societyer-gcos-chrome-extension",
        schemaVersion: 3,
        scrapedAtISO: new Date().toISOString(),
      },
      projects: projectListing.projects || [],
      project: projectListing.projects?.find((project) => String(project.projectId) === String(projectId)) || {},
      landing,
      summary,
      programSelection,
      mailingAddress,
      orgContacts: { ...orgContacts, contactLinks, details: contactDetails },
      projectLocations,
      appliedJobs: { ...appliedJobs, jobLinks, details: appliedJobDetails },
      projectDetails,
      manage,
      approvedJobs,
      agreement: { ...agreement, agreementLinks },
      correspondence: { ...correspondence, _doc: undefined, viewLinks, bodies },
      eed,
      documents,
      account: {
        accountManagement,
        organizationProfile,
        orgInfo,
        orgMailingAddresses,
        directDepositAccounts: { skipped: true, reason: "Skipped to avoid exporting bank account numbers or void-cheque document metadata." },
        representatives: { skipped: true, reason: "External GCKey/ECAS representative-management flow is out of scope and can terminate GCOS session." },
      },
      contactUs,
      resultLog: [{ level: "info", step: "extension-export", message: "Collected GCOS project snapshot from a normal Chrome session.", timestampISO: new Date().toISOString() }],
    };
    snapshot.structured = await buildStructured(snapshot);
    snapshot.normalizedGrant = normalize(snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
