/**
 * Schema-driven traversal for the workspace transfer.
 *
 * Every typed reference is found by walking the composed `convex/schema.ts`
 * validators at runtime (objects, arrays, unions, optionals and records), so a
 * new `v.id()` anywhere in the schema is picked up without a hand-kept list.
 * The same walker rewrites rows (pass 1 and pass 2) and checks their shape, so
 * the plan, the destination writes and the verification can't disagree.
 */
import type { ValidatorJSON } from "convex/values";

export type FieldJSON = { fieldType: ValidatorJSON; optional: boolean };
export type TableValidators = Map<string, ValidatorJSON>;

/** One typed reference position in a table's document validator. */
export type IdPath = { path: string; target: string; required: boolean };

type SchemaLike = { tables: Record<string, unknown> };

function isValidatorJson(value: unknown): value is ValidatorJSON {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** The document validator JSON of every table. `Validator.json` is absent from Convex's declarations. */
export function tableValidators(schema: SchemaLike): TableValidators {
  const result: TableValidators = new Map();
  for (const name of Object.keys(schema.tables).sort()) {
    const json = (schema.tables[name] as { validator?: { json?: unknown } }).validator?.json;
    if (!isValidatorJson(json)) throw new Error(`Table ${name} has no readable validator.`);
    result.set(name, json);
  }
  return result;
}

/** Index names whose first field is `societyId` (Convex's experimental `" indexes"()` accessor). */
export function societyIndexes(schema: SchemaLike): Map<string, string> {
  const result = new Map<string, string>();
  for (const [name, table] of Object.entries(schema.tables)) {
    const read = (table as { " indexes"?: () => unknown })[" indexes"];
    if (typeof read !== "function") continue;
    const indexes = read.call(table);
    if (!Array.isArray(indexes)) continue;
    for (const index of indexes) {
      const descriptor = (index as { indexDescriptor?: unknown }).indexDescriptor;
      const fields = (index as { fields?: unknown }).fields;
      if (typeof descriptor === "string" && Array.isArray(fields) && fields[0] === "societyId") {
        if (!result.has(name) || fields.length === 1) result.set(name, descriptor);
      }
    }
  }
  return result;
}

function objectFields(validator: ValidatorJSON): Record<string, FieldJSON> | null {
  return validator.type === "object" ? (validator.value as Record<string, FieldJSON>) : null;
}

/** Top-level `societyId` field: absent, optional or required. */
export function societyField(validator: ValidatorJSON): "none" | "optional" | "required" {
  const field = objectFields(validator)?.societyId;
  if (!field) return "none";
  return field.optional ? "optional" : "required";
}

/**
 * Static manifest of typed references. Path syntax: `a.b`, `[]` for array
 * elements, `{}` for record values and `{key}` for record keys. `required`
 * means a row can't be inserted without that reference resolving.
 */
export function idPaths(validator: ValidatorJSON): IdPath[] {
  const out: IdPath[] = [];
  const walk = (v: ValidatorJSON, path: string, required: boolean) => {
    switch (v.type) {
      case "id": out.push({ path, target: v.tableName, required }); return;
      case "object":
        for (const [key, field] of Object.entries(v.value as Record<string, FieldJSON>)) {
          walk(field.fieldType, path ? `${path}.${key}` : key, required && !field.optional);
        }
        return;
      case "array": walk(v.value, `${path}[]`, false); return;
      case "record":
        walk(v.keys as ValidatorJSON, `${path}{key}`, false);
        walk(v.values.fieldType, `${path}{}`, false);
        return;
      case "union": {
        // Required only when every alternative is itself a reference.
        const allIds = v.value.every((member) => member.type === "id");
        for (const member of v.value) walk(member, path, required && allIds);
        return;
      }
      default: return;
    }
  };
  walk(validator, "", true);
  return out;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof ArrayBuffer);
}

