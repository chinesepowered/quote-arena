import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ago, friendlyError, host } from "../lib/format";
import { Button, Field, Pill, Spinner, Tooltip, inputCls, useToast } from "./ui";

type Contractor = Doc<"contractors">;

const STATUS: Record<Contractor["rfqStatus"], { label: string; tone: "stone" | "green" | "red" | "amber" | "blue" | "violet" }> = {
  none: { label: "Not contacted", tone: "stone" },
  queued: { label: "Sending…", tone: "amber" },
  sent: { label: "Sent", tone: "blue" },
  delivered: { label: "Delivered", tone: "blue" },
  bounced: { label: "Bounced", tone: "red" },
  replied: { label: "Replied", tone: "green" },
  declined: { label: "Declined", tone: "red" },
};

export function ContractorPanel({
  job,
  contractors,
  canEdit,
  onOpenThread,
}: {
  job: Doc<"jobs">;
  contractors: Contractor[];
  canEdit: boolean;
  onOpenThread: (id: Id<"contractors">) => void;
}) {
  const toast = useToast();
  const setSelected = useMutation(api.contractors.setSelected);
  const sendRequests = useMutation(api.contractors.sendRequests);
  const rediscover = useMutation(api.jobs.rediscover);
  const [sending, setSending] = useState(false);
  const [adding, setAdding] = useState(false);

  const sourcing = job.sourcing;
  const running = sourcing?.state === "running";
  // Firecrawl runs on a shared credit pool. When it is reserved, say so rather
  // than let the panel look broken.
  const crawl = useQuery(api.crawlCache.status);
  const crawlPaused = crawl ? !crawl.live : false;
  const ready = contractors.filter((c) => c.selected && c.email && c.rfqStatus === "none");

  const onSend = async () => {
    setSending(true);
    try {
      const r = await sendRequests({ jobId: job._id });
      toast(r.queued ? `Sending ${r.queued} request${r.queued === 1 ? "" : "s"}…` : "Nothing to send", r.queued ? "success" : "info");
    } catch (e) {
      toast(friendlyError(e), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-stone-500">Contractors</h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            disabled={running}
            onClick={async () => {
              try {
                await rediscover({ jobId: job._id });
              } catch (e) {
                toast(friendlyError(e), "error");
              }
            }}
            title={crawlPaused ? "Live crawling is paused to protect the shared budget — this will replay saved results" : "Search the web again with Firecrawl"}
          >
            {running ? <Spinner className="size-3" /> : "🔥"} Find more
          </Button>
        )}
      </div>

      {/* Sourcing status */}
      <AnimatePresence initial={false}>
        {sourcing && sourcing.state !== "idle" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`mt-2 overflow-hidden rounded-xl px-3 py-2 text-xs ${
              sourcing.state === "error" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : running ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-stone-50 text-stone-600 ring-1 ring-stone-200"
            }`}
          >
            <div className="flex items-start gap-2">
              {running ? <Spinner className="mt-0.5 size-3 shrink-0" /> : <span className="shrink-0">{sourcing.state === "error" ? "⚠" : "🔥"}</span>}
              <div>
                <div className="font-medium">{running ? "Firecrawl is searching" : sourcing.state === "error" ? "Search stopped" : "Firecrawl search done"}</div>
                <div className="opacity-80">{sourcing.note}</div>
                {sourcing.queries && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {sourcing.queries.map((q) => (
                      <span key={q} className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-black/5">
                        “{q}”
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shared crawl budget reserved: saved results only. */}
      {crawlPaused && (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-sky-200">
          <span className="shrink-0">💤</span>
          <div>
            <div className="font-medium">Live search is resting</div>
            <div className="opacity-80">Showing saved results — live contractor search is paused to protect the shared crawl budget. Everything else on the arena still works, and you can add a contractor by hand.</div>
          </div>
        </div>
      )}

      {/* List */}
      <ul className="mt-3 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {contractors.map((c) => (
            <motion.li
              key={c._id}
              layout
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              <ContractorRow c={c} canEdit={canEdit} onToggle={(v) => setSelected({ contractorId: c._id, selected: v }).catch((e) => toast(friendlyError(e), "error"))} onOpenThread={() => onOpenThread(c._id)} />
            </motion.li>
          ))}
        </AnimatePresence>
        {contractors.length === 0 && !running && (
          <li className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">
            {crawlPaused
              ? "Nothing saved for this job yet, and live search is paused. Add a contractor below to keep going."
              : "No contractors yet. Add one below or run a search."}
          </li>
        )}
        {contractors.length === 0 && running && (
          <>
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-16 animate-pulse rounded-xl bg-stone-100" />
            ))}
          </>
        )}
      </ul>

      {canEdit && (
        <div className="mt-3 space-y-2">
          {adding ? (
            <AddContractor jobId={job._id} onDone={() => setAdding(false)} />
          ) : (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setAdding(true)}>
              + Add a contractor you know
            </Button>
          )}
          <Button variant="primary" className="w-full" busy={sending} disabled={!ready.length} onClick={onSend}>
            📬 Send {ready.length ? `${ready.length} request${ready.length === 1 ? "" : "s"}` : "requests"}
          </Button>
          <p className="text-center text-[11px] text-stone-400">Emails go out from the app inbox with your photos and a <span className="font-mono">[{job.caseCode}]</span> code so replies route back here.</p>
        </div>
      )}
    </div>
  );
}

