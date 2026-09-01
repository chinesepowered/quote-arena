import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ago, friendlyError } from "../lib/format";
import { Button, Pill, Spinner, inputCls, useToast } from "./ui";

type Tab = "questions" | "thread" | "simulate";

const CLASS_TONE: Record<string, "green" | "blue" | "red" | "stone" | "amber"> = {
  quote: "green",
  question: "blue",
  decline: "red",
  auto_reply: "stone",
  other: "stone",
};

export function Drawer({
  job,
  contractors,
  canEdit,
  focusContractor,
  onFocusContractor,
}: {
  job: Doc<"jobs">;
  contractors: Doc<"contractors">[];
  canEdit: boolean;
  focusContractor: Id<"contractors"> | null;
  onFocusContractor: (id: Id<"contractors"> | null) => void;
}) {
  const questions = useQuery(api.questions.forJob, { jobId: job._id });
  const messages = useQuery(api.messages.forJob, { jobId: job._id });
  const pending = (questions ?? []).filter((q) => q.status === "pending_approval");
  const [tab, setTab] = useState<Tab>(pending.length ? "questions" : "thread");

  useEffect(() => {
    if (focusContractor) setTab("thread");
  }, [focusContractor]);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "questions", label: "Questions", badge: pending.length || undefined },
    { id: "thread", label: "Thread" },
    ...(canEdit ? [{ id: "simulate" as Tab, label: "Reply as contractor" }] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 rounded-xl bg-stone-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${tab === t.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}
          >
            {t.label}
            {t.badge ? <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] text-stone-950">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === "questions" && <Questions job={job} questions={questions} canEdit={canEdit} />}
        {tab === "thread" && (
          <Thread contractors={contractors} messages={messages} focus={focusContractor} onFocus={onFocusContractor} />
        )}
        {tab === "simulate" && canEdit && <Simulate job={job} contractors={contractors} />}
      </div>
    </div>
  );
}

/* ───────────────────────── Questions ───────────────────────── */

