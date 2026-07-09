#!/usr/bin/env node
/*
 * Standing regression for the untrusted image-decode path (UTIF + chardata guards).
 *
 *   node scripts/fuzz-image-decode.cjs        # exits non-zero on any regression
 *
 * Covers the surface the 1.15.x ICC-parser fuzz (SECURITY-FOLLOWUPS #18) did NOT:
 * the pure-JS UTIF TIFF/JPEG decoder that chardata's Image tab runs on hostile bytes.
 * Rerun after any bump of public/lib/utif.js.
 *
 * Asserts:
 *   (1) UTIF.decode() never hangs on adversarial IFDs (the #19 tag-count-loop DoS);
 *   (2) a valid TIFF — inline AND out-of-line array tags — still decodes losslessly;
 *   (3) chardata's guards (assertImagePixels / jpegSofDims, mirrored here) accept
 *       legit dimensions and reject every dimension-bomb class (#20).
 */
'use strict';
const path = require('path');
const UTIF = require(path.join(__dirname, '..', 'public', 'lib', 'utif.js'));

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

// ── minimal hand TIFF builder ────────────────────────────────────────────────
const T = { SHORT: 3, LONG: 4 };
function buildTiff(tags, stripBytes) {
  const entries = Object.keys(tags).map(Number).sort((a, b) => a - b);
  const n = entries.length, ifdOff = 8, stripOff = ifdOff + 2 + n * 12 + 4;
  const buf = new Uint8Array(stripOff + (stripBytes ? stripBytes.length : 0));
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, n, true);
  entries.forEach((tag, k) => {
    const [type, count, value] = tags[tag], o = ifdOff + 2 + k * 12;
    dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true);
    if (type === T.SHORT && count === 1) { dv.setUint16(o + 8, value, true); dv.setUint16(o + 10, 0, true); }
    else dv.setUint32(o + 8, value, true);
  });
  dv.setUint32(ifdOff + 2 + n * 12, 0, true);
  if (stripBytes) buf.set(stripBytes, stripOff);
  return { buf, stripOff };
}
function makeImage(W, H, { spp = 1, bpc = 8, photo = 1, comp = 1 } = {}, strip = new Uint8Array([0])) {
  const t = (so) => ({
    256: [T.LONG, 1, W], 257: [T.LONG, 1, H], 258: [T.SHORT, 1, bpc], 259: [T.SHORT, 1, comp],
    262: [T.SHORT, 1, photo], 273: [T.LONG, 1, so], 277: [T.SHORT, 1, spp], 278: [T.LONG, 1, H],
    279: [T.LONG, 1, strip.length],
  });
  return buildTiff(t(buildTiff(t(0), strip).stripOff), strip).buf;
}
const abOf = (u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);

// ── (1) decode() must not hang on adversarial inputs ─────────────────────────
console.log('(1) UTIF.decode() adversarial-input timing (regression: #19 tag-count-loop DoS)');
const HANG_MS = 1000;
let worst = 0, cases = 0;
function timeDecode(bytes) {
  const t0 = process.hrtime.bigint();
  try { UTIF.decode(abOf(bytes)); } catch (_) { /* graceful throw is fine */ }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6; worst = Math.max(worst, ms); cases++;
}
const base = makeImage(4, 4, { spp: 1, bpc: 8 }, new Uint8Array(16));
timeDecode(base);
timeDecode(makeImage(65535, 65535, { spp: 1, bpc: 8 }));
timeDecode(makeImage(100000, 100000, { spp: 1, bpc: 1, photo: 0, comp: 4 }));
for (let i = 0; i < base.length; i++) { const b = base.slice(); b[i] ^= 0xFF; timeDecode(b); }  // bitflip sweep (hit #19 pre-patch)
for (let s = 0; s < 128; s++) { const r = new Uint8Array(80); for (let i = 0; i < r.length; i++) r[i] = (s * 2654435761 + i * 40503) & 0xFF; r[0]=0x49;r[1]=0x49;r[2]=0x2A;r[3]=0; timeDecode(r); }
ok(worst < HANG_MS, `${cases} adversarial decodes, worst ${worst.toFixed(0)}ms (< ${HANG_MS}ms)`);

