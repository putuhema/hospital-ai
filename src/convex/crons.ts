import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("forget old chat limits", { hourUTC: 19, minuteUTC: 0 }, internal.limits.sweep);
crons.hourly("forget expired chat answers", { minuteUTC: 5 }, internal.answers.sweep);
export default crons;
