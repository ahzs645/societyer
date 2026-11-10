import { BRANDKIT_PROFILE_SCHEMA, brandkitPackLogos } from "../../../shared/brandkitLogo";
import { importInvoiceBrand, type InvoiceBrand } from "../../../shared/invoiceBranding";
import { crc32, openZip, readZipEntryBytes, type ZipReaderEntry } from "../../lib/zipStream";

const MAX_JSON_BYTES = 2_000_000;
const MAX_ZIP_BYTES = 50_000_000;
const MAX_LOGO_BYTES = 200_000;

function parseJson(text: string, name: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} does not contain valid JSON.`);
  }
}

export type BrandkitVersion = { path: string; label: string };
/** A file import, plus the packs a multi-version ZIP offers. `versions` lists
 * newest first and is empty for JSON profiles and single-pack ZIPs. */
export type BrandkitImport = { brand: InvoiceBrand; versions: BrandkitVersion[]; selected?: string };

const PACK_FILE = "brandkit-pack.json";
type PackManifest = { format?: unknown; version?: unknown; name?: unknown; brandVersion?: unknown; menuLogo?: unknown };
const versionParts = (value: string) => value.split(/[^0-9]+/).filter(Boolean).map(Number);
function compareVersions(left: string, right: string) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export async function importBrandkitFile(file: File): Promise<InvoiceBrand> {
  return (await readBrandkitFile(file)).brand;
}

/** Reads a Brandkit JSON profile or ZIP. When a ZIP carries several packs
 * (a current release plus archived versions), the newest brand version is
 * imported unless `packPath` names another listed pack. */
export async function readBrandkitFile(file: File, packPath?: string): Promise<BrandkitImport> {
  if (file.size > MAX_ZIP_BYTES) throw new Error("Choose a Brandkit ZIP smaller than 50 MB.");
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    if (/\.zip$/i.test(file.name)) throw new Error("Choose a readable Brandkit ZIP.");
    if (file.size > MAX_JSON_BYTES) throw new Error("Choose a Brandkit JSON profile smaller than 2 MB.");
    return { brand: importInvoiceBrand(parseJson(await file.text(), "The Brandkit profile")), versions: [] };
  }

  const entries = await openZip(file);
  const safe = (entry: ZipReaderEntry) => !entry.dir &&
    entry.name.split("/").every(part => part && part !== "." && part !== ".." && !part.includes("\\"));
  const matching = (filename: string) => [...entries.values()].filter(entry => safe(entry) &&
    (entry.name === filename || entry.name.endsWith(`/${filename}`)));
  const findEntry = (filename: string) => {
    const matches = matching(filename);
    if (matches.length > 1) throw new Error(`The ZIP contains more than one ${filename}.`);
    return matches[0];
  };
  const read = async (entry: ZipReaderEntry, limit: number) => {
    if (entry.flags & 1) throw new Error("Choose a Brandkit ZIP without password protection.");
    if (entry.size > limit) throw new Error("A Brandkit file inside the ZIP is too large.");
    const bytes = await readZipEntryBytes(file, entry);
    if (crc32(bytes) !== entry.crc) throw new Error("A Brandkit file inside the ZIP is damaged.");
    return new TextDecoder().decode(bytes);
  };
  const profile = findEntry("consumer-profile.json");
  if (profile) return { brand: importInvoiceBrand(parseJson(await read(profile, MAX_JSON_BYTES), "The Brandkit profile")), versions: [] };

  const packEntries = matching(PACK_FILE);
  if (!packEntries.length) {
    const brand = findEntry("brand.json");
    if (!brand) throw new Error("The ZIP needs a Brandkit profile or a Brandkit pack.");
    return { brand: importInvoiceBrand(parseJson(await read(brand, MAX_JSON_BYTES), "brand.json")), versions: [] };
  }
  const packs: { entry: ZipReaderEntry; manifest: PackManifest }[] = [];
  for (const entry of packEntries) {
    const manifest: PackManifest | null = parseJson(await read(entry, MAX_JSON_BYTES), "The Brandkit pack manifest");
    if (manifest?.format === "brandkit-pack" && manifest.version === 1) packs.push({ entry, manifest });
  }
  if (!packs.length) throw new Error("This Brandkit pack version is not supported.");
  const depth = (entry: ZipReaderEntry) => entry.name.split("/").length;
  const brandVersion = (manifest: PackManifest) => typeof manifest.brandVersion === "string" ? manifest.brandVersion : "";
  // Newest brand version first; the pack nearest the ZIP root wins a tie.
  packs.sort((left, right) => compareVersions(brandVersion(right.manifest), brandVersion(left.manifest)) ||
    depth(left.entry) - depth(right.entry) || left.entry.name.localeCompare(right.entry.name));
  const chosen = packPath === undefined ? packs[0] : packs.find(pack => pack.entry.name === packPath);
  if (!chosen) throw new Error("That Brandkit version is no longer in the ZIP.");
  const versions = packs.length > 1 ? packs.map(({ entry, manifest }, index) => {
    const name = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : "Brandkit";
    const version = brandVersion(manifest);
    const folder = entry.name.slice(0, -PACK_FILE.length).replace(/\/$/, "");
    return { path: entry.name,
      label: `${name}${version ? ` ${version}` : ""}${index === 0 ? " (latest)" : ""}${folder ? ` · ${folder}` : ""}` };
  }) : [];
  return { brand: await readPack(chosen.entry, chosen.manifest), versions, selected: chosen.entry.name };

  async function readPack(pack: ZipReaderEntry, manifest: PackManifest) {
    const logoPath = manifest.menuLogo;
    if (typeof logoPath !== "string" || !/^(?:[\w.-]+\/)*[\w.-]+\.svg$/i.test(logoPath) ||
        logoPath.split("/").some(part => part === "." || part === "..")) throw new Error("The Brandkit pack needs a vector menu logo.");

    const prefix = pack.name.slice(0, -PACK_FILE.length);
    // Archived packs name their source after the version, e.g. brand-1.0.json.
    const version = brandVersion(manifest);
    const brand = entries.get(prefix + "brand.json") ??
      (/^[\w.-]+$/.test(version) ? entries.get(`${prefix}brand-${version}.json`) : undefined);
    const logo = entries.get(prefix + logoPath);
    if (!brand || !logo || !safe(brand) || !safe(logo)) throw new Error("The Brandkit pack is missing brand.json or its vector logo.");
    const data = parseJson(await read(brand, MAX_JSON_BYTES), "brand.json");
    if (data?.schema !== "brandkit/1") throw new Error("This Brandkit source version is not supported.");
    const colours = Object.fromEntries(["ink", "paper", "primary", "muted", "light", "reverse", "line", "rule"].map(role => {
      const value = data.roles?.[role];
      return [role, data.colours?.[value] ?? value];
    }));
    return importInvoiceBrand({
      schema: BRANDKIT_PROFILE_SCHEMA,
      id: data.id,
      name: data.name,
      version: data.version,
      colours,
      typography: { body: data.typography?.body, heading: data.typography?.headlines, label: data.typography?.labels },
      provenance: { source: data.source, status: data.status },
      logos: brandkitPackLogos(await read(logo, MAX_LOGO_BYTES), colours.primary),
    });
  }
}
