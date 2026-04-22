import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  STARTER_POLICY_TEMPLATES,
  starterTemplateHtml,
  starterTemplateRequiredFields,
} from "../convex/starterPolicyTemplates";
import {
  compareTemplateText,
  htmlToPlainText,
  renderStarterTemplateSampleHtml,
  starterSampleData,
} from "./starter-template-rendering";

const sourceRoot = "/Users/ahmadjalil/Downloads/New Folder With Items";
const nestedSourceRoot = join(sourceRoot, "New Folder With Items 3");
const outputDir = "convex/data/starterPolicyTemplates";

function listPdfFiles(dir: string): string[] {
  const rows: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...listPdfFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) rows.push(path);
  }
  return rows;
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pdfText(path: string) {
  return execFileSync("pdftotext", ["-layout", path, "-"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function pageCount(path: string) {
  const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  const match = info.match(/^Pages:\s*(\d+)/m);
  return match ? Number(match[1]) : undefined;
}

function normalizedAscii(value: string) {
  return value
    .replace(/\u2018|\u2019|\u201A|\u201B/g, "'")
    .replace(/\u201C|\u201D|\u201E|\u201F/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function primarySourceFile(sourceFile: string, allFiles: string[]) {
  const nestedPath = join(nestedSourceRoot, sourceFile);
  if (existsSync(nestedPath)) return nestedPath;
  const rootPath = join(sourceRoot, sourceFile);
  if (existsSync(rootPath)) return rootPath;
  const byBaseName = allFiles.find((file) => basename(file) === sourceFile);
  if (byBaseName) return byBaseName;
  throw new Error(`Missing source file ${sourceFile}`);
}

function main() {
  mkdirSync(outputDir, { recursive: true });
  const allFiles = listPdfFiles(sourceRoot);
  const byHash = new Map<string, string[]>();

  for (const file of allFiles) {
    const hash = sha256(file);
    byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
  }

  for (const template of STARTER_POLICY_TEMPLATES) {
    const primary = primarySourceFile(template.sourceFile, allFiles);
    const hash = sha256(primary);
    if (hash !== template.sourceSha256) {
      throw new Error(`${template.key} hash mismatch: ${hash} !== ${template.sourceSha256}`);
    }
    const sourceText = normalizedAscii(pdfText(primary));
    const html = starterTemplateHtml(template);
    const sampleData = starterSampleData(template);
    const renderedSampleHtml = renderStarterTemplateSampleHtml(template, html, sampleData);
    const renderedSampleText = htmlToPlainText(renderedSampleHtml);

    const duplicateFiles = (byHash.get(hash) ?? [])
      .map((file) => ({
        fileName: basename(file),
        relativePath: relative(sourceRoot, file),
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const artifact = {
      key: template.key,
      name: template.name,
      policyNumber: template.policyNumber,
      templateType: template.templateType ?? "policy",
      documentTag: template.documentTag ?? "other",
      source: {
        primaryFileName: basename(primary),
        primaryRelativePath: relative(sourceRoot, primary),
        sourceRootName: basename(sourceRoot),
        sha256: hash,
        pageCount: pageCount(primary),
        duplicateFiles,
      },
      extraction: {
        tool: "pdftotext -layout",
        textEncoding: "utf8-normalized-ascii",
        text: sourceText,
      },
      sampleData,
      renderedSample: {
        html: renderedSampleHtml,
        text: renderedSampleText,
      },
      comparison: {
        comparedAgainst: "source PDF extraction",
        comparedArtifact: "renderedSample.text",
        ...compareTemplateText(sourceText, renderedSampleText),
      },
      remadeTemplate: {
        summary: template.summary,
        signatureRequired: template.signatureRequired ?? true,
        includeBoardAcceptance: template.includeBoardAcceptance !== false,
        requiredDataFields: starterTemplateRequiredFields(template),
        optionalDataFields: template.optionalDataFields ?? [],
        reviewDataFields: template.reviewDataFields ?? [
          "Bylaws",
          "SigningAuthorities",
          "Jurisdiction",
          "CharityStatus",
        ],
        sections: template.sections,
        html,
      },
    };

    writeFileSync(join(outputDir, `${template.key}.json`), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }

  console.log(`Wrote ${STARTER_POLICY_TEMPLATES.length} starter template JSON files to ${outputDir}`);
}

main();
