import { useEffect, useState } from "react";

// Hash routing: works on GitHub Pages without a 404 fallback.
export const ROUTES = ["console", "metrics", "about"] as const;
export type Route = (typeof ROUTES)[number];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, "").split(/[?/]/)[0];
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : "console";
}

export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}

export function go(r: Route) {
  window.location.hash = `#/${r}`;
  window.scrollTo({ top: 0 });
}
