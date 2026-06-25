// (c) William Li 2026
const express = require('express');
const helmet  = require('helmet');
const path    = require('path');
const fs      = require('fs');

const app = express();
const PORT = 3001;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'",
                        "https://www.googletagmanager.com", "blob:"],
      styleSrc:        ["'self'", "'unsafe-inline'"],
      imgSrc:          ["'self'", "data:", "blob:"],
      connectSrc:      ["'self'", "blob:",
                        "https://www.google-analytics.com",
                        "https://region1.google-analytics.com",
                        // Subscribe form posts cross-origin to the WP plugin
                        // hosted at colourbill.com (handles list management,
                        // moderation, and release sends). The endpoint emits
                        // the matching Access-Control-Allow-Origin response.
                        // Apex redirects to www, and Apache's 301 doesn't carry
                        // ACAO — browsers reject CORS on the redirect itself —
                        // so we POST to www directly. Apex is kept in the list
                        // in case someone hand-edits a URL.
                        "https://colourbill.com",
                        "https://www.colourbill.com",
                        // Dev: local Docker WP stack (see /tmp/wp-e2e). Harmless
                        // in prod since the directive is enforced by the browser;
                        // a prod page can't reach localhost anyway.
                        "http://localhost:8000"],
      workerSrc:       ["'self'", "blob:"],
      scriptSrcAttr:   ["'unsafe-inline'"],
      objectSrc:       ["'none'"],
      frameAncestors:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // WASM blob-URL loading requires relaxed COEP
  // helmet's default COOP is 'same-origin', which nulls out window.opener for
  // cross-origin popups — that breaks the chardata → profiletool launch hand-off
  // in local dev (chardata:3001 opens profiletool:5173). 'same-origin-allow-popups'
  // keeps the main page cross-origin-isolated but preserves the opener handle
  // for windows this page opens. Production is same-origin (/profiletool/
  // subpath) so this is a no-op there.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.status(200).type('text/plain').send('ok'));

// Memory watchdog for outside-in monitoring. UptimeRobot runs a Keyword monitor
// against this URL set to alert when "MEM_OK" is ABSENT — so a low-memory reading
// (token flips to MEM_LOW) or a total box lockup (no response at all) both trip
// the same alert. The 447MB Lightsail instance has no headroom; a nightly apt
// kernel upgrade once OOM-thrashed it into being unreachable on every port. We
// added 2GB swap as the cushion; this endpoint is the early-warning tripwire.
//
// Reads /proc/meminfo directly (cheap, dependency-free, same spirit as /health).
// Body is JUST the token — no raw numbers — since the URL is publicly reachable;
// the metrics go to the server log only. Fails OPEN to MEM_OK if meminfo can't be
// read (e.g. non-Linux dev box) so the monitor doesn't false-alarm off-platform.
const MIN_AVAIL_MB = 100; // available RAM floor before we flag
const MAX_SWAP_PCT = 60;  // swap utilisation ceiling before we flag
app.get('/memstat', (req, res) => {
  let token = 'MEM_OK';
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const kB = (k) => { const m = mi.match(new RegExp('^' + k + ':\\s+(\\d+) kB', 'm')); return m ? +m[1] : null; };
    const availMB  = kB('MemAvailable') != null ? kB('MemAvailable') / 1024 : Infinity;
    const swapTot  = kB('SwapTotal') || 0;
    const swapFree = kB('SwapFree')  || 0;
    const swapPct  = swapTot > 0 ? ((swapTot - swapFree) / swapTot) * 100 : 0;
    if (availMB < MIN_AVAIL_MB || swapPct > MAX_SWAP_PCT) {
      token = 'MEM_LOW';
      console.warn(`/memstat MEM_LOW: avail=${availMB.toFixed(0)}MB swapUsed=${swapPct.toFixed(0)}%`);
    }
  } catch (e) {
    // meminfo unavailable — fail open so the keyword stays present.
  }
  res.status(200).type('text/plain').send(token);
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
  }
}));

// Bind to loopback only: nginx reverse-proxies to localhost:3001 over TLS.
// Binding 0.0.0.0 also exposed the app directly over plaintext HTTP on :3001,
// bypassing nginx/TLS — 127.0.0.1 keeps it private to the proxy.
app.listen(PORT, '127.0.0.1', () => console.log(`Server running at http://127.0.0.1:${PORT}`));
