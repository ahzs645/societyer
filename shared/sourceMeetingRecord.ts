/** The literal meeting source is distinct from Societyer's editable minutes projection.
 * No dates, participant roles, legal status or decision outcomes are invented here. */
export type SourceMeetingCell = {text:string;colSpan?:number;rowSpan?:number;header?:boolean;paragraphs?:string[];blocks?:SourceMeetingBlock[]};
export type SourceMeetingBlock =
 | {kind:'paragraph'|'heading';text:string;level?:number;links?:Array<{text:string;url:string;offset?:number}>;sourceReference?:string}
 | {kind:'table';rows:Array<{cells:SourceMeetingCell[]}>;widths?:number[];sourceReference?:string}
 | {kind:'image';dataUrl?:string;url?:string;alt?:string;caption?:string;width?:number;height?:number;sourceReference?:string}
 | {kind:'page_break';sourceReference?:string};
export type SourceMeetingParticipant = {name:string;category:'present'|'regrets'|'absent'|'staff'|'guest'|'unknown';roleTitle?:string;affiliation?:string;sourceText:string;sourceReference:string};
export type SourceMeetingOriginalDownload={fileName:string;mimeType:string;sha256:string;parts:Array<{url:string;bytes:number;sha256:string}>};
export type SourceMeetingRecord = {
 version:1;sourceKind:string;reviewStatus:'imported_needs_review';
 header:{literalTitle:string;organizationName?:string;dateText?:string;timeText?:string;locationText?:string;lines:string[]};
 participants:SourceMeetingParticipant[];
 documents:Array<{documentId:string;title:string;sourceReference:string;selectedText:string;fullText:string;blocks:SourceMeetingBlock[];primaryBlockStart:number;primaryBlockEnd:number;purpose:'main'|'supporting_package';originalUrl?:string;originalSha256?:string;originalDownload?:SourceMeetingOriginalDownload}>;
 sectionBaseline:any[];
 structuredBaseline:{motions:any[];decisions:string[];actionItems:any[];details:any};
 note:string;
};
export type SourceMeetingDocumentInput = {_id?:string;documentId?:string;title?:string;sourceReference?:string;sourceKind?:string;selectedText?:string;extractedText?:string;content?:string;blocks?:SourceMeetingBlock[];fullText?:string;primaryBlockStart?:number;primaryBlockEnd?:number;purpose?:'main'|'supporting_package';originalUrl?:string;originalSha256?:string;originalDownload?:SourceMeetingOriginalDownload};
export function readableSourceText(value:unknown):string {return typeof value==='string'?value.replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\r\n?/g,'\n'):'';}
function parsed(value:unknown):any {if(typeof value!=='string')return {};try{return JSON.parse(value);}catch{return {};}}
function literalCells(line:string):string[]|null {
 if(!line.includes('|'))return null;
 let cells=line.split('|');
 if(line.trim().startsWith('|'))cells=cells.slice(1);
 if(line.trim().endsWith('|'))cells=cells.slice(0,-1);
 return cells.map(cell=>cell.trim());
}
/** Text extraction preserves every line. Pipe tables become actual tables;
 * narrative retains whitespace, bullet text, signatures and attachment wording. */
export function parseSourceMeetingBlocks(value:string):SourceMeetingBlock[] {
 const lines=readableSourceText(value).split('\n');const blocks:SourceMeetingBlock[]=[];
 let paragraphs:string[]=[];let rows:Array<{cells:SourceMeetingCell[]}>=[];
 const flushParagraph=()=>{if(paragraphs.length){blocks.push({kind:'paragraph',text:paragraphs.join('\n')});paragraphs=[];}};
 const flushTable=()=>{if(rows.length){blocks.push({kind:'table',rows});rows=[];}};
 for(const line of lines){
  if(line.includes('\f')){flushParagraph();flushTable();const fragments=line.split('\f');fragments.forEach((fragment,index)=>{if(index)blocks.push({kind:'page_break'});if(fragment)blocks.push({kind:'paragraph',text:fragment});});continue;}
  const cells=literalCells(line);
  if(cells && cells.length>1){flushParagraph();rows.push({cells:cells.map(text=>({text}))});}
  else{flushTable();if(!line.trim()&&paragraphs.length){flushParagraph();blocks.push({kind:'paragraph',text:''});}else paragraphs.push(line);}
 }
 flushParagraph();flushTable();return blocks;
}
/** Text with pipe-delimited table rows ("Item | Discussion | Action/WHO") split into prose and
 * table segments, so stored minutes and source text written by earlier imports (cells joined with
 * " | ") render as tables instead of pipes. A line is a table row when it has at least two cells
 * and either sits next to another row or has three or more cells; a single "A | B" line in prose
 * stays prose. The stored text is never changed. */
