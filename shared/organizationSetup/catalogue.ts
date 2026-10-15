/**
 * The organization setup step catalogue (`/app/organization-setup`).
 *
 * Pure data and copy: which phases and steps apply to an organization, what
 * each one is called, why it matters and where it links. Completion rules live
 * in `evaluate.ts`; this module only decides wording and shape.
 *
 * Wording follows the legal identity:
 * - corporation vs society vs other organization (no society words in a
 *   corporation and no share words in a society or a not-for-profit),
 * - federal (Corporations Canada) vs BC (BC Registries) vs other registries,
 *   taken from the jurisdiction module contract,
 * - Acts without a registered pathway ("records only") keep the same phases
 *   but drop the pathway-specific steps and give no official link.
 */

import { jurisdictionModuleContract } from "../jurisdictionWorkspace";
import { formatLongDate } from "../locale";
import {
  ANOTHER_ACT_VALUE,
  incorporationActForValue,
  incorporationActTitle,
  incorporationJurisdiction,
  incorporationJurisdictionForCode,
} from "../incorporationActs";
import type { OrganizationOnboardingAnswers } from "../onboarding";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isCorporation, organizationEntityType, type LegalEntityLike } from "../organizationDomain";
import { organizationRuleScope } from "../entityRuleScope";
import { resolvePathway } from "../pathways/registry";
import type { Permission } from "../functions/permissions";
import { interfaceRouteReadPermission } from "../interfaceRouteAccess";
import type { SetupPhaseKey, SetupStepAction, SetupStepKey, SetupVariant } from "./types";

/** The organization fields the catalogue and evaluator read. */
export type SetupOrganization = LegalEntityLike & {
  name?: string | null;
  legalSubtype?: string | null;
  formationStatus?: string | null;
  organizationStatus?: string | null;
  isMemberFunded?: boolean | null;
  isCharity?: boolean | null;
  numbered?: boolean | null;
  registeredOfficeAddress?: string | null;
  incorporationNumber?: string | null;
  certificateDate?: string | null;
  certificateEvidenceDocumentId?: string | null;
  fiscalYearEnd?: string | null;
  annualMeetingDate?: string | null;
  craBnStatus?: string | null;
  charityStatus?: string | null;
  iscRegisterEntryDate?: string | null;
  transparencyEntryDate?: string | null;
  privacyProgramStatus?: string | null;
  filingSubmittedAtISO?: string | null;
  filingReference?: string | null;
  hasConstitutionDocument?: boolean;
  hasBylawsDocument?: boolean;
  hasPrivacyPolicyDocument?: boolean;
};

/** Everything the copy needs, derived once from the legal identity. */
export type SetupCopyContext = {
  /** "corporation" | "society" | "co-operative" | "organization". */
  noun: string;
  name: string;
  society: boolean;
  /** Shares and shareholders (a business corporation), else members. */
  shareBased: boolean;
  federal: boolean;
  bcCompany: boolean;
  bcSociety: boolean;
  /** The Act has a registered pathway with a preparation guide. */
  guided: boolean;
  /** Significant-control (CBCA, OBCA) or transparency (BC) register applies. */
  controlRegister: "isc" | "transparency" | null;
  memberFunded: boolean;
  /** Who you file with, e.g. "Corporations Canada", "BC Registries", "the Alberta registry". */
  registry: string;
  /** The online service, e.g. "Societies Online"; equals `registry` when there is no named service. */
  registryService: string;
  filingUrl?: string;
  /** Official Act title, e.g. "Canada Business Corporations Act (CBCA)". */
  actTitle: string;
  /** "Federal", "British Columbia", or "" when unknown. */
  placeName: string;
  /** "corporation number", "incorporation number", "registry number". */
  numberLabel: string;
  /** Titles of the preparation guide's requirements ("What you'll need"). */
  requirements: string[];
  operatingRegions?: string;
  classDetails?: string;
};

/** A catalogue step with its copy resolved for one organization. */
export type SetupStepDefinition = {
  key: SetupStepKey;
  phase: SetupPhaseKey;
  title: string;
  description: string;
  optional: boolean;
  /** "Doesn't apply to us" is offered (needs a reason). */
  allowNotApplicable: boolean;
  /** Filing and the certificate are lifecycle steps: no "Remind me later". */
  lifecycle: boolean;
  to?: string;
  actionLabel?: string;
  action?: SetupStepAction;
  externalUrl?: string;
  externalLabel?: string;
  /**
   * Read permissions the viewer needs to see this step's state and open its
   * page: the destination route's permission plus the registers the
   * completion rule reads. Missing any of them makes the step "restricted".
   */
  readPermissions: Permission[];
};

