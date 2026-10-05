/** Lossless, reviewable projection of imported source minutes into agenda sections.
 * This is a source extraction, never an adoption, vote, attendance or membership decision. */
export type SourceMinuteDocument = {
  _id?: string; title?: string; extractedText?: string; content?: string;
  selectedText?: string; sourceReference?: string; sourceKind?: string;
};
export type SourceMinuteSection = {
  title: string; agendaItemId?: string; motionId?: string; linkedTaskIds?: string[]; type?: string; presenter?: string; discussion?: string; motionText?: string;
  decisions?: string[]; actionItems?: Array<{text: string; done: boolean; assignee?: string; dueDate?: string}>;
  depth?: 0 | 1; sourceEvidence?: any; sourceReference?: string; sourceReviewStatus?: string; sourceKind?: string;
};

function parsed(value: unknown): any {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try { return JSON.parse(value); } catch { return {}; }
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function readable(value: string): string {
  // A number of supplied extraction files stored literal newline escapes twice.
  return value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
}
function key(value: string): string {
  return value.toLowerCase().replace(/^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.)\s:-]+/i, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function kindFor(title: string, body: string): string {
  if (/(?:^|[\W_])script(?:[\W_]|$)/i.test(title) || /annual general meeting script|\bchair says\s*:/i.test(body)) return 'script';
  if (/(?:^|[\W_])template(?:[\W_]|$)|blank minutes/i.test(title)) return 'template';
  // Agenda packages can contain actual previous minutes; don't downgrade their records.
  if (/(?:^|[\W_])minutes(?:[\W_]|$)/i.test(title) || /(?:^|\n)\s*(?:[\w ,'-]+\s+)?(?:meeting\s+)?minutes(?:\s+(?:of|for|from))?\s*(?:\n|:)|minutes of (?:the|a) .*meeting/i.test(body)) return 'recorded_minutes';
  if (/(?:^|[\W_])agenda(?:[\W_]|$)/i.test(title) || /(?:^|\n)\s*(?:meeting\s+)?agenda\s*(?:\n|:)/i.test(body)) return 'agenda';
  return 'recorded_minutes';
}
function isAgendaTopic(value: string): boolean {
  if (/^(?:action(?: item)?|motion|decision)\s*:|^agenda item|^(?:operations committee|board|monitoring working group) meeting(?: minutes)?$|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*20\d{2}.*meeting/i.test(value)) return false;
  return /call.*order|quorum|agenda|minutes|approval|adoption|report|financial|statement|budget|business|adjourn|appointment|election|director|membership|fee|committee|update|correspondence|welcome|introduction|conflict|review|discussion|presentation|action|next meeting|roundtable|monitoring|air quality|aqmp|mwg|operations|treasurer report|chair report|secretary report|recess|break|constitution|bylaw|strategic|funding/i.test(value);
}

function heading(line: string): {title:string; depth:0|1} | null {
  const value = line.trim();
  // Avoid names in numbered rosters, dates, monetary lines, script directions and paragraphs.
  const m = value.match(/^(\d{1,2}(?:\.\d{1,2})?|[IVX]{1,5})(?:[.)]\s+|\s+)(.{3,130})$/i);
  if (!m) return null;
  const title = m[2].trim();
  if (/^(?:action(?: item)?|motion|decision)\s*:|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*20\d{2}.*meeting|committee meeting(?: minutes)?$/i.test(title)) return null;
  if (/^\$|\b(?:chair says|member says|i so move|i second|is|are|was|were|will|indicates|attached|needed)\b|^see |^send |\(chair\)/i.test(title)) return null;
  const topic = /call.*order|quorum|agenda|minutes|approval|adoption|report|financial|statement|budget|business|adjourn|appointment|election|director|membership|fee|committee|update|correspondence|welcome|introduction|conflict|review|discussion|presentation|action|next meeting|roundtable|monitoring|air quality|aqmp|mwg|operations|treasurer report|chair report|secretary report|recess|break|open.*meeting|constitution|bylaw|strategic|funding/i;
  if (!topic.test(title)) return null;
  return {title, depth: /\.[1-9]/.test(m[1]) ? 1 : 0};
}
function matchingTopic(value: string): string {
  const normalized = key(value);
  if (/minutes/.test(normalized) && /previous|prior|adopt|approv|review/.test(normalized)) return 'previous_minutes';
  if (/agenda/.test(normalized) && /adopt|approv|review/.test(normalized)) return 'agenda_approval';
  if (/call.*order|opening.*meeting/.test(normalized)) return 'call_to_order';
  if (/adjourn/.test(normalized)) return 'adjournment';
  return normalized;
}

function classifySection(title: string): string {
  return /report|financial|statement|treasurer/i.test(title) ? 'report' : /motion|approval|adoption|appointment|election/i.test(title) ? 'motion' : 'discussion';
}
function strings(values: unknown): string[] { return Array.isArray(values) ? values.map(v => typeof v === 'string' ? v : text((v as any)?.text)).filter(Boolean) : []; }

export function buildSourceMinuteSections(args: {
  minutes: any; agendaItems?: Array<string | any>; sourceDocuments?: SourceMinuteDocument[];
}): {sections: SourceMinuteSection[]; sourceTransposition: any} {
  const {minutes} = args;
  const transcript = parsed(minutes.draftTranscript);
  const docs = (args.sourceDocuments ?? []).map(doc => {
    const content = parsed(doc.content);
    const original = readable(doc.extractedText ?? content.extractedText ?? content.text ?? '');
    return {...doc, rawText: text(doc.extractedText ?? content.extractedText ?? content.text), original, selected: readable(doc.selectedText ?? original), title: doc.title ?? content.title ?? 'Source document'};
  }).filter(doc => doc.original || doc.selected);
  const fallback = readable(text(minutes.discussion));
  const sourceTitles = docs.map(doc => doc.title).join('; ') || text(transcript.sourceDocumentTitle);
  const originalText = docs.length ? docs.map(doc => `[${doc.title}]\n${doc.original}`).join('\n\n') : fallback;
  const mappingText = docs.length ? docs.map(doc => doc.selected).join('\n\n') : fallback;
  const sourceKind = docs.find(doc => doc.sourceKind)?.sourceKind ?? kindFor(sourceTitles, mappingText);
  const proposed = sourceKind !== 'recorded_minutes';
  const sourceReference = docs.map(doc => doc.sourceReference ?? `${doc.title}${doc._id ? ` [${doc._id}]` : ''}`).join('; ')
    || strings(minutes.sourceExternalIds).join('; ') || sourceTitles || 'Imported meeting source';
  const lines: string[] = [];
  let tableHeadingIndex = -1;
  let syntheticAgendaNumber = 0;
  const sourcePresenters = new Map<number,string>();
  for (const rawLine of mappingText.split('\n')) {
    let cells = rawLine.split('|').map(cell => cell.trim());
    if (rawLine.trim().startsWith('|')) cells = cells.slice(1);
    if (rawLine.trim().endsWith('|')) cells = cells.slice(0,-1);
    if (sourceKind === 'agenda' && cells.length >= 2 && cells[0] && isAgendaTopic(cells[0])) {
      tableHeadingIndex = lines.length;
      syntheticAgendaNumber += 1;
      lines.push(`${syntheticAgendaNumber}. ${cells[0]}`);
      if (cells[1]) sourcePresenters.set(tableHeadingIndex,cells[1]);
      lines.push(...cells.slice(1).filter(Boolean).map((cell,i) => `${i === 0 ? 'Responsibility' : 'Proposed group action'}: ${cell}`));
    } else if (cells.length >= 3 && /^(?:\d{1,2}(?:\.\d{1,2})?[.)]?)?$/.test(cells[0])) {
      if (cells[0] && cells[1]) {
        tableHeadingIndex = lines.length;
        lines.push(`${cells[0].replace(/[.)]$/, '')}. ${cells[1]}`);
      } else if (cells[1]) {
        if (/^quorum$/i.test(cells[1])) { tableHeadingIndex = lines.length; lines.push('Quorum'); }
        else if (tableHeadingIndex >= 0) lines[tableHeadingIndex] += ` ${cells[1]}`;
        else lines.push(cells[1]);
      }
      if (cells.slice(2).some(Boolean)) lines.push(cells.slice(2).filter(Boolean).join(' '));
    } else {
      tableHeadingIndex = -1;
      if (cells.length === 2 && heading(cells[0]) && cells[1]) lines.push(cells[0],cells[1]);
      else {
        const columns = rawLine.trim().split(/\s{2,}|\t+|\s+(?=[•●▪])/);
        if (columns.length >= 2 && /^\d{1,2}(?:\.\d{1,2})?[.)]?$/.test(columns[0])) {
          const title = `${columns[0].replace(/[.)]$/, '')}. ${columns[1]}`;
          lines.push(title,...(columns.length > 2 ? [columns.slice(2).join(' ')] : []));
        } else if (columns.length > 1 && heading(columns[0])) lines.push(columns[0],columns.slice(1).join(' '));
        else lines.push(rawLine);
      }
    }
  }
  const anchors: Array<{title:string;depth:0|1;line:number}> = [];
  const agendaKeys = new Set((args.agendaItems ?? []).map(item => typeof item === 'string' ? item : text(item?.title)).filter(isAgendaTopic).map(key).filter(Boolean));
  lines.forEach((line, index) => {
    let h = heading(line);
    const value = line.trim();
    // Word table exports and many MWG records use unnumbered topic labels.
    // Require a short standalone label, known topic and surrounding whitespace;
    // sentences and roster entries remain source context, never invented items.
    if (!h && sourceKind !== 'script' && !/^\d{1,2}[.)\s]/.test(value) && value.length >= 3 && value.length <= 100 && !/[.!?;]$/.test(value) && !value.includes('|') && !/\s{3,}/.test(value) &&
      !/^(?:\[|[•●▪-]|operations committee meeting|monitoring working group meeting|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*20\d{2}.*meeting|chair (?:says|continues)|allow |see |send |the |this |it |decision|action item|agenda item|again |date|time|location|present|absent|regrets|prince george|pgair secretariat)/i.test(value) &&
      !/\b(?:is|are|was|were|will|should|indicates|attached|needed)\b|\(chair\)|roundtable society|^monitoring$/i.test(value) &&
      (agendaKeys.has(key(value)) || /^(?:quorum|call.*order|adjournment|member information exchange|current business|executive report highlights|budget and projects overview(?: \([^)]*\))?|emerging air quality issues discussion)$/i.test(value) ||
        (/report|financial|budget|business|adjourn|appointment|election|committee|update|review|discussion|presentation|action items?|next meeting|roundtable|monitoring|air quality|aqmp|mwg|operations|invoicing|capital|membership/i.test(value) &&
        !/[,]/.test(value) && ((value.length <= 65 || value.endsWith(':')) && (!lines[index-1]?.trim() || !lines[index+1]?.trim()))))) h = {title:value.replace(/:$/, ''),depth:0};
    if (h) anchors.push({...h,line:index});
  });
  // Incomplete OCR may be a single paragraph. Exact agenda-heading anchors still
  // split it without treating each person's name or a financial year as an item.
  if (!anchors.length && lines.length < 5 && mappingText.length) {
    const candidates = (args.agendaItems ?? []).map(a => typeof a === 'string' ? a : text(a?.title)).filter(Boolean);
    const found = candidates.map(title => ({title,index:mappingText.toLowerCase().indexOf(title.toLowerCase())})).filter(a => a.index >= 0).sort((a,b) => a.index-b.index);
    if (found.length > 1) {
      const parts = [mappingText.slice(0,found[0].index), ...found.map((a,i) => `${a.title}\n${mappingText.slice(a.index+a.title.length,found[i+1]?.index ?? mappingText.length)}`)];
      lines.splice(0,lines.length,...parts.join('\n').split('\n'));
      let cursor = 1;
      found.forEach((a,i) => { anchors.push({title:a.title,depth:0,line:cursor}); cursor += parts[i+1].split('\n').length; });
    }
  }
  const rawSections = anchors.map((anchor,i) => ({...anchor,presenter:sourcePresenters.get(anchor.line),body:lines.slice(anchor.line+1,anchors[i+1]?.line ?? lines.length).join('\n').trim(),reference:`${sourceReference}; normalized extraction lines ${anchor.line+1}–${anchors[i+1]?.line ?? lines.length}`}));
  const sourceSections: typeof rawSections = [];
  for (const section of rawSections) {
    const normalized = key(section.title);
    const existing = normalized.length >= 8 ? sourceSections.find(item => key(item.title) === normalized && item.depth === section.depth) : undefined;
    if (existing) {
      existing.body = [existing.body,section.body].filter(Boolean).join('\n\n');
      existing.reference += `; additional source fragment: ${section.reference}`;
    } else sourceSections.push({...section});
  }
  const sections: SourceMinuteSection[] = [];
  const fromSource = (entry:any, metadata:any = {}) => {
    const body = entry?.body ?? '';
    const candidates = body.split('\n').map((line:string) => line.trim()).filter(Boolean);
    const decisions = candidates.filter((line:string) => /\b(?:carried(?!\s+forward)|defeated|approved|agreed|resolved|decision\s*:|consensus)\b/i.test(line));
    const actions = candidates.filter((line:string) => /^(?:action(?:\s+item)?|to\s+do|follow[- ]?up)\s*[:–-]/i.test(line));
    const motion = candidates.filter((line:string) => /\b(?:motion|moved by|seconded by|i so move|i second)\b/i.test(line)).join('\n');
    return {
      ...(metadata._id ? {agendaItemId:metadata._id} : {}),
      title: metadata.title || entry?.title || 'Source notes awaiting agenda mapping',
      type: metadata.type || classifySection(metadata.title || entry?.title || ''),
      ...(metadata.presenter || entry?.presenter ? {presenter:metadata.presenter || entry.presenter} : {}),
      discussion: body,
      ...(motion || metadata.motionText ? {motionText: `${proposed ? 'Proposed source wording: ' : ''}${motion || metadata.motionText}`} : {}),
      decisions: decisions.map((line:string) => `${proposed ? 'Proposed wording (not a recorded decision)' : 'Reported decision (source review pending)'}: ${line}`),
      actionItems: actions.map((line:string) => ({text:`${proposed ? 'Proposed action: ' : 'Reported action (source review pending): '}${line}`,done:false})),
      depth: (metadata.depth === 1 ? 1 : entry?.depth ?? 0) as 0|1,
      sourceReference: entry?.reference || sourceReference,
      sourceReviewStatus: 'imported_needs_review', sourceKind,
      sourceEvidence: {decisionState: proposed ? 'proposed' : 'reported', actionState: proposed ? 'proposed' : 'reported', originalHeading: entry?.title ?? '', citation: entry?.reference || sourceReference},
    };
  };
  const agendaItems = (args.agendaItems ?? []).map(item => typeof item === 'string' ? {title:item} : item).filter(item => text(item?.title).trim());
  const usedAgenda = new Set<number>();
  // Original heading order is the source order; an old machine-derived agenda
  // may be incomplete, reordered or contain a roster mistaken for topics.
  for (const entry of sourceSections) {
    const index = agendaItems.findIndex((item,i) => !usedAgenda.has(i) && matchingTopic(item.title) === matchingTopic(entry.title));
    if (index >= 0) usedAgenda.add(index);
    sections.push(fromSource(entry,index >= 0 ? {...agendaItems[index],title:entry.title,depth:entry.depth} : {}));
  }
  for (let i=0;i<agendaItems.length;i++) {
    const item = agendaItems[i];
    if (!sourceSections.length && !usedAgenda.has(i) && isAgendaTopic(item.title)) sections.push(fromSource(undefined,item));
  }
  const unmappedText = anchors.length ? lines.slice(0,anchors[0].line).join('\n').trim() : mappingText;
  if (unmappedText) sections.push(fromSource({title:'Source notes awaiting agenda mapping',body:unmappedText,reference:sourceReference,depth:0}));
  if (!sections.length) sections.push(fromSource({title:'Source evidence awaiting extraction',body:fallback,reference:sourceReference,depth:0}));
  // Preserve pre-existing decisions/actions which have no reliable item assignment.
  const importedDecisions = strings(minutes.decisions);
  const importedActions = Array.isArray(minutes.actionItems) ? minutes.actionItems : [];
  if (importedDecisions.length || importedActions.length) sections.push({
    title:'Imported decisions and actions awaiting agenda mapping', type:'other', discussion:'Item assignment requires review against the cited original source.',
    decisions: importedDecisions.map(value => `${proposed ? 'Proposed wording (not a recorded decision)' : 'Reported decision (source review pending)'}: ${value}`),
    actionItems: importedActions.map((item:any) => ({text:`${proposed ? 'Proposed action: ' : ''}${text(item.text)}`,done:false,...(item.assignee ? {assignee:item.assignee}:{}),...(item.dueDate ? {dueDate:item.dueDate}:{})})),
    depth:0,sourceReference,sourceReviewStatus:'imported_needs_review',sourceKind,
  });
  return {sections,sourceTransposition:{version:1,originalText,originalAgendaItems: args.agendaItems ?? [], originalSources: docs.map(doc => ({documentId:doc._id ?? '',title:doc.title,text:doc.rawText})),originalDiscussion:text(minutes.discussion),originalQuorum:{quorumMet:minutes.quorumMet ?? false,quorumStatus:minutes.quorumStatus ?? "not_recorded"},originalDraftTranscript:text(minutes.draftTranscript),sourceKind,sourceReference,unmappedText,mappedSectionCount:sourceSections.length,
    reviewStatus:'imported_needs_review',note:proposed ? 'Agenda, script or template wording describes proposed business; it does not establish attendance, an appointment or a passed decision.' : 'Source-derived sections need review against the original; no adoption or statutory status is inferred.'}};
}

