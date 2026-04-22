import { formatDate, formatDateTime } from "../../../lib/format";
import {
  accessLevelLabel,
  availabilityLabel,
  materialEffectiveStatus,
} from "./meetingMaterialAccess";

export function renderMeetingPackHtml({
  meeting,
  agenda,
  materials,
  tasks,
  minutes,
  joinDetails,
}: {
  meeting: any;
  agenda: string[];
  materials: any[];
  tasks: any[];
  minutes: any;
  joinDetails: any;
}) {
  const agendaHtml = (agenda.length ? agenda : ["General materials"])
    .map((topic) => {
      const topicMaterials = materials.filter((material) => (material.agendaLabel || "General materials") === topic);
      return `<li><strong>${escapeHtml(topic)}</strong>${topicMaterials.length ? `<ul>${topicMaterials.map((material) => {
        const status = materialEffectiveStatus(material);
        const parts = [
          availabilityLabel(status),
          accessLevelLabel(material.accessLevel),
          material.requiredForMeeting ? "required" : "",
          material.expiresAtISO ? `expires ${formatDate(material.expiresAtISO)}` : "",
        ].filter(Boolean);
        return `<li>${escapeHtml(material.label || material.document?.title || "Document")} <span class="meta">(${escapeHtml(parts.join(", "))})</span></li>`;
      }).join("")}</ul>` : ""}</li>`;
    })
    .join("");
  const taskHtml = tasks.length
    ? `<ul>${tasks.map((task) => `<li>${escapeHtml(task.title)} - ${escapeHtml(task.status)}${task.dueDate ? `, due ${escapeHtml(task.dueDate)}` : ""}</li>`).join("")}</ul>`
    : "<p>No linked tasks.</p>";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(meeting.title)} meeting pack</title>
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.45; margin: 32px; color: #18212f; }
      h1, h2 { margin-bottom: 6px; }
      .meta { color: #596275; margin-bottom: 20px; }
      section { border-top: 1px solid #d8dee8; padding-top: 18px; margin-top: 18px; }
      li { margin: 4px 0; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(meeting.title)}</h1>
    <div class="meta">${escapeHtml(meeting.type)} - ${escapeHtml(formatDateTime(meeting.scheduledAt))} - ${escapeHtml(meeting.location ?? "")}</div>
    <section>
      <h2>Join Details</h2>
      ${joinDetails.url ? `<p><a href="${escapeHtml(joinDetails.url)}">${escapeHtml(joinDetails.url)}</a></p>` : "<p>No remote meeting link saved.</p>"}
      ${joinDetails.meetingId ? `<p>Meeting ID: ${escapeHtml(joinDetails.meetingId)}</p>` : ""}
      ${joinDetails.passcode ? `<p>Passcode: ${escapeHtml(joinDetails.passcode)}</p>` : ""}
      ${joinDetails.instructions ? `<p>${escapeHtml(joinDetails.instructions)}</p>` : ""}
    </section>
    <section>
      <h2>Agenda And Materials</h2>
      <ol>${agendaHtml}</ol>
    </section>
    <section>
      <h2>Attendance</h2>
      <p>${minutes?.attendees?.length ? escapeHtml(minutes.attendees.join(", ")) : "Attendance not recorded."}</p>
    </section>
    <section>
      <h2>Actions</h2>
      ${taskHtml}
    </section>
    <section>
      <h2>Minutes</h2>
      <p>${minutes ? "Minutes are on file in Societyer." : "Minutes have not been drafted yet."}</p>
    </section>
  </body>
</html>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