export type SetupPhaseDefinition = { key: SetupPhaseKey; title: string; description: string };

export const SETUP_PHASE_ORDER: readonly SetupPhaseKey[] = ["prepare", "file", "organize", "maintain"];

/** Preset reasons offered with "Doesn't apply to us" (free text is also accepted). */
export const SETUP_NOT_APPLICABLE_REASONS = [
  "No one owns 25% or more",
  "We only operate in one province",
  "Not needed for our organization",
] as const;

export const SETUP_DECISION_REASON_MAX = 300;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Possessive for registry names: "Corporations Canada's", "BC Registries'". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** Registry naming per jurisdiction module (`jurisdictionModuleContract`). */
function registryNames(organization: SetupOrganization, placeId?: string, placeName?: string): { registry: string; service: string } {
  const contract = jurisdictionModuleContract(organization);
  switch (contract.registryPortalKey) {
    case "corporations_canada":
      return { registry: contract.registryPortalLabel, service: `${possessive(contract.registryPortalLabel)} online filing service` };
    case "bc_registry_societies":
      return { registry: "BC Registries", service: "Societies Online" };
    case "bc_registry_companies":
      return { registry: "BC Registries", service: contract.registryPortalLabel };
    case "ontario_business_registry":
      return { registry: `the ${contract.registryPortalLabel}`, service: `the ${contract.registryPortalLabel}` };
    default: {
      // Federal Acts without a module (CNCA, co-operatives) still file with Corporations Canada.
      if (placeId === "CA") return { registry: "Corporations Canada", service: "Corporations Canada's online filing service" };
      const registry = placeName ? `the ${placeName} registry` : "the registry";
      return { registry, service: registry };
    }
  }
}

/** Derive wording and routing facts for an organization. */
export function setupCopyContext(organization: SetupOrganization, answers?: OrganizationOnboardingAnswers | null): SetupCopyContext {
  const scope = organizationRuleScope(organization);
  const entityType = organizationEntityType(organization).toLowerCase();
  const society = scope.isSociety;
  const noun = society ? "society"
    : entityType.includes("corporation") ? "corporation"
    : /co.?operativ/.test(entityType) ? "co-operative"
    : "organization";
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  const act = incorporationActForValue(organization.actFormedUnder, organization.jurisdictionCode ?? organization.homeJurisdictionCode);
  const place = act ? incorporationJurisdiction(act.jurisdiction) : incorporationJurisdictionForCode(code);
  const pathway = resolvePathway(organization as any);
  const guide = pathway.allowed ? pathway.pathway?.preparation : undefined;
  const guided = Boolean(guide);
  const pathwayKey = pathway.pathway?.key;
  const shareBased = isCorporation(organization);
  const federal = place?.id === "CA" || code === "CA-FED-CBCA";
  const bcCompany = shareBased && pathwayKey === "bc_company";
  const bcSociety = society && pathwayKey === "bc_society";
  const { registry, service } = registryNames(organization, place?.id, place?.name);
  const controlRegister = shareBased && (pathwayKey === "federal_cbca" || pathwayKey === "ontario_obca") ? "isc"
    : bcCompany ? "transparency"
    : null;
  const otherActName = answers?.otherActName;
  const actTitle = act
    ? incorporationActTitle(act, act.actFormedUnder === ANOTHER_ACT_VALUE ? otherActName : undefined)
    : clean(otherActName) || "your governing Act";
  return {
    noun,
    name: clean(organization.name) || `your ${noun}`,
    society,
    shareBased,
    federal,
    bcCompany,
    bcSociety,
    guided,
    controlRegister,
    memberFunded: Boolean(organization.isMemberFunded) || organization.legalSubtype === "member_funded_society",
    registry,
    registryService: service,
    filingUrl: guide?.filingChannel.onlineUrl,
    actTitle,
    placeName: place ? (place.id === "CA" ? "Federal" : place.name) : "",
    numberLabel: federal ? "corporation number" : place ? "incorporation number" : "registry number",
    requirements: guide?.requirements.map((requirement) => requirement.title) ?? [],
    operatingRegions: clean(answers?.operatingRegions) || undefined,
    classDetails: clean(answers?.classDetails) || undefined,
  };
}

