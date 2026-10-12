/**
 * SYNTHETIC YCN Access tables for the YCN importer checks.
 *
 * Same table shapes and column names as a YCN `DB_GLOB_*` export (as read by
 * `mdb-export -D '%Y-%m-%d'`), with invented people, companies, addresses and
 * numbers. Nothing here comes from a real database.
 *
 * Edge cases covered, entity BC9900001:
 *  - two names, transition from the Company Act to the BCA;
 *  - registered-office history (three addresses, one superseded edit) and a
 *    records office that moved; a business address with an addressee and a contact;
 *  - registrations (BC incorporation + transition with the same number, Alberta
 *    extra-provincial) and annual filings (filed, not filed, date but not filed);
 *  - a person whose name and address change on the roster (INFO_STR/INFO_END);
 *  - a holding company holder; a roster-only person; the 2999 "no end" sentinel;
 *  - one officer who is both President and Secretary; a free-text office;
 *  - the certificate register: allotments, transfers with forward pointers
 *    (two certificates merging into one), a 1→5 subdivision with a replacement
 *    certificate, a 10→1 consolidation with replacement certificates and no
 *    pointers, a transfer with a balance certificate and no pointers, and a
 *    redemption (a certificate cancelled with nothing replacing it);
 *  - a superseded share row and a superseded settings row (ignored);
 *  - a two-digit birth year that is clear (age of majority) and one that is not.
 * Entity BC9900002 is a second, small company in the same database.
 */

import type { YcnRow, YcnTables } from "../../shared/ycnAccessImport";

const E1 = "BC9900001";
const E2 = "BC9900002";

let dbId = 0;
const row = (ent: string, fields: YcnRow): YcnRow => ({
  ENT_ID: ent,
  DB_ID: String((dbId += 1)),
  ENTRY_DT_TM: "20240101.09",
  ENTRY_BY: "Synthetic",
  REVISE_DT_TM: "",
  REVISE_BY: "",
  ...fields,
});

/** A share row; YCN uses `Ent_ID` casing on this table. */
const share = (fields: YcnRow): YcnRow => {
  const { ENT_ID, ...rest } = row(E1, fields);
  return { Ent_ID: ENT_ID, ...rest };
};

export const SYNTHETIC_ENTITY_IDS = { primary: E1, second: E2 } as const;

