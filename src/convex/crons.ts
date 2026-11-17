import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("forget old chat limits", { hourUTC: 19, minuteUTC: 0 }, internal.limits.sweep);
crons.hourly("forget expired chat answers", { minuteUTC: 5 }, internal.answers.sweep);
crons.daily("forget old unanswered questions", { hourUTC: 19, minuteUTC: 15 }, internal.gaps.sweep);
crons.hourly("forget yesterday's queue alerts", { minuteUTC: 20 }, internal.alerts.sweep);
// Monday 09.00 WITA (UTC+8).
crons.weekly("email the week's unanswered questions", { dayOfWeek: "monday", hourUTC: 1, minuteUTC: 0 }, internal.gapsDigest.send);
export default crons;
