// Style sheet of the pages, written inline so that a page needs no second request; the colors are variables
export const STYLE = `
:root {
    color-scheme: light dark;
    --bg: #fbf8f5;
    --surface: #ffffff;
    --ink: #17120f;
    --muted: #6b5f57;
    --line: #e6ddd5;
    --accent: #ff4a1c;
    --accent-text: #c7350c;
    --accent-ink: #17120f;
    --dep: #8a5a00;
    --dep-bg: #fdf0d5;
    --pre: #5b3fb5;
    --pre-bg: #ece6fb;
    --ok: #1e6b3a;
    --ok-bg: #dcf3e3;
    --sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #120e0c;
        --surface: #1c1714;
        --ink: #f6f0eb;
        --muted: #a3968d;
        --line: #2f2824;
        --accent: #ff5a2b;
        --accent-text: #ff7a50;
        --accent-ink: #120e0c;
        --dep: #f0b44c;
        --dep-bg: #3a2a0c;
        --pre: #b9a6f5;
        --pre-bg: #2a2147;
        --ok: #7fd69b;
        --ok-bg: #12301e;
    }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 var(--sans); }
a { color: var(--accent-text); text-underline-offset: 0.15em; transition: color 0.15s ease; }
a:hover { color: var(--ink); }
code, pre { font-family: var(--mono); font-size: 0.9em; }
code { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 0.1em 0.35em; }
pre { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 0.8em 1em; overflow-x: auto; }
pre code { background: none; border: 0; padding: 0; }
.top { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: center; justify-content: space-between; max-width: 46rem; margin: 0 auto; padding: 1.25rem 1rem 0; }
.brand { font-weight: 800; font-size: 1.35rem; letter-spacing: -0.03em; color: var(--ink); text-decoration: none; }
.logo { height: 1.5em; width: auto; max-width: 8em; vertical-align: -0.3em; margin-right: 0.5rem; }
.search { position: relative; flex: 0 1 15rem; min-width: 0; }
.search input { width: 100%; padding: 0.3rem 2.2rem 0.3rem 0.85rem; font-size: 0.9rem; line-height: 1.4; border-radius: 999px; -webkit-appearance: none; appearance: none; }
.search input::placeholder { color: var(--muted); }
.search input::-webkit-search-cancel-button { -webkit-appearance: none; }
.search input:focus { outline: 2px solid var(--ring, var(--accent)); outline-offset: 1px; border-color: transparent; }
@media (pointer: coarse) { .search input { font-size: 1rem; } }
.search button { position: absolute; top: 50%; right: 0.2rem; transform: translateY(-50%); display: grid; place-items: center; width: 1.65rem; height: 1.65rem; padding: 0; border-radius: 50%; background: none; color: var(--muted); transition: color 0.15s, background-color 0.15s; }
.search button:hover, .search button:focus-visible { color: var(--accent-ink); background: var(--accent); }
input { transition: border-color 0.15s ease; font: inherit; padding: 0.35rem 0.6rem; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; min-width: 0; }
button { font: inherit; font-weight: 600; padding: 0.35rem 0.8rem; background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 6px; cursor: pointer; }
main { max-width: 46rem; margin: 0 auto; padding: 1rem 1rem 3rem; }
h1 { font-size: 2rem; line-height: 1.15; letter-spacing: -0.03em; margin: 1.5rem 0 0.5rem; overflow-wrap: anywhere; }
h2 { font-size: 1.15rem; margin: 2rem 0 0.5rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 0.4rem; }
h4, h5, h6 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
h5, h6 { color: var(--muted); }
.lead, .meta, .crumbs, footer { color: var(--muted); }
.crumbs { margin: 1rem 0 0; font-size: 0.9rem; overflow-wrap: anywhere; }
.index { list-style: none; margin: 0; padding: 0; }
.index li { display: flex; gap: 0.5rem; align-items: baseline; padding: 0.2rem 0; }
.index li > a { min-width: 0; overflow-wrap: anywhere; }
.index .dots { flex: 1; border-bottom: 1px dotted var(--line); transform: translateY(-0.3em); min-width: 1rem; }
.index .end { color: var(--muted); font-family: var(--mono); font-size: 0.85em; white-space: nowrap; }
table { border-collapse: collapse; width: 100%; }
th, td { overflow-wrap: anywhere; text-align: left; padding: 0.35rem 0.6rem 0.35rem 0; border-bottom: 1px solid var(--line); vertical-align: baseline; }
th { color: var(--muted); font-weight: 500; font-size: 0.85rem; }
.right { text-align: right; white-space: nowrap; }
.center { text-align: center; }
.mark { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0 0.45em; border-radius: 3px; margin-left: 0.2em; vertical-align: 0.1em; }
.dep { color: var(--dep); background: var(--dep-bg); }
.pre { color: var(--pre); background: var(--pre-bg); }
.latest { color: var(--ok); background: var(--ok-bg); }
.notice { border-left: 3px solid var(--dep); background: var(--dep-bg); color: var(--ink); padding: 0.6rem 1rem; border-radius: 0 6px 6px 0; margin: 1rem 0; }
dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.markdown { overflow-wrap: anywhere; }
.markdown img { max-width: 100%; height: auto; }
.markdown table { display: block; overflow-x: auto; }
.markdown blockquote { margin: 1rem 0; padding: 0 1rem; border-left: 3px solid var(--line); color: var(--muted); }
footer a { color: inherit; text-decoration-color: var(--muted); text-underline-offset: 0.2em; transition: color 0.15s, text-decoration-color 0.15s; }
footer a:hover { color: var(--accent-text); text-decoration-color: currentColor; }
@supports (scrollbar-color: auto) { html, pre, .markdown table { scrollbar-width: thin; scrollbar-color: var(--muted) transparent; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
footer { max-width: 46rem; margin: 0 auto; padding: 0 1rem 2rem; font-size: 0.85rem; }
`;
