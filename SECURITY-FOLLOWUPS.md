# Security follow-ups

Tracking list of hardening items deferred from the 1.4.0 security review (2026-05-02).
Removed in a future PR — none of these are actively exploitable in the current threat
model (browser-only app, same-origin, no backend), but each closes a defence-in-depth gap.

## 1. `escapeHtml` sweep of pre-existing innerHTML sinks

Several places in `public/index.html` still interpolate untrusted file content into
`innerHTML` template literals without escaping. The 1.4.0 review fixed the new ICC + compare
sinks but left these alone since they pre-date the change. A crafted CSV with `<script>`
in a column header or file name would inject in:

- `~4491` — TV chart legend dataset label (`${ds.name}` in `buildTvColorantCheckboxes`)
- `~4599` — TV trace label (`${ds.name}` in `renderTvChart`)
- `~4800` — Data Table heading (`${a.name}`)
- `buildSpectralLabel` (search the file) — assembles HTML from header/colorant strings

**Fix:** route each through the existing `escapeHtml` helper at `public/index.html:~2019`.

Approach: grep for `${` inside template literals that flow into `.innerHTML =` and audit
each one. Don't refactor the rendering layer — escape at the sinks.

## 2. Content-Security-Policy header in `server.js`

No CSP today. `server.js` is a small Express static server; adding a header middleware is
trivial. Starter that should work given Plotly's inline-style usage and the WASM blob
loader:

```
Content-Security-Policy: default-src 'self';
  img-src 'self' data:;
  style-src 'self' 'unsafe-inline';
  script-src 'self' 'wasm-unsafe-eval';
  connect-src 'self' blob:;
  worker-src 'self' blob:
```

**Test plan:** boot `node server.js`, load the page in a real browser, exercise:
- 3D plot (Plotly inline styles)
- WASM module load (blob URL)
- Settings panel open / close
- Help page (`help.html`)
- ICC profile load + render

If anything breaks, narrow the violations rather than dropping CSP. Each disallowed source
should produce a console error pointing at the directive that needs widening.

## 3. Max input size guard in `addFileToList`

`public/index.html` `addFileToList` accepts any `File` size and reads via `FileReader`.
A user-loaded multi-GB CSV would OOM the tab. Low-impact (user shoots own foot), but a
~200 MB cap with a friendly toast/error is cheap insurance. Use the existing error-display
pattern (look at the CGATS / file-invalid messages).

## How to pick this up

Either pick up directly or ask Claude something like:
> Read `SECURITY-FOLLOWUPS.md` and start a feature branch implementing item N.

The 1.4.0 review notes (in the conversation that produced commit `ae79e17`) have more
context if needed.
