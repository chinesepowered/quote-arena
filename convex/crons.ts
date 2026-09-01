import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 6 hours: one polite follow-up to contractors who have not replied in 48h.
crons.interval("nudge non-responders", { hours: 6 }, internal.nudges.sweep, {});

export default crons;
