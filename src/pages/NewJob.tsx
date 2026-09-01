import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button, Field, inputCls, useToast } from "../components/ui";
import { friendlyError } from "../lib/format";
import { navigate } from "../lib/router";

const TIMING = ["As soon as possible", "Within 2 weeks", "Within the next 4 weeks", "In the next 2–3 months", "Flexible"];
const BUDGETS = ["Not sure yet", "Under $1,000", "$1,000 – $2,500", "$2,500 – $4,500", "$4,500 – $8,000", "$8,000 – $15,000", "$15,000+"];

type Photo = { file: File; preview: string; storageId?: Id<"_storage">; error?: string };

export function NewJob() {
  const trades = useQuery(api.jobs.trades) ?? [];
  const generateUploadUrl = useMutation(api.jobs.generateUploadUrl);
  const create = useMutation(api.jobs.create);
  const toast = useToast();

  const [trade, setTrade] = useState("Fencing");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [timing, setTiming] = useState(TIMING[2]);
  const [budget, setBudget] = useState(BUDGETS[0]);
  const [autoFind, setAutoFind] = useState(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

  const uploading = photos.some((p) => !p.storageId && !p.error);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files).slice(0, 6 - photos.length);
    const next: Photo[] = picked.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next]);
    for (const ph of next) {
      try {
        const url = await generateUploadUrl();
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": ph.file.type || "application/octet-stream" }, body: ph.file });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        setPhotos((p) => p.map((x) => (x.preview === ph.preview ? { ...x, storageId } : x)));
      } catch (e) {
        setPhotos((p) => p.map((x) => (x.preview === ph.preview ? { ...x, error: friendlyError(e) } : x)));
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { slug } = await create({
        trade,
        title,
        description,
        city,
        region,
        timing,
        budgetBand: budget === BUDGETS[0] ? undefined : budget,
        photoIds: photos.map((p) => p.storageId).filter((id): id is Id<"_storage"> => Boolean(id)),
        skipSourcing: !autoFind,
      });
      navigate(`/j/${slug}`);
    } catch (err) {
      toast(friendlyError(err), "error");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="text-xs text-stone-500 hover:text-stone-900">
        ← Back
      </a>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Post a job once</h1>
      <p className="mt-1 text-sm text-stone-600">We find local contractors, email them your job and photos, and turn every reply into a ranked quote.</p>

      <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trade">
            <select className={inputCls} value={trade} onChange={(e) => setTrade(e.target.value)}>
              {(trades.length ? trades : ["Fencing"]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Timing">
            <select className={inputCls} value={timing} onChange={(e) => setTiming(e.target.value)}>
              {TIMING.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="What needs doing" hint="One line, like you'd say it to a neighbour.">
          <input className={inputCls} required maxLength={90} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replace 40 ft of fallen back fence" />
        </Field>

        <Field label="Details" hint="Measurements, materials, access, anything a contractor would ask. The AI answers their questions from this.">
          <textarea className={`${inputCls} min-h-32`} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Windstorm took down ~40 ft of 6 ft privacy fence; posts snapped at ground level. Level lawn, 4 ft side-gate access. Cedar or pressure-treated, one gate." />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]">
          <Field label="City">
            <input className={inputCls} required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Waterloo" />
          </Field>
          <Field label="Region">
            <input className={inputCls} required value={region} onChange={(e) => setRegion(e.target.value)} placeholder="ON" />
          </Field>
          <Field label="Budget band">
            <select className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value)}>
              {BUDGETS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Photos" hint="Up to 6. They're linked in every request so contractors can quote without a visit.">
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <div key={p.preview} className="relative size-20 overflow-hidden rounded-lg ring-1 ring-stone-200">
                <img src={p.preview} alt="" className={`size-full object-cover ${p.storageId ? "" : "opacity-50"}`} />
                {!p.storageId && !p.error && <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-stone-700">uploading…</span>}
                {p.error && <span className="absolute inset-0 grid place-items-center bg-rose-100/80 p-1 text-center text-[10px] text-rose-800">{p.error}</span>}
                <button type="button" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))} className="absolute right-0.5 top-0.5 rounded bg-white/90 px-1 text-[10px]">
                  ✕
                </button>
              </div>
            ))}
            {photos.length < 6 && (
              <label className="grid size-20 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-stone-300 text-2xl text-stone-400 hover:border-amber-400 hover:text-amber-500">
                +
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
              </label>
            )}
          </div>
        </Field>

        <label className="flex items-start gap-3 rounded-xl bg-orange-50 p-3 ring-1 ring-orange-200">
          <input type="checkbox" className="mt-0.5 size-4 accent-orange-500" checked={autoFind} onChange={(e) => setAutoFind(e.target.checked)} />
          <span className="text-sm">
            <span className="font-semibold text-orange-900">🔥 Find contractors automatically</span>
            <span className="block text-xs text-orange-800/80">
              Firecrawl searches the web for “{trade.toLowerCase()} contractor {city || "your city"}”, reads their sites, and the AI pulls out emails and services. Untick to add contractors by hand.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-stone-500">
            {city ? (
              <>
                We’ll contact contractors in <b>{city}{region ? `, ${region}` : ""}</b>.
              </>
            ) : (
              "Nothing is emailed until you press Send on the next screen."
            )}
          </p>
          <Button type="submit" size="lg" variant="gold" busy={busy} disabled={uploading}>
            Open the arena →
          </Button>
        </div>
      </form>
    </div>
  );
}
