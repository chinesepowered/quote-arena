import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Leaderboard, type BoardQuote } from "../components/Leaderboard";
import { ContractorPanel } from "../components/Contractors";
import { Drawer } from "../components/Drawer";
import { CompareModal } from "../components/Compare";
import { Button, CopyButton, Counter, Modal, Pill, Spinner, Tooltip, useToast } from "../components/ui";
import { friendlyError } from "../lib/format";
import { navigate } from "../lib/router";

export function Arena({ slug }: { slug: string }) {
  const job = useQuery(api.jobs.getBySlug, { slug });
  const contractors = useQuery(api.contractors.list, job ? { jobId: job._id } : "skip");
  const board = useQuery(api.quotes.leaderboard, job ? { jobId: job._id } : "skip");
  const pendingQuestions = useQuery(api.questions.pendingCount, job ? { jobId: job._id } : "skip");
  const decide = useMutation(api.jobs.decide);
  const reopen = useMutation(api.jobs.reopen);
  const toast = useToast();

  const [focusContractor, setFocusContractor] = useState<Id<"contractors"> | null>(null);
  const [compareIds, setCompareIds] = useState<Id<"quotes">[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [winnerCandidate, setWinnerCandidate] = useState<Id<"contractors"> | null>(null);
  const [mobilePane, setMobilePane] = useState<"contractors" | "board" | "inbox">("board");

  useEffect(() => {
    if (job) document.title = `${job.title} · Quote Arena`;
    return () => {
      document.title = "Quote Arena";
    };
  }, [job]);

  const quotes = (board?.quotes ?? []) as BoardQuote[];
  const compared = useMemo(() => compareIds.map((id) => quotes.find((q) => q._id === id)).filter((q): q is BoardQuote => Boolean(q)), [compareIds, quotes]);

  const toggleCompare = useCallback((id: Id<"quotes">) => {
    setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 3 ? ids : [...ids, id]));
  }, []);

  const openThread = useCallback((id: Id<"contractors">) => {
    setFocusContractor(id);
    setMobilePane("inbox");
  }, []);

  const confirmWinner = async () => {
    if (!job || !winnerCandidate) return;
    try {
      await decide({ jobId: job._id, contractorId: winnerCandidate });
      setWinnerCandidate(null);
      fireConfetti();
      toast("Winner picked. The others get a polite note.", "success");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  };

  if (job === undefined) return <PageSkeleton />;
  if (job === null)
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold">Arena not found</h1>
        <p className="mt-2 text-sm text-stone-500">This link may be wrong, or the job was removed.</p>
        <Button className="mt-6" onClick={() => navigate("/")}>
          Back home
        </Button>
      </div>
    );

  const list = contractors ?? [];
  const found = list.length;
  const contacted = list.filter((c) => ["queued", "sent", "delivered", "replied", "declined", "bounced"].includes(c.rfqStatus)).length;
  const replied = list.filter((c) => ["replied", "declined"].includes(c.rfqStatus)).length;
  const winner = job.winnerContractorId ? list.find((c) => c._id === job.winnerContractorId) : undefined;
  const shareUrl = `${window.location.origin}/j/${job.slug}`;

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-4 sm:px-6 lg:pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <a href="/" className="hover:text-stone-900" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
              ← All jobs
            </a>
            <span>·</span>
            <Pill tone="stone">{job.trade}</Pill>
            <span>
              {job.city}, {job.region}
            </span>
            <span>·</span>
            <span className="font-mono">[{job.caseCode}]</span>
            {job.isDemo && <Pill tone="violet">demo arena · anyone can drive it</Pill>}
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">{job.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600 line-clamp-2">{job.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {job.photos.length > 0 && (
            <div className="flex -space-x-2">
              {job.photos.slice(0, 4).map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block size-10 overflow-hidden rounded-lg ring-2 ring-white shadow">
                  <img src={p.url} alt="" className="size-full object-cover" />
                </a>
              ))}
            </div>
          )}
          <CopyButton text={shareUrl} label="Share board" />
          {job.status === "decided" && job.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => reopen({ jobId: job._id }).catch((e) => toast(friendlyError(e), "error"))}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Status strip */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Found" value={found} hint="Contractors Firecrawl found or you added" icon="🔥" live={job.sourcing?.state === "running"} />
        <Stat label="Contacted" value={contacted} hint="Requests sent from the app inbox" icon="📬" />
        <Stat label="Replied" value={replied} hint="Replies routed back by thread or job code" icon="💬" />
        <Stat label="Quotes" value={quotes.length} hint="Normalized quotes on the board" icon="🏆" gold />
      </div>

      {job.status === "decided" && winner && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-600 px-5 py-3 text-white shadow-lg shadow-emerald-600/30">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Decided</div>
            <div className="font-display text-lg font-bold">You picked {winner.name}. Everyone else got a courtesy note.</div>
          </div>
          <Button variant="secondary" size="sm" onClick={fireConfetti}>
            🎉 Again
          </Button>
        </motion.div>
      )}

      {/* Mobile pane switcher */}
      <div className="mt-4 flex gap-1 rounded-xl bg-stone-100 p-1 lg:hidden">
        {(
          [
            ["contractors", `Contractors (${found})`],
            ["board", `Board (${quotes.length})`],
            ["inbox", `Inbox${pendingQuestions ? ` (${pendingQuestions})` : ""}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setMobilePane(id)} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${mobilePane === id ? "bg-white shadow-sm" : "text-stone-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Three columns */}
      <div className="mt-4 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_340px] xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className={`${mobilePane === "contractors" ? "" : "hidden"} lg:block`}>
          <div className="lg:sticky lg:top-4">
            {contractors ? <ContractorPanel job={job} contractors={list} canEdit={job.canEdit} onOpenThread={openThread} /> : <div className="h-64 animate-pulse rounded-2xl bg-stone-100" />}
          </div>
        </aside>

        <main className={`${mobilePane === "board" ? "" : "hidden"} min-w-0 lg:block`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-stone-500">Leaderboard</h2>
              <Tooltip wide content={<span>{board?.formula ?? ""}</span>}>
                <span className="cursor-help rounded-full bg-stone-200 px-1.5 text-[10px] font-bold text-stone-600">how ranking works</span>
              </Tooltip>
              <span className="flex items-center gap-1 text-[11px] text-emerald-700">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                live
              </span>
            </div>
            <Button variant={compareIds.length ? "primary" : "secondary"} size="sm" onClick={() => setCompareOpen(true)} disabled={!compareIds.length}>
              Compare {compareIds.length ? `(${compareIds.length})` : ""}
            </Button>
          </div>
          {board ? (
            <Leaderboard
              quotes={quotes}
              formula={board.formula}
              budgetBand={job.budgetBand}
              canEdit={job.canEdit}
              winnerId={job.winnerContractorId}
              decided={job.status === "decided"}
              compareIds={compareIds}
              onToggleCompare={toggleCompare}
              onReply={openThread}
              onPickWinner={(id) => setWinnerCandidate(id)}
            />
          ) : (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-48 animate-pulse rounded-2xl bg-stone-100" />
              ))}
            </div>
          )}
        </main>

        <aside className={`${mobilePane === "inbox" ? "" : "hidden"} lg:block`}>
          <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
            {contractors ? (
              <Drawer job={job} contractors={list} canEdit={job.canEdit} focusContractor={focusContractor} onFocusContractor={setFocusContractor} />
            ) : (
              <div className="h-64 animate-pulse rounded-2xl bg-stone-100" />
            )}
          </div>
        </aside>
      </div>

      <CompareModal open={compareOpen} onClose={() => setCompareOpen(false)} quotes={compared} />

      <Modal open={Boolean(winnerCandidate)} onClose={() => setWinnerCandidate(null)} title="Pick this contractor?">
        <p className="text-sm text-stone-600">
          <b>{list.find((c) => c._id === winnerCandidate)?.name}</b> will be marked the winner. Everyone else who quoted gets a short, polite “we went another way” email from the app inbox.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setWinnerCandidate(null)}>
            Cancel
          </Button>
          <Button variant="gold" onClick={confirmWinner}>
            🏆 Confirm winner
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, hint, icon, gold, live }: { label: string; value: number; hint: string; icon: string; gold?: boolean; live?: boolean }) {
  return (
    <div title={hint} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 ${gold ? "bg-gradient-to-br from-amber-50 to-orange-50 ring-amber-200" : "bg-white ring-stone-200"}`}>
      <span className="text-xl">{icon}</span>
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          {label}
          {live && <Spinner className="size-2.5" />}
        </div>
        <div className="font-display text-2xl font-extrabold leading-none text-stone-900">
          <Counter value={value} />
        </div>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6">
      <div className="h-8 w-72 animate-pulse rounded bg-stone-200" />
      <div className="mt-4 grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-stone-100" />
        ))}
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[320px_1fr_380px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-96 animate-pulse rounded-2xl bg-stone-100" />
        ))}
      </div>
    </div>
  );
}

function fireConfetti() {
  const end = Date.now() + 1200;
  const colors = ["#f59e0b", "#fbbf24", "#f97316", "#10b981", "#0ea5e9"];
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
