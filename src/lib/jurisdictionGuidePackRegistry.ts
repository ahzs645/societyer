import bcGuidePackJson from "./jurisdictionGuidePacks/ca-bc.json";
import bcBcaGuidePackJson from "./jurisdictionGuidePacks/ca-bc-bca.json";
import federalCbcaGuidePackJson from "./jurisdictionGuidePacks/ca-fed-cbca.json";
import ontarioObcaGuidePackJson from "./jurisdictionGuidePacks/ca-on-obca.json";

export const JURISDICTION_GUIDE_PACK_JSON = [
  bcGuidePackJson,
  bcBcaGuidePackJson,
  federalCbcaGuidePackJson,
  ontarioObcaGuidePackJson,
] as const;
