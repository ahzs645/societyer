// PDF + workflow-document helpers extracted from api-gateway.ts: pdf-lib field
// inspection/fill, template path/key resolution, and workflow secret/file helpers.

import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Request } from "express";
import { PDFDocument } from "pdf-lib";
import {
  buildPdfTableImportBundle,
  normalizePdfTableStructures,
} from "../../convex/lib/pdfTableNormalization";
import { httpError } from "./shared";

async function fillUnbcAffiliatePdf(templatePath: string, affiliate: Record<string, unknown>) {
  return await fillGenericPdf(templatePath, affiliate);
}

async function fillGenericPdf(templatePath: string, values: Record<string, unknown>) {
  const pdfDoc = await PDFDocument.load(await readFile(templatePath));
  const form = pdfDoc.getForm();
  for (const [fieldName, rawValue] of Object.entries(values)) {
    if (/signature/i.test(fieldName)) continue;
    const value = rawValue == null ? "" : String(rawValue);
    try {
      if (typeof rawValue === "boolean") {
        const checkbox = form.getCheckBox(fieldName);
        if (rawValue) checkbox.check();
        else checkbox.uncheck();
        continue;
      }
      form.getTextField(fieldName).setText(value);
    } catch {
      // The template has a few non-text widgets. Unknown fields are ignored so
      // the n8n payload can be broader than this specific PDF revision.
    }
  }
  form.updateFieldAppearances();
  return await pdfDoc.save();
}

async function inspectPdfTemplate(pdf: Buffer | Uint8Array, metadata: Record<string, unknown> = {}) {
  assertPdfBytes(Buffer.from(pdf), String(metadata.fileName ?? "PDF"));
  const pdfDoc = await PDFDocument.load(pdf);
  const form = pdfDoc.getForm();
  const fields = form.getFields().map((field: any) => inspectPdfField(field));
  return {
    ...metadata,
    pageCount: pdfDoc.getPageCount(),
    fieldCount: fields.length,
    fields,
    tables: detectRepeatedPdfFieldTables(fields),
    detectedAtISO: new Date().toISOString(),
  };
}

function inspectPdfField(field: any) {
  const widgets = field.acroField?.getWidgets?.() ?? [];
  const rects = widgets
    .map((widget: any) => widget.getRectangle?.())
    .filter(Boolean)
    .map((rect: any) => ({
      x: roundNumber(rect.x),
      y: roundNumber(rect.y),
      width: roundNumber(rect.width),
      height: roundNumber(rect.height),
    }));
  return {
    name: field.getName(),
    type: pdfFieldType(field),
    rects,
    value: pdfFieldValue(field),
  };
}

function pdfFieldType(field: any) {
  const ctor = field?.constructor?.name;
  if (ctor === "PDFTextField") return "text";
  if (ctor === "PDFCheckBox") return "checkbox";
  if (ctor === "PDFSignature") return "signature";
  if (ctor === "PDFDropdown") return "dropdown";
  if (ctor === "PDFOptionList") return "optionList";
  if (ctor === "PDFRadioGroup") return "radio";
  return ctor ?? "unknown";
}

function pdfFieldValue(field: any) {
  const ctor = field?.constructor?.name;
  try {
    if (ctor === "PDFTextField") return cleanPdfFieldValue(field.getText?.());
    if (ctor === "PDFCheckBox") return Boolean(field.isChecked?.());
    if (ctor === "PDFDropdown" || ctor === "PDFOptionList") return field.getSelected?.();
    if (ctor === "PDFRadioGroup") return cleanPdfFieldValue(field.getSelected?.());
  } catch {
    return undefined;
  }
  return undefined;
}

function cleanPdfFieldValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function detectRepeatedPdfFieldTables(fields: any[]) {
  const groups = new Map<string, Array<{ field: any; row: number }>>();
  for (const field of fields) {
    const parsed = parseRepeatedFieldName(field.name);
    if (!parsed) continue;
    const existing = groups.get(parsed.base) ?? [];
    existing.push({ field, row: parsed.row });
    groups.set(parsed.base, existing);
  }
  for (const field of fields) {
    if (parseRepeatedFieldName(field.name)) continue;
    const existing = groups.get(field.name);
    if (existing) existing.push({ field, row: 1 });
  }
  return [...groups.entries()]
    .map(([base, rows]) => {
      const uniqueRows = Array.from(new Set(rows.map((row) => row.row))).sort((a, b) => a - b);
      if (uniqueRows.length < 2) return null;
      return {
        kind: "repeatedField",
        label: base,
        confidence: "medium",
        rowCount: uniqueRows.length,
        columns: [
          {
            key: slugifyPdfKey(base),
            label: base,
            fieldNames: rows.sort((a, b) => a.row - b.row).map((row) => row.field.name),
          },
        ],
        bounds: boundsForRects(rows.map((row) => row.field.rects?.[0]).filter(Boolean)),
        notes: "Detected from repeated AcroForm field names and aligned widget positions.",
      };
    })
    .filter(Boolean);
}