function Questions({
  job,
  questions,
  canEdit,
}: {
  job: Doc<"jobs">;
  questions: (Doc<"questions"> & { contractorName: string })[] | undefined;
  canEdit: boolean;
}) {
  const toast = useToast();
  const setAutoReply = useMutation(api.jobs.setAutoReply);
  if (!questions) return <Skeleton />;
  const pending = questions.filter((q) => q.status === "pending_approval");
  const done = questions.filter((q) => q.status !== "pending_approval");
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-stone-200">
        <div>
          <div className="text-sm font-semibold text-stone-900">Auto-answer questions</div>
          <div className="text-[11px] text-stone-500">Send AI answers immediately when they are fully grounded in your job facts. Otherwise you approve each one.</div>
        </div>
        <button
          role="switch"
          aria-checked={job.autoReply}
          disabled={!canEdit}
          onClick={() => setAutoReply({ jobId: job._id, autoReply: !job.autoReply }).catch((e) => toast(friendlyError(e), "error"))}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${job.autoReply ? "bg-emerald-500" : "bg-stone-300"} disabled:opacity-50`}
        >
          <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${job.autoReply ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </label>

      {pending.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">No questions waiting. When a contractor asks something, a proposed answer appears here.</div>
      )}
      <AnimatePresence initial={false}>
        {pending.map((q) => (
          <motion.div key={q._id} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
            <QuestionCard q={q} canEdit={canEdit} />
          </motion.div>
        ))}
      </AnimatePresence>
      {done.length > 0 && (
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer select-none py-1 font-semibold">Answered / dismissed ({done.length})</summary>
          <div className="mt-2 space-y-2">
            {done.map((q) => (
              <div key={q._id} className="rounded-lg bg-white p-2.5 ring-1 ring-stone-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-700">{q.contractorName}</span>
                  <Pill tone={q.status === "sent" ? "green" : "stone"}>{q.status === "sent" ? "sent" : "dismissed"}</Pill>
                </div>
                <div className="mt-1 italic">“{q.question}”</div>
                <div className="mt-1 whitespace-pre-wrap text-stone-600">{q.proposedAnswer}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function QuestionCard({ q, canEdit }: { q: Doc<"questions"> & { contractorName: string }; canEdit: boolean }) {
  const toast = useToast();
  const approve = useMutation(api.questions.approve);
  const dismiss = useMutation(api.questions.dismiss);
  const [answer, setAnswer] = useState(q.proposedAnswer);
  const [busy, setBusy] = useState(false);
  const heuristic = q.model === "heuristic";
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-sky-200 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-stone-900">{q.contractorName} asks</span>
        <span className="text-[10px] text-stone-400">{ago(q.createdAt)}</span>
      </div>
      <p className="mt-1 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950">“{q.question}”</p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-stone-500">Proposed answer</span>
        {q.grounded ? (
          <Pill tone="green" title="Written only from the facts in your job post">grounded in job facts</Pill>
        ) : (
          <Pill tone="amber" title={heuristic ? "AI was unavailable; this is a draft built from your job description" : "The AI could not fully answer this from your job facts"}>
            {heuristic ? "AI unavailable · draft from job facts" : "needs your input"}
          </Pill>
        )}
      </div>
      <textarea className={`${inputCls} mt-1 min-h-28 text-sm`} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!canEdit} />
      {canEdit && (
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => dismiss({ questionId: q._id }).catch((e) => toast(friendlyError(e), "error"))}>
            Dismiss
          </Button>
          <Button
            size="sm"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await approve({ questionId: q._id, answer });
                toast("Answer on its way", "success");
              } catch (e) {
                toast(friendlyError(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve & send
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Thread ───────────────────────── */

type Msg = {
  _id: Id<"messages">;
  contractorId?: Id<"contractors">;
  direction: "in" | "out";
  subject: string;
  text: string;
  classification?: string;
  summary?: string;
  aiState?: string;
  at: number;
};

function Thread({
  contractors,
  messages,
  focus,
  onFocus,
}: {
  contractors: Doc<"contractors">[];
  messages: Msg[] | undefined;
  focus: Id<"contractors"> | null;
  onFocus: (id: Id<"contractors"> | null) => void;
}) {
  const withMail = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages ?? []) if (m.contractorId) counts.set(m.contractorId, (counts.get(m.contractorId) ?? 0) + 1);
    return contractors.filter((c) => counts.has(c._id)).map((c) => ({ ...c, count: counts.get(c._id)! }));
  }, [contractors, messages]);

  if (!messages) return <Skeleton />;
  const shown = focus ? messages.filter((m) => m.contractorId === focus) : messages;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onFocus(null)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${!focus ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-200"}`}>
          All ({messages.length})
        </button>
        {withMail.map((c) => (
          <button key={c._id} onClick={() => onFocus(c._id)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${focus === c._id ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-200"}`}>
            {c.name} ({c.count})
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">No emails yet.</div>}
      <ol className="space-y-2">
        <AnimatePresence initial={false}>
          {[...shown].reverse().map((m) => (
            <motion.li key={m._id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
              <MessageBubble m={m} name={contractors.find((c) => c._id === m.contractorId)?.name ?? "Unknown sender"} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function MessageBubble({ m, name }: { m: Msg; name: string }) {
  const [open, setOpen] = useState(false);
  const inbound = m.direction === "in";
  return (
    <div className={`rounded-xl p-3 ring-1 ${inbound ? "bg-white ring-stone-200" : "bg-stone-900 text-stone-100 ring-stone-900"}`}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={`font-semibold ${inbound ? "text-stone-800" : "text-stone-200"}`}>{inbound ? `${name} → you` : `you → ${name}`}</span>
        <span className={inbound ? "text-stone-400" : "text-stone-400"}>{ago(m.at)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {inbound && m.classification && <Pill tone={CLASS_TONE[m.classification] ?? "stone"}>{m.classification.replace("_", " ")}</Pill>}
        {inbound && m.aiState === "pending" && (
          <Pill tone="amber">
            <Spinner className="size-2.5" /> analyzing…
          </Pill>
        )}
        {inbound && m.aiState === "ai_unavailable" && <Pill tone="amber" title="The AI model timed out; pattern matching was used instead">AI unavailable</Pill>}
        {m.summary && <span className={`text-[11px] ${inbound ? "text-stone-500" : "text-stone-400"}`}>{m.summary}</span>}
      </div>
      <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${open ? "" : "line-clamp-4"} ${inbound ? "text-stone-800" : "text-stone-100"}`}>{m.text}</p>
      {m.text.length > 220 && (
        <button onClick={() => setOpen(!open)} className={`mt-1 text-[11px] font-semibold ${inbound ? "text-stone-500" : "text-stone-300"}`}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
      <div className={`mt-1 truncate text-[10px] ${inbound ? "text-stone-400" : "text-stone-500"}`}>{m.subject}</div>
    </div>
  );
}

/* ───────────────────────── Simulate a reply ───────────────────────── */

const PRESETS = [
  { label: "Detailed quote", text: "Hi! Thanks for the photos. We can do it for $3,200–3,600 in cedar, about 2 weeks out, takes 2 days. Includes removal of the old fence and disposal. Excludes staining. Cheers, Mike" },
  { label: "Cheaper, faster", text: "Hey — had a cancellation. $2,900 all in, we can start next week and finish in 2 days. Includes removal. Excludes staining and permits." },
  { label: "Vague quote", text: "Roughly 4k give or take, depends on the posts. Can fit you in soon." },
  { label: "A question", text: "Happy to quote. Is the ground level along the run, and can we get a wheelbarrow through the side gate?" },
  { label: "Decline", text: "Thanks for reaching out, unfortunately we're booked solid through the fall and can't take this on." },
];

function Simulate({ job, contractors }: { job: Doc<"jobs">; contractors: Doc<"contractors">[] }) {
  const toast = useToast();
  const simulate = useMutation(api.demo.simulateReply);
  const candidates = contractors.filter((c) => c.rfqStatus !== "none" || c.manual);
  const [who, setWho] = useState<string>(candidates[0]?._id ?? "");
  const [text, setText] = useState(PRESETS[0].text);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!who && candidates[0]) setWho(candidates[0]._id);
  }, [candidates, who]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
        <b>Demo shortcut.</b> Pushes a fake reply through the exact same path a real email takes (inbox → webhook → routing → AI extraction), so you can watch the board reorder without a phone.
        {" "}In real use, contractors simply reply to the email.
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Reply as</span>
        <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
          {candidates.length === 0 && <option value="">Send requests first</option>}
          {candidates.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setText(p.text)} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50">
            {p.label}
          </button>
        ))}
      </div>
      <textarea className={`${inputCls} min-h-32 text-sm`} value={text} onChange={(e) => setText(e.target.value)} />
      <Button
        className="w-full"
        busy={busy}
        disabled={!who || !text.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await simulate({ jobId: job._id, contractorId: who as Id<"contractors">, text });
            toast("Reply received — analyzing…", "success");
          } catch (e) {
            toast(friendlyError(e), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        Deliver this reply
      </Button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-stone-100" />
      ))}
    </div>
  );
}
