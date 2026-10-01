import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError } from "better-auth/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

// The deployment's environment variables (`npx convex env set`).
declare const process: { env: Record<string, string | undefined> };

export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
  local: { schema: authSchema },
});

/** Accounts with this role edit the hospital and manage the other accounts. */
const ADMIN = "admin";

/** Whether an account has the admin role (Better Auth keeps several roles comma-separated). */
const isAdmin = (user: { role?: string | null }) =>
  (user.role ?? "").split(",").some((r) => r.trim() === ADMIN);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    // The app's address (`SITE_URL`): the editor signs in through its /api/auth.
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    databaseHooks: {
      user: {
        create: {
          // Admins add accounts in the editor (/editor/accounts). Signing up is only open
          // while there are no accounts at all, and that first account becomes an admin.
          before: async (user, context) => {
            if (context?.path !== "/sign-up/email") return;
            if ((await context.context.internalAdapter.countTotalUsers()) > 0)
              throw new APIError("FORBIDDEN", { message: "Ask an admin to add an account for you." });
            return { data: { ...user, role: ADMIN } };
          },
        },
      },
    },
    plugins: [admin({ adminRoles: [ADMIN] }), convex({ authConfig })],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) => betterAuth(createAuthOptions(ctx));

/** The signed-in admin; throws for anyone else. Call before changing the hospital. */
export async function requireEditor(ctx: GenericCtx<DataModel>) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new ConvexError("Sign in to save");
  if (!isAdmin(user) || user.banned) throw new ConvexError("This account may not edit the hospital");
  return user;
}

/** The signed-in account and whether it may edit; null when signed out. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return user && { id: user._id, name: user.name, email: user.email, editor: isAdmin(user) && !user.banned };
  },
});

/** No accounts yet: whoever signs up first becomes the admin. */
export const open = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    return users.page.length === 0;
  },
});
