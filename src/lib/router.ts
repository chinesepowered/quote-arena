import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "arena"; slug: string }
  | { name: "admin" }
  | { name: "notfound" };

export function parse(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return { name: "home" };
  if (p === "/new") return { name: "new" };
  if (p === "/admin") return { name: "admin" };
  const m = p.match(/^\/j\/([^/]+)$/);
  if (m) return { name: "arena", slug: decodeURIComponent(m[1]) };
  return { name: "notfound" };
}

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}

/** Intercept plain left-clicks on internal links so the SPA handles them. */
export function useLinkHandler() {
  return useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = e.currentTarget.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    e.preventDefault();
    navigate(href);
  }, []);
}
