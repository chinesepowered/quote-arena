import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import { Button, Pill } from "../components/ui";
import { ago } from "../lib/format";
import { navigate, useLinkHandler } from "../lib/router";

export function Home() {
  const mine = useQuery(api.jobs.listMine);
  const demo = useQuery(api.jobs.demo);
  const onLink = useLinkHandler();

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-10 sm:px-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-stone-950 px-6 py-12 text-white shadow-2xl sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-gradient-to-br from-amber-400/40 to-orange-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-gradient-to-tr from-sky-500/20 to-emerald-400/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-amber-200 ring-1 ring-white/15">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Live quotes, no phone tag
          </div>
          <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Post the job once.
            <br />
            <span className="bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-400 bg-clip-text text-transparent">Watch the quotes fight.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-stone-300 sm:text-lg">
            Quote Arena finds local contractors, emails them all with your photos, and turns every reply into a normalized quote card — price, timeline, what's in, what's missing — on a leaderboard that reorders live.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" variant="gold" onClick={() => navigate("/new")}>
              Post a job →
            </Button>
            {demo && (
              <Button size="lg" variant="secondary" onClick={() => navigate(`/j/${demo.slug}`)}>
                Open the demo arena
              </Button>
            )}
          </div>
        </div>

        {/* Mini board preview */}
        <div className="relative mt-10 grid gap-2 sm:absolute sm:bottom-10 sm:right-10 sm:mt-0 sm:w-72">
          {[
            { n: 1, name: "Maple City Fencing", price: "$2,900", tone: "from-amber-300 to-orange-500 text-stone-950" },
            { n: 2, name: "Grand River Fence", price: "$4,100", tone: "from-slate-200 to-slate-400 text-slate-900" },
            { n: 3, name: "Tri-City Outdoor", price: "$3,650", tone: "from-orange-200 to-amber-700 text-white" },
          ].map((r, i) => (
            <motion.div
              key={r.n}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.1, type: "spring", stiffness: 300, damping: 26 }}
              className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10 backdrop-blur"
            >
              <span className={`grid size-8 place-items-center rounded-lg bg-gradient-to-br font-display text-sm font-extrabold ${r.tone}`}>{r.n}</span>
              <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
              <span className="font-display text-sm font-bold text-amber-200">{r.price}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mt-10 grid gap-3 sm:grid-cols-4">
        {[
          ["🔥", "Firecrawl finds them", "Searches the web for local contractors and reads their sites — with source links."],
          ["📬", "AgentMail asks them", "One inbox emails every contractor your job and photos, tagged with a job code."],
          ["🧠", "AI normalizes replies", "Price, timeline, includes, excludes — and “not stated” chips for what's missing."],
          ["⚡", "Convex keeps it live", "The board reorders the instant a better quote lands. Share it with the household."],
        ].map(([icon, title, body]) => (
          <div key={title} className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
            <div className="text-2xl">{icon}</div>
            <div className="mt-2 font-display font-semibold text-stone-900">{title}</div>
            <div className="mt-1 text-xs text-stone-500">{body}</div>
          </div>
        ))}
      </section>

      {/* Jobs */}
      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">Your arenas</h2>
          <Button variant="secondary" size="sm" onClick={() => navigate("/new")}>
            + New job
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {demo && (
            <a href={`/j/${demo.slug}`} onClick={onLink} className="group rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 p-4 ring-1 ring-amber-200 transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <Pill tone="gold">Demo arena</Pill>
                <span className="text-xs text-stone-500">{demo.quotes} quotes · {demo.found} contractors</span>
              </div>
              <div className="mt-2 font-display text-lg font-semibold text-stone-900 group-hover:underline">{demo.title}</div>
              <div className="text-xs text-stone-500">
                {demo.trade} · {demo.city}
              </div>
            </a>
          )}
          {mine === undefined && <div className="h-24 animate-pulse rounded-2xl bg-stone-100" />}
          {mine?.map((j) => (
            <a key={j._id} href={`/j/${j.slug}`} onClick={onLink} className="group rounded-2xl bg-white p-4 ring-1 ring-stone-200 transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <Pill tone={j.status === "decided" ? "green" : j.status === "sourcing" ? "amber" : "blue"}>{j.status}</Pill>
                <span className="text-xs text-stone-500">{ago(j.createdAt)}</span>
              </div>
              <div className="mt-2 font-display text-lg font-semibold text-stone-900 group-hover:underline">{j.title}</div>
              <div className="text-xs text-stone-500">
                {j.trade} · {j.city} · found {j.found} · contacted {j.contacted} · {j.quotes} quote{j.quotes === 1 ? "" : "s"}
              </div>
            </a>
          ))}
          {mine && mine.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-stone-200 p-6 text-center text-sm text-stone-500">
              No jobs of your own yet. <button className="font-semibold text-stone-900 underline" onClick={() => navigate("/new")}>Post your first</button> — it takes a minute.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
