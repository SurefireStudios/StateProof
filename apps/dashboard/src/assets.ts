/**
 * Styles and client behaviour, as strings the build writes out.
 *
 * Dark, dense, low-chrome: this is a reliability tool, not a landing page. The
 * accent is used only to mean "StateProof said something"; verdict colour is
 * always paired with a word, because a judge reading a failure matrix should
 * never have to distinguish two shades of red to know what happened.
 */

export const STYLES = `
:root {
  --bg: #0b0d10;
  --bg-raise: #12151a;
  --bg-sink: #080a0c;
  --line: #1f242c;
  --line-strong: #2c333d;
  --ink: #e7ecf3;
  --ink-dim: #98a3b3;
  --ink-faint: #6b7686;
  --accent: #4da3ff;
  --pass: #35c98b;
  --fail: #ff6b6b;
  --review: #f0b429;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, .mono { font-family: var(--mono); font-size: 0.86em; }
pre {
  background: var(--bg-sink);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  line-height: 1.5;
}

/* --- chrome ------------------------------------------------------------- */
.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 28px;
  padding: 0 28px;
  height: 60px;
  background: rgba(11, 13, 16, 0.92);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(8px);
}
.brand { display: flex; align-items: baseline; gap: 10px; color: var(--ink); }
.brand:hover { text-decoration: none; }
.brand-mark {
  width: 10px; height: 10px; border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(77, 163, 255, 0.16);
  align-self: center;
}
.brand-name { font-weight: 650; letter-spacing: -0.01em; }
.brand-tag { color: var(--ink-faint); font-size: 13px; }
.nav { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.nav-link {
  color: var(--ink-dim); padding: 6px 11px; border-radius: 6px; font-size: 14px;
}
.nav-link:hover { background: var(--bg-raise); color: var(--ink); text-decoration: none; }
.nav-link.is-active { background: var(--bg-raise); color: var(--ink); box-shadow: inset 0 -2px 0 var(--accent); }

.page { max-width: 1180px; margin: 0 auto; padding: 34px 28px 72px; }
.page-head { margin-bottom: 26px; }
.page-head h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 6px; }
.page-sub { color: var(--ink-dim); margin: 0; max-width: 78ch; }
.footer {
  border-top: 1px solid var(--line);
  padding: 22px 28px 48px;
  color: var(--ink-faint);
  font-size: 13px;
  max-width: 1180px; margin: 0 auto;
}
.footer p { margin: 4px 0; }
.colophon { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
.colophon-mark { width: 26px; height: 26px; flex: none; border-radius: 6px; opacity: .9; }
.colophon-credit { margin: 0; line-height: 1.45; }
.colophon-credit strong { color: var(--ink-dim); font-weight: 600; }
.colophon-links { margin-left: auto; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; }
.colophon-links a { padding: 2px 6px; border-radius: 4px; }
.colophon-links a:hover { background: rgba(255,255,255,.05); text-decoration: none; }
@media (max-width: 720px) { .colophon-links { margin-left: 0; width: 100%; } }

/* --- structure ---------------------------------------------------------- */
section { margin: 34px 0; }
h2 { font-size: 19px; letter-spacing: -0.01em; margin: 0 0 12px; }
h3 { font-size: 15px; margin: 0 0 8px; }
.lede { font-size: 17px; color: var(--ink-dim); max-width: 76ch; }
.grid { display: grid; gap: 14px; }
.grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 900px) {
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}
.card {
  background: var(--bg-raise);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px 18px;
}
.card h3 { color: var(--ink-dim); font-weight: 500; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; }
.stat { font-size: 30px; font-weight: 620; letter-spacing: -0.02em; margin: 2px 0 4px; }
.stat-note { color: var(--ink-faint); font-size: 13px; margin: 0; }
.muted { color: var(--ink-dim); }
.faint { color: var(--ink-faint); }
.small { font-size: 13px; }

/* --- tables ------------------------------------------------------------- */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { background: var(--bg-sink); color: var(--ink-dim); font-weight: 550; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: rgba(255,255,255,0.02); }
td.num, th.num { text-align: right; font-family: var(--mono); }
.row-highlight td { background: rgba(77, 163, 255, 0.07); }

/* --- verdicts ----------------------------------------------------------- */
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border-radius: 999px;
  font-size: 12px; font-weight: 600; letter-spacing: 0.03em;
  border: 1px solid currentColor;
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.v-pass { color: var(--pass); }
.v-fail { color: var(--fail); }
.v-review { color: var(--review); }
.v-pass.solid, .v-fail.solid, .v-review.solid { color: var(--bg); }
.v-pass.solid { background: var(--pass); border-color: var(--pass); }
.v-fail.solid { background: var(--fail); border-color: var(--fail); }
.v-review.solid { background: var(--review); border-color: var(--review); }

/* --- inspector ---------------------------------------------------------- */
.case-switch { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
.case-chip {
  border: 1px solid var(--line-strong); border-radius: 7px;
  padding: 5px 11px; font-family: var(--mono); font-size: 13px; color: var(--ink-dim);
  background: var(--bg-raise);
}
.case-chip:hover { color: var(--ink); text-decoration: none; border-color: var(--accent); }
.case-chip.is-active { color: var(--bg); background: var(--accent); border-color: var(--accent); font-weight: 600; }
.claim {
  border-left: 3px solid var(--review);
  background: var(--bg-raise);
  padding: 12px 16px; border-radius: 0 8px 8px 0;
  white-space: pre-wrap;
}
.req { border: 1px solid var(--line); border-radius: 10px; background: var(--bg-raise); margin-bottom: 10px; }
.req-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.req-key { font-family: var(--mono); font-size: 13px; }
.req-body { padding: 0 16px 14px; }
.req-reason { color: var(--ink-dim); font-size: 14px; margin: 0 0 10px; }
details.evidence summary {
  cursor: pointer; color: var(--accent); font-size: 13px; list-style: none;
  display: inline-flex; align-items: center; gap: 6px;
}
details.evidence summary::-webkit-details-marker { display: none; }
details.evidence summary::before { content: "▸"; font-size: 10px; }
details.evidence[open] summary::before { content: "▾"; }
.ev-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
.ev-link {
  font-family: var(--mono); font-size: 12px;
  border: 1px solid var(--line-strong); border-radius: 6px; padding: 3px 8px;
  color: var(--ink-dim); background: var(--bg-sink);
}
.ev-link:hover { color: var(--ink); border-color: var(--accent); text-decoration: none; }
.ev-link[data-missing="true"] { color: var(--fail); border-color: var(--fail); }

.timeline { list-style: none; margin: 0; padding: 0; }
.event {
  display: grid; grid-template-columns: 54px 150px 1fr; gap: 12px;
  padding: 9px 12px; border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.event:last-child { border-bottom: none; }
.event .seq { font-family: var(--mono); color: var(--ink-faint); }
.event .kind { font-family: var(--mono); font-size: 12px; color: var(--ink-dim); }
.event .detail { color: var(--ink); word-break: break-word; white-space: pre-wrap; }
.event.is-approval { background: rgba(240, 180, 41, 0.06); }
.event.is-write { background: rgba(77, 163, 255, 0.05); }
.event.is-error { background: rgba(255, 107, 107, 0.07); }

.diff-row { border-bottom: 1px solid var(--line); padding: 10px 12px; }
.diff-row:last-child { border-bottom: none; }
.diff-head { display: flex; gap: 10px; align-items: center; font-family: var(--mono); font-size: 13px; }
.tag { font-size: 11px; padding: 1px 7px; border-radius: 4px; border: 1px solid var(--line-strong); color: var(--ink-dim); }
.tag.added { color: var(--pass); border-color: var(--pass); }
.tag.removed { color: var(--fail); border-color: var(--fail); }
.tag.modified { color: var(--review); border-color: var(--review); }
.field-change { display: grid; grid-template-columns: 170px 1fr 1fr; gap: 10px; font-family: var(--mono); font-size: 12px; padding: 3px 0; }
.field-change .was { color: var(--fail); }
.field-change .now { color: var(--pass); }

.flash { animation: flash 1.6s ease-out; }
@keyframes flash {
  0%, 30% { background: rgba(77, 163, 255, 0.22); box-shadow: inset 3px 0 0 var(--accent); }
  100% { background: transparent; box-shadow: none; }
}

/* --- misc --------------------------------------------------------------- */
.kv { display: grid; grid-template-columns: 210px 1fr; gap: 4px 14px; font-size: 14px; }
.kv dt { color: var(--ink-dim); }
.kv dd { margin: 0; font-family: var(--mono); font-size: 13px; word-break: break-all; }
.bar { height: 8px; border-radius: 4px; background: var(--bg-sink); overflow: hidden; border: 1px solid var(--line); }
.bar > span { display: block; height: 100%; background: var(--accent); }
.callout {
  border: 1px solid var(--line-strong); border-left: 3px solid var(--accent);
  background: var(--bg-raise); border-radius: 0 8px 8px 0; padding: 12px 16px;
}
.callout.warn { border-left-color: var(--review); }
.btn {
  display: inline-block; padding: 9px 16px; border-radius: 8px;
  background: var(--accent); color: #04121f; font-weight: 600; font-size: 14px;
}
.btn:hover { text-decoration: none; filter: brightness(1.08); }
.btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line-strong); }
.steps { counter-reset: step; list-style: none; padding: 0; margin: 0; }
.steps li {
  counter-increment: step; position: relative; padding: 0 0 16px 38px; border-left: 1px solid var(--line);
  margin-left: 12px;
}
.steps li:last-child { border-left-color: transparent; padding-bottom: 0; }
.steps li::before {
  content: counter(step); position: absolute; left: -13px; top: 0;
  width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  background: var(--bg-raise); border: 1px solid var(--line-strong);
  font-size: 12px; color: var(--ink-dim); font-family: var(--mono);
}
`;

export const APP_JS = `
(function () {
  "use strict";

  /**
   * Evidence links are the point of the inspector: a citation that cannot be
   * followed is indistinguishable from a citation that was invented. Clicking
   * one scrolls to the exact event, record or diff row it names and flashes it.
   */
  function highlight(id) {
    var target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
    return true;
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest("[data-evidence-target]");
    if (!link) return;
    event.preventDefault();
    var ids = (link.getAttribute("data-evidence-target") || "").split(" ").filter(Boolean);
    for (var i = 0; i < ids.length; i += 1) {
      if (highlight(ids[i])) return;
    }
  });

  // Deep links such as inspector.html#ev-EV-004 land on the right row.
  if (window.location.hash.length > 1) {
    window.setTimeout(function () { highlight(window.location.hash.slice(1)); }, 60);
  }
})();
`;
