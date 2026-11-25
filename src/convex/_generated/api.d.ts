/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as alertsSend from "../alertsSend.js";
import type * as answers from "../answers.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as gaps from "../gaps.js";
import type * as gapsDigest from "../gapsDigest.js";
import type * as hospital from "../hospital.js";
import type * as http from "../http.js";
import type * as leaflets from "../leaflets.js";
import type * as limits from "../limits.js";
import type * as live from "../live.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  alertsSend: typeof alertsSend;
  answers: typeof answers;
  auth: typeof auth;
  crons: typeof crons;
  gaps: typeof gaps;
  gapsDigest: typeof gapsDigest;
  hospital: typeof hospital;
  http: typeof http;
  leaflets: typeof leaflets;
  limits: typeof limits;
  live: typeof live;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
