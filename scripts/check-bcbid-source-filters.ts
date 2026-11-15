import assert from 'node:assert/strict';
import {bcBidSourceFilters,matchesBcBidSourceFilters} from '../shared/bcBidSourceFilters';
import {underUnspsc,unspscAncestors,unspscCodesOf,unspscCounts,unspscLevel,unspscParent,unspscPrefix} from '../shared/unspsc';
import {BC_BID_TYPE_CROSSWALK,HISTORICAL_TYPE_PREFIX,currentTypeOf,historicalTypesOf} from '../shared/bcBidTypeCrosswalk';
import current from '../src/features/procurementReview/data/bc-bid-current-types.json';
import historical from '../src/features/procurementReview/data/bc-bid-historical-types.json';

const facts={sourceId:'bc-bid',taxonomyReleaseId:'taxonomy-release:UNSPSC:UNv260801',opportunityTypeGroupCode:'itq',industryCategories:['Goods'],sourceRegionPath:'|CA_STATE_BC|CA_BC_R1|',classificationCodes:['25101507']};
const row={analyticsJson:JSON.stringify(facts)};
const filters=bcBidSourceFilters({currentType:'itq',industryCategory:'Goods',officialRegion:'CA_STATE_BC',commodityCode:'25000000'});
assert(matchesBcBidSourceFilters(row,filters));
for (const key of Object.keys(filters)) assert(!matchesBcBidSourceFilters(row,{...filters,[key]:key==='commodityCode'?'10000000':'different'}));
assert(!matchesBcBidSourceFilters({},filters));
for (const code of ['25000000','25100000','25101500','25101507']) assert(matchesBcBidSourceFilters(row,{commodityCode:code}),code);
for (const code of ['25200000','25101600','25101508']) assert(!matchesBcBidSourceFilters(row,{commodityCode:code}),code);
assert.throws(()=>bcBidSourceFilters({commodityCode:'25'}));

// The crosswalk names only real codes, and every pre-2023 type is either crosswalked or pre-2023 only.
const currentCodes=new Set(current.types.map(type=>type.code)), historicalCodes=new Set(historical.types.map(type=>type.code));
assert.equal(currentCodes.size,23); assert.equal(historicalCodes.size,33);
for (const [code,{current:target}] of Object.entries(BC_BID_TYPE_CROSSWALK)) {
  assert(historicalCodes.has(code),`unknown pre-2023 type ${code}`);
  assert(currentCodes.has(target),`unknown current type ${target}`);
}
const unmapped=[...historicalCodes].filter(code=>!currentTypeOf(code)).sort();
assert.deepEqual(unmapped,['AFS','Climate','DirectAward','Onboarding','RFA']);
assert.deepEqual([...currentCodes].filter(code=>!historicalTypesOf(code).length).sort(),['can','other','ta']);
// Exact means the same title; Request for Quotation is a quote, not current `rfq` (Request for Qualifications).
const titleOf=(list:{code:string;title:string}[],code:string)=>list.find(type=>type.code===code)?.title.replace(/s$/,'');
for (const [code,{current:target,match}] of Object.entries(BC_BID_TYPE_CROSSWALK)) if (match==='exact') assert.equal(titleOf(historical.types,code),titleOf(current.types,target),code);
assert.equal(currentTypeOf('RFQ'),'itq'); assert.equal(currentTypeOf('RQU'),'rfq');
assert.deepEqual(historicalTypesOf('rfp'),[{code:'RFP',match:'exact'},{code:'RFPS',match:'close'},{code:'SRFP',match:'close'}]);

// One type filter covers both eras.
const old=(code:string)=>({analyticsJson:JSON.stringify({sourceId:'bc-bid',historicalTypeReferenceId:HISTORICAL_TYPE_PREFIX+code})});
for (const code of ['RFP','RFPS','SRFP']) assert(matchesBcBidSourceFilters(old(code),{currentType:'rfp'}),code);
assert(matchesBcBidSourceFilters({analyticsJson:JSON.stringify({...facts,opportunityTypeGroupCode:'rfp'})},{currentType:'rfp'}));
assert(!matchesBcBidSourceFilters(old('RFQ'),{currentType:'rfq'}),'Request for Quotation is not Request for Qualifications');
assert(matchesBcBidSourceFilters(old('RFQ'),{currentType:'itq'}));
assert(!matchesBcBidSourceFilters(old('DirectAward'),{currentType:'rfp'}));
assert(!matchesBcBidSourceFilters(old('RFP'),{currentType:'ta'}));

