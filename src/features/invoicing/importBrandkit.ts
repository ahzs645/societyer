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

export async function importBrandkitFile(file: File): Promise<InvoiceBrand> {
  if (file.size > MAX_ZIP_BYTES) throw new Error("Choose a Brandkit ZIP smaller than 50 MB.");
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    if (/\.zip$/i.test(file.name)) throw new Error("Choose a readable Brandkit ZIP.");
    if (file.size > MAX_JSON_BYTES) throw new Error("Choose a Brandkit JSON profile smaller than 2 MB.");
    return importInvoiceBrand(parseJson(await file.text(), "The Brandkit profile"));
  }

  const entries = await openZip(file);
  const findEntry = (filename: string) => {
    const matches = [...entries.values()].filter(entry => !entry.dir &&
      (entry.name === filename || entry.name.endsWith(`/${filename}`)) &&
      entry.name.split("/").every(part => part && part !== "." && part !== ".." && !part.includes("\\")));
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
  if (profile) return importInvoiceBrand(parseJson(await read(profile, MAX_JSON_BYTES), "The Brandkit profile"));

  const pack = findEntry("brandkit-pack.json");
  if (!pack) {
    const brand = findEntry("brand.json");
    if (!brand) throw new Error("The ZIP needs a Brandkit profile or a Brandkit pack.");
    return importInvoiceBrand(parseJson(await read(brand, MAX_JSON_BYTES), "brand.json"));
  }
  const manifest = parseJson(await read(pack, MAX_JSON_BYTES), "The Brandkit pack manifest");
  if (manifest?.format !== "brandkit-pack" || manifest.version !== 1) throw new Error("This Brandkit pack version is not supported.");
  const logoPath = manifest.menuLogo;
  if (typeof logoPath !== "string" || !/^(?:[\w.-]+\/)*[\w.-]+\.svg$/i.test(logoPath) ||
      logoPath.split("/").some(part => part === "." || part === "..")) throw new Error("The Brandkit pack needs a vector menu logo.");

  const prefix = pack.name.slice(0, -"brandkit-pack.json".length);
  const brand = entries.get(prefix + "brand.json");
  const logo = entries.get(prefix + logoPath);
  if (!brand || !logo) throw new Error("The Brandkit pack is missing brand.json or its vector logo.");
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
