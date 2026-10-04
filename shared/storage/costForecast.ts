/** Manual USD scenario using the supplied R2 pricing evidence (retrieved 2026-10-04). */
export type R2ForecastInput = {
  storageClass: "standard" | "infrequent";
  gbMonths: number;
  classAOperations: number;
  classBOperations: number;
  retrievalGb: number;
  remainingFreeGbMonths: number;
  remainingFreeClassAOperations: number;
  remainingFreeClassBOperations: number;
  additionalMonthlyUsd: number;
};

export function forecastR2Cost(input: R2ForecastInput) {
  for (const [key, value] of Object.entries(input)) {
    if (key !== "storageClass" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("Enter finite, non-negative forecast values.");
  }
  if (!["standard", "infrequent"].includes(input.storageClass)) throw new Error("Choose a supported R2 storage class.");
  const standard = input.storageClass === "standard";
  // Free allowances belong to the account. Only the explicitly remaining share may be used here.
  const storageUnits = Math.ceil(Math.max(0, input.gbMonths - (standard ? input.remainingFreeGbMonths : 0)));
  const classAUnits = Math.ceil(Math.max(0, input.classAOperations - (standard ? input.remainingFreeClassAOperations : 0)) / 1_000_000);
  const classBUnits = Math.ceil(Math.max(0, input.classBOperations - (standard ? input.remainingFreeClassBOperations : 0)) / 1_000_000);
  const retrievalUnits = standard ? 0 : Math.ceil(input.retrievalGb);
  const storageUsd = storageUnits * (standard ? 0.015 : 0.01);
  const classAUsd = classAUnits * (standard ? 4.50 : 9.00);
  const classBUsd = classBUnits * (standard ? 0.36 : 0.90);
  const retrievalUsd = retrievalUnits * 0.01;
  return { storageUnits, classAUnits, classBUnits, retrievalUnits, storageUsd, classAUsd, classBUsd, retrievalUsd,
    totalUsd: storageUsd + classAUsd + classBUsd + retrievalUsd + input.additionalMonthlyUsd };
}