// Older links: a crosswalked pre-2023 type reads as its current type; one without stays a pre-2023 filter.
assert.deepEqual(bcBidSourceFilters({historicalType:HISTORICAL_TYPE_PREFIX+'RFPS'}),{currentType:'rfp'});
assert.deepEqual(bcBidSourceFilters({historicalType:HISTORICAL_TYPE_PREFIX+'RFP',currentType:'rfp'}),{currentType:'rfp'});
assert.deepEqual(bcBidSourceFilters({historicalType:HISTORICAL_TYPE_PREFIX+'AFS'}),{historicalType:HISTORICAL_TYPE_PREFIX+'AFS'});
const direct=bcBidSourceFilters({historicalType:HISTORICAL_TYPE_PREFIX+'DirectAward'});
assert(matchesBcBidSourceFilters(old('DirectAward'),direct)); assert(!matchesBcBidSourceFilters(old('RFP'),direct));
// Conflicting types stay as given (and match nothing), rather than one silently replacing the other.
assert.deepEqual(bcBidSourceFilters({historicalType:HISTORICAL_TYPE_PREFIX+'RFP',currentType:'itt'}),{historicalType:HISTORICAL_TYPE_PREFIX+'RFP',currentType:'itt'});

// Pre-2023 notices carry GSIN, not UNSPSC, codes: a commodity code never matches them.
const historic={analyticsJson:JSON.stringify({...facts,historicalTypeReferenceId:'old'})};
assert(matchesBcBidSourceFilters(historic,{historicalType:'old'}));
assert(!matchesBcBidSourceFilters(historic,{historicalType:'different'}));
assert(!matchesBcBidSourceFilters(historic,{historicalType:'old',commodityCode:'25000000'}));
assert(!matchesBcBidSourceFilters({analyticsJson:JSON.stringify({...facts,historicalTypeReferenceId:HISTORICAL_TYPE_PREFIX+'RFQ'})},{currentType:'itq',commodityCode:'25000000'}));

// The UNSPSC rules the list filter, the commodity pages and the analytics share (shared/unspsc.ts).
assert.equal(unspscPrefix('43000000'),'43'); assert.equal(unspscPrefix('10100000'),'1010'); assert.equal(unspscPrefix('43231501'),'43231501');
assert.deepEqual(['43000000','43230000','43231500','43231501'].map(unspscLevel),[0,1,2,3]);
assert.equal(unspscParent('43231501'),'43231500'); assert.equal(unspscParent('43000000'),null);
assert.deepEqual(unspscAncestors('43231501'),['43000000','43230000','43231500']);
assert(underUnspsc(['43231501'],'43230000')); assert(!underUnspsc(['43230000'],'43231500'),'A family-level notice is not under the family\'s classes');
assert(!underUnspsc(['43231501'],'00000000'),'An all-zero code covers nothing');
assert.deepEqual(unspscCodesOf(facts),['25101507']);
assert.deepEqual(unspscCodesOf({...facts,taxonomyReleaseId:'taxonomy-release:GSIN:1'}),[],'GSIN codes are never read as UNSPSC');
assert.deepEqual(unspscCodesOf({...facts,historicalTypeReferenceId:HISTORICAL_TYPE_PREFIX+'RFQ'}),[],'Pre-2023 notices carry none');
assert.deepEqual(unspscCodesOf({...facts,classificationCodes:['25101507',{scheme:'GSIN',code:'R019BF'},'2510']}),['25101507']);
const counts=unspscCounts([['43231501','43231502'],['43230000'],['80101504']]);
assert.equal(counts.get('43000000'),2,'A notice counts once under each ancestor, however many of its codes sit there');
assert.equal(counts.get('43231500'),1); assert.equal(counts.get('43230000'),2); assert.equal(counts.get('43231502'),1); assert.equal(counts.has('43231600'),false);

console.log('BC Bid filters: AND, hierarchy, type crosswalk (both eras, older links), historical separation, unknown facts, validation and the shared UNSPSC rules passed');
