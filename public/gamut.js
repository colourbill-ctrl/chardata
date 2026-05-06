/**
 * gamut.js — WASM loader and JS wrapper for the CharData gamut module.
 *
 * Exposes window.Gamut = {
 *   preload()                                          → Promise<void>
 *   fitModel(data)                                     → Promise<model>
 *   buildGamutMesh(model, steps)                       → Promise<{vertices, triangles}>
 *   buildSlice(model, axis, value, steps)              → Promise<{polygon, raw}>
 *   loadIccProfile(arrayBuffer)                        → Promise<{handle, colorSpace, ...}>
 *   evalIccA2BSync(handleId, colorants[], intent)      → {L, a, b}   (sync — needs preload)
 *   evalIccBatchSync(handleId, patches[][], intent)    → [{L,a,b}]  (sync — needs preload)
 *   buildIccGamutMesh(handleId, intent, steps)         → Promise<{vertices, triangles}>
 *   buildIccSlice(handleId, intent, axis, value, steps)→ Promise<{polygon, raw}>
 *   freeIccProfile(handleId)                           → void
 *   BOUNDARY_STEPS   []   — default steps per colorant count (3D mesh)
 *   SLICE_FACE_STEPS []   — default steps per colorant count (2D slice)
 * }
 *
 * Uses blob-URL dynamic import to load the Emscripten ES6 module glue from
 * /wasm/chardata-gamut.mjs without a bundler (same pattern as iccgamut).
 */