export function syntheticYcnTables(): YcnTables {
  dbId = 0;
  return {
    DB_GLOB_CORP_NAME: [
      row(E1, { REG_POSN: "1", CORP_NAME: "Example Widgets Ltd.", SHORT_NAME: "the Company", START_DT_TM: "20050301.09" }),
      row(E1, { REG_POSN: "2", CORP_NAME: "Synthetic Holdings Ltd.", SHORT_NAME: "the Company", START_DT_TM: "20120601.09" }),
      row(E2, { REG_POSN: "1", CORP_NAME: "Second Synthetic Corp.", SHORT_NAME: "the Corporation", START_DT_TM: "20230115.09" }),
    ],
    DB_GLOB_CONSTATING: [
      row(E1, { JURISDICTION: "British Columbia", LEGISLATION: "Company Act (British Columbia)", REG_ACTION: "incorporated", REG_NUMBER: "", START_DT_TM: "20050301.09" }),
      row(E1, { JURISDICTION: "British Columbia", LEGISLATION: "Business Corporations Act (British Columbia)", REG_ACTION: "transitioned", REG_NUMBER: "", START_DT_TM: "20060601.09" }),
    ],
    DB_GLOB_REG_OFFICE: [
      row(E1, { REG_POSN: "1", ADDRESS: "100 Example Street, Exampleton, BC V1A 1A1", START_DT_TM: "20050301.09" }),
      row(E1, { REG_POSN: "2", ADDRESS: "250 Sample Road, Exampleton, BC Canada V1A 2B2", START_DT_TM: "20100115.09", REVISE_DT_TM: "20200101.1015" }),
      row(E1, { REG_POSN: "2", ADDRESS: "250 Sample Road, Suite 4, Exampleton, BC Canada V1A 2B2", START_DT_TM: "20100115.09" }),
      row(E1, { REG_POSN: "3", ADDRESS: "77 Placeholder Way, Testville, BC V2C 3D4", START_DT_TM: "20180701.09" }),
      row(E2, { REG_POSN: "1", ADDRESS: "9 Fictional Lane, Mocktown, AB T1X 1X1", START_DT_TM: "20230115.09" }),
    ],
    DB_GLOB_REC_OFFICE: [
      row(E1, { REG_POSN: "1", ADDRESS: "100 Example Street, Exampleton, BC V1A 1A1", START_DT_TM: "20050301.09" }),
      row(E1, { REG_POSN: "2", ADDRESS: "77 Placeholder Way, Testville, BC V2C 3D4", START_DT_TM: "20180701.09" }),
    ],
    DB_GLOB_BUS_ADDRESS: [
      row(E1, {
        ADDRESS_1: "Synthetic Holdings Head Office", ADDRESS_2: "77 Placeholder Way", ADDRESS_3: "Testville, British Columbia", ADDRESS_4: "V2C 3D4",
        ADDRESS_5: "", ADDRESS_6: "", ADDRESS_7: "", ADDRESS_8: "", CONTACT_1: "Alexandra Sample", CONTACT_2: "Director", START_DT_TM: "20180701.09",
      }),
    ],
    DB_GLOB_REG_FILING: [
      row(E1, { REG_POSN: "1", JURISDICTION: "British Columbia", REGN_YN: "Y", REGN_NAT: "Incorporation", REGN_LEG: "Company Act (British Columbia)", REGN_NUM: "BC9900001", REGN_DT_TM: "20050301.09" }),
      row(E1, { REG_POSN: "2", JURISDICTION: "British Columbia", REGN_YN: "Y", REGN_NAT: "Transition", REGN_LEG: "Business Corporations Act (British Columbia)", REGN_NUM: "BC9900001", REGN_DT_TM: "20060601.09" }),
      row(E1, { REG_POSN: "3", JURISDICTION: "Alberta", REGN_YN: "Y", REGN_NAT: "XP Registration", REGN_LEG: "Business Corporations Act (Alberta)", REGN_NUM: "A0000001", REGN_DT_TM: "20120814.09" }),
      row(E1, { REG_POSN: "4", JURISDICTION: "British Columbia", FILE_YN: "Y", FILE_YEAR: "2016", FILE_DT_TM: "20160315.09" }),
      row(E1, { REG_POSN: "5", JURISDICTION: "British Columbia", FILE_YN: "Y", FILE_YEAR: "2017", FILE_DT_TM: "20170314.09" }),
      row(E1, { REG_POSN: "6", JURISDICTION: "British Columbia", FILE_YN: "", FILE_YEAR: "2018", FILE_DT_TM: "20180320.09" }),
      row(E1, { REG_POSN: "7", JURISDICTION: "Alberta", FILE_YN: "", FILE_YEAR: "2017", FILE_DT_TM: "" }),
    ],
    DB_GLOB_CORP_SETTINGS: [
      row(E1, { AGM_MONTH: "March", AGM_DAY: "31", FIN_MONTH: "December", FIN_DAY: "31", RESTRICT_PEOPLE_YND: "Y", WAIVE_PREP_FINANCIALS: "N", REVISE_DT_TM: "20210628.162047" }),
      row(E1, {
        AGM_MONTH: "May", AGM_DAY: "15", FIN_MONTH: "February", FIN_DAY: "29", RESTRICT_PEOPLE_YND: "D", DOC_PREP_LANGUAGE: "Default",
        WAIVE_PREP_FINANCIALS: "Y", CONT_PRIM_NAME: "Alexandra Sample", CONT_PRIM_EMAIL: "contact@example.test", LOC_MIN_BOOK: "77 Placeholder Way, Testville",
      }),
      row(E2, { AGM_MONTH: "June", AGM_DAY: "15", FIN_MONTH: "March", FIN_DAY: "31" }),
    ],
    Retain_List: [
      { ID: "1", CORP_NAME: "Synthetic Holdings Ltd.", ENT_ID: E1, CORP_NUM: "BC9900001", RESP_LWYR: "Pat Counsel" },
    ],
    DB_GLOB_ENT_PEOPLE: [
      { ENT_ID: E1, PERS_ID: "P001", GLOB_ID: "SYN001", INFO_STR: "20000101", INFO_END: "20181231", SIGN_ORDER: "1", INDIVIDUAL: "Y", FULL_NAME: "Alex Sample", ADDRESS: "100 Example Street, Exampleton, BC V1A 1A1", LAST_NAME: "Sample", FIRST_NAME: "Alex", MAJORITY: "Y", GENDER: "F" },
      { ENT_ID: E1, PERS_ID: "P001", GLOB_ID: "SYN001", INFO_STR: "20190101", INFO_END: "29991231", SIGN_ORDER: "1", INDIVIDUAL: "Y", FULL_NAME: "Alexandra Sample", ADDRESS: "200 Second Avenue, Exampleton, BC V1A 2B2", LAST_NAME: "Sample", FIRST_NAME: "Alexandra", MAJORITY: "Y", GENDER: "F" },
      { ENT_ID: E1, PERS_ID: "P002", GLOB_ID: "SYN002", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "2", INDIVIDUAL: "Y", FULL_NAME: "Blake Sample", ADDRESS: "300 Third Street, Exampleton, BC V1A 3C3", MAJORITY: "Y", GENDER: "M" },
      { ENT_ID: E1, PERS_ID: "P003", GLOB_ID: "SYN003", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "3", INDIVIDUAL: "Y", FULL_NAME: "Casey Sample", ADDRESS: "400 Fourth Street, Exampleton, BC V1A 4D4", MAJORITY: "Y", GENDER: "X" },
      { ENT_ID: E1, PERS_ID: "P004", GLOB_ID: "SYN004", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "4", INDIVIDUAL: "Y", FULL_NAME: "Dana Sample", ADDRESS: "500 Fifth Street, Exampleton, BC V1A 5E5", MAJORITY: "Y", GENDER: "F" },
      { ENT_ID: E1, PERS_ID: "P005", GLOB_ID: "SYN005", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "5", INDIVIDUAL: "Y", FULL_NAME: "Eli Sample", ADDRESS: "600 Sixth Street, Exampleton, BC V1A 6F6", MAJORITY: "Y", GENDER: "M" },
      { ENT_ID: E1, PERS_ID: "P006", GLOB_ID: "SYN006", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "5.1", INDIVIDUAL: "Y", FULL_NAME: "Finley Sample", ADDRESS: "700 Seventh Street, Exampleton, BC V1A 7G7", MAJORITY: "Y", GENDER: "M" },
      { ENT_ID: E1, PERS_ID: "P007", GLOB_ID: "SYN007", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "1", INDIVIDUAL: "N", CORP_SIGN: "By:", FULL_NAME: "Sample Holdco Ltd.", ADDRESS: "77 Placeholder Way, Testville, BC V2C 3D4" },
      { ENT_ID: E1, PERS_ID: "P008", GLOB_ID: "SYN008", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "2", INDIVIDUAL: "Y", FULL_NAME: "Gray Officer", ADDRESS: "800 Eighth Street, Exampleton, BC V1A 8H8", MAJORITY: "Y", GENDER: "M" },
      { ENT_ID: E1, PERS_ID: "P009", GLOB_ID: "SYN009", INFO_STR: "20000101", INFO_END: "", SIGN_ORDER: "6", INDIVIDUAL: "Y", FULL_NAME: "Harper Roster", ADDRESS: "900 Ninth Street, Exampleton, BC V1A 9J9", MAJORITY: "Y", GENDER: "F" },
      { ENT_ID: E2, PERS_ID: "Q001", GLOB_ID: "SYN101", INFO_STR: "20230115", INFO_END: "29991231", SIGN_ORDER: "1", INDIVIDUAL: "Y", FULL_NAME: "Indigo Second", ADDRESS: "9 Fictional Lane, Mocktown, AB T1X 1X1", MAJORITY: "Y", GENDER: "F" },
    ],
    DB_GLOB_PEOPLE_DIRECTORY: [
      { GLOB_ID: "SYN001", SEARCH_NAME: "Sample, Alexandra", FULL_NAME: "Alexandra Sample", LAST_NAME: "Sample", FIRST_NAME: "Alexandra", ADDRESS: "200 Second Avenue, Exampleton, BC V1A 2B2", INDIVIDUAL: "Y", INDIV_DOB: "1970-02-03", INDIV_CUR_MAJ: "Y", INDIV_CUR_GENDER: "F" },
      { GLOB_ID: "SYN002", SEARCH_NAME: "Sample, Blake", FULL_NAME: "Blake Sample", INDIVIDUAL: "Y", INDIV_DOB: "02/17/20 00:00:00", INDIV_CUR_MAJ: "Y", INDIV_CUR_GENDER: "M" },
      { GLOB_ID: "SYN003", SEARCH_NAME: "Sample, Casey", FULL_NAME: "Casey Sample", INDIVIDUAL: "Y", INDIV_DOB: "03/04/18 00:00:00", INDIV_CUR_MAJ: "", INDIV_CUR_GENDER: "X" },
      { GLOB_ID: "SYN007", SEARCH_NAME: "Sample Holdco Ltd.", FULL_NAME: "Sample Holdco Ltd.", INDIVIDUAL: "N", INDIV_DOB: "", CORP_SIGN: "By:" },
      { GLOB_ID: "SYN101", SEARCH_NAME: "Second, Indigo", FULL_NAME: "Indigo Second", INDIVIDUAL: "Y", INDIV_DOB: "1985-07-08", INDIV_CUR_MAJ: "Y", INDIV_CUR_GENDER: "F" },
      { GLOB_ID: "SYN900", SEARCH_NAME: "Elsewhere, Jordan", FULL_NAME: "Jordan Elsewhere", INDIVIDUAL: "Y", INDIV_DOB: "1990-01-01", INDIV_CUR_MAJ: "Y" },
    ],
    DB_GLOB_DIRECTOR: [
      row(E1, { REG_POSN: "1", APPOINT_DT_TM: "20050301.09", ID: "P001", Name: "Alex Sample", REMOVE_DT_TM: "" }),
      row(E1, { REG_POSN: "1", APPOINT_DT_TM: "20040101.09", ID: "P001", Name: "Alex Sample", REMOVE_DT_TM: "", REVISE_DT_TM: "20210101.09" }),
      row(E1, { REG_POSN: "2", APPOINT_DT_TM: "20050301.09", ID: "P002", Name: "Blake Sample", REMOVE_DT_TM: "20161115.09" }),
      row(E2, { REG_POSN: "1", APPOINT_DT_TM: "20230115.09", ID: "Q001", Name: "Indigo Second", REMOVE_DT_TM: "" }),
    ],
    DB_GLOB_OFFICER: [
      row(E1, { REG_POSN: "1", APPOINT_DT_TM: "20050301.09", REMOVE_DT_TM: "", ID: "P001", Name: "Alex Sample", PRES: "Y", SECR: "Y", OTHER: "" }),
      row(E1, { REG_POSN: "2", APPOINT_DT_TM: "20100214.09", REMOVE_DT_TM: "20160215", ID: "P008", Name: "Gray Officer", PRES: "", SECR: "", OTHER: "Chief Operating Officer" }),
      row(E1, { REG_POSN: "3", APPOINT_DT_TM: "20160411.09", REMOVE_DT_TM: "", ID: "P002", Name: "Blake Sample", PRES: "", SECR: "", OTHER: "Chief Synthetic Strategist" }),
    ],
    DB_GLOB_SHARE_CAPTL: [
      row(E1, { REG_POSN: "1", CLASS: "COMMON", SHR_DESC: "Common Shares without par value", SHR_SINGLE: "Common Share without par value", CREATION_DT_TM: "20050301.09", CANCEL_DT_TM: "", VOTING: "" }),
      row(E1, { REG_POSN: "2", CLASS: "CLASSB", SHR_DESC: "Class B Non-Voting Preferred Shares without Par Value", SHR_SINGLE: "Class B Non-Voting Preferred Share without Par Value", CREATION_DT_TM: "20050301.09", CANCEL_DT_TM: "", VOTING: "" }),
      row(E2, { REG_POSN: "1", CLASS: "COMMON", SHR_DESC: "Common Shares", SHR_SINGLE: "Common Share", CREATION_DT_TM: "20230115.09", CANCEL_DT_TM: "", VOTING: "1" }),
    ],
    DB_GLOB_SHARE_TRANS: [
      // Class B: allotment, transfer (forward pointer), second allotment, two certificates merging into one.
      share({ ISS_DT_TM: "20091116.09", HLDR_ID: "P003", HLDR_NAME: "Casey Sample", SHR_CLASS: "CLASSB", SHR_NUM: "1", SHR_CERT: "1A", SHR_CERT_REPL: "2A", SHR_CONSID_AMT: "10", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "20110412.09" }),
      share({ ISS_DT_TM: "20110412.09", HLDR_ID: "P004", HLDR_NAME: "Dana Sample", SHR_CLASS: "CLASSB", SHR_NUM: "1", SHR_CERT: "2A", SHR_CERT_REPL: "4A", ISS_TYP: "Transfer", CANCEL_DT_TM: "20161017.09" }),
      share({ ISS_DT_TM: "20110621.09", HLDR_ID: "P005", HLDR_NAME: "Eli Sample", SHR_CLASS: "CLASSB", SHR_NUM: "1", SHR_CERT: "3A", SHR_CERT_REPL: "4A", SHR_CONSID_AMT: "10", SHR_CONSID_CUR: "C$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "20161017.09" }),
      share({ ISS_DT_TM: "20161017.09", HLDR_ID: "P006", HLDR_NAME: "Finley Sample", SHR_CLASS: "CLASSB", SHR_NUM: "2", SHR_CERT: "4A", SHR_CERT_REPL: "5A", ISS_TYP: "Transfer", CANCEL_DT_TM: "20200609.09" }),
      // 1 → 5 subdivision: a +8 delta row, then a replacement certificate for 10.
      share({ ISS_DT_TM: "20200609.09", HLDR_ID: "P006", HLDR_NAME: "Finley Sample", SHR_CLASS: "CLASSB", SHR_NUM: "8", SHR_CERT: "", SHR_CERT_REPL: "5A", ISS_TYP: "Subdivision", CANCEL_DT_TM: "20200609.09" }),
      share({ ISS_DT_TM: "20200609.09", HLDR_ID: "P006", HLDR_NAME: "Finley Sample", SHR_CLASS: "CLASSB", SHR_NUM: "10", SHR_CERT: "5A", SHR_CERT_REPL: "Replacement", ISS_TYP: "Certificate", CANCEL_DT_TM: "20240331.09" }),
      // Common: allotments.
      share({ ISS_DT_TM: "20050301.09", HLDR_ID: "P001", HLDR_NAME: "Alex Sample", SHR_CLASS: "COMMON", SHR_NUM: "100", SHR_CERT: "1", SHR_CONSID_AMT: "100", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "20200922.09" }),
      share({ ISS_DT_TM: "20050301.09", HLDR_ID: "P002", HLDR_NAME: "Blake Sample", SHR_CLASS: "COMMON", SHR_NUM: "100", SHR_CERT: "2", SHR_CONSID_AMT: "100", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "20200922.09" }),
      share({ ISS_DT_TM: "20160215.09", HLDR_ID: "P001", HLDR_NAME: "Alex Sample", SHR_CLASS: "COMMON", SHR_NUM: "100", SHR_CERT: "3", SHR_CONSID_AMT: "100", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "20200922.09" }),
      share({ ISS_DT_TM: "20180305.09", HLDR_ID: "P007", HLDR_NAME: "Sample Holdco Ltd.", SHR_CLASS: "COMMON", SHR_NUM: "10", SHR_CERT: "4", SHR_CONSID_AMT: "10", SHR_CONSID_CUR: "$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "20200922.09" }),
      // A superseded edit of the last allotment: ignored.
      share({ ISS_DT_TM: "20180305.09", HLDR_ID: "P007", HLDR_NAME: "Sample Holdco Ltd.", SHR_CLASS: "COMMON", SHR_NUM: "12", SHR_CERT: "4", ISS_TYP: "Allot", REVISE_DT_TM: "20180102.101500" }),
      // 10 → 1 consolidation: negative delta rows (no certificate, no pointer) and replacement certificates.
      share({ ISS_DT_TM: "20200922.09", HLDR_ID: "P001", HLDR_NAME: "Alex Sample", SHR_CLASS: "COMMON", SHR_NUM: "-180", ISS_TYP: "Consolidation", CANCEL_DT_TM: "20200922.09" }),
      share({ ISS_DT_TM: "20200922.09", HLDR_ID: "P002", HLDR_NAME: "Blake Sample", SHR_CLASS: "COMMON", SHR_NUM: "-90", ISS_TYP: "Consolidation", CANCEL_DT_TM: "20200922.09" }),
      share({ ISS_DT_TM: "20200922.09", HLDR_ID: "P007", HLDR_NAME: "Sample Holdco Ltd.", SHR_CLASS: "COMMON", SHR_NUM: "-9", ISS_TYP: "Consolidation", CANCEL_DT_TM: "20200922.09" }),
      share({ ISS_DT_TM: "20200922.09", HLDR_ID: "P001", HLDR_NAME: "Alexandra Sample", SHR_CLASS: "COMMON", SHR_NUM: "20", SHR_CERT: "5", SHR_CERT_REPL: "Replacement", ISS_TYP: "Certificate", CANCEL_DT_TM: "20220531.09" }),
      share({ ISS_DT_TM: "20200922.09", HLDR_ID: "P002", HLDR_NAME: "Blake Sample", SHR_CLASS: "COMMON", SHR_NUM: "10", SHR_CERT: "6", SHR_CERT_REPL: "Replacement", ISS_TYP: "Certificate", CANCEL_DT_TM: "" }),
      share({ ISS_DT_TM: "20200922.09", HLDR_ID: "P007", HLDR_NAME: "Sample Holdco Ltd.", SHR_CLASS: "COMMON", SHR_NUM: "1", SHR_CERT: "7", SHR_CERT_REPL: "Replacement", ISS_TYP: "Certificate", CANCEL_DT_TM: "" }),
      // Transfer of 8 with a balance certificate of 12, no forward pointers recorded.
      share({ ISS_DT_TM: "20220531.09", HLDR_ID: "P004", HLDR_NAME: "Dana Sample", SHR_CLASS: "COMMON", SHR_NUM: "8", SHR_CERT: "8", ISS_TYP: "Transfer", CANCEL_DT_TM: "" }),
      share({ ISS_DT_TM: "20220531.09", HLDR_ID: "P001", HLDR_NAME: "Alexandra Sample", SHR_CLASS: "COMMON", SHR_NUM: "12", SHR_CERT: "9", ISS_TYP: "Transfer", CANCEL_DT_TM: "29991231" }),
      // Second entity: one allotment.
      { Ent_ID: E2, DB_ID: "900", REVISE_DT_TM: "", ISS_DT_TM: "20230115.09", HLDR_ID: "Q001", HLDR_NAME: "Indigo Second", SHR_CLASS: "COMMON", SHR_NUM: "100", SHR_CERT: "1", SHR_CONSID_AMT: "1", SHR_CONSID_CUR: "C$", SHR_CONSID_TYP: "Cash", ISS_TYP: "Allot", CANCEL_DT_TM: "" },
    ],
    DB_GLOB_DIVIDEND: [
      row(E1, { REG_POSN: "1", DECLARE_DT_TM: "20190520.09", CLASS: "COMMON", DIV_PER_SHARE: "5", SHR_TOTAL: "210", DIV_CURRENCY: "C$", DIV_TOTAL: "1050" }),
    ],
    DB_GLOB_TRANSPARENCY_REG: [
      row(E1, { REG_POSN: "1", NAME: "1. Alexandra Sample", ADDRESS: "200 Second Avenue, Exampleton, BC V1A 2B2", BIRTH: "19700203.09", CITIZEN: "Yes", TAX_RESIDENT_YN: "Y", START_DT: "20050301.09", END_DT: "", REASON: "Holds 25% or more of the voting shares" }),
      row(E1, { REG_POSN: "2", NAME: "2. Morgan Abroad", ADDRESS: "1 Faraway Road, Elsewhere, CA 90000", BIRTH: "19650909.09", CITIZEN: "France/U.S.", TAX_RESIDENT_YN: "N", START_DT: "20060725.09", END_DT: "20200101.09", REASON: "Has the right to elect a majority of directors" }),
    ],
    DB_GLOB_TRANSPARENCY_DUE: [
      row(E1, { REG_POSN: "1", NAME: "2. Morgan Abroad", STEPS: "Wrote twice to the last known address; no reply.", STEP_DT: "20191118.09" }),
    ],
    DB_GLOB_SERVICE_PROVIDERS: [
      row(E1, { APPOINT_DT_TM: "20150612.09", FUNCTION: "Auditors", FIRM_ID: "FIRM01", FIRM_NAME: "Example Audit LLP", FIRM_LOCATION: "Exampleton", CONTACT_NAME: "Quinn Auditor" }),
      row(E1, { APPOINT_DT_TM: "20050301.09", FUNCTION: "Corp_Rec_Lawyer", FIRM_ID: "FIRM02", FIRM_NAME: "Sample Law Corporation", FIRM_LOCATION: "Exampleton", CONTACT_NAME: "Pat Counsel" }),
    ],
    DB_GLOB_CORP_ASSETS: [
      row(E1, { REG_POSN: "1", ASSET_TYPE: "Equipment", ASSET_DESC: "Synthetic delivery van", ASSET_ID: "VIN-SYNTH-0001", ASSET_JUR: "BC", ASSET_QUANT: "1", ACQ_DT_TM: "20190520", ACQ_COST: "$48,000", ACQ_CURRENCY: "US$", ACQ_FROM: "Example Motors Ltd.", ACQ_COMMENTS: "Bought new" }),
      row(E1, { REG_POSN: "2", ASSET_TYPE: "Real Estate", ASSET_DESC: "Lot 1, Example Plan", ASSET_ID: "PID-000-000-001", ASSET_JUR: "BC", ASSET_QUANT: "1", ACQ_DT_TM: "20100610", ACQ_COST: "$300,000", ACQ_CURRENCY: "C$", DISP_DT_TM: "20120918", DISP_PRICE: "$420,000", DISP_CURRENCY: "C$", DISP_TO: "Example Buyer Inc.", DISP_COMMENTS: "Sold at market" }),
    ],
  };
}