/** Structural match used to pick a union branch; ids match any string. */
export function matches(v: ValidatorJSON, value: unknown): boolean {
  switch (v.type) {
    case "null": return value === null;
    case "number": return typeof value === "number";
    case "bigint": return typeof value === "bigint";
    case "boolean": return typeof value === "boolean";
    case "string": case "id": return typeof value === "string";
    case "bytes": return value instanceof ArrayBuffer;
    case "any": return value !== undefined;
    case "literal": return value === v.value;
    case "array": return Array.isArray(value) && value.every((item) => matches(v.value, item));
    case "object": {
      if (!isPlainObject(value)) return false;
      const fields = v.value as Record<string, FieldJSON>;
      for (const key of Object.keys(value)) if (!(key in fields)) return false;
      return Object.entries(fields).every(([key, field]) => value[key] === undefined ? field.optional : matches(field.fieldType, value[key]));
    }
    case "record": return isPlainObject(value) && Object.entries(value).every(([key, item]) =>
      matches(v.keys as ValidatorJSON, key) && matches(v.values.fieldType, item));
    case "union": return v.value.some((member) => matches(member, value));
    default: return false;
  }
}

/** Shape errors of one document (ids are checked only as strings). */
export function validateDocument(validator: ValidatorJSON, doc: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const check = (v: ValidatorJSON, value: unknown, path: string) => {
    if (errors.length >= 5) return;
    if (v.type === "object") {
      if (!isPlainObject(value)) { errors.push(`${path || "document"}: expected an object`); return; }
      const fields = v.value as Record<string, FieldJSON>;
      for (const key of Object.keys(value)) if (!(key in fields)) errors.push(`${path ? `${path}.` : ""}${key}: not in the schema`);
      for (const [key, field] of Object.entries(fields)) {
        const child = path ? `${path}.${key}` : key;
        if (value[key] === undefined) { if (!field.optional) errors.push(`${child}: required field missing`); continue; }
        check(field.fieldType, value[key], child);
      }
      return;
    }
    if (v.type === "array") {
      if (!Array.isArray(value)) { errors.push(`${path}: expected an array`); return; }
      value.forEach((item, index) => check(v.value, item, `${path}[${index}]`));
      return;
    }
    if (v.type === "record") {
      if (!isPlainObject(value)) { errors.push(`${path}: expected a record`); return; }
      for (const [key, item] of Object.entries(value)) {
        if (!matches(v.keys as ValidatorJSON, key)) errors.push(`${path}{${key}}: key does not match`);
        check(v.values.fieldType, item, `${path}{}`);
      }
      return;
    }
    if (!matches(v, value)) errors.push(`${path}: expected ${v.type}`);
  };
  check(validator, doc, "");
  return errors;
}

/**
 * Resolves a typed reference. Return the destination id, or `null` when it
 * can't resolve now: the enclosing optional field, array element or record
 * entry is then omitted, and an unresolvable required position fails the row.
 */
export type ResolveId = (target: string, sourceId: string, path: string) => string | null;
/** Rewrites one string that is not a typed reference (string-held ids). */
export type RewriteString = (value: string, path: string) => string;

type Transformed = { ok: true; value: unknown } | { ok: false; path: string };

/** Rebuilds a value under its validator, resolving references and rewriting strings. */
export function transformValue(v: ValidatorJSON, value: unknown, resolveId: ResolveId, rewriteString: RewriteString, path = ""): Transformed {
  switch (v.type) {
    case "id": {
      if (typeof value !== "string") return { ok: true, value };
      const resolved = resolveId(v.tableName, value, path);
      return resolved === null ? { ok: false, path } : { ok: true, value: resolved };
    }
    case "string": return { ok: true, value: typeof value === "string" ? rewriteString(value, path) : value };
    case "any": return { ok: true, value: rewriteAny(value, rewriteString, path) };
    case "object": {
      if (!isPlainObject(value)) return { ok: true, value };
      const fields = v.value as Record<string, FieldJSON>;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        const field = fields[key];
        const child = path ? `${path}.${key}` : key;
        // Unknown fields pass through untouched; validation reports them.
        if (!field) { out[key] = item; continue; }
        const result = transformValue(field.fieldType, item, resolveId, rewriteString, child);
        if (result.ok) out[key] = result.value;
        else if (!field.optional) return result;
      }
      return { ok: true, value: out };
    }
    case "array": {
      if (!Array.isArray(value)) return { ok: true, value };
      const out: unknown[] = [];
      for (const item of value) {
        const result = transformValue(v.value, item, resolveId, rewriteString, `${path}[]`);
        if (result.ok) out.push(result.value);
      }
      return { ok: true, value: out };
    }
    case "record": {
      if (!isPlainObject(value)) return { ok: true, value };
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const keyResult = transformValue(v.keys as ValidatorJSON, key, resolveId, rewriteString, `${path}{key}`);
        const itemResult = transformValue(v.values.fieldType, item, resolveId, rewriteString, `${path}{}`);
        if (keyResult.ok && itemResult.ok && typeof keyResult.value === "string") out[keyResult.value] = itemResult.value;
      }
      return { ok: true, value: out };
    }
    case "union": {
      const member = v.value.find((candidate) => matches(candidate, value));
      return member ? transformValue(member, value, resolveId, rewriteString, path) : { ok: true, value };
    }
    default: return { ok: true, value };
  }
}