export type TextOrTableSegment = {kind:'text';text:string}|{kind:'table';rows:string[][];header:boolean};
export function splitPipeTables(value:string):TextOrTableSegment[] {
 const lines=readableSourceText(value).split('\n');const cells=lines.map(literalCells);
 const isRow=(index:number)=>{const row=cells[index];if(!row||row.length<2||!row.some(cell=>cell))return false;
  const neighbour=(other:number)=>Boolean(cells[other]&&cells[other]!.length>=2);
  return row.length>=3||neighbour(index-1)||neighbour(index+1);};
 const segments:TextOrTableSegment[]=[];let text:string[]=[];let rows:string[][]=[];
 const flushText=()=>{if(text.join('\n').trim())segments.push({kind:'text',text:text.join('\n')});text=[];};
 const flushRows=()=>{if(rows.length){const width=Math.max(...rows.map(row=>row.length));const padded=rows.map(row=>[...row,...Array(width-row.length).fill('')]);
  // A first row of short labels ("Item | Discussion | Action") is the header.
  const header=padded.length>1&&padded[0].every(cell=>cell.length<=40&&!/[.!?]$/.test(cell))&&/\b(?:item|agenda|topic|discussion|action|who|for|decision|notes?|name|organi[sz]ation|date|status|responsib\w*)\b/i.test(padded[0].join(' '));
  segments.push({kind:'table',rows:padded,header});rows=[];}};
 lines.forEach((line,index)=>{if(isRow(index)){flushText();rows.push(cells[index]!);}else{flushRows();text.push(line);}});
 flushRows();flushText();return segments;
}
/** Plain text of a block. Table cells are joined with " | " so stored records round-trip through
 * `parseSourceMeetingBlocks`; displays render them as tables (`splitPipeTables`). */
