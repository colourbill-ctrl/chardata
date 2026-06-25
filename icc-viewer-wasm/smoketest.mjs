// (c) 2026 William Li
// Quick Node-side check: load icc-viewer.mjs from public/wasm and run
// validateProfile + describeTag on a small ICC profile from the test corpus.
// Usage: node icc-viewer-wasm/smoketest.mjs <path-to-profile.icc>
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(__dirname, '..', 'public', 'wasm');

const profilePath = process.argv[2];
if (!profilePath) { console.error('usage: node smoketest.mjs <profile.icc>'); process.exit(2); }

const { default: createIccViewerModule } = await import('file://' + path.join(wasmDir, 'icc-viewer.mjs'));
const mod = await createIccViewerModule({
  locateFile: (f) => path.join(wasmDir, f),
});

const bytes = new Uint8Array(await readFile(profilePath));
const json  = mod.validateProfile(bytes);
const data  = JSON.parse(json);

if (data.error) { console.error('ERROR:', data.error); process.exit(1); }

console.log('file              :', path.basename(profilePath));
console.log('library version   :', data.libraryVersion);
console.log('size              :', data.sizeBytes, 'bytes');
console.log('profile id (md5)  :', data.profileId);
console.log('header fields     :', Object.keys(data.header).length);
console.log('  Description      ', data.header['Profile Description'] || '(none)');
console.log('  Colorspace       ', data.header['Data Color Space']);
console.log('  Class            ', data.header['Profile Class']);
console.log('  Version          ', data.header['Version']);
console.log('  Cmm              ', data.header['Cmm']);
console.log('tags              :', data.tags.length);
data.tags.slice(0, 8).forEach((t, i) => {
  const pad = (t.pad < 0 ? '!' : (t.pad > 3 ? '~' : ' ')) + String(t.pad).padStart(3);
  console.log(`  ${String(i+1).padStart(2)}. ${t.name.padEnd(28)} [${t.id}] ${String(t.type).padEnd(28)} off=${String(t.offset).padStart(7)} size=${String(t.size).padStart(7)} pad=${pad}`);
});
if (data.tags.length > 8) console.log(`  ... ${data.tags.length - 8} more`);
console.log('validation        :', data.validation.level, '—', data.validation.status);
if (data.validation.messages.length) {
  console.log('messages:');
  for (const m of data.validation.messages.slice(0, 5)) console.log('  ', m);
}

// Verbosity-100 describeTag on the first tag
if (data.tags.length) {
  const first = data.tags[0];
  const desc = JSON.parse(mod.describeTag(bytes, first.id));
  if (desc.error) console.log('describeTag error :', desc.error);
  else console.log(`describeTag(${first.id}) len=${desc.description.length}, first line:`,
                   desc.description.split('\n')[0]);
}
