export async function readGcosExportFile(file: File) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
    const entries = readStoredZip(new Uint8Array(await file.arrayBuffer()));
    const snapshotEntry = entries.find((entry) => /(^|\/)snapshot\.json$/i.test(entry.name))
      ?? entries.find((entry) => /\.json$/i.test(entry.name) && !/(^|\/)manifest\.json$/i.test(entry.name));
    if (!snapshotEntry) throw new Error("GCOS zip did not contain snapshot.json.");
    return new TextDecoder().decode(snapshotEntry.data);
  }
  return await file.text();
}

export function enrichGcosNormalizedGrant(snapshot: any, normalizedGrant: any = {}) {
  const approvedJob = snapshot?.structured?.approvedJob ?? {};
  const keyFacts = mergeStringLists(
    normalizedGrant?.keyFacts,
    approvedJob.participantsApproved ? [`Approved participants: ${numberText(approvedJob.participantsApproved)}`] : [],
    approvedJob.weeksApproved ? [`Approved weeks: ${numberText(approvedJob.weeksApproved)}`] : [],
    (approvedJob.hoursPerWeekApproved ?? approvedJob.hoursPerWeek) ? [`Approved hours/week: ${numberText(approvedJob.hoursPerWeekApproved ?? approvedJob.hoursPerWeek)}`] : [],
    approvedJob.hourlyWage ? [`Approved hourly wage: ${moneyText(approvedJob.hourlyWage)}`] : [],
  );
  return {
    ...normalizedGrant,
    keyFacts,
  };
}

function mergeStringLists(...lists: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const text = String(item ?? "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
  }
  return result;
}

function numberText(value: unknown) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match?.[0] ?? String(value ?? "").trim();
}

function moneyText(value: unknown) {
  const parsed = Number(numberText(value));
  if (!Number.isFinite(parsed)) return String(value ?? "").trim();
  return `$${parsed.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function readStoredZip(bytes: Uint8Array) {
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset + 4 <= bytes.length) {
    const signature = readU32(bytes, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error("Unsupported zip format.");
    const method = readU16(bytes, offset + 8);
    if (method !== 0) throw new Error("Unsupported compressed zip. Re-export from the Societyer GCOS extension.");
    const compressedSize = readU32(bytes, offset + 18);
    const nameLength = readU16(bytes, offset + 26);
    const extraLength = readU16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error("Zip entry is truncated.");
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.push({ name, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd;
  }
  return entries;
}

function readU16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readU32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