// ── (2) valid decode, inline + out-of-line array tags, lossless ──────────────
console.log('(2) valid TIFF decode (inline + out-of-line array tags)');
const W = 4, H = 4, strip = new Uint8Array(W * H * 3);
for (let p = 0; p < W * H; p++) { strip[p*3] = p*10; strip[p*3+1] = 255 - p*10; strip[p*3+2] = 128; }
// RGB with an out-of-line [8,8,8] BitsPerSample (count 3 -> 6 bytes -> not inline; the clamp-sensitive path)
const n = 9, ifdOff = 8, afterIFD = ifdOff + 2 + n * 12 + 4, bpsOff = afterIFD, stripOff = bpsOff + 6;
const buf = new Uint8Array(stripOff + W * H * 3), dv = new DataView(buf.buffer);
buf[0]=0x49;buf[1]=0x49;dv.setUint16(2,42,true);dv.setUint32(4,ifdOff,true);dv.setUint16(ifdOff,n,true);
[[256,T.LONG,1,W],[257,T.LONG,1,H],[258,T.SHORT,3,bpsOff],[259,T.SHORT,1,1],[262,T.SHORT,1,2],
 [273,T.LONG,1,stripOff],[277,T.SHORT,1,3],[278,T.LONG,1,H],[279,T.LONG,1,W*H*3]].forEach((t,k)=>{
  const [tag,type,count,v]=t,o=ifdOff+2+k*12; dv.setUint16(o,tag,true);dv.setUint16(o+2,type,true);
  dv.setUint32(o+4,count,true); if(type===T.SHORT&&count===1)dv.setUint16(o+8,v,true); else dv.setUint32(o+8,v,true);
});
dv.setUint32(ifdOff+2+n*12,0,true); dv.setUint16(bpsOff,8,true);dv.setUint16(bpsOff+2,8,true);dv.setUint16(bpsOff+4,8,true);
buf.set(strip, stripOff);
const ifds = UTIF.decode(abOf(buf));
ok(ifds.length === 1 && ifds[0].t258 && ifds[0].t258.length === 3 && ifds[0].t258[0] === 8,
   `out-of-line BitsPerSample = [${ifds[0].t258}] (clamp-preserved)`);
UTIF.decodeImage(abOf(buf), ifds[0]);
ok(ifds[0].data && ifds[0].data.length === W*H*3, `decoded ${ifds[0].data && ifds[0].data.length} bytes (want ${W*H*3})`);
ok(ifds[0].data[0] === 0 && ifds[0].data[1] === 255 && ifds[0].data[2] === 128, `pixel0 = [${ifds[0].data[0]},${ifds[0].data[1]},${ifds[0].data[2]}]`);

// ── (3) chardata guards (mirror of index.html) accept legit / reject bombs ───
console.log('(3) assertImagePixels + jpegSofDims (mirror of index.html guards; regression: #20)');
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
function assertImagePixels(w, h, spp) {
  const Wn = Number(w), Hn = Number(h), S = Math.max(1, Number(spp) || 1);
  if (!Number.isInteger(Wn) || !Number.isInteger(Hn) || Wn <= 0 || Hn <= 0) throw new Error('image_decode_failed');
  const px = Wn * Hn; if (px > MAX_IMAGE_PIXELS || px * S > MAX_IMAGE_PIXELS * 8) throw new Error('image_too_big');
}
function jpegSofDims(u) {
  let i = 2;
  while (i + 9 < u.length) {
    if (u[i] !== 0xFF) { i++; continue; }
    const m = u[i+1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    if (m === 0xD9 || m === 0xDA) break;
    const len = (u[i+2] << 8) | u[i+3]; if (len < 2) break;
    if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
      return { h: (u[i+5] << 8) | u[i+6], w: (u[i+7] << 8) | u[i+8], comps: u[i+9] };
    i += 2 + len;
  }
  return null;
}
const g = (w, h, s) => { try { assertImagePixels(w, h, s); return 'accept'; } catch (e) { return e.message; } };
ok(g(6000, 4000, 3) === 'accept', `24MP RGB -> ${g(6000,4000,3)}`);
ok(g(65535, 65535, 1) === 'image_too_big', `65535^2 -> ${g(65535,65535,1)}`);
ok(g(100000, 100000, 1) === 'image_too_big', `1-bit gigapixel plate -> ${g(100000,100000,1)}`);
ok(g(0, 0, 1) === 'image_decode_failed', `zero dims -> ${g(0,0,1)}`);
const sof = jpegSofDims(Uint8Array.from([0xFF,0xD8,0xFF,0xC0,0,0x11,8,1,0,2,0,3,1,0x11,0,2,0x11,1,3,0x11,1,0xFF,0xD9]));
ok(sof && sof.w === 512 && sof.h === 256, `jpegSofDims -> ${JSON.stringify(sof)}`);

console.log(`\n${fail === 0 ? 'ALL GREEN' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