export function sourceMeetingBlockText(block:SourceMeetingBlock):string {
 if(block.kind==='table')return block.rows.map(row=>row.cells.map(cell=>cell.blocks?.length?cell.blocks.map(sourceMeetingBlockText).join('\n'):cell.text).join(' | ')).join('\n');
 if(block.kind==='paragraph'||block.kind==='heading')return block.text;
 if(block.kind==='image')return [block.alt,block.caption].filter(Boolean).join('\n');
 return '\f';
}
export function sourceMeetingContentText(record:SourceMeetingRecord):string {return record.documents.map(doc=>doc.blocks.map(sourceMeetingBlockText).join('\n')).join('\n\n');}
function categoryLabel(value:string):SourceMeetingParticipant['category']|undefined {
 const clean=value.trim().replace(/[:–-]+$/,'').toLowerCase();
 if(/^(?:present|attendees|in attendance|attendance present|directors present|members present)$/.test(clean))return 'present';
 if(/^(?:regrets|apologies|absent with regrets)$/.test(clean))return 'regrets';
 if(/^(?:absent|not present|members absent)$/.test(clean))return 'absent';
 if(/^(?:staff|secretariat staff)$/.test(clean))return 'staff';
 if(/^(?:guests|guest|observers)$/.test(clean))return 'guest';
 return undefined;
}
function participantsFromDocuments(documents:SourceMeetingRecord['documents']):SourceMeetingParticipant[] {
 const participants:SourceMeetingParticipant[]=[];
 const literalNames=(values:string[])=>values.flatMap(value=>value.split(/\n+/).map(name=>name.trim()).filter(Boolean)).filter(name=>/^[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){1,3}$/u.test(name)&&!/council|society|secretariat|ministry|health|member|city|university|district|pga?ir|environment/i.test(name));
 for(const document of documents){let current:SourceMeetingParticipant['category']|undefined;
  for(const block of document.blocks.slice(document.primaryBlockStart,document.primaryBlockEnd)){
   if(block.kind==='image'||block.kind==='page_break')continue;
   if(block.kind==='table'){
    for(const row of block.rows){
     const values=row.cells.map(cell=>cell.text.trim());const status=values.map(categoryLabel).find(Boolean);
     if(status){
      current=status;
      for(const name of literalNames(values.filter(value=>value&&!categoryLabel(value)))) participants.push({name,category:current,sourceText:values.join(' | '),sourceReference:document.sourceReference});
      continue;
     }
     if(!current)continue;
     if(!values[0]&&values.slice(1).filter(Boolean).length>0){
      for(const name of literalNames(values.slice(1).filter(Boolean))) participants.push({name,category:current,sourceText:values.join(' | '),sourceReference:document.sourceReference});
      continue;
     }
     const name=values[0];
     if(!name||/^(?:name|agenda|item|discussion|action|motion|date|time|location)\b/i.test(name)||/^\d+[.)\s]/.test(name)) {if(/^agenda|^item|^discussion/i.test(name))current=undefined;continue;}
     participants.push({name,category:current,...(values[1]?{affiliation:values[1]}:{}),sourceText:values.join(' | '),sourceReference:document.sourceReference});
    }
   }else{
    for(const line of block.text.split('\n')){
     const status=categoryLabel(line);if(status){current=status;continue;}
     if(!current||!line.trim())continue;
     if(/^\d+(?:\.\d+)?[.)]?\s+/.test(line.trim())||/^(?:minutes|agenda|call.*order|welcome|discussion|current business|new business|action|meeting (?:called|commenced))\b/i.test(line.trim())){current=undefined;continue;}
     // Do not guess a person from long narrative paragraphs or a roster citation.
     if(line.trim().length>180||/[.!?]$/.test(line.trim())){current=undefined;continue;}
     const columns=line.trim().split(/\t+|\s{2,}|\s*\|\s*/);const comma=columns.length===1?line.trim().match(/^([^,]+),\s*(.+)$/):null;
     const name=comma?comma[1]:columns[0];const affiliation=comma?comma[2]:columns[1];
     participants.push({name,category:current,...(affiliation?{affiliation}:{}),sourceText:line,sourceReference:document.sourceReference});
    }
   }
  }
 }
 return participants;
}
function sourceHeader(documents:SourceMeetingRecord['documents']):SourceMeetingRecord['header'] {
 const text=documents[0]?readableSourceText(documents[0].selectedText):'';
 const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
 const boundary=lines.findIndex(line=>categoryLabel(line)||/^(?:\d+[.)]\s|agenda items?\s*:|minutes\s*:)/i.test(line));
 const before=lines.slice(0,boundary>=0?boundary:Math.min(12,lines.length));
 const headerLines=before.length?before:lines.slice(0,Math.min(12,lines.length));
 const dateLine=headerLines.find(line=>/^(?:date(?:\s*\/\s*time)?|meeting date)\s*:/i.test(line))??headerLines.find(line=>/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{1,2}(?:,\s*|\s+)\d{4}\b/i.test(line));
 const timeLine=headerLines.find(line=>/^(?:time|meeting time)\s*:/i.test(line));
 const locationIndex=headerLines.findIndex(line=>/^(?:location|place|venue)\s*:/i.test(line));
 const value=(line:string|undefined)=>line?.replace(/^(?:date(?:\s*\/\s*time)?|meeting date|time|meeting time|location|place|venue)\s*:\s*/i,'').trim();
 const literalTitle=headerLines.find(line=>/\bminutes\b|\bagenda\b|\bscript\b|meeting|discussion/i.test(line)&&!/^(?:date|time|location|place|venue)\s*:/i.test(line))??headerLines[0]??documents[0]?.title??'Meeting source';
 const organizationName=headerLines.find(line=>/society|association|roundtable|pga?ir/i.test(line)&&line!==literalTitle&&!/^(?:date|time|location|place|venue)\s*:/i.test(line));
 const bareTime=dateLine?.match(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?(?:\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?)?/i)?.[0];
 const location=locationIndex>=0?headerLines.slice(locationIndex,locationIndex+3).filter((line,index)=>index===0||(!/^(?:date|time|teleconference|present|regrets)\s*:/i.test(line)&&!categoryLabel(line))).join('\n'):undefined;
 return {literalTitle,lines:headerLines,...(organizationName?{organizationName}:{}),...(dateLine?{dateText:value(dateLine)}:{}),...(timeLine||bareTime?{timeText:timeLine?value(timeLine):bareTime}:{}),...(location?{locationText:value(location)}:{})};
}
export function buildSourceMeetingRecord(args:{sourceDocuments:SourceMeetingDocumentInput[];minutes?:any;meeting?:any}):SourceMeetingRecord {
 const documents=args.sourceDocuments.map(source=>{
  const content=parsed(source.content);
  const fullText=readableSourceText(source.fullText??source.extractedText??content.extractedText??source.selectedText??'');
  const selectedText=readableSourceText(source.selectedText??fullText);
  let blocks:SourceMeetingBlock[]=source.blocks?.length?JSON.parse(JSON.stringify(source.blocks)):parseSourceMeetingBlocks(fullText);
  let primaryBlockStart=source.primaryBlockStart??0;let primaryBlockEnd=source.primaryBlockEnd??blocks.length;
  if(!source.blocks?.length&&selectedText.trim()&&selectedText.trim()!==fullText.trim()){
   const start=fullText.indexOf(selectedText);if(start>=0){
    const before=parseSourceMeetingBlocks(fullText.slice(0,start));const primary=parseSourceMeetingBlocks(selectedText);const after=parseSourceMeetingBlocks(fullText.slice(start+selectedText.length));
    primaryBlockStart=before.length;primaryBlockEnd=before.length+primary.length;blocks=[...before,...primary,...after];
   }
  }
  primaryBlockStart=Math.max(0,Math.min(blocks.length,primaryBlockStart));primaryBlockEnd=Math.max(primaryBlockStart,Math.min(blocks.length,primaryBlockEnd));
  return {documentId:source._id??source.documentId??'',title:source.title??content.title??'Source document',sourceReference:source.sourceReference??source.title??content.title??'Meeting source',selectedText,fullText,blocks,primaryBlockStart,primaryBlockEnd,
   purpose:source.purpose??'main' as 'main'|'supporting_package',...(source.originalUrl?{originalUrl:source.originalUrl}:{}),...(source.originalSha256?{originalSha256:source.originalSha256}:{}),...(source.originalDownload?{originalDownload:JSON.parse(JSON.stringify(source.originalDownload))}:{})};
 }).filter(document=>document.fullText||document.blocks.length);
 const sourceKind=args.sourceDocuments.find(document=>document.sourceKind)?.sourceKind??args.minutes?.sourceTransposition?.sourceKind??'recorded_minutes';
 return {version:1,sourceKind,reviewStatus:'imported_needs_review',header:sourceHeader(documents),participants:participantsFromDocuments(documents),documents,
  sectionBaseline:JSON.parse(JSON.stringify(args.minutes?.sections??[])),
  structuredBaseline:{motions:JSON.parse(JSON.stringify(args.minutes?.motions??args.minutes?.displayMotions??[])),decisions:JSON.parse(JSON.stringify(args.minutes?.decisions??[])),actionItems:JSON.parse(JSON.stringify(args.minutes?.actionItems??[])),details:JSON.parse(JSON.stringify(Object.fromEntries(['chairName','secretaryName','recorderName','calledToOrderAt','adjournedAt','remoteParticipation','detailedAttendance','attendees','absent','nextMeetingAt','nextMeetingLocation','nextMeetingNotes','sessionSegments','appendices','agmDetails','discussion'].map(key=>[key,args.minutes?.[key]??null]))))},
  note:sourceKind==='recorded_minutes'?'Literal source wording is retained. Imported minutes remain subject to source review and adoption.':'Literal proposed source wording is retained. A script, agenda or template does not establish that the meeting occurred or a decision passed.'};
}
export function resolveSourceMeetingRecord(minutes:any):SourceMeetingRecord|undefined {
 const existing=minutes?.sourceMeetingRecord??minutes?.sourceTransposition?.sourceMeetingRecord;
 return existing?.version===1&&Array.isArray(existing.documents)?existing:undefined;
}
export function sourceMinuteSectionComparable(section:any):string {
 return JSON.stringify(['title','type','presenter','discussion','motionText','reportSubmitted','decisions','actionItems','linkedTaskIds','sourceKind','sourceReference','sourceReviewStatus','sourceEvidence'].map(key=>section?.[key]??null));
}
/** Imported sections are a projection, not a second complete copy in the export.
 * Later additions/edits remain explicit alongside the unchanged source record. */
