import { query } from "./_generated/server";
import { v } from "convex/values";

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const [documents, materials] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
      ctx.db
        .query("meetingMaterials")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect(),
    ]);

    const meetingIds = Array.from(new Set(materials.map((row) => String(row.meetingId))));
    const meetings = await Promise.all(meetingIds.map((id) => ctx.db.get(id as any)));
    const meetingById = new Map(meetings.filter(Boolean).map((meeting: any) => [String(meeting._id), meeting]));
    const documentById = new Map(documents.map((document) => [String(document._id), document]));

    const referenceDocuments = documents
      .filter((document) => isLibraryDocument(document, materials))
      .filter((document) => !isInternalDocumentRecord(document))
      .sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));

    const meetingPackets = meetingIds
      .map((meetingId) => {
        const meeting = meetingById.get(meetingId);
        const packetMaterials = materials
          .filter((material) => String(material.meetingId) === meetingId)
          .map((material) => ({
            ...material,
            document: documentById.get(String(material.documentId)) ?? null,
          }))
          .filter((row) => row.document)
          .sort((a, b) => a.order - b.order);
        return {
          meeting,
          materials: packetMaterials,
          requiredCount: packetMaterials.filter((row) => row.requiredForMeeting).length,
        };
      })
      .filter((packet) => packet.meeting)
      .sort((a, b) => String(b.meeting.scheduledAt).localeCompare(String(a.meeting.scheduledAt)));

    const sections = groupBySection(referenceDocuments);
    return {
      referenceDocuments,
      meetingPackets,
      sections,
      counts: {
        referenceDocuments: referenceDocuments.length,
        meetingPackets: meetingPackets.length,
        meetingMaterials: materials.length,
      },
    };
  },
});

function isLibraryDocument(document: any, materials: any[]) {
  const tags = Array.isArray(document.tags) ? document.tags.map(String) : [];
  if (document.librarySection) return true;
  if (document.category === "Policy" || document.category === "Bylaws" || document.category === "Constitution") return true;
  if (tags.includes("library") || tags.includes("board-handbook") || tags.includes("reference")) return true;
  return materials.some((material) => String(material.documentId) === String(document._id));
}

function groupBySection(documents: any[]) {
  const groups = new Map<string, any[]>();
  for (const document of documents) {
    const section = document.librarySection ?? defaultSection(document);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section)!.push(document);
  }
  return Array.from(groups, ([section, docs]) => ({ section, documents: docs }));
}

function defaultSection(document: any) {
  if (document.category === "Bylaws" || document.category === "Constitution") return "governance";
  if (document.category === "Policy") return "policy";
  if (document.category === "FinancialStatement") return "finance";
  if (document.meetingId) return "meeting_material";
  return "reference";
}

function isInternalDocumentRecord(doc: any) {
  const tags = Array.isArray(doc.tags) ? doc.tags : [];
  return (
    tags.includes("import-session") ||
    tags.includes("org-history") ||
    doc.category === "Import Session" ||
    doc.category === "Import Candidate" ||
    doc.category === "Org History Source" ||
    doc.category === "Org History Item"
  );
}
