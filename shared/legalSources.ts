import { SOCIETY_LEGAL_SOURCES } from './societyLegalProfile';
import { CORPORATE_LEGAL_SOURCES } from './corporateLegalSources';
import { GOVERNANCE_SUPPLEMENTAL_SOURCES } from './governanceSupplementalSources';
import { LEGAL_CALENDAR_SOURCES } from './legalCalendarSources';
export const LEGAL_SOURCES = [...SOCIETY_LEGAL_SOURCES, ...CORPORATE_LEGAL_SOURCES, ...GOVERNANCE_SUPPLEMENTAL_SOURCES, ...LEGAL_CALENDAR_SOURCES] as const;
export const legalSourceById = new Map(LEGAL_SOURCES.map(source => [source.id, source]));