(function () {
  'use strict';

  const WASM_MJS_URL  = '/wasm/chardata-gamut.mjs';
  const WASM_BIN_URL  = '/wasm/chardata-gamut.wasm';

  // Default grid density by colorant count (index = nColorants).
  // Mesh vertex count grows as C(N,2) * 2^(N-2) * (steps+1)^2, so steps must
  // shrink fast for high N. Past ~N=10 even the minimum (steps=2) is heavy;
  // 12+ may OOM in WASM. NCLR profiles up to 15 channels are still attempted,
  // best-effort. Slice memory is bounded per-face, so SLICE_FACE_STEPS is more
  // generous than BOUNDARY_STEPS.
  //                          0   1   2   3   4  5  6  7  8  9 10 11 12 13 14 15
  const BOUNDARY_STEPS   = [  0, 50, 40, 14,  7, 5, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2];
  const SLICE_FACE_STEPS = [  0, 50, 40, 14, 10, 6, 4, 4, 3, 3, 2, 2, 2, 2, 2, 2];

  // ── Module loading ──────────────────────────────────────────────────────────
  let modulePromise = null;
  let _mod = null;  // cached module reference for synchronous calls after preload

  function getModule() {
    if (modulePromise) return modulePromise;
    modulePromise = (async () => {
      // Fetch the .mjs glue as text so we can rewrite the hardcoded relative
      // .wasm URL to an absolute one (the blob URL has no base URL of its own).
      const mjsText = await fetch(WASM_MJS_URL).then(r => {
        if (!r.ok) throw new Error(`Failed to load ${WASM_MJS_URL}: ${r.status}`);
        return r.text();
      });

      const absWasmUrl = new URL(WASM_BIN_URL, location.href).href;
      const patched = mjsText.replace(
        /(['"`])chardata-gamut\.wasm\1/g,
        JSON.stringify(absWasmUrl)
      );

      const blob    = new Blob([patched], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      let createModule;
      try {
        ({ default: createModule } = await import(blobUrl));
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      const m = await createModule();
      _mod = m;
      return m;
    })();
    return modulePromise;
  }

  // ── Error unwrapping ────────────────────────────────────────────────────────
  // Emscripten encodes embind CppException as an opaque integer.
  // getExceptionMessage() returns ["TypeName", "what()"].
  function unwrapError(mod, e) {
    try {
      if (typeof mod.getExceptionMessage === 'function') {
        const parts = mod.getExceptionMessage(e);
        const what  = (parts && parts[1]) ? parts[1] : String(e);
        if (typeof mod.decrementExceptionRefcount === 'function')
          mod.decrementExceptionRefcount(e);
        return new Error(what);
      }
    } catch (_) {}
    return e instanceof Error ? e : new Error(String(e));
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Preload (and cache) the WASM module. Call this as early as possible so the
   * first real computation doesn't pay the full download + instantiation cost.
   */
  async function preload() {
    await getModule();
  }

  /**
   * Fit a weighted polynomial model to characterisation data.
   *
   * @param {object} data
   *   { nColorants, colorantNames[], colorants[][], labL[], labA[], labB[] }
   *   colorants[][] values are in original units (e.g. 0..100 for ink %).
   * @returns {Promise<object>} model — pass to buildGamutMesh / buildSlice
   */
  async function fitModel(data) {
    const mod = await getModule();
    try {
      const json = mod.fitModel(JSON.stringify(data));
      return JSON.parse(json);
    } catch (e) {
      throw unwrapError(mod, e);
    }
  }

  /**
   * Build a 3D gamut mesh via boundary-cloud triangulation of the polynomial
   * model's device hypercube 2-skeleton.
   *
   * @param {object} model   — result of fitModel()
   * @param {number} steps   — grid points per free axis (use BOUNDARY_STEPS[nC])
   * @returns {Promise<{vertices: number[][], triangles: number[][]}>}
   *   vertices[i] = [L*, a*, b*];  triangles[i] = [vi, vj, vk]
   */
  async function buildGamutMesh(model, steps) {
    const mod = await getModule();
    try {
      const json = mod.buildGamutMesh(JSON.stringify(model), steps);
      return JSON.parse(json);
    } catch (e) {
      throw unwrapError(mod, e);
    }
  }

  /**
   * Compute the 2D gamut slice at a fixed Lab axis value.
   *
   * @param {object} model   — result of fitModel()
   * @param {number} axis    — 0=L*, 1=a*, 2=b*
   * @param {number} value   — slice plane value
   * @param {number} steps   — grid density (use SLICE_FACE_STEPS[nC])
   * @returns {Promise<{polygon: number[][], raw: number[][]}>}
   *   polygon = convex hull vertices in (u,v) order:
   *     axis=L → (a*,b*), axis=a → (L*,b*), axis=b → (L*,a*)
   */
  async function buildSlice(model, axis, value, steps) {
    const mod = await getModule();
    try {
      const json = mod.buildSlice(JSON.stringify(model), axis, value, steps);
      return JSON.parse(json);
    } catch (e) {
      throw unwrapError(mod, e);
    }
  }

  // ── ICC helpers ─────────────────────────────────────────────────────────────

  // Encode ArrayBuffer → base64 string in 8 KB chunks (avoids stack overflow
  // with large profiles when using String.fromCharCode spread).
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return btoa(binary);
  }

  /**
   * Load an ICC profile from an ArrayBuffer.
   * Returns { handle, colorSpace, deviceClass, description, nColorants,
   *           colorants[], intents[] }
   */
  async function loadIccProfile(arrayBuffer) {
    const mod = await getModule();
    try {
      const b64 = arrayBufferToBase64(arrayBuffer);
      return JSON.parse(mod.loadIccProfile(b64));
    } catch (e) {
      throw unwrapError(mod, e);
    }
  }

  /**
   * Synchronous single-point A2B evaluation.
   * Requires preload() to have resolved before calling.
   * colorants: 0–100 values.
   */
  function evalIccA2BSync(handleId, colorants, intent) {
    if (!_mod) throw new Error('WASM not yet loaded — call Gamut.preload() first');
    return JSON.parse(_mod.evalIccA2B(handleId, JSON.stringify(colorants), intent));
  }

  /**
   * Synchronous batch A2B evaluation — one cmsDoTransform call for all patches.
   * patches: array of colorant arrays (0–100 each).
   */
  function evalIccBatchSync(handleId, patches, intent) {
    if (!_mod) throw new Error('WASM not yet loaded — call Gamut.preload() first');
    return JSON.parse(_mod.evalIccBatch(handleId, JSON.stringify(patches), intent));
  }

  /**
   * Build a 3D gamut mesh via the ICC A2B CLUT (same 2-skeleton as buildGamutMesh).
   */
  async function buildIccGamutMesh(handleId, intent, steps) {
    const mod = await getModule();
    try {
      return JSON.parse(mod.buildIccGamutMesh(handleId, intent, steps));
    } catch (e) {
      throw unwrapError(mod, e);
    }
  }

  /**
   * Compute the 2D gamut slice via the ICC A2B CLUT.
   * axis: 0=L*, 1=a*, 2=b*
   */
  async function buildIccSlice(handleId, intent, axis, value, steps) {
    const mod = await getModule();
    try {
      return JSON.parse(mod.buildIccSlice(handleId, intent, axis, value, steps));
    } catch (e) {
      throw unwrapError(mod, e);
    }
  }

  /** Release an ICC profile handle and its cached transforms. */
  function freeIccProfile(handleId) {
    if (_mod) _mod.freeIccProfile(handleId);
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  window.Gamut = {
    preload,
    fitModel,
    buildGamutMesh,
    buildSlice,
    loadIccProfile,
    evalIccA2BSync,
    evalIccBatchSync,
    buildIccGamutMesh,
    buildIccSlice,
    freeIccProfile,
    BOUNDARY_STEPS,
    SLICE_FACE_STEPS,
  };
})();
