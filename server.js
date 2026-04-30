const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
  }
}));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
