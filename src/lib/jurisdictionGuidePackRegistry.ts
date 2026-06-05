import bcGuidePackJson from "./jurisdictionGuidePacks/ca-bc.json";
import federalCbcaGuidePackJson from "./jurisdictionGuidePacks/ca-fed-cbca.json";
import ontarioObcaGuidePackJson from "./jurisdictionGuidePacks/ca-on-obca.json";

export const JURISDICTION_GUIDE_PACK_JSON = [
  bcGuidePackJson,
  federalCbcaGuidePackJson,
  ontarioObcaGuidePackJson,
] as const;
