// WorkflowDetail: intake-field domain types and normalization/validation helpers.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  ExternalLink,
  FileText,
  FormInput,
  History,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDateTime } from "../lib/format";

export const FIELD_LABELS = [
  "Legal First Name of Affiliate",
  "Legal Middle Name of Affiliate",
  "Legal Last Name of Affiliate",
  "Current Mailing Address",
  "Emergency Contact(Name and Ph)",
  "UNBC ID #",
  "Birthdate of Affiliate (MM/DD/YYYY)",
  "Personal email address",
  "Name of requesting Manager",
  "UNBC Department/Organization",
  "Length of Affiliate status(lf known)",
  "ManagerPhone",
  "Manager Email",
  "Authorizing Name (if different from Manager)",
  "Date signed",
  "Check Box0",
  "Check Box1",
];

export type IntakeFieldType = "text" | "email" | "phone" | "date" | "checkbox" | "textarea" | "person";

export type IntakeField = {
  key: string;
  label: string;
  type: IntakeFieldType;
  required?: boolean;
  defaultValue?: unknown;
  helpText?: string;
  categories?: string[];
  isHidden?: boolean;
};

export type TemplateToken = {
  label: string;
  value: string;
  group: string;
};

export function checkboxLabel(field: string) {
  if (field === "Check Box0") return "Previous UNBC ID - yes";
  if (field === "Check Box1") return "Previous UNBC ID - no";
  return field;
}

export function slugifyFieldKey(label: string) {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "field";
}

export function inferIntakeFieldType(label: string): IntakeFieldType {
  const norm = label.toLowerCase();
  if (/check\s*box|yes\/no|true\/false/.test(norm)) return "checkbox";
  if (/e-?mail/.test(norm)) return "email";
  if (/phone|tel|mobile|cell/.test(norm)) return "phone";
  if (/date|birth/.test(norm)) return "date";
  if (/address|note|description|comment/.test(norm)) return "textarea";
  return "text";
}

export function normalizeIntakeFields(raw: any, fallback?: any): IntakeField[] {
  const source = Array.isArray(raw) && raw.length > 0
    ? raw
    : Array.isArray(fallback) && fallback.length > 0
      ? fallback
      : [];
  const seen = new Set<string>();
  return source
    .map((entry: any): IntakeField | null => {
      if (typeof entry === "string") {
        const label = entry.trim();
        if (!label) return null;
        const key = uniqueFieldKey(slugifyFieldKey(label), seen);
        return {
          key,
          label,
          type: inferIntakeFieldType(label),
          required: false,
        };
      }
      if (!entry || typeof entry !== "object") return null;
      const label = String(entry.label ?? entry.name ?? entry.key ?? "").trim();
      if (!label) return null;
      const rawKey = String(entry.key ?? entry.name ?? slugifyFieldKey(label)).trim();
      const key = uniqueFieldKey(slugifyFieldKey(rawKey), seen);
      const type = ["text", "email", "phone", "date", "checkbox", "textarea", "person"].includes(entry.type)
        ? entry.type as IntakeFieldType
        : inferIntakeFieldType(label);
      return {
        key,
        label,
        type,
        required: Boolean(entry.required),
        defaultValue: entry.defaultValue,
        helpText: typeof entry.helpText === "string" ? entry.helpText : undefined,
        categories: Array.isArray(entry.categories) ? entry.categories.map(String) : undefined,
        isHidden: Boolean(entry.isHidden),
      };
    })
    .filter(Boolean) as IntakeField[];
}

export function uniqueFieldKey(base: string, seen: Set<string>) {
  let key = base || "field";
  let suffix = 2;
  while (seen.has(key)) key = `${base}_${suffix++}`;
  seen.add(key);
  return key;
}

export function configuredIntakeFields(workflow: any) {
  const intakeNode = Array.isArray(workflow?.nodePreview)
    ? workflow.nodePreview.find((node: any) => node?.type === "form")
    : null;
  const fallback =
    workflow?.config?.intakeFields ??
    workflow?.config?.pdfFields ??
    (workflow?.config?.sampleInput && typeof workflow.config.sampleInput === "object"
      ? Object.keys(workflow.config.sampleInput)
      : workflow?.config?.sampleAffiliate && typeof workflow.config.sampleAffiliate === "object"
        ? Object.keys(workflow.config.sampleAffiliate)
      : FIELD_LABELS);
  return normalizeIntakeFields(intakeNode?.config?.fields, fallback);
}

export function initialIntakeValues(fields: IntakeField[], sample: Record<string, any>) {
  const values: Record<string, any> = {};
  for (const field of fields) {
    const fallback = sample[field.key] ?? sample[field.label] ?? field.defaultValue;
    values[field.key] = field.type === "checkbox" ? Boolean(fallback) : fallback ?? "";
  }
  return values;
}

export function intakePayloadFromState(fields: IntakeField[], values: Record<string, any>) {
  const payload: Record<string, any> = {};
  for (const field of fields) {
    const value = field.type === "checkbox" ? Boolean(values[field.key]) : values[field.key] ?? "";
    payload[field.key] = value;
    // Preserve AcroForm label lookups and older mappings that used the label as the key.
    payload[field.label] = value;
  }
  return payload;
}

export function missingRequiredIntakeFields(fields: IntakeField[], values: Record<string, any>) {
  return fields
    .filter((field) => {
      if (!field.required) return false;
      const value = values[field.key];
      if (field.type === "person") {
        return !value || typeof value !== "object" || (!value.recordId && !value.name);
      }
      if (field.type === "checkbox") return !Boolean(value);
      return value == null || String(value).trim() === "";
    })
    .map((field) => field.label);
}
