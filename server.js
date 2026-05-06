const express = require('express');
const helmet  = require('helmet');
const path    = require('path');

const app = express();
const PORT = 3001;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'",
                        "https://www.googletagmanager.com", "blob:"],
      styleSrc:        ["'self'", "'unsafe-inline'"],
      imgSrc:          ["'self'", "data:"],
      connectSrc:      ["'self'", "blob:",
                        "https://www.google-analytics.com",
                        "https://region1.google-analytics.com"],
      workerSrc:       ["'self'", "blob:"],
      scriptSrcAttr:   ["'unsafe-inline'"],
      objectSrc:       ["'none'"],
      frameAncestors:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false // WASM blob-URL loading requires relaxed COEP
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.status(200).type('text/plain').send('ok'));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
  }
}));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
