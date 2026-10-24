import { documentImageDimensions } from "../../../shared/documentRichContent";
const pending = new Map<string, Promise<{ logoUrl: string; logoAspectRatio: number }>>();
/** Resolve the workspace storage logo once, with bounded bytes and pixels before PDF rendering. */
export async function resolveDocumentOrganizationLogo<T extends { logoUrl?: string | null }>(organization: T): Promise<T & { logoAspectRatio?: number }> {
  const source = organization.logoUrl; if (!source) return organization;
  let request = pending.get(source);
  if (!request) {
    request = (async () => {
      let data = source;
      if (!/^data:image\/(?:png|jpeg);base64,/i.test(source)) {
        const response = await fetch(source, { signal: AbortSignal.timeout(10000) });
        if (!response.ok || !response.body) throw new Error("Could not load the organization logo from workspace storage.");
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 2000000) { await reader.cancel(); throw new Error("Use an organization logo smaller than 2 MB for PDF documents."); } chunks.push(item.value); } } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let cursor = 0; for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
        const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71, jpeg = bytes[0] === 255 && bytes[1] === 216;
        if (!png && !jpeg) throw new Error("Use a PNG or JPEG organization logo for PDF documents.");
        const encoded: string[] = []; for (let index = 0; index < bytes.length; index += 32768) encoded.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
        data = `data:image/${png ? "png" : "jpeg"};base64,${btoa(encoded.join(""))}`;
      }
      if (data.length > 2800000) throw new Error("Use an organization logo smaller than 2 MB for PDF documents.");
      const { width, height } = documentImageDimensions(data);
      return { logoUrl: data, logoAspectRatio: width / height };
    })().catch((error) => { pending.delete(source); throw error; });
    if (pending.size >= 20) pending.delete(pending.keys().next().value!);
    pending.set(source, request);
  }
  return { ...organization, ...await request };
}
