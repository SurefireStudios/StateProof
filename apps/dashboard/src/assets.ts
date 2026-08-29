/**
 * The dashboard's *layer* on top of the shared stylesheet.
 *
 * Both surfaces are one product, so they share one design system: the build
 * concatenates `apps/product/src/client/styles.css` — tokens, typography,
 * elevation, motion, responsive rules and every component both sites use — and
 * this file adds only what is peculiar to the dashboard. Anything defined in the
 * base must not be redefined here, or the two drift again.
 */

export const STYLES = `
/* --- chrome the dashboard shapes differently ---------------------------- */
.brand-name { font-weight: 650; letter-spacing: -0.01em; }

.page-head { margin-bottom: var(--s-5); }
.page-head h1 { margin: 0 0 6px; }
.page-sub { color: var(--ink-dim); margin: 0; max-width: 78ch; text-wrap: pretty; }

/* --- the case switcher --------------------------------------------------- */
.case-switch { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--s-5); }
.case-chip {
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  padding: 5px 11px;
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink-dim);
  background: var(--bg-raise);
  box-shadow: var(--hairline);
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease),
    background-color var(--dur) var(--ease);
}
.case-chip:hover { color: var(--ink); border-color: var(--accent); text-decoration: none; }
.case-chip.is-active {
  color: var(--accent-ink);
  background: var(--accent);
  border-color: var(--accent);
  font-weight: 600;
}

/* --- the agent's claim, quoted ------------------------------------------- */
.claim {
  border: 1px solid var(--line);
  border-left: 2px solid var(--review);
  background-color: var(--bg-raise);
  background-image: linear-gradient(90deg, var(--review-tint), transparent 240px);
  border-radius: 0 var(--r-md) var(--r-md) 0;
  padding: 14px 18px;
  box-shadow: var(--shadow-sm);
  white-space: pre-wrap;
}

/* --- pieces the base does not have -------------------------------------- */
.stat-note { color: var(--ink-faint); font-size: 13px; margin: 0; }
.bar {
  height: 8px;
  border-radius: var(--r-xs);
  background: var(--bg-sink);
  overflow: hidden;
  border: 1px solid var(--line);
}
.bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-hi)); }
td.num, th.num { text-align: right; font-family: var(--mono); }
.row-highlight td { background: var(--accent-tint); }

/*
 * The base pill carries a glyph from "data-glyph"; the dashboard's pills carry a
 * dot instead. Verdict colour is still always paired with the word beside it.
 */
.pill::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.pill.solid::before { background: currentColor; }

/* Evidence that resolves to nothing is named as such, not quietly rendered. */
.ev-link[data-missing="true"] { color: var(--fail); border-color: var(--fail); background: var(--fail-tint); }

/* The base keys these off "k-"; the dashboard generator emits "is-". */
.event.is-approval { background-color: rgba(240, 180, 41, 0.07); }
.event.is-write { background-color: rgba(77, 163, 255, 0.05); }
.event.is-error { background-color: rgba(255, 107, 107, 0.08); }

/* The architecture diagram is a full-width inline SVG. */
.diagram {
  width: 100%;
  height: auto;
  background: var(--bg-sink);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
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
