// (c) 2026 William Li
/**
 * icc-viewer.js — lazy loader for the IccProfLib-based ICC profile viewer.
 *
 * The WASM module (built from icc-viewer-wasm/wrapper.cpp) is only fetched on
 * first call to validateProfile() or describeTag() — keeping chardata's cold
 * load unchanged for users who never click "Display File" on an ICC slot.
 *
 * Mirrors the blob-URL dynamic-import pattern in gamut.js so the same approach
 * works without a bundler.
 *
 * Exposes:
 *   window.IccViewer = {
 *     validateProfile(uint8) → Promise<JSON>   // header + tags + validation
 *     describeTag(uint8, sig) → Promise<string> // verbosity-100 dump for one tag
 *     // — data-first visualizations (IccVizModel, compiled into the same module):
 *     enumerate(uint8) → Promise<Array>        // {kind,id,title,output,tagSig,grp,idx}
 *     renderGraph(uint8, id) → Promise<JSON>   // {title,xAxis,yAxis,series[]}
 *     renderRaster(uint8, id) → Promise<JSON>  // {width,height,…,samples:Uint8Array}
 *     tagEvalInfo(uint8, sig) → Promise<JSON>  // transform shape for the evaluator
 *     evaluateTag(uint8, sig, input[], norm?) → Promise<JSON>  // single-point apply
 *   }
 */
(function () {
  'use strict';

  const WASM_MJS_URL = '/wasm/icc-viewer.mjs';
  const WASM_BIN_URL = '/wasm/icc-viewer.wasm';

  let modulePromise = null;

  function getModule() {
    if (modulePromise) return modulePromise;
    modulePromise = (async () => {
      const mjsText = await fetch(WASM_MJS_URL).then(r => {
        if (!r.ok) throw new Error(`Failed to load ${WASM_MJS_URL}: ${r.status}`);
        return r.text();
      });
      const absWasmUrl = new URL(WASM_BIN_URL, location.href).href;
      const patched = mjsText.replace(
        /(['"`])icc-viewer\.wasm\1/g,
        JSON.stringify(absWasmUrl)
      );
      const blob    = new Blob([patched], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const { default: createModule } = await import(blobUrl);
        return await createModule();
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })();
    modulePromise.catch(() => { modulePromise = null });
    return modulePromise;
  }

  async function validateProfile(bytes) {
    const mod = await getModule();
    const json = mod.validateProfile(bytes);
    const data = JSON.parse(json);
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function describeTag(bytes, tagSig) {
    const mod = await getModule();
    const json = mod.describeTag(bytes, tagSig);
    const data = JSON.parse(json);
    if (data.error) throw new Error(data.error);
    return data.description;
  }

  // ── data-first visualizations (IccVizModel) ──────────────────────────────
  // Same module as validateProfile/describeTag — the viz engine is compiled in
  // via plot-wrapper.cpp, so these reuse the loaded WASM (and its parse cache).

  async function enumerate(bytes) {
    const mod = await getModule();
    const arr = JSON.parse(mod.enumerate(bytes));
    if (arr && arr.error) throw new Error(arr.error);
    return arr;
  }

  async function renderGraph(bytes, id) {
    const mod = await getModule();
    const g = JSON.parse(mod.renderGraph(bytes, id));
    if (g.error) throw new Error(g.error);
    return g;
  }

  async function renderRaster(bytes, id) {
    const mod = await getModule();
    const r = mod.renderRaster(bytes, id);
    if (r.error) throw new Error(r.error);
    // Copy samples off the WASM heap so they survive later calls.
    return {
      width: r.width, height: r.height, channels: r.channels,
      bitsPerChannel: r.bitsPerChannel, photometric: r.photometric,
      normalizedICC: r.normalizedICC, samples: Uint8Array.from(r.samples),
      warnings: r.warnings ? Array.from(r.warnings) : [],
    };
  }

  async function tagEvalInfo(bytes, tagSig) {
    const mod = await getModule();
    const r = JSON.parse(mod.tagEvalInfo(bytes, tagSig));
    if (r.error) throw new Error(r.error);
    return r;
  }

  async function evaluateTag(bytes, tagSig, input, inputIsNormalized = false) {
    const mod = await getModule();
    const r = JSON.parse(mod.evaluateTag(bytes, tagSig, JSON.stringify(input), inputIsNormalized));
    if (r.error) throw new Error(r.error);
    return r;
  }

  window.IccViewer = {
    validateProfile, describeTag,
    enumerate, renderGraph, renderRaster, tagEvalInfo, evaluateTag,
  };
})();
