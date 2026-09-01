import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

/* ───────────────────────── Toasts ───────────────────────── */

type Toast = { id: number; text: string; kind: "info" | "error" | "success" };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className={`pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm shadow-lg ring-1 ${
                t.kind === "error"
                  ? "bg-rose-600 text-white ring-rose-700"
                  : t.kind === "success"
                    ? "bg-emerald-600 text-white ring-emerald-700"
                    : "bg-stone-900 text-white ring-stone-800"
              }`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────────────────────── Buttons & pills ───────────────────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
};

export function Button({ variant = "primary", size = "md", busy, className = "", children, disabled, ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" }[size];
  const variants = {
    primary: "bg-stone-900 text-white hover:bg-stone-800 shadow-sm",
    secondary: "bg-white text-stone-800 ring-1 ring-stone-200 hover:bg-stone-50 shadow-sm",
    ghost: "text-stone-700 hover:bg-stone-100",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    gold: "bg-gradient-to-br from-amber-400 to-orange-500 text-stone-950 shadow-md shadow-amber-500/30 hover:from-amber-300 hover:to-orange-400",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} disabled={disabled || busy} {...rest}>
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Pill({
  tone = "stone",
  children,
  className = "",
  title,
  dashed,
}: {
  tone?: "stone" | "green" | "red" | "amber" | "blue" | "violet" | "gold";
  children: ReactNode;
  className?: string;
  title?: string;
  dashed?: boolean;
}) {
  const tones = {
    stone: "bg-stone-100 text-stone-700 ring-stone-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    red: "bg-rose-50 text-rose-800 ring-rose-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-300",
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    gold: "bg-gradient-to-r from-amber-200 to-yellow-100 text-amber-950 ring-amber-300",
  }[tone];
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ${
        dashed ? "ring-dashed" : ""
      } ${tones} ${className}`}
      style={dashed ? { outline: "1px dashed currentColor", outlineOffset: -1, boxShadow: "none" } : undefined}
    >
      {children}
    </span>
  );
}

/* ───────────────────────── Tooltip ───────────────────────── */

export function Tooltip({ content, children, wide }: { content: ReactNode; children: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className={`absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-lg bg-stone-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-stone-100 shadow-xl ${
              wide ? "w-80" : "w-64"
            }`}
          >
            {content}
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-8 border-transparent border-t-stone-900" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ───────────────────────── Modal ───────────────────────── */

export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center bg-stone-950/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={`max-h-[90vh] w-full overflow-auto rounded-2xl bg-white p-6 shadow-2xl ${wide ? "max-w-5xl" : "max-w-lg"}`}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
                <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
                  ✕
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── Form bits ───────────────────────── */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200";

/* ───────────────────────── Copy button ───────────────────────── */

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<number | undefined>(undefined);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setDone(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      {done ? "Copied" : label}
    </Button>
  );
}

/** Number that animates when it changes (status strip counters). */
export function Counter({ value }: { value: number }) {
  const key = useMemo(() => value, [value]);
  return (
    <span className="relative inline-block tabular-nums">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={key}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