/**
 * Which phase set applies. Preparing and submitted workspaces use the
 * corporation or society track; so does one that was incorporated through
 * that track. Everything else (unverified existing, legacy blank status, or
 * incorporated without having prepared here) is "already incorporated".
 */
export function setupVariant(organization: SetupOrganization, answers?: OrganizationOnboardingAnswers | null): SetupVariant {
  const status = clean(organization.formationStatus);
  const preparedHere = status === "preparing" || status === "submitted"
    || (status === "incorporated" && (answers?.organizationStage === "preparing" || Boolean(organization.filingSubmittedAtISO)));
  if (!preparedHere) return "existing";
  return organizationRuleScope(organization).isSociety ? "society_preparing" : "corporation_preparing";
}

/** Phase titles and descriptions for a variant. */
export function setupPhases(variant: SetupVariant, ctx: SetupCopyContext): SetupPhaseDefinition[] {
  const maintain: SetupPhaseDefinition = { key: "maintain", title: "Keep it in good standing", description: "Yearly tasks. Societyer reminds you when each is due." };
  const fileDescription = ctx.guided
    ? `You file online with ${ctx.registry} and pay the fee there. Societyer doesn't file for you.`
    : `You file with ${ctx.registry} and pay any fee there. Societyer doesn't file for you.`;
  if (variant === "existing") {
    return [
      { key: "prepare", title: "Confirm the basics", description: "Record the details from your certificate so deadlines use the real dates." },
      { key: "file", title: "Add your people", description: ctx.society ? "The directors who run the society and the members who belong to it." : `The people who run the ${ctx.noun} and the people who ${ctx.shareBased ? "own it" : "belong to it"}.` },
      { key: "organize", title: "Add your records", description: "Governing documents and past records, kept in one place." },
      maintain,
    ];
  }
  if (variant === "society_preparing") {
    return [
      { key: "prepare", title: "Get ready to apply", description: `Gather what ${ctx.registry} will ask for. Nothing here files anything.` },
      { key: "file", title: `Apply to ${ctx.registry}`, description: ctx.guided ? `You apply online through ${ctx.registryService} and pay the fee there. Societyer doesn't file for you.` : fileDescription },
      { key: "organize", title: "After your society is incorporated", description: "Your society exists from the date on the certificate. These steps organize it." },
      maintain,
    ];
  }
  return [
    { key: "prepare", title: "Get ready to file", description: `Gather what ${ctx.registry} will ask for. Nothing here files anything.` },
    { key: "file", title: `File with ${ctx.registry}`, description: fileDescription },
    { key: "organize", title: "After your certificate arrives", description: `Your ${ctx.noun} exists from the date on the certificate. These steps organize it.` },
    maintain,
  ];
}

/** "Waiting for Corporations Canada" while the filing is submitted. */
export function setupWaitingNote(ctx: SetupCopyContext): string {
  return `Waiting for ${ctx.registry}`;
}

/** Plain stage label for headers and the saved-answers summary. */
export function setupStageLabel(organization: SetupOrganization, ctx: SetupCopyContext): string {
  switch (clean(organization.formationStatus)) {
    case "preparing": return "Getting ready to incorporate";
    case "submitted": return `Filed — waiting for ${ctx.registry}`;
    case "incorporated": return organization.certificateDate ? `Incorporated on ${formatLongDate(organization.certificateDate)}` : "Incorporated";
    case "unverified_existing": return "Already incorporated — certificate not uploaded yet";
    default: return "Already incorporated";
  }
}

type StepInput = Omit<SetupStepDefinition, "optional" | "allowNotApplicable" | "lifecycle" | "readPermissions"> & {
  optional?: boolean;
  allowNotApplicable?: boolean;
  lifecycle?: boolean;
  /** Registers the completion rule reads, beyond the destination route. */
  reads?: Permission[];
};

