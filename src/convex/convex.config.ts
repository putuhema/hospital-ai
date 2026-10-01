import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
// Editor accounts and sessions (Better Auth), kept in their own tables.
app.use(betterAuth);

export default app;
