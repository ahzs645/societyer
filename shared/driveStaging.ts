/** Staging date evidence never uses the import date or a fiscal-period date. */
export function sourceMeetingDateEvidence(header: string, fileName: string) {
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const dates = (value: string, checkContext: boolean) => {
    const text = value.replace(/_/g, ' ');
    const found: string[] = [];
    const add = (year: string, month: number, day: string, index: number, length: number) => {
      const date = `${year}-${String(month).padStart(2,'0')}-${day.padStart(2,'0')}`;
      if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) return;
      const before = text.slice(Math.max(0,index-100),index).split(/\r?\n/).slice(-2).join(' ');
      if (checkContext && /financial|fiscal|statement|budget|previous|last meeting|next meeting|(?:adoption|approval) of.{0,30}minutes/i.test(before)) return;
      found.push(date);
    };
    for (const m of text.matchAll(/\b((?:19|20)\d{2})[-/ ](\d{1,2})[-/ ](\d{1,2})\b/g)) add(m[1],Number(m[2]),m[3],m.index!,m[0].length);
    for (const m of text.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*(\d{1,2})(?:st|nd|rd|th)?[\s,/-]+((?:19|20)\d{2})\b/gi)) add(m[3],months.indexOf(m[1].slice(0,3).toLowerCase())+1,m[2],m.index!,m[0].length);
    for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?[\s,/-]+((?:19|20)\d{2})\b/gi)) add(m[3],months.indexOf(m[2].slice(0,3).toLowerCase())+1,m[1],m.index!,m[0].length);
    return [...new Set(found)];
  };
  const headerDates=dates(header.slice(0,600),true),fileDates=dates(fileName,false);
  if (headerDates.length !== 1) return { date:undefined,reason:headerDates.length?'Multiple header dates require review.':'No explicit valid meeting date in source header; manual structuring required.',headerDates,fileDates };
  if (fileDates.some(date=>date!==headerDates[0])) return {date:undefined,reason:'Source header and filename dates disagree; resolve against original.',headerDates,fileDates};
  return {date:headerDates[0],reason:'Candidate date from explicit source header; original still requires review.',headerDates,fileDates};
}
