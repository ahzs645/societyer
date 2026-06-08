// GrantPanels: dossier style constants and status-to-tone mappers.
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

export function grantStatusTone(status: unknown) {
  if (status === "Awarded" || status === "Active" || status === "Closed") return "success";
  if (status === "Declined") return "danger";
  if (status === "Submitted" || status === "Drafting") return "warn";
  return "info";
}

export function complianceTone(status: unknown) {
  const text = String(status ?? "").toLowerCase();
  if (/(ready|attached|present|saved|linked|waived|complete)/.test(text)) return "success";
  if (/(missing|not|needed|overdue)/.test(text)) return "danger";
  if (/(requested|review|scheduled|watch|conditional)/.test(text)) return "warn";
  return "info";
}

export function timelineTone(status: unknown, date: string) {
  const text = String(status ?? "").toLowerCase();
  if (/(submitted|complete|attached|ready|saved|done)/.test(text)) return "success";
  if (/(overdue|missing|not)/.test(text)) return "danger";
  const dueTime = new Date(date).getTime();
  if (Number.isFinite(dueTime) && dueTime < Date.now() && !/(conditional|expected)/.test(text)) return "danger";
  if (/(due|requested|conditional|expected|watch)/.test(text)) return "warn";
  return "info";
}

export function nextStepTone(status: unknown) {
  const text = String(status ?? "").toLowerCase();
  if (/(done|complete|ready)/.test(text)) return "success";
  if (/(need|missing|overdue)/.test(text)) return "danger";
  if (/(review|upcoming|scheduled)/.test(text)) return "warn";
  return "info";
}

export function priorityTone(priority: unknown) {
  const text = String(priority ?? "").toLowerCase();
  if (text === "high") return "danger";
  if (text === "medium") return "warn";
  return "info";
}

export const dossierSectionStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-panel)",
  padding: 12,
};

export const factBoxStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
  minWidth: 0,
};

export const nextStepStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};

export const workflowActionBarStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap" as const,
  marginTop: 10,
};

export const employeeLinkStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

export const detailPanelStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: "8px 10px",
};

export const detailSummaryStyle = {
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontWeight: 600,
};

export const documentListStyle = {
  margin: "8px 0 0",
  paddingLeft: 18,
  display: "grid",
  gap: 6,
};

export const documentListItemStyle = {
  color: "var(--text-secondary)",
  lineHeight: 1.35,
};

export const timelineItemStyle = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};

export const fundLineStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

export const flagChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  padding: "6px 8px",
  background: "var(--bg-base)",
};

export const contactRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-base)",
  padding: 10,
};
