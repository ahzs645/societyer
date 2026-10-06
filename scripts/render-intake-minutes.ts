import { readFile, writeFile } from "node:fs/promises";
import { renderMinutesHtml, type MinutesRenderArgs } from "../src/features/meetings/lib/minutesRenderer";
import { normalizeMeetingMinutesPayload } from "../shared/functions/importSessionHelpers/importSessionNormalize";
import { toMeetingDateTime } from "../shared/functions/importSessionHelpers/importSessionRecordKinds";
import { escapeHtml } from "../src/lib/html";
import { assertImportBundlePreflight } from "../shared/importBundlePreflight";

const [organizationPath, bundlePath, outputPath] = process.argv.slice(2);
if (!organizationPath || !bundlePath || !outputPath) throw new Error("Usage: node --import tsx scripts/render-intake-minutes.ts organization.json bundle.json preview.html");
const society = JSON.parse(await readFile(organizationPath, "utf8"));
const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
assertImportBundlePreflight(bundle);
const candidates: Record<string, unknown>[] = bundle.meetingMinutes ?? [];
const articles = candidates.map((raw, index: number) => {
  const p = normalizeMeetingMinutesPayload(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.meetingDate ?? "")) throw new Error("Preview requires a complete source date; unknown dates must stay evidence-only");
  const heldAt = toMeetingDateTime(p.meetingDate);
  const minutes = {
    ...p, heldAt,
    motions: p.motions.map((m) => ({ text: m.motionText, movedBy: m.movedByName, secondedBy: m.secondedByName, outcome: m.outcome || "Not recorded", votesFor: m.votesFor, votesAgainst: m.votesAgainst, abstentions: m.abstentions })),
  };
  const body = renderMinutesHtml({ society,
    meeting: { title: p.meetingTitle || "Imported minutes", type: p.meetingType || "Board", scheduledAt: heldAt, location: p.location, electronic: p.electronic, agendaItems: p.agendaItems },
    minutes: minutes as unknown as MinutesRenderArgs["minutes"],
    styleId: "standard",
    options: { includeTranscript: false, includeApprovalBlock: false, includeSignatures: false, includeGeneratedFooter: false, includeDiscussionSummary: !p.sections?.length },
  });
  const links = p.sourceExternalIds.map((id: string) => `<a href="https://drive.google.com/file/d/${encodeURIComponent(id.replace(/^google-drive:/, ""))}/view">${escapeHtml(id)}</a>`).join(" · ");
  return `<article id="meeting-${index}"><aside><strong>Pending source review</strong><p>${links}</p><p>The header timestamp is the app's date-storage placeholder, not evidence of start time. Use any separately recorded call-to-order time. Action completion and approval are historical source claims, not current status.</p>${p.notes ? `<p>${escapeHtml(p.notes)}</p>` : ""}</aside>${body}<p><a href="#index">Back to index</a></p></article>`;
});
const index = candidates.map((p, i: number) => `<li><a href="#meeting-${i}">${escapeHtml(String(p.meetingDate ?? ""))} — ${escapeHtml(String(p.meetingTitle ?? ""))}</a></li>`).join("");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PGAIR transposed meeting minutes</title><style>body{max-width:1050px;margin:40px auto;padding:0 24px;font:16px/1.55 system-ui,sans-serif;color:#182333}h1,h2,h3{line-height:1.2}a{color:#185b89}article{border-top:3px solid #506d83;margin-top:60px;padding-top:24px}aside{padding:18px;background:#fff4d8;border-left:4px solid #b88817}table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px}th,td{border:1px solid #cbd2d9;padding:8px;vertical-align:top;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}.meta,.muted{color:#52606d}.motion{border-left:3px solid #abbac8;padding-left:16px}@media print{article{break-before:page}aside{font-size:11px}}</style><main><h1 id="index">Transposed meeting minutes</h1><p>${candidates.length} review candidates rendered using Societyer's Standard minutes renderer. These are unapproved transpositions. See the accompanying fidelity report for data-model limitations and unresolved versions.</p><ol>${index}</ol>${articles.join("\n")}</main></html>`;
await writeFile(outputPath, html, { flag: "wx", mode: 0o600 });
console.log(`Rendered ${candidates.length} candidate meetings through the app's minutes renderer.`);
