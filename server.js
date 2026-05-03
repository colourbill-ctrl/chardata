const express = require('express');
const helmet  = require('helmet');
const path    = require('path');

const app = express();
const PORT = 3001;

app.use(helmet({
  contentSecurityPolicy: false,   // app uses inline scripts + CDN; CSP needs per-project tuning
  crossOriginEmbedderPolicy: false // WASM blob-URL loading requires relaxed COEP
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => res.status(418).type('text/plain').send('teapot (temporary — UptimeRobot test)'));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
  }
}));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
