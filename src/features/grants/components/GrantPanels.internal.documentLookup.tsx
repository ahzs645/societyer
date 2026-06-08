// GrantPanels: grant-document matching, evidence grouping, and timeline aggregation.
import { type ReactNode, useEffect, useState } from "react";
import { ExternalLink, ListChecks, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Field, InspectorNote } from "../../../components/ui";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { StructuredAddressFields } from "../../../components/StructuredAddressFields";
import { formatDate, money } from "../../../lib/format";
import {
  asAnswerLibrary,
  asComplianceFlags,
  asContacts,
  asNextSteps,
  asRequirements,
  asTimelineEvents,
  asUseOfFunds,
  cleanStringList,
  detectRequirementTemplateKey,
  GRANT_REQUIREMENT_TEMPLATES,
  type GrantRequirement,
  type GrantRequirementStatus,
  mergeTemplateRequirements,
  optionalString,
  REQUIREMENT_STATUSES,
  requirementStatusTone,
  requirementSummary,
  requirementTemplateCoverage,
  type RequirementTemplateKey,
} from "../lib/grantDrafts";

export function findKeyFactNumber(value: unknown, pattern: RegExp) {
  for (const fact of cleanStringList(value)) {
    const match = fact.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

export function grantPacketKey(grant: any) {
  const title = String(grant.title ?? "").toLowerCase();
  if (title.includes("canada summer jobs")) return "canada summer jobs";
  if (title.includes("bc community gaming") || title.includes("gaming grant")) return "bc gaming grant";
  return "";
}

export function grantRelatedDocuments(grant: any, documents: any[]) {
  const linkedIds = new Set(
    [
      ...asRequirements(grant.requirements).map((requirement) => requirement.documentId),
      ...cleanStringList(grant.sourceDocumentIds),
    ]
      .filter(Boolean)
      .map(String),
  );
  const packetKey = grantPacketKey(grant);
  return documents.filter((document) => {
    if (linkedIds.has(String(document._id))) return true;
    if (!packetKey) return false;
    return evidenceDocumentText(document).includes(packetKey);
  });
}

export const EVIDENCE_GROUPS = [
  {
    label: "Application / confirmation",
    patterns: [/application|confirmation|summary|online version|main application|review purposes/i],
  },
  {
    label: "Bylaws and registry evidence",
    patterns: [/bylaws|constitution|registry|society|annual report|certified/i],
  },
  {
    label: "AGM / board evidence",
    patterns: [/annual general meeting|agm|directors|office|officer|authority to act|primary officer/i],
  },
  {
    label: "Financials and budgets",
    patterns: [/budget|financial|fin312|statement|screenshot|revenue|expenses|balance|2024-2025|simplified_program_financials/i],
  },
  {
    label: "Program narrative",
    patterns: [/program information|program|narrative|job details/i],
  },
  {
    label: "Government guides / conditions",
    patterns: [/guide|conditions|cond|checklist|faq|tutorial|canada\.ca|common hosted/i],
  },
  {
    label: "Follow-up documents",
    patterns: [/follow.?up|direct deposit|email/i],
  },
];

export function groupEvidenceDocuments(documents: any[]) {
  const groups = EVIDENCE_GROUPS.map((group) => ({ label: group.label, documents: [] as any[] }));
  const other = { label: "Other packet files", documents: [] as any[] };

  for (const document of documents) {
    const text = evidenceDocumentText(document);
    const index = EVIDENCE_GROUPS.findIndex((group) =>
      group.patterns.some((pattern) => pattern.test(text)),
    );
    if (index >= 0) groups[index].documents.push(document);
    else other.documents.push(document);
  }

  return [...groups, other];
}

export function evidenceDocumentText(document: any) {
  return [
    document.title,
    document.fileName,
    document.category,
    ...(Array.isArray(document.tags) ? document.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function cleanDocumentTitle(document: any) {
  return String(document.title ?? document.fileName ?? "Document")
    .replace(/^Grant packet — /, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGrantTimeline(grant: any, reports: any[]) {
  const grantId = String(grant.id ?? grant._id ?? "");
  const items: { date: string; label: string; status?: string; notes?: string }[] = [];
  const add = (date: unknown, label: string, status?: string, notes?: string) => {
    const text = optionalString(date);
    if (!text) return;
    items.push({ date: text, label, status, notes });
  };

  add(grant.applicationDueDate, "Application due", "Due");
  add(grant.submittedAtISO, "Application submitted", "Submitted", grant.confirmationCode ? `Confirmation ${grant.confirmationCode}` : undefined);
  add(grant.decisionAtISO, "Decision expected / recorded", "Expected");
  add(grant.startDate, "Project start", "Scheduled");
  add(grant.endDate, "Project end", "Scheduled");
  add(grant.nextReportDueAtISO, "Next report due", "Due");

  for (const requirement of asRequirements(grant.requirements)) {
    add(requirement.dueDate, requirement.label, requirement.status, requirement.notes);
  }
  for (const event of asTimelineEvents(grant.timelineEvents)) {
    add(event.date, event.label, event.status, event.notes);
  }
  for (const report of reports.filter((report) => String(report.grantId) === grantId)) {
    add(report.dueAtISO, report.title, report.status, report.notes);
    add(report.submittedAtISO, `${report.title} submitted`, "Submitted");
  }

  const deduped = new Map<string, { date: string; label: string; status?: string; notes?: string }>();
  for (const item of items) {
    deduped.set(`${item.date}-${item.label}`, item);
  }
  return Array.from(deduped.values()).sort((a, b) => a.date.localeCompare(b.date));
}