/** A seeded empty agenda scaffold is safe to enrich; an edited section is not. */
export function hasRecordedMinuteSectionContent(sections: any): boolean {
  return Array.isArray(sections) && sections.some(section =>
    text(section.discussion).trim() || text(section.motionText).trim() || section.motionId ||
    (section.decisions?.length ?? 0) || (section.actionItems?.length ?? 0) || (section.linkedTaskIds?.length ?? 0) || section.reportSubmitted);
}

/** Only attach an existing native object when its exact source wording identifies
 * one section. Ambiguous wording stays unassigned; this never changes legal state. */
export function attachSourceMinuteSectionLinks(sections: any[], args: {tasks?: any[]; motions?: any[]}) {
  const clean = (value:unknown) => String(value ?? '').toLowerCase()
    .replace(/reported action \(source review pending\):\s*|proposed action:\s*|\baction(?: item)?\s*[:–-]\s*/gi,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const linked = sections.map(section => ({...section}));
  const motionLinks: Array<{id:string;sectionIndex:number;sectionTitle:string}> = [];
  for (const task of args.tasks ?? []) {
    const wording = clean(task.description?.split('\n\n')[1] ?? String(task.title ?? '').replace(/^Review historical action:\s*/i,''));
    if (wording.length < 15) continue;
    const hits = linked.map((section,index) => clean(section.discussion).includes(wording) ? index : -1).filter(index => index >= 0);
    if (hits.length === 1) linked[hits[0]].linkedTaskIds = [...new Set([...(linked[hits[0]].linkedTaskIds ?? []),task._id])];
  }
  for (const motion of args.motions ?? []) {
    const wording = clean(motion.text).slice(0,140);
    if (wording.length < 15) continue;
    const hits = linked.map((section,index) => clean(section.discussion).includes(wording) ? index : -1).filter(index => index >= 0);
    if (hits.length === 1 && !linked[hits[0]].motionId) {
      linked[hits[0]].motionId = motion._id;
      motionLinks.push({id:motion._id,sectionIndex:hits[0],sectionTitle:linked[hits[0]].title});
    }
  }
  return {sections:linked,motionLinks};
}
