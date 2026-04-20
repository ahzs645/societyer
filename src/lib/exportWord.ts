/**
 * Export a DOM-friendly HTML fragment as a .doc file that Word / Pages / Google Docs
 * open natively. We wrap the body in Word-compatible boilerplate and serve it as
 * `application/msword` with a `.doc` extension. No external library.
 */
export function exportWordDoc({
  filename,
  title,
  bodyHtml,
}: {
  filename: string;
  title: string;
  bodyHtml: string;
}) {
  const css = `
    body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }
    h1 { font-size: 20pt; margin: 0 0 4pt; }
    h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
    h3 { font-size: 12pt; margin: 12pt 0 4pt; }
    p { margin: 0 0 6pt; line-height: 1.35; }
    ul, ol { margin: 0 0 8pt 24pt; padding: 0; }
    li { margin: 0 0 2pt; }
    table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; }
    th, td { border: 1px solid #bbb; padding: 4pt 6pt; font-size: 10.5pt; text-align: left; vertical-align: top; }
    th { background: #f1f1f1; }
    .motion { border-left: 3pt solid #3b5bdb; padding: 4pt 8pt; background: #f6f8ff; margin: 0 0 8pt; }
    .motion .outcome-carried { color: #0a8f4e; font-weight: 600; }
    .motion .outcome-defeated { color: #c9264a; font-weight: 600; }
    .motion .outcome-tabled { color: #a86400; font-weight: 600; }
    .meta { color: #666; font-size: 10pt; }
    .muted { color: #888; }
  `;

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <!--[if gte mso 9]>
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <![endif]-->
      <style>${css}</style>
    </head>
    <body>${bodyHtml}</body>
  </html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".doc") ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function escapeHtml(s: string | undefined | null): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build the body HTML for a meeting-minutes export. */
export function renderMinutesHtml({
  society,
  meeting,
  minutes,
}: {
  society: { name: string; incorporationNumber?: string | null };
  meeting: {
    title: string;
    type: string;
    scheduledAt: string;
    location?: string | null;
    electronic?: boolean;
  };
  minutes: {
    heldAt: string;
    attendees: string[];
    absent: string[];
    quorumMet: boolean;
    quorumRequired?: number;
    quorumSourceLabel?: string;
    discussion: string;
    motions: {
      text: string;
      movedBy?: string;
      secondedBy?: string;
      outcome: string;
      votesFor?: number;
      votesAgainst?: number;
      abstentions?: number;
    }[];
    decisions: string[];
    actionItems: {
      text: string;
      assignee?: string;
      dueDate?: string;
      done: boolean;
    }[];
    approvedAt?: string | null;
    draftTranscript?: string | null;
  };
}): string {
  const eh = escapeHtml;
  const held = new Date(minutes.heldAt).toLocaleString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  const motionRow = (m: typeof minutes.motions[number]) => `
    <div class="motion">
      <p><strong>Motion.</strong> ${eh(m.text)}</p>
      <p class="meta">
        ${m.movedBy ? `Moved by <strong>${eh(m.movedBy)}</strong>` : ""}
        ${m.secondedBy ? ` · Seconded by <strong>${eh(m.secondedBy)}</strong>` : ""}
      </p>
      <p><span class="outcome-${eh(m.outcome.toLowerCase())}">${eh(m.outcome.toUpperCase())}</span>${
        m.votesFor != null
          ? ` · For ${m.votesFor} · Against ${m.votesAgainst ?? 0} · Abstain ${m.abstentions ?? 0}`
          : ""
      }</p>
    </div>
  `;

  const attendeeList = (items: string[]) =>
    items.length ? `<ul>${items.map((a) => `<li>${eh(a)}</li>`).join("")}</ul>` : "<p class='muted'>—</p>";

  return `
    <h1>${eh(meeting.title)}</h1>
    <p class="meta">
      ${eh(meeting.type)} · ${eh(held)}
      ${meeting.location ? ` · ${eh(meeting.location)}` : ""}
      ${meeting.electronic ? " · Electronic participation" : ""}
    </p>
    <p class="meta">${eh(society.name)}${society.incorporationNumber ? ` · ${eh(society.incorporationNumber)}` : ""}</p>

    <h2>Attendance</h2>
    <table>
      <tr>
        <th style="width: 50%;">Present</th>
        <th style="width: 50%;">Absent</th>
      </tr>
      <tr>
        <td>${attendeeList(minutes.attendees)}</td>
        <td>${attendeeList(minutes.absent)}</td>
      </tr>
    </table>
    <p><strong>Quorum:</strong> ${minutes.quorumMet ? "Met" : "Not met"}${
      minutes.quorumRequired != null ? ` · ${minutes.attendees.length} present / ${minutes.quorumRequired} required` : ""
    }${minutes.quorumSourceLabel ? ` · Rule: ${eh(minutes.quorumSourceLabel)}` : ""}</p>

    <h2>Discussion</h2>
    <p>${eh(minutes.discussion).replace(/\n/g, "<br/>")}</p>

    <h2>Motions</h2>
    ${minutes.motions.length ? minutes.motions.map(motionRow).join("") : "<p class='muted'>No motions recorded.</p>"}

    <h2>Decisions</h2>
    ${minutes.decisions.length
      ? `<ol>${minutes.decisions.map((d) => `<li>${eh(d)}</li>`).join("")}</ol>`
      : "<p class='muted'>No decisions recorded.</p>"}

    <h2>Action items</h2>
    ${minutes.actionItems.length
      ? `<table>
          <tr><th>Item</th><th>Assignee</th><th>Due</th><th>Status</th></tr>
          ${minutes.actionItems.map((a) => `
            <tr>
              <td>${eh(a.text)}</td>
              <td>${eh(a.assignee ?? "—")}</td>
              <td>${eh(a.dueDate ?? "—")}</td>
              <td>${a.done ? "Done" : "Open"}</td>
            </tr>
          `).join("")}
        </table>`
      : "<p class='muted'>No action items.</p>"}

    <h2>Approval</h2>
    <p>${minutes.approvedAt
      ? `Approved on <strong>${eh(new Date(minutes.approvedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }))}</strong>.`
      : "<em>Pending approval at next meeting.</em>"}</p>

    ${minutes.draftTranscript ? `
      <h2>Transcript</h2>
      <p class="muted">Raw transcript retained with these minutes.</p>
      <p style="font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; white-space: pre-wrap;">${eh(minutes.draftTranscript)}</p>
    ` : ""}

    <p class="meta" style="margin-top: 18pt;">Generated by Societyer · ${new Date().toISOString().slice(0, 10)}</p>
  `;
}
