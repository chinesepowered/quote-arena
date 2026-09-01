import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Pill } from "../components/ui";
import { ago } from "../lib/format";
import { navigate } from "../lib/router";

/** Free-tier burn and unrouted mail, so the human can watch during judging. */
export function Admin() {
  const usage = useQuery(api.usage.today);
  const settings = useQuery(api.mail.getSettings);
  const unrouted = useQuery(api.mail.unrouted);
  const redact = (s?: string) => (s ? s.replace(/^[^@<]*/, "***") : "unknown");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="text-xs text-stone-500 hover:text-stone-900">← Back</a>
      <h1 className="mt-2 font-display text-2xl font-bold">Ops</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {["firecrawl", "llm", "agentmail"].map((p) => (
          <div key={p} className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{p} today</div>
            <div className="font-display text-3xl font-extrabold">{usage?.counts[p] ?? 0}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
        <span>App inbox:</span>
        <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{settings?.inboxAddress ?? "not created"}</code>
        {usage?.paused ? <Pill tone="red">PAUSED</Pill> : <Pill tone="green">running</Pill>}
        <span className="text-xs text-stone-400">{usage?.day}</span>
      </div>
      <h2 className="mt-8 font-display text-lg font-semibold">Unrouted inbound mail</h2>
      <p className="text-xs text-stone-500">Emails that matched no thread, job code, or known sender. Never dropped.</p>
      <ul className="mt-3 space-y-2">
        {unrouted?.length === 0 && <li className="text-sm text-stone-400">None.</li>}
        {unrouted?.map((m) => (
          <li key={m._id} className="rounded-xl bg-white p-3 text-sm ring-1 ring-stone-200">
            <div className="flex justify-between text-xs text-stone-500"><span>{redact(m.from)}</span><span>{ago(m.at)}</span></div>
            <div className="font-medium">{m.subject}</div>
            <div className="mt-1 line-clamp-2 text-xs text-stone-500">{m.extractedText}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
