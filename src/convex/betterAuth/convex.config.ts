import { defineComponent } from "convex/server";

// Better Auth installed locally (its tables are defined here), so plugins such as admin can add their fields.
const component = defineComponent("betterAuth");

export default component;
