# CharData — Colour Gamut Comparison Tool

Compares characterisation data from two ICC-profiling CSV files, showing
3D gamut shells, 2D gamut slices, and per-patch ΔE statistics.

Live at **[chardata.colourbill.com](https://chardata.colourbill.com)**

---

## Running locally

```bash
npm install
node server.js
# → http://localhost:3001
```

No build step for JS — `server.js` is a static file server only.

---

## Architecture

Everything of substance is in `public/index.html`. The Express server
only serves static files and sets the correct MIME type for `.wasm`.

Gamut computation (model fitting, 3D mesh, 2D slice) runs in C++
compiled to WebAssembly:

| File | Purpose |
|---|---|
| `gamut-wasm/gamut-wrapper.cpp` | C++ source — three embind-exported functions |
| `gamut-wasm/CMakeLists.txt` | CMake build config for Emscripten |
| `public/wasm/chardata-gamut.mjs` | Emscripten JS glue (committed build artifact) |
| `public/wasm/chardata-gamut.wasm` | WASM binary (committed build artifact) |
| `public/gamut.js` | JS wrapper — loads WASM, exposes `window.Gamut` |

---

## Building the WASM module

Requires WSL (Ubuntu) with Emscripten and nlohmann-json installed.

**One-time WSL setup:**
```bash
# Install Emscripten
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk-install/emsdk
cd ~/emsdk-install/emsdk && ./emsdk install latest && ./emsdk activate latest
source ~/emsdk-install/emsdk/emsdk_env.sh

# Install nlohmann/json
sudo apt install nlohmann-json3-dev
```

**Build:**
```bash
# From WSL, at the repo root:
scripts/build-wasm.sh
```

Artifacts are written to `public/wasm/`. Commit them alongside any
C++ source changes — the Lightsail server has no build toolchain.

**The pre-commit hook handles this automatically**: if any file under
`gamut-wasm/` is staged, the hook runs `build-wasm.sh` via WSL and
stages the rebuilt artifacts before the commit completes. A build
failure aborts the commit.

---

## Fresh clone setup

After cloning, run once to activate the pre-commit hook:

```bash
git config core.hooksPath hooks
```

The hook script is tracked in `hooks/pre-commit`; only the git config
pointer needs to be set manually.

---

## Deployment

Pushes to `main` auto-deploy to Lightsail via GitHub Actions
(`.github/workflows/deploy.yml`). The workflow SSHs into the server,
does `git pull`, runs `npm install --omit=dev`, and restarts the pm2
process. No build step on the server.

Required GitHub Actions secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`.

**To roll back to the pure-JS version**, check out the `legacy/compare`
branch — that preserves the app as it was before the WASM migration.

---

## CSV format

Required columns: `CYAN`, `MAGENTA`, `YELLOW`, `BLACK`, `LAB_L`, `LAB_A`, `LAB_B`
