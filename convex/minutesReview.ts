import { authorizedMutation } from './lib/authorizedServer';
import { mutation } from './lib/untypedServer';
import { v } from 'convex/values';
import * as handlers from '../shared/functions/minutesReview';
import { toPortableMutationCtx } from './lib/portable';
export const saveEvidence = authorizedMutation('minutesReview:saveEvidence', mutation)({ args: { id: v.id('minutes'), evidence: v.any() }, returns: v.any(), handler: async (ctx, args) => handlers.saveEvidence(await toPortableMutationCtx(ctx), args) });
export const scheduleSuggestions = authorizedMutation('minutesReview:scheduleSuggestions', mutation)({ args: { id: v.id('minutes'), suggestionIds: v.array(v.string()) }, returns: v.any(), handler: async (ctx, args) => handlers.scheduleSuggestions(await toPortableMutationCtx(ctx), args) });
