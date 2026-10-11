import { LANGS } from "./i18n";
import { Console } from "./pages/Console";
import { About } from "./pages/About";
import { Metrics } from "./pages/Metrics";
import { useRoute } from "./router";
import { useApp } from "./state";

function ApiDot() {
  const { t, apiState, health } = useApp();
  const label = t(`api.${apiState}`);
  const gpu = health?.gpu && typeof health.gpu === "object" ? (health.gpu as { name?: string }).name : undefined;
  return (
    <span className={`api-dot api-${apiState}`} title={gpu ? `${label} · ${gpu}` : label}>
      <i aria-hidden />
      <span className="api-label">{label}</span>
    </span>
  );
}

export function App() {
  const route = useRoute();
  const { t, lang, setLang } = useApp();
  return (
    <>
      <header className="top">
        <div className="top-row">
          <a className="brand" href="#/console">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="3.2" fill="currentColor" />
            </svg>
            <b>BayWatch</b>
            <span className="tagline">{t("app.tagline")}</span>
          </a>
          <ApiDot />
          {route !== "console" && (
            <div className="langs" role="group" aria-label="language">
              {LANGS.map((l) => (
                <button key={l} className={l === lang ? "on" : ""} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
          )}
        </div>
        <nav className="tabs">
          <a href="#/console" className={route === "console" ? "on" : ""}>Service floor</a>
          <a href="#/metrics" className={route === "metrics" ? "on" : ""}>Results</a>
          <a href="#/about" className={route === "about" ? "on" : ""}>Data &amp; licences</a>
        </nav>
      </header>
      <main className={route === "console" ? "wide" : ""}>
        {route === "console" && <Console />}
        {route === "metrics" && <Metrics />}
        {route === "about" && <About />}
      </main>
      <footer className="foot muted small">
        BayWatch · service-centre camera analytics · built by team DNA · Royal Motors after-sales pilot · results show source, confidence, model and version
      </footer>
    </>
  );
}
