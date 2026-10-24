/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { AnyApi } from "convex/server";
import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { anyApi, componentsGeneric } from "convex/server";

export const api: AnyApi = anyApi;
export const internal: AnyApi = anyApi;
export const components = componentsGeneric() as unknown as { betterAuth: ComponentApi<"betterAuth"> };