function rewriteAny(value: unknown, rewriteString: RewriteString, path: string): unknown {
  if (typeof value === "string") return rewriteString(value, path);
  if (Array.isArray(value)) return value.map((item) => rewriteAny(item, rewriteString, `${path}[]`));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[rewriteString(key, `${path}{key}`)] = rewriteAny(item, rewriteString, `${path}.*`);
    return out;
  }
  return value;
}

/** Calls `visit` for every present typed reference value in a document. */
export function visitIds(v: ValidatorJSON, value: unknown, visit: (target: string, id: string, path: string) => void, path = ""): void {
  transformValue(v, value, (target, id, at) => { visit(target, id, at); return id; }, (s) => s, path);
}

/** Calls `visit` for every string that isn't a typed reference (including `v.any()` contents and record keys). */
export function visitStrings(v: ValidatorJSON, value: unknown, visit: (value: string, path: string) => void, path = ""): void {
  transformValue(v, value, (_target, id) => id, (s, at) => { visit(s, at); return s; }, path);
}

const TOKEN = /[A-Za-z0-9_]+/g;
const MIN_ID_LENGTH = 16;

/**
 * Finds id-shaped tokens inside a string. Convex ids are random base32
 * tokens, so a whole token (or an `_`-separated part, since real ids have no
 * underscore) that equals a known id is that id, also inside JSON or text.
 */
export function idTokens(value: string, isId: (token: string) => boolean): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(TOKEN)) {
    const token = match[0];
    if (token.length < MIN_ID_LENGTH) continue;
    if (isId(token)) { found.push(token); continue; }
    if (token.includes("_")) for (const part of token.split("_")) if (part.length >= MIN_ID_LENGTH && isId(part)) found.push(part);
  }
  return found;
}

/** Replaces id tokens that `lookup` maps; returns the new string and the count replaced. */
export function rewriteIdTokens(value: string, lookup: (token: string) => string | undefined): { value: string; count: number } {
  let count = 0;
  const next = value.replace(TOKEN, (token) => {
    if (token.length < MIN_ID_LENGTH) return token;
    const whole = lookup(token);
    if (whole !== undefined) { count += 1; return whole; }
    if (!token.includes("_")) return token;
    return token.split("_").map((part) => {
      if (part.length < MIN_ID_LENGTH) return part;
      const mapped = lookup(part);
      if (mapped === undefined) return part;
      count += 1;
      return mapped;
    }).join("_");
  });
  return { value: next, count };
}

/** Stable SHA-256 hex digest (Web Crypto: Node and the Convex runtime). */
export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Digest of every table validator, so the CLI and the destination prove they run the same schema. */
export async function schemaDigest(validators: TableValidators): Promise<string> {
  return sha256Hex(JSON.stringify([...validators.entries()].sort(([a], [b]) => a.localeCompare(b))));
}

/** Convex `_storage` checksums are base64; exports and tools sometimes use hex. Returns lowercase hex or null. */
export function normalizeSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value)) return null;
  const binary = atob(value.length === 43 ? `${value}=` : value);
  if (binary.length !== 32) return null;
  return Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