function detectLayoutTextTables(text: string) {
  const lines = String(text ?? "").split(/\r?\n/);
  const candidates: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) continue;
    const columns = line
      .split(/\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (columns.length < 3) continue;
    const headerish = columns.some((column) => /\b(room|number|date|deposit|issued|amount|fund|account|org)\b/i.test(column));
    if (!headerish) continue;
    candidates.push({
      kind: "layoutText",
      page: 1,
      lineNumber: i + 1,
      columns,
      confidence: columns.length >= 4 ? "medium" : "low",
    });
  }
  return candidates;
}

function parseRepeatedFieldName(name: string) {
  const match = String(name).match(/^(.*?)(?:\s+(\d+))$/);
  if (!match) return null;
  const base = match[1].trim();
  const row = Number(match[2]);
  if (!base || !Number.isFinite(row) || row < 2) return null;
  return { base, row };
}

function boundsForRects(rects: any[]) {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: roundNumber(minX),
    y: roundNumber(minY),
    width: roundNumber(maxX - minX),
    height: roundNumber(maxY - minY),
  };
}

function roundNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function slugifyPdfKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

async function readPdfFile(sourcePath: string, fileName: string) {
  const pdf = await readFile(sourcePath).catch(() => null);
  if (!pdf) throw httpError(404, "pdf_source_missing", `${fileName} was not found.`);
  assertPdfBytes(pdf, fileName);
  return pdf;
}

function assertPdfBytes(pdf: Buffer, fileName: string) {
  if (pdf.byteLength === 0 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw httpError(400, "invalid_pdf_template", `${fileName} is not a PDF file.`);
  }
}

function normalizePdfFieldPayload(value: unknown) {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { ...input };
}

function sanitizeTemplateKey(value: string) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) throw httpError(400, "invalid_pdf_template_key", "PDF template key is required.");
  return key;
}

function workflowPdfTemplatePath(templateKey: string) {
  const normalized = sanitizeTemplateKey(templateKey);
  if (normalized === "unbc_affiliate_id" || normalized === "unbc_affiliate_id_fill") {
    return process.env.UNBC_AFFILIATE_TEMPLATE_PATH;
  }
  if (
    normalized === "unbc_key_access_request" ||
    normalized === "unbc_key_request" ||
    normalized === "key_request"
  ) {
    return process.env.UNBC_KEY_REQUEST_TEMPLATE_PATH ?? process.env.KEY_REQUEST_TEMPLATE_PATH;
  }
  const envName = `SOCIETYER_PDF_TEMPLATE_${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_PATH`;
  return process.env[envName];
}

function workflowPdfFileNameForTemplate(templateKey: string, values: Record<string, unknown>) {
  const normalized = sanitizeTemplateKey(templateKey);
  if (normalized === "unbc_key_access_request" || normalized === "unbc_key_request" || normalized === "key_request") {
    const first = String(values["First Name"] ?? values.firstName ?? "Requester").trim() || "Requester";
    const last = String(values["Last Name"] ?? values.lastName ?? "Key Request").trim() || "Key Request";
    return sanitizeFileName(`UNBC Key Access Request - ${last}, ${first}.pdf`);
  }
  if (normalized === "unbc_affiliate_id") return workflowPdfFileName(values);
  return sanitizeFileName(`${normalized.replace(/_/g, " ")} - ${new Date().toISOString().slice(0, 10)}.pdf`);
}