function step(input: StepInput): SetupStepDefinition {
  const { reads = [], ...rest } = input;
  const route = input.to ? interfaceRouteReadPermission(input.to.split(/[?#]/)[0]) : undefined;
  const readPermissions = [...new Set([...(route ? [route] : []), ...reads])];
  return {
    ...rest,
    optional: input.optional ?? false,
    allowNotApplicable: input.allowNotApplicable ?? false,
    lifecycle: input.lifecycle ?? false,
    readPermissions,
  };
}

function placeSentence(ctx: SetupCopyContext): string {
  if (ctx.bcSociety) return "A BC society under the Societies Act.";
  if (!ctx.placeName) return `Under the ${ctx.actTitle}.`;
  return `${ctx.placeName}, under the ${ctx.actTitle}.`;
}

function actStep(ctx: SetupCopyContext): SetupStepDefinition {
  return step({
    key: "act", phase: "prepare",
    title: "Confirm where you're incorporating",
    description: `${placeSentence(ctx)} You chose this when you created the workspace.`,
    to: "/app/society", actionLabel: "Review legal details",
  });
}

function nameStep(ctx: SetupCopyContext): SetupStepDefinition {
  if (ctx.society) {
    return step({
      key: "name", phase: "prepare",
      title: "Reserve your society's name",
      description: ctx.guided ? "Get a name approved through BC Registries before you apply." : `Check with ${ctx.registry} that the name is available before you apply.`,
      // Societies can't use a numbered name, so this is a plain link.
      to: "/app/formation-maintenance?new=nameSearch", actionLabel: "Record a name request",
    });
  }
  const description = ctx.federal && ctx.shareBased
    ? "Use a numbered name, or pick a word name and get a NUANS name search report."
    : ctx.bcCompany
      ? "Use a numbered company, or pick a name and get it approved by BC Registries."
      : `Use a numbered name if ${ctx.registry} allows it, or pick a name and check that it's available.`;
  return step({
    key: "name", phase: "prepare",
    title: `Choose your ${ctx.noun}'s name`,
    description,
    // "Use a numbered name" sits beside this link (NameStepChoice); the link
    // opens the name search form directly.
    to: "/app/formation-maintenance?new=nameSearch", actionLabel: "Record a name search", action: "choose_name",
  });
}

function officeStep(ctx: SetupCopyContext, variant: SetupVariant): SetupStepDefinition {
  if (variant === "existing") {
    return step({
      key: "office", phase: "prepare",
      title: "Check the registered office address",
      description: "Where legal notices are delivered. Make sure it matches the registry.",
      to: "/app/society#registered-office", actionLabel: "Check the address",
    });
  }
  const description = ctx.bcSociety ? "A BC address for delivering and mailing records."
    : ctx.bcCompany ? "The BC address where legal notices are delivered."
    : ctx.federal ? "The official address in Canada where legal notices are delivered."
    : "The official address where legal notices are delivered.";
  return step({
    key: "office", phase: "prepare",
    title: "Add the registered office address",
    description,
    to: "/app/society#registered-office", actionLabel: "Add the address",
  });
}

function accessStep(ctx: SetupCopyContext, phase: SetupPhaseKey): SetupStepDefinition {
  return step({
    key: "access", phase,
    title: "Invite the people who'll use Societyer",
    description: `Directors and ${ctx.shareBased ? "shareholders" : "members"} don't get access automatically. Invite who needs it.`,
    to: "/app/users", actionLabel: "Invite people",
    reads: ["users:read"],
  });
}

function certificateStep(ctx: SetupCopyContext, variant: SetupVariant): SetupStepDefinition {
  if (variant === "existing") {
    return step({
      key: "certificate", phase: "prepare",
      title: "Upload your certificate of incorporation",
      description: "So Societyer can use the real incorporation date for deadlines.",
      actionLabel: "Record the certificate", action: "record_certificate", lifecycle: true,
    });
  }
  return step({
    key: "certificate", phase: "organize",
    title: "Record your certificate of incorporation",
    description: `Upload the certificate, then enter the ${ctx.numberLabel} and date shown on it.`,
    actionLabel: "Record the certificate", action: "record_certificate", lifecycle: true,
  });
}

function fileStep(ctx: SetupCopyContext): SetupStepDefinition {
  const external = ctx.guided && ctx.filingUrl
    ? { externalUrl: ctx.filingUrl, externalLabel: `Open ${ctx.registryService.replace(/'s? online filing service$/, "")}` }
    : {};
  if (!ctx.guided) {
    return step({
      key: "file", phase: "file",
      title: ctx.society ? "Apply to incorporate" : "File your incorporation",
      description: `Societyer doesn't have step-by-step guidance for the ${ctx.actTitle} yet. Use the registry's own instructions.`,
      actionLabel: "I've filed it", action: "mark_submitted", lifecycle: true,
    });
  }
  if (ctx.society) {
    return step({
      key: "file", phase: "file",
      title: `Apply through ${ctx.registryService}`,
      description: `Open ${ctx.registryService}, enter your details and pay the fee.`,
      actionLabel: "I've filed it", action: "mark_submitted", lifecycle: true, ...external,
    });
  }
  return step({
    key: "file", phase: "file",
    title: "File your incorporation online",
    description: `Open ${ctx.registryService}, enter the details you prepared, and pay the fee.`,
    actionLabel: "I've filed it", action: "mark_submitted", lifecycle: true, ...external,
  });
}

function maintainSteps(ctx: SetupCopyContext, variant: SetupVariant): SetupStepDefinition[] {
  const annualReport = ctx.bcCompany || ctx.society ? "annual report" : "annual return";
  const meeting = ctx.society
    ? step({
      key: "agm", phase: "maintain",
      title: ctx.bcSociety ? "Plan your AGM and annual report" : "Plan your annual general meeting",
      description: ctx.bcSociety ? "Hold an AGM each year and file the annual report within 30 days." : "Hold it each year as your bylaws and the Act require.",
      to: "/app/meetings", actionLabel: "Plan the meeting",
    })
    : step({
      key: "annual-meeting", phase: "maintain",
      title: `Plan the ${variant === "existing" ? "next" : "first"} annual ${ctx.shareBased ? "shareholders'" : "members'"} meeting`,
      description: ctx.guided && ctx.shareBased
        ? variant === "existing" ? "Hold it, or sign a written resolution instead, each year." : "Hold it, or sign a written resolution instead, within 18 months of incorporating."
        : "Hold it within the time the Act sets.",
      to: "/app/meetings", actionLabel: "Plan the meeting",
    });
  return [
    step({
      key: "fiscal-year", phase: "maintain",
      title: "Set your financial year-end",
      description: `Used to schedule the ${ctx.society ? "AGM" : "annual meeting"} and tax filings.`,
      to: "/app/compliance-settings", actionLabel: "Set the year-end",
    }),
    meeting,
    step({
      key: "calendar", phase: "maintain",
      title: "Turn on filing reminders",
      description: `Track the ${annualReport} and other deadlines.`,
      to: "/app/deadlines", actionLabel: "Open deadlines",
      reads: ["filings:read"],
    }),
    ...(variant === "existing" ? [
      step({
        key: "meetings", phase: "maintain",
        title: "Record this year's meetings",
        description: "Schedule meetings and keep the minutes and decisions together.",
        to: "/app/meetings", actionLabel: "Open meetings",
      }),
      step({
        key: "filings", phase: "maintain",
        title: "Track your registry filings",
        description: `The ${annualReport}, changes and their receipts.`,
        to: "/app/filings", actionLabel: "Open filings",
      }),
    ] : []),
    step({
      key: "privacy", phase: "maintain", optional: true,
      title: "Write down how you handle personal information",
      description: "A short privacy policy and who's responsible for it.",
      to: "/app/privacy", actionLabel: "Open privacy",
    }),
  ];
}

function corporationPreparingSteps(ctx: SetupCopyContext): SetupStepDefinition[] {
  const prepare: SetupStepDefinition[] = [
    actStep(ctx),
    nameStep(ctx),
    officeStep(ctx, "corporation_preparing"),
    ...(ctx.bcCompany ? [step({
      key: "records-office", phase: "prepare", allowNotApplicable: true,
      title: "Add the records office address",
      description: "Where the company keeps its records. It can be the same as the registered office.",
      to: "/app/society#registered-office", actionLabel: "Add the address",
      reads: ["documents:read"],
    })] : []),
    step({
      key: "directors", phase: "prepare",
      title: "Name your first directors",
      description: ctx.federal && ctx.shareBased
        ? "At least one person. At least 25% must be resident Canadians. Each director must agree to act."
        : ctx.bcCompany ? "At least one director. There's no residency rule. Each director must agree to act."
        : "At least one person. Each director must agree to act.",
      to: "/app/role-holders?role=director", actionLabel: "Add directors",
      reads: ["directors:read"],
    }),
    step({
      key: "shares", phase: "prepare",
      title: ctx.shareBased ? "Set out your share structure" : "Set out your membership classes",
      description: ctx.shareBased
        ? `The classes of shares and the rights each class has. This goes into the articles.`
        : "The classes of members and the rights each class has. This goes into the articles.",
      to: "/app/rights-ledger", actionLabel: ctx.shareBased ? "Add share classes" : "Add membership classes",
    }),
    ...(ctx.controlRegister === "isc" ? [step({
      key: "isc", phase: "prepare", allowNotApplicable: true,
      title: "List people with significant control",
      description: `Anyone who owns or controls 25% or more. ${ctx.federal ? "Corporations Canada asks for this when you file." : "You'll keep this register once the corporation exists."}`,
      to: "/app/significant-individuals", actionLabel: "Add people",
      reads: ["documents:read"],
    })] : ctx.controlRegister === "transparency" ? [step({
      key: "isc", phase: "prepare", allowNotApplicable: true,
      title: "Plan your transparency register",
      description: "Anyone who owns or controls 25% or more of the shares or votes. You'll keep this register once the company exists.",
      to: "/app/significant-individuals", actionLabel: "Add people",
      reads: ["documents:read"],
    })] : []),
    ...(ctx.guided ? [
      ctx.bcCompany
        ? step({
          key: "articles", phase: "prepare",
          title: "Prepare the incorporation agreement and articles",
          description: "Each person forming the company signs the agreement and takes at least one share. The articles set out the share rights and how the company is run.",
          to: "/app/post-incorporation", actionLabel: "Start the articles worksheet",
          reads: ["documents:read"],
        })
        : step({
          key: "articles", phase: "prepare",
          title: "Prepare the articles of incorporation",
          description: "Name, office province, share classes, transfer limits and number of directors, ready to enter in the online form.",
          to: "/app/post-incorporation", actionLabel: "Start the articles worksheet",
          reads: ["documents:read"],
        }),
      step({
        key: "review", phase: "prepare", optional: true,
        title: "Check your details before you file",
        description: "Optional. Have someone else check your filing details, or check them yourself if no one else can.",
        to: "/app/post-incorporation", actionLabel: "Open the review",
        reads: ["tasks:read"],
      }),
    ] : []),
  ];
  const organize: SetupStepDefinition[] = [
    certificateStep(ctx, "corporation_preparing"),
    ...(ctx.guided ? [step({
      key: "organize", phase: "organize",
      title: "Pass your first resolutions",
      description: ctx.bcCompany
        ? "Directors appoint officers, authorize share issues and set up banking."
        : "Directors adopt the by-laws, appoint officers, authorize share issues and set up banking.",
      to: "/app/post-incorporation", actionLabel: "Prepare the resolutions",
      reads: ["documents:read"],
    })] : []),
    step({
      key: "officers", phase: "organize", allowNotApplicable: true,
      title: "Appoint officers",
      description: "Usually a president and a secretary. One person can hold both.",
      to: "/app/role-holders?role=officer", actionLabel: "Add officers",
      reads: ["directors:read"],
    }),
    ctx.shareBased
      ? step({
        key: "issue-shares", phase: "organize",
        title: "Issue the first shares",
        description: "Record who got shares, how many, and what they paid. Shares can only be issued once paid for.",
        to: "/app/rights-ledger", actionLabel: "Issue shares",
      })
      : step({
        key: "members", phase: "organize",
        title: "Add your first members",
        description: "Keep a register of members and their membership class.",
        to: "/app/members", actionLabel: "Add members",
      }),
    step({
      key: "registers", phase: "organize",
      title: "Set up the minute book and registers",
      description: ctx.bcCompany
        ? "Keep the articles, resolutions and the director, officer and shareholder registers in the records office."
        : `Keep the articles, ${ctx.shareBased ? "by-laws, " : ""}resolutions and the director, officer and ${ctx.shareBased ? "shareholder" : "member"} registers together.`,
      to: "/app/minute-book", actionLabel: "Open the minute book",
      reads: ["documents:read", "directors:read", ...(ctx.shareBased ? [] : ["members:read" as Permission])],
    }),
    ...(ctx.controlRegister === "isc" ? [step({
      key: "isc-register", phase: "organize", allowNotApplicable: true,
      title: "Keep the significant-control register",
      description: "Record each person with significant control, and update the register within 15 days of a change.",
      to: "/app/significant-individuals", actionLabel: "Open the register",
      reads: ["documents:read"],
    })] : ctx.controlRegister === "transparency" ? [step({
      key: "isc-register", phase: "organize", allowNotApplicable: true,
      title: "Keep the transparency register",
      description: "Record each person who owns or controls 25% or more, and update it within 15 days of a change.",
      to: "/app/significant-individuals", actionLabel: "Open the register",
      reads: ["documents:read"],
    })] : []),
    step({
      key: "business-number", phase: "organize",
      title: "Confirm your business number",
      description: ctx.federal && ctx.shareBased
        ? "Corporations Canada usually issues a CRA business number with the certificate. Record it."
        : ctx.bcCompany ? "BC Registries usually arranges a CRA business number with the certificate. Record it."
        : "Get a business number from the Canada Revenue Agency if you don't have one, then record it.",
      to: "/app/society", actionLabel: "Record the number",
    }),
    step({
      key: "provinces", phase: "organize", optional: true, allowNotApplicable: true,
      title: ctx.federal ? "Register in provinces where you do business" : "Register in other provinces where you do business",
      description: `${ctx.federal ? "Each province you operate in" : "Each other province you operate in"} may need its own registration.${ctx.operatingRegions ? ` You said you'll operate in: ${ctx.operatingRegions}.` : ""}`,
      to: "/app/society#more-organization-details", actionLabel: "Add a registration",
    }),
    accessStep(ctx, "organize"),
  ];
  return [...prepare, fileStep(ctx), ...organize, ...maintainSteps(ctx, "corporation_preparing")];
}

function societyPreparingSteps(ctx: SetupCopyContext): SetupStepDefinition[] {
  const prepare: SetupStepDefinition[] = [
    actStep(ctx),
    nameStep(ctx),
    ...(ctx.guided ? [step({
      key: "constitution", phase: "prepare",
      title: "Write your constitution",
      description: "Your society's name and purposes.",
      to: "/app/post-incorporation", actionLabel: "Start the constitution",
      reads: ["documents:read"],
    })] : []),
    step({
      key: "bylaws", phase: "prepare",
      title: ctx.guided ? "Choose your bylaws" : "Prepare your bylaws",
      description: ctx.guided ? "Start from BC's model bylaws or write your own." : "The rules for members, meetings and directors.",
      to: ctx.guided ? "/app/post-incorporation" : "/app/documents", actionLabel: ctx.guided ? "Start the bylaws" : "Upload the bylaws",
      reads: ["documents:read"],
    }),
    step({
      key: "directors", phase: "prepare",
      title: "Name your first directors",
      description: !ctx.bcSociety ? "At least one person. Each director must agree to act."
        : ctx.memberFunded ? "At least one director. Member-funded societies have no BC residency rule."
        : "At least three, with at least one living in BC. Member-funded societies need only one.",
      to: "/app/directors", actionLabel: "Add directors",
    }),
    officeStep(ctx, "society_preparing"),
    ...(ctx.guided ? [step({
      key: "review", phase: "prepare", optional: true,
      title: "Check your details before you file",
      description: "Optional. Have someone else check your application, or check it yourself if no one else can.",
      to: "/app/post-incorporation", actionLabel: "Open the review",
      reads: ["tasks:read"],
    })] : []),
  ];
  const organize: SetupStepDefinition[] = [
    certificateStep(ctx, "society_preparing"),
    step({
      key: "members", phase: "organize",
      title: "Add your first members",
      description: "Keep a register of members and their membership class.",
      to: "/app/members", actionLabel: "Add members",
    }),
    ...(ctx.guided ? [step({
      key: "first-meeting", phase: "organize",
      title: "Hold your first directors' meeting",
      description: "Confirm officers, banking and where records are kept.",
      to: "/app/post-incorporation", actionLabel: "Prepare the resolution",
      reads: ["documents:read"],
    })] : []),
    step({
      key: "tax", phase: "organize", allowNotApplicable: true,
      title: "Check CRA accounts and charity status",
      description: "A business number, GST and charity registration are separate from incorporation.",
      to: "/app/society", actionLabel: "Record tax details",
    }),
    accessStep(ctx, "organize"),
  ];
  return [...prepare, fileStep(ctx), ...organize, ...maintainSteps(ctx, "society_preparing")];
}

function existingSteps(ctx: SetupCopyContext): SetupStepDefinition[] {
  const corporateRegisters = !ctx.society;
  const governingTitle = ctx.society ? "Upload your constitution and bylaws"
    : ctx.bcCompany ? "Upload your articles"
    : ctx.shareBased ? "Upload your articles and by-laws"
    : "Upload your governing documents";
  return [
    certificateStep(ctx, "existing"),
    step({
      key: "number", phase: "prepare",
      title: `Add your ${ctx.numberLabel}`,
      description: "It's on your certificate and on registry filings.",
      to: "/app/society", actionLabel: "Add the number",
    }),
    officeStep(ctx, "existing"),
    step({
      key: "directors", phase: "file",
      title: "Add your current directors",
      description: "Everyone on the board today.",
      to: corporateRegisters ? "/app/role-holders?role=director" : "/app/directors", actionLabel: "Add directors",
      reads: corporateRegisters ? ["directors:read"] : [],
    }),
    ...(corporateRegisters ? [step({
      key: "officers", phase: "file", allowNotApplicable: true,
      title: "Add your officers",
      description: "Such as the president, secretary and treasurer.",
      to: "/app/role-holders?role=officer", actionLabel: "Add officers",
      reads: ["directors:read"],
    })] : []),
    ctx.shareBased
      ? step({
        key: "owners", phase: "file",
        title: "Add your shareholders",
        description: "Everyone who holds shares today.",
        to: "/app/role-holders?role=shareholder", actionLabel: "Add shareholders",
      })
      : step({
        key: "owners", phase: "file",
        title: "Add your members",
        description: "Everyone on the member register today.",
        to: "/app/members", actionLabel: "Add members",
      }),
    ...(ctx.controlRegister ? [step({
      key: "isc-register", phase: "file", allowNotApplicable: true,
      title: ctx.controlRegister === "transparency" ? "Add your transparency register" : "Add people with significant control",
      description: "Anyone who owns or controls 25% or more.",
      to: "/app/significant-individuals", actionLabel: "Add people",
      reads: ["documents:read"],
    })] : []),
    step({
      key: "governing-docs", phase: "organize",
      title: governingTitle,
      description: "The signed copies on file with the registry.",
      // Corporations open the upload form with Articles already chosen.
      to: ctx.society ? "/app/documents" : "/app/documents?intent=new&category=ArticlesOfIncorporation&title=Articles%20of%20incorporation",
      actionLabel: "Upload documents",
    }),
    ...(ctx.shareBased ? [step({
      key: "shares", phase: "organize",
      title: "Record your share classes and who holds them",
      description: "Each class of shares and the current holdings.",
      to: "/app/rights-ledger", actionLabel: "Open the share register",
    })] : []),
    step({
      key: "minute-book", phase: "organize", optional: true,
      title: "Bring in past minutes and resolutions",
      description: "Older records help answer questions later.",
      to: "/app/minute-book", actionLabel: "Open the minute book",
    }),
    accessStep(ctx, "organize"),
    ...maintainSteps(ctx, "existing"),
  ];
}

/** The steps that apply to one organization, in display order, with copy resolved. */
export function setupStepCatalogue(variant: SetupVariant, ctx: SetupCopyContext): SetupStepDefinition[] {
  if (variant === "existing") return existingSteps(ctx);
  if (variant === "society_preparing") return societyPreparingSteps(ctx);
  return corporationPreparingSteps(ctx);
}

/** Every step key any variant can produce (for validation and tests). */
export function isKnownSetupStepKey(key: string): key is SetupStepKey {
  return KNOWN_KEYS.has(key);
}

const KNOWN_KEYS = new Set<string>([
  "act", "name", "office", "records-office", "directors", "shares", "isc", "articles", "review", "constitution", "bylaws",
  "file", "certificate", "organize", "officers", "issue-shares", "registers", "isc-register", "business-number",
  "provinces", "access", "members", "first-meeting", "tax", "number", "owners", "governing-docs", "minute-book",
  "fiscal-year", "annual-meeting", "agm", "calendar", "privacy", "meetings", "filings",
]);
