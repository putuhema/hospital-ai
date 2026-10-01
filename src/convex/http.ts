import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Sign-in and sessions, reached through the app's /api/auth.
authComponent.registerRoutes(http, createAuth);

export default http;
