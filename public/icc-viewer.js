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

  window.IccViewer = { validateProfile, describeTag };
})();