function normalizeAffiliatePayload(value: unknown) {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    "Legal First Name of Affiliate": input["Legal First Name of Affiliate"] ?? input.firstName ?? "",
    "Legal Middle Name of Affiliate": input["Legal Middle Name of Affiliate"] ?? input.middleName ?? "",
    "Legal Last Name of Affiliate": input["Legal Last Name of Affiliate"] ?? input.lastName ?? "",
    "Current Mailing Address": input["Current Mailing Address"] ?? input.mailingAddress ?? "",
    "Emergency Contact(Name and Ph)": input["Emergency Contact(Name and Ph)"] ?? input.emergencyContact ?? "",
    "UNBC ID #": input["UNBC ID #"] ?? input.unbcId ?? "",
    "Birthdate of Affiliate (MM/DD/YYYY)": input["Birthdate of Affiliate (MM/DD/YYYY)"] ?? input.birthdate ?? "",
    "Personal email address": input["Personal email address"] ?? input.email ?? "",
    "Name of requesting Manager": input["Name of requesting Manager"] ?? input.managerName ?? "",
    "UNBC Department/Organization": input["UNBC Department/Organization"] ?? input.department ?? "",
    "Length of Affiliate status(lf known)": input["Length of Affiliate status(lf known)"] ?? input.affiliateStatusLength ?? "",
    ManagerPhone: input.ManagerPhone ?? input.managerPhone ?? "",
    "Manager Email": input["Manager Email"] ?? input.managerEmail ?? "",
    "Authorizing Name (if different from Manager)": input["Authorizing Name (if different from Manager)"] ?? input.authorizingName ?? "",
    "Date signed": input["Date signed"] ?? input.dateSigned ?? new Date().toISOString().slice(0, 10),
    "Check Box0": Boolean(input["Check Box0"] ?? input.previousUnbcIdYes),
    "Check Box1": Boolean(input["Check Box1"] ?? input.previousUnbcIdNo),
  };
}

function workflowPdfFileName(affiliate: Record<string, unknown>) {
  const first = String(affiliate["Legal First Name of Affiliate"] ?? "Affiliate").trim() || "Affiliate";
  const last = String(affiliate["Legal Last Name of Affiliate"] ?? "Request").trim() || "Request";
  return sanitizeFileName(`UNBC Affiliate ID Request - ${last}, ${first}.pdf`);
}

function requireWorkflowSecret(req: Request) {
  const expected = process.env.SOCIETYER_WORKFLOW_CALLBACK_SECRET;
  if (!expected) {
    throw httpError(500, "workflow_secret_missing", "SOCIETYER_WORKFLOW_CALLBACK_SECRET is not configured.");
  }
  const provided =
    req.get("x-societyer-workflow-secret") ??
    req.get("x-societyer-callback-secret") ??
    bearerToken(req) ??
    (typeof req.body?.callbackSecret === "string" ? req.body.callbackSecret : undefined);
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw httpError(401, "invalid_workflow_secret", "Workflow callback secret is invalid.");
  }
}

function bearerToken(req: Request) {
  const header = req.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return undefined;
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decodeBase64Pdf(value: string) {
  const pdf = Buffer.from(value, "base64");
  if (pdf.byteLength === 0 || pdf.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw httpError(400, "invalid_pdf_payload", "generatedPdf.base64 must be a PDF file.");
  }
  return pdf;
}

function generatedWorkflowDocumentDir() {
  return path.resolve(process.cwd(), "data", "workflow-generated-documents");
}

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.endsWith(".pdf") ? cleaned : `${cleaned || "workflow-generated-document"}.pdf`;
}

function sanitizeStorageKey(value: string) {
  if (!/^[a-zA-Z0-9._, -]+$/.test(value)) {
    throw httpError(400, "invalid_document_key", "Generated document key is invalid.");
  }
  return value;
}

function downloadFileNameFromStorageKey(value: string) {
  return sanitizeFileName(value.replace(/^[0-9a-f-]+-/i, ""));
}

export {
  fillUnbcAffiliatePdf,
  fillGenericPdf,
  inspectPdfTemplate,
  inspectPdfField,
  pdfFieldType,
  pdfFieldValue,
  cleanPdfFieldValue,
  detectRepeatedPdfFieldTables,
  detectLayoutTextTables,
  parseRepeatedFieldName,
  boundsForRects,
  roundNumber,
  slugifyPdfKey,
  readPdfFile,
  assertPdfBytes,
  normalizePdfFieldPayload,
  sanitizeTemplateKey,
  workflowPdfTemplatePath,
  workflowPdfFileNameForTemplate,
  normalizeAffiliatePayload,
  workflowPdfFileName,
  requireWorkflowSecret,
  bearerToken,
  timingSafeEqual,
  decodeBase64Pdf,
  generatedWorkflowDocumentDir,
  sanitizeFileName,
  sanitizeStorageKey,
  downloadFileNameFromStorageKey,
};
