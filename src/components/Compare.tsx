import type { BoardQuote } from "./Leaderboard";
import { days, money, pct, priceRange } from "../lib/format";
import { Modal, Pill } from "./ui";

export function CompareModal({ open, onClose, quotes }: { open: boolean; onClose: () => void; quotes: BoardQuote[] }) {
  const best = (vals: (number | null | undefined)[], lowIsGood = true) => {
    const nums = vals.filter((v): v is number => v != null);
    if (!nums.length) return null;
    return lowIsGood ? Math.min(...nums) : Math.max(...nums);
  };
  const bestScore = best(quotes.map((q) => q.breakdown.score));
  const bestMid = best(quotes.map((q) => q.breakdown.priceMid));
  const bestDays = best(quotes.map((q) => q.timelineDays));
  const bestConf = best(quotes.map((q) => q.confidence), false);

  const rows: { label: string; render: (q: BoardQuote) => React.ReactNode; hi?: (q: BoardQuote) => boolean }[] = [
    { label: "Rank", render: (q) => <span className="font-display text-2xl font-extrabold">{q.rank ?? "—"}</span> },
    { label: "Price", render: (q) => <span className="font-display text-lg font-bold">{priceRange(q.priceLow, q.priceHigh, q.currency)}</span>, hi: (q) => q.breakdown.priceMid != null && q.breakdown.priceMid === bestMid },
    { label: "Effective cost", render: (q) => (q.breakdown.score == null ? <Pill tone="amber" dashed>unranked</Pill> : money(q.breakdown.score, q.currency)), hi: (q) => q.breakdown.score != null && q.breakdown.score === bestScore },
    { label: "Timeline", render: (q) => (q.timelineDays == null ? <Pill tone="amber" dashed>not stated</Pill> : days(q.timelineDays)), hi: (q) => q.timelineDays != null && q.timelineDays === bestDays },
    { label: "Earliest start", render: (q) => q.startEarliest ?? <Pill tone="amber" dashed>not stated</Pill> },
    { label: "Includes", render: (q) => <Chips items={q.includes} tone="green" /> },
    { label: "Excludes", render: (q) => <Chips items={q.excludes} tone="red" /> },
    { label: "Not stated", render: (q) => (q.breakdown.missing.length ? <Chips items={q.breakdown.missing} tone="amber" dashed /> : <span className="text-emerald-700">nothing missing</span>) },
    { label: "Confidence", render: (q) => pct(q.confidence), hi: (q) => q.confidence === bestConf },
    { label: "Notes", render: (q) => <span className="text-xs text-stone-500">{q.notes ?? "—"}</span> },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Side by side" wide>
      {quotes.length === 0 ? (
        <p className="text-sm text-stone-500">Pick up to three quotes with the Compare button.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="w-36 border-b border-stone-200 pb-3 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500" />
                {quotes.map((q) => (
                  <th key={q._id} className="border-b border-stone-200 pb-3 text-left align-bottom">
                    <div className="font-display text-lg font-semibold">{q.contractorName}</div>
                    <div className="text-[11px] font-normal text-stone-500">{q.model === "heuristic" ? "pattern-matched" : "AI-extracted"}{q.revision > 1 ? ` · rev ${q.revision}` : ""}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="border-b border-stone-100 py-3 pr-3 align-top text-[11px] font-semibold uppercase tracking-wider text-stone-500">{r.label}</td>
                  {quotes.map((q) => {
                    const hi = r.hi?.(q);
                    return (
                      <td key={q._id} className={`border-b border-stone-100 py-3 pr-4 align-top ${hi ? "bg-emerald-50/70" : ""}`}>
                        <div className="flex items-start gap-2">
                          <div>{r.render(q)}</div>
                          {hi && <span className="mt-1 text-[10px] font-bold uppercase text-emerald-700">best</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function Chips({ items, tone, dashed }: { items: string[]; tone: "green" | "red" | "amber"; dashed?: boolean }) {
  if (!items.length) return <span className="text-stone-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <Pill key={i} tone={tone} dashed={dashed}>
          {it}
        </Pill>
      ))}
    </div>
  );
}
