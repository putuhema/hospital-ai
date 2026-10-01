import { createAuth } from "../auth";

// A static instance for Better Auth's schema generation only (`npx auth generate` in this folder); never imported at runtime.
export const auth = createAuth({} as any);
