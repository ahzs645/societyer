/**
 * Browser stand-in for `iconv-lite`, aliased in vite.config.ts. The only
 * browser consumer is the Outlook .msg reader used by AI intake
 * (@kenjiuno/msgreader), which calls `decode(bytes, codepage)` and
 * `encode(text, codepage)`. The real package needs Node's Buffer (via
 * safer-buffer), which browsers and web workers do not have; TextDecoder
 * covers the code pages .msg files use (UTF-16LE and Windows code pages).
 */

function labelFor(encoding: string): string {
  const value = String(encoding ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (["utf16le", "utf-16le", "ucs2", "ucs-2", "utf16", "utf-16"].includes(value)) return "utf-16le";
  if (["utf8", "utf-8"].includes(value)) return "utf-8";
  if (["latin1", "binary", "iso88591", "iso-8859-1"].includes(value)) return "iso-8859-1";
  const codePage = /^(?:cp|windows-?|win)(\d{3,5})$/.exec(value)?.[1];
  if (codePage) {
    if (/^125\d$/.test(codePage) || codePage === "874") return `windows-${codePage}`;
    if (codePage === "65001") return "utf-8";
    if (codePage === "932") return "shift_jis";
    if (codePage === "936") return "gbk";
    if (codePage === "949") return "euc-kr";
    if (codePage === "950") return "big5";
    if (codePage === "866") return "ibm866";
    if (codePage === "20127") return "us-ascii";
    if (codePage === "28591") return "iso-8859-1";
  }
  return value || "utf-8";
}

export function decode(bytes: ArrayLike<number> | ArrayBuffer | Uint8Array, encoding: string): string {
  const view = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes as ArrayLike<number>);
  try {
    return new TextDecoder(labelFor(encoding)).decode(view);
  } catch {
    return new TextDecoder("windows-1252").decode(view);
  }
}

export function encode(text: string, encoding: string): Uint8Array {
  const label = labelFor(encoding);
  if (label === "utf-8") return new TextEncoder().encode(text);
  if (label === "utf-16le") {
    const out = new Uint8Array(text.length * 2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      out[index * 2] = code & 0xff;
      out[index * 2 + 1] = code >> 8;
    }
    return out;
  }
  // Single-byte fallback: Latin-1 range kept, anything else becomes "?".
  return Uint8Array.from(text, (char) => (char.charCodeAt(0) < 256 ? char.charCodeAt(0) : 63));
}

export function encodingExists(encoding: string): boolean {
  try {
    new TextDecoder(labelFor(encoding));
    return true;
  } catch {
    return false;
  }
}

export default { decode, encode, encodingExists };