function ContractorRow({ c, canEdit, onToggle, onOpenThread }: { c: Contractor; canEdit: boolean; onToggle: (v: boolean) => void; onOpenThread: () => void }) {
  const toast = useToast();
  const setEmail = useMutation(api.contractors.setEmail);
  const remove = useMutation(api.contractors.remove);
  const [email, setEmailDraft] = useState("");
  const s = STATUS[c.rfqStatus];
  const before = c.rfqStatus === "none";

  return (
    <div className={`rounded-xl bg-white p-3 ring-1 transition ${c.rfqStatus === "replied" ? "ring-emerald-200" : "ring-stone-200"}`}>
      <div className="flex items-start gap-2.5">
        {before && canEdit ? (
          <input
            type="checkbox"
            className="mt-1 size-4 accent-amber-500"
            checked={c.selected}
            disabled={!c.email}
            onChange={(e) => onToggle(e.target.checked)}
            title={c.email ? "Include in the request" : "Add an email first"}
          />
        ) : (
          <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${c.rfqStatus === "replied" ? "bg-emerald-500" : c.rfqStatus === "declined" || c.rfqStatus === "bounced" ? "bg-rose-400" : c.rfqStatus === "queued" ? "animate-pulse bg-amber-400" : "bg-sky-400"}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button className="min-w-0 text-left" onClick={onOpenThread} title="Open thread">
              <div className="truncate text-sm font-semibold text-stone-900 hover:underline">{c.name}</div>
            </button>
            <Pill tone={s.tone} className="shrink-0">
              {c.rfqStatus === "queued" && <Spinner className="size-2.5" />}
              {s.label}
            </Pill>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-stone-500">
            {c.services.slice(0, 3).map((svc) => (
              <span key={svc}>{svc}</span>
            ))}
            {c.ratingSnippet && <span className="text-amber-700">{c.ratingSnippet}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {c.email ? (
              <Pill tone="stone" title={c.email}>
                ✉ {c.email}
              </Pill>
            ) : (
              <Pill tone="amber" dashed>
                phone only
              </Pill>
            )}
            {c.phone && <Pill tone="stone">☎ {c.phone}</Pill>}
            {c.manual ? (
              <Pill tone="violet">added by you</Pill>
            ) : (
              <SourceHover c={c} />
            )}
          </div>
          {!c.email && canEdit && before && (
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await setEmail({ contractorId: c._id, email });
                  setEmailDraft("");
                } catch (err) {
                  toast(friendlyError(err), "error");
                }
              }}
            >
              <input className={`${inputCls} h-8 py-1 text-xs`} placeholder="Add their email" type="email" required value={email} onChange={(e) => setEmailDraft(e.target.value)} />
              <Button size="sm" variant="secondary" type="submit">
                Save
              </Button>
            </form>
          )}
          {c.lastError && <p className="mt-1.5 text-[11px] text-rose-700">Last send failed: {c.lastError}</p>}
          {c.sentAt && <p className="mt-1 text-[10px] text-stone-400">sent {ago(c.sentAt)}{c.nudgeCount ? ` · nudged ${c.nudgeCount}×` : ""}{c.repliedAt ? ` · replied ${ago(c.repliedAt)}` : ""}</p>}
        </div>
        {before && canEdit && (
          <button className="rounded p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-600" title="Remove" onClick={() => remove({ contractorId: c._id }).catch((e) => toast(friendlyError(e), "error"))}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function SourceHover({ c }: { c: Contractor }) {
  if (!c.sourceUrl) return null;
  return (
    <Tooltip
      wide
      content={
        <div>
          <div className="font-semibold text-white">How we found them</div>
          <div className="mt-0.5 text-stone-300">
            Firecrawl {c.model && c.model !== "heuristic" && c.model !== "seed" ? `→ ${c.model}` : c.model === "seed" ? "(seeded demo row)" : "→ pattern-matched"}
            {c.fetchedAt ? ` · ${ago(c.fetchedAt)}` : ""}
          </div>
          {c.sourceTitle && <div className="mt-1 truncate text-amber-200">{c.sourceTitle}</div>}
          {c.rawExcerpt && <pre className="mt-1 max-h-32 overflow-hidden whitespace-pre-wrap font-mono text-[10px] leading-snug text-stone-400">{c.rawExcerpt.slice(0, 400)}</pre>}
        </div>
      }
    >
      <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-800 ring-1 ring-orange-200 hover:bg-orange-100">
        🔥 via {host(c.sourceUrl)}
      </a>
    </Tooltip>
  );
}

function AddContractor({ jobId, onDone }: { jobId: Id<"jobs">; onDone: () => void }) {
  const toast = useToast();
  const add = useMutation(api.contractors.addManual);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await add({ jobId, name, email: email || undefined });
          toast("Contractor added", "success");
          onDone();
        } catch (err) {
          toast(friendlyError(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Name">
        <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dave's Fencing (or yourself, to test)" />
      </Field>
      <Field label="Email" hint="Use your own address to play the contractor in the demo.">
        <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="quotes@example.com" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" busy={busy}>
          Add
        </Button>
      </div>
    </form>
  );
}
