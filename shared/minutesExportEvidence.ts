import { resolveConflictMotion } from "./conflictMotion";

/** Both export entry points resolve evidence through the same view model. */
export function minutesEvidenceOptions(signatures: any[] = [], conflicts: any[] = [], proxies: any[] = [], directors: any[] = [], motions: any[] = []) {
  return {
    signatures: signatures.map(row => ({ signerName: row.signerName, signerRole: row.signerRole, signedAtISO: row.signedAtISO, imageDataUrl: row.imageDataUrl })),
    conflicts: conflicts.map(row => {
      const director = directors.find(item => item._id === row.directorId);
      const resolution = resolveConflictMotion(row, motions);
      return {
        directorName: director ? `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim() : "Director",
        contractOrMatter: row.contractOrMatter, natureOfInterest: row.natureOfInterest,
        abstainedFromVote: row.abstainedFromVote, leftRoom: row.leftRoom,
        motionLabel: resolution?.kind === "resolved" ? resolution.motion.name || resolution.motion.text : resolution?.kind === "stale" ? `[motion no longer on record: "${resolution.motionText}"]` : undefined,
      };
    }),
    proxies: proxies.map(row => ({ grantorName: row.grantorName, proxyHolderName: row.proxyHolderName, instructions: row.instructions, revoked: !!row.revokedAtISO })),
  };
}
