/**
 * gamut.js — WASM loader and JS wrapper for the compwas gamut module.
 *
 * Exposes window.Gamut = {
 *   preload()                              → Promise<void>
 *   fitModel(data)                         → Promise<model>
 *   buildGamutMesh(model, steps)           → Promise<{vertices, triangles}>
 *   buildSlice(model, axis, value, steps)  → Promise<{polygon, raw}>
 *   BOUNDARY_STEPS   []   — default steps per colorant count (3D mesh)
 *   SLICE_FACE_STEPS []   — default steps per colorant count (2D slice)
 * }
 *
 * Uses blob-URL dynamic import to load the Emscripten ES6 module glue from
 * /wasm/compwas-gamut.mjs without a bundler (same pattern as iccgamut).
 */
(function () {
  'use strict';

  const WASM_MJS_URL  = '/wasm/compwas-gamut.mjs';
  const WASM_BIN_URL  = '/wasm/compwas-gamut.wasm';

  // Default grid density by colorant count (index = nColorants).
  // Matches compare's BOUNDARY_STEPS / SLICE_FACE_STEPS constants.
  const BOUNDARY_STEPS   = [0, 50, 40, 14,  7,  5, 3];
  const SLICE_FACE_STEPS = [0, 50, 40, 14, 10,  6, 4];

  // ── Module loading ──────────────────────────────────────────────────────────
  let modulePromise = null;

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
        /(['"`])compwas-gamut\.wasm\1/g,
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

      return createModule();
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

  // ── Export ──────────────────────────────────────────────────────────────────
  window.Gamut = {
    preload,
    fitModel,
    buildGamutMesh,
    buildSlice,
    BOUNDARY_STEPS,
    SLICE_FACE_STEPS,
  };
})();
