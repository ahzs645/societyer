/** Public function wrappers apply the shared action policy before handler work. */
import { makeFunctionReference } from "convex/server";
import { requireFunctionAction } from "../../shared/functions/actionPolicy";
import { toPortableQueryCtx } from "./portable";

function wrap(builder: any, name: string, kind: "query" | "mutation" | "action") {
  return (definition: any) => {
    const handler = definition.handler;
    return builder({ ...definition, handler: async (ctx: any, args: any) => {
      if (kind === "action") {
        await ctx.runQuery(makeFunctionReference<"query">("authorization:checkAction"), { name, kind, args });
      } else {
        await requireFunctionAction(await toPortableQueryCtx(ctx), name, kind, args);
      }
      return handler(ctx, args);
    } });
  };
}

export const authorizedQuery = <T>(name: string, builder: T): T => wrap(builder, name, "query") as T;
export const authorizedMutation = <T>(name: string, builder: T): T => wrap(builder, name, "mutation") as T;
export const authorizedAction = <T>(name: string, builder: T): T => wrap(builder, name, "action") as T;