export function isUnchangedSourceMinuteSection(record:SourceMeetingRecord,section:any):boolean {
 return record.sectionBaseline.some(baseline=>sourceMinuteSectionComparable(baseline)===sourceMinuteSectionComparable(section));
}
export function changedSourceMinuteSections(record:SourceMeetingRecord,sections:any[]=[]):any[] {
 const remaining=record.sectionBaseline.map(section=>sourceMinuteSectionComparable(section));
 return sections.filter(section=>{const value=sourceMinuteSectionComparable(section);const index=remaining.indexOf(value);if(index>=0){remaining.splice(index,1);return false;}return true;});
}
export function sourceMeetingTokens(text:string):string[] {return readableSourceText(text).normalize('NFKC').match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}|]/gu)??[];}
/** Check both selected meeting and full source package coverage. Extra image
 * alt/caption text is allowed; missing source words or punctuation are not. */
export function preflightSourceMeetingRecord(record:SourceMeetingRecord):{passed:boolean;documents:Array<{documentId:string;expectedTokens:number;renderedTokens:number;missingTokens:string[];fullExpectedTokens:number;fullRenderedTokens:number;fullMissingTokens:string[]}>;tableCount:number;imageCount:number} {
 const coverage=(expectedText:string,renderedText:string)=>{
  const expected=sourceMeetingTokens(expectedText);const rendered=sourceMeetingTokens(renderedText);const missingTokens:string[]=[];let cursor=0;
  for(const token of expected){const found=rendered.indexOf(token,cursor);if(found<0)missingTokens.push(token);else cursor=found+1;}
  return {expectedTokens:expected.length,renderedTokens:rendered.length,missingTokens};
 };
 const documents=record.documents.map(document=>{
  const primary=coverage(document.selectedText,document.blocks.slice(document.primaryBlockStart,document.primaryBlockEnd).map(sourceMeetingBlockText).join('\n'));
  const full=coverage(document.fullText,document.blocks.map(sourceMeetingBlockText).join('\n'));
  return {documentId:document.documentId,...primary,fullExpectedTokens:full.expectedTokens,fullRenderedTokens:full.renderedTokens,fullMissingTokens:full.missingTokens};
 });
 const countBlocks=(blocks:SourceMeetingBlock[],kind:string):number=>blocks.reduce((count,block)=>count+(block.kind===kind?1:0)+(block.kind==='table'?block.rows.reduce((sum,row)=>sum+row.cells.reduce((cellSum,cell)=>cellSum+countBlocks(cell.blocks??[],kind),0),0):0),0);
 return {passed:documents.every(document=>!document.missingTokens.length&&!document.fullMissingTokens.length),documents,tableCount:record.documents.reduce((count,document)=>count+countBlocks(document.blocks,'table'),0),imageCount:record.documents.reduce((count,document)=>count+countBlocks(document.blocks,'image'),0)};
}
