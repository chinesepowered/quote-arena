import { EnsureSignedIn } from "./auth";
import { ToastProvider } from "./components/ui";
import { navigate, useRoute } from "./lib/router";
import { Home } from "./pages/Home";
import { NewJob } from "./pages/NewJob";
import { Arena } from "./pages/Arena";
import { Admin } from "./pages/Admin";

function Shell() {
  const route = useRoute();
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-stone-50/80 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="flex items-center gap-2 font-display text-base font-extrabold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-orange-500 text-sm text-stone-950 shadow-sm">🏆</span>
            Quote Arena
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a href="/new" onClick={(e) => { e.preventDefault(); navigate("/new"); }} className="rounded-lg px-3 py-1.5 font-medium text-stone-700 hover:bg-stone-200/60">
              New job
            </a>
            <a href="/admin" onClick={(e) => { e.preventDefault(); navigate("/admin"); }} className="rounded-lg px-3 py-1.5 text-stone-500 hover:bg-stone-200/60">
              Ops
            </a>
          </nav>
        </div>
      </header>
      {route.name === "home" && <Home />}
      {route.name === "new" && <NewJob />}
      {route.name === "arena" && <Arena slug={route.slug} />}
      {route.name === "admin" && <Admin />}
      {route.name === "notfound" && (
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <h1 className="font-display text-2xl font-bold">Nothing here</h1>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="mt-4 inline-block text-sm underline">Go home</a>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <EnsureSignedIn>
        <Shell />
      </EnsureSignedIn>
    </ToastProvider>
  );
}
