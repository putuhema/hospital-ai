import { defineSchema } from "convex/server";
import { tables } from "./generatedSchema";

// Better Auth's tables, generated from convex/auth.ts (`npx auth generate --output generatedSchema.ts`
// in this folder after changing its options). Add indexes here, not fields: those come from the options.
export default defineSchema({ ...tables });
