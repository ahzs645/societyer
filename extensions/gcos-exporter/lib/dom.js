export const $ = (id) => document.getElementById(id);

export function setStatus(message, tone = "") {
  const node = $("status");
  node.textContent = message;
  node.className = `status ${tone}`.trim();
}

export function readFormValues() {
  return {
    projectId: $("projectId").value.trim(),
    programCode: $("programCode").value.trim(),
    apiBase: $("apiBase").value.trim().replace(/\/+$/, ""),
    societyId: $("societyId").value.trim(),
    autoLoadProjects: Boolean($("autoLoadProjects")?.checked),
  };
}

export function writeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2);
  $("output").value = json;
  if (!$("projectId").value && snapshot?.projectId) $("projectId").value = snapshot.projectId;
  if (!$("programCode").value && snapshot?.programCode) $("programCode").value = snapshot.programCode;
  return json;
}

export function clearSnapshotOutput() {
  $("output").value = "";
}

export function setBusy(busy, hasSnapshot) {
  for (const id of ["exportJson", "copyJson", "downloadJson", "importJson"]) {
    const button = $(id);
    if (!button) continue;
    if (id === "exportJson") button.disabled = busy;
    else button.disabled = busy || !hasSnapshot;
  }
}

export function renderProjectList(projects, handlers) {
  const container = $("projectList");
  if (!projects.length) {
    container.innerHTML = '<p class="muted">No projects found.</p>';
    return;
  }
  container.replaceChildren(...projects.map((project) => projectCard(project, handlers)));
}

export function renderProjectListMessage(message, tone = "muted") {
  $("projectList").innerHTML = `<p class="${tone}">${escapeHtml(message)}</p>`;
}

function projectCard(project, handlers) {
  const card = document.createElement("div");
  const statusClass = /active|agreement|approved/i.test(project.status || "") ? "active" : "closed";
  card.className = `project-card ${statusClass}`;

  const title = document.createElement("div");
  title.className = "project-title";
  title.textContent = project.title || `GCOS project ${project.projectId}`;
  card.append(title);

  const meta = document.createElement("div");
  meta.className = "project-meta";
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.textContent = project.status || "Unknown";
  meta.append(badge, document.createTextNode(project.program || project.programGroup || ""));
  card.append(meta);

  const numbers = [project.projectNumber ? `#${project.projectNumber}` : "", project.trackingNumber].filter(Boolean).join(" · ");
  if (numbers) {
    const numberMeta = document.createElement("div");
    numberMeta.className = "project-meta muted";
    numberMeta.textContent = numbers;
    card.append(numberMeta);
  }
  if (project.dateUpdated) {
    const updated = document.createElement("div");
    updated.className = "project-meta muted";
    updated.textContent = `Updated: ${project.dateUpdated}`;
    card.append(updated);
  }

  const actions = document.createElement("div");
  actions.className = "project-actions";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "btn-export";
  exportButton.textContent = "Export JSON";
  exportButton.addEventListener("click", () => handlers.onExport(project));
  actions.append(exportButton);

  const displayUrl = project.links?.Display || project.links?.display;
  if (displayUrl) {
    const viewLink = document.createElement("a");
    viewLink.href = displayUrl;
    viewLink.target = "_blank";
    viewLink.rel = "noreferrer";
    viewLink.className = "btn-link";
    viewLink.textContent = "View";
    actions.append(viewLink);
  }
  card.append(actions);
  return card;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}
