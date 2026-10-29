#!/usr/bin/env node
// Cambuz PDF Reader — Phase 2 automated tests (Node.js)
//
// Covers what can be verified without a browser/Electron:
//  1. Sample PDFs exist and parse (page counts)
//  2. Unicode text extraction (English/Hindi/Punjabi intact)
//  3. Search matching helpers (unit tests, incl. native-script queries)
//  4. End-to-end search counts on real PDFs via the app's own algorithm
//  5. Document outlines (bookmarks) present
//  6. Metadata present
//  7. Rotation viewport math
//  8. JS syntax of all app sources
//  9. No Phase-4+ feature leakage (printing is covered by Phase 3 tests)
// 10. Recents pure helpers
//
// Browser-only behavior (canvas rendering, text-layer DOM, IndexedDB,
// fullscreen) is verified via the live web preview + manual checklist
// documented in the README test report.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pdfjsLib = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const searchMod = await import('../src/search.js');
const recentsMod = await import('../src/recents.js');

const { findAllMatches, normalizeStr, verifyMatch, countMatches } = searchMod;
const { makeId, timeAgo, formatBytes } = recentsMod;

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  failures.push(name);
}

function assert(cond, name, detail) {
  if (cond) pass(name);
  else fail(name, detail);
}

function section(title) {
  console.log(`\n## ${title}`);
}

async function loadPdf(name) {
  const data = new Uint8Array(readFileSync(path.join(ROOT, 'samples', name)));
  return pdfjsLib.getDocument({ data }).promise;
}

async function extractAllText(doc) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((i) => (typeof i.str === 'string' ? i.str : '')).join('\n'));
  }
  return pages;
}

/** Doc-wide search using the app's own matching algorithm. */
async function searchDoc(doc, query) {
  let total = 0;
  const perPage = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let n = 0;
    for (const item of tc.items) {
      if (typeof item.str === 'string' && item.str) {
        n += countMatches(item.str, query, false);
      }
    }
    perPage.push(n);
    total += n;
  }
  return { total, perPage };
}

// ---------------------------------------------------------------------------
section('1. Sample PDFs exist and parse');

const EXPECTED_PAGES = {
  'welcome.pdf': 5,
  'cambuz-demo.pdf': 10,
  'hindi-sample.pdf': 4,
  'punjabi-sample.pdf': 4,
  'multilingual.pdf': 7,
};

for (const [file, expected] of Object.entries(EXPECTED_PAGES)) {
  const full = path.join(ROOT, 'samples', file);
  if (!existsSync(full)) {
    fail(`${file} exists`, 'missing — run npm run samples');
    continue;
  }
  pass(`${file} exists`);
  try {
    const doc = await loadPdf(file);
    assert(doc.numPages === expected, `${file} has ${expected} pages`, `got ${doc.numPages}`);
    await doc.destroy();
  } catch (err) {
    fail(`${file} parses with PDF.js`, err.message);
  }
}

// ---------------------------------------------------------------------------
section('2. Unicode text extraction (no corruption)');

{
  const doc = await loadPdf('hindi-sample.pdf');
  const pages = await extractAllText(doc);
  const all = pages.join('\n');
  assert(all.includes('पंजाब'), 'hindi: contains पंजाब');
  for (const w of ['क्ष', 'त्र', 'ज्ञ', 'श्र', 'द्ध', 'ह्म']) {
    assert(all.includes(w), `hindi: conjunct ${w} intact`);
  }
  for (const w of ['उत्तर', 'राज्य', 'पुस्तक', 'कक्षा', 'यज्ञ', 'शस्त्र', 'वस्त्र', 'बुद्ध']) {
    assert(all.includes(w), `hindi: word ${w} intact`);
  }
  for (const w of ['देवनागरी', 'मात्राएँ', 'नमूना', 'दस्तावेज़', 'सुंदर']) {
    assert(all.includes(w), `hindi: word ${w} intact`);
  }
  assert(all.includes('० १ २ ३ ४ ५ ६ ७ ८ ९'), 'hindi: Devanagari digits intact');
  // Combining-mark fidelity: anusvara + vowel sign must survive round-trip.
  assert(all.includes('है।'), 'hindi: vowel sign + danda intact (है।)');
  assert(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(all), 'hindi: no control chars in extraction');
  await doc.destroy();
}
{
  const doc = await loadPdf('punjabi-sample.pdf');
  const pages = await extractAllText(doc);
  const all = pages.join('\n');
  assert(all.includes('ਪੰਜਾਬ'), 'punjabi: contains ਪੰਜਾਬ');
  for (const w of ['ਪੁੱਤਰ', 'ਮੱਖਣ', 'ਦੁੱਧ', 'ਰੁੱਖ', 'ਸਕੂਲ', 'ਕੁੜੀ', 'ਕੱ']) {
    assert(all.includes(w), `punjabi: word ${w} intact (incl. adhak)`);
  }
  for (const w of ['ਨਮੂਨਾ', 'ਦਸਤਾਵੇਜ', 'ਸੁੰਦਰ', 'ਸੂਬਾ', 'ਅਤੇ']) {
    assert(all.includes(w), `punjabi: word ${w} intact`);
  }
  assert(all.includes('੦ ੧ ੨ ੩ ੪ ੫ ੬ ੭ ੮ ੯'), 'punjabi: Gurmukhi digits intact');
  assert(all.includes('Gurmukhi'), 'punjabi: Gurmukhi word intact');
  assert(all.includes('ਹੈ।'), 'punjabi: danda intact (ਹੈ।)');
  assert(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(all), 'punjabi: no control chars in extraction');
  await doc.destroy();
}
{
  const doc = await loadPdf('multilingual.pdf');
  const pages = await extractAllText(doc);
  const all = pages.join('\n');
  assert(all.includes('Punjab'), 'multilingual: contains Punjab');
  assert(all.includes('पंजाब'), 'multilingual: contains पंजाब');
  assert(all.includes('ਪੰਜਾਬ'), 'multilingual: contains ਪੰਜਾਬ');
  await doc.destroy();
}

// ---------------------------------------------------------------------------
section('3. Search helper unit tests');

assert(
  JSON.stringify(findAllMatches('Punjab is here, Punjab again', 'Punjab')) ===
    JSON.stringify([{ index: 0, length: 6 }, { index: 16, length: 6 }]),
  'findAllMatches: two matches with correct offsets'
);
assert(findAllMatches('hello', 'Punjab').length === 0, 'findAllMatches: no false positives');
assert(findAllMatches('anything', '').length === 0, 'findAllMatches: empty query → no matches');
assert(
  findAllMatches('punjab PUNJAB Punjab', 'Punjab').length === 3,
  'findAllMatches: case-insensitive by default'
);
assert(
  findAllMatches('punjab PUNJAB Punjab', 'Punjab', true).length === 1,
  'findAllMatches: matchCase=true finds 1'
);
{
  // Native-script queries must match without corrupting Unicode.
  const hindi = 'पंजाब उत्तर भारत का एक राज्य है। हर साल लोग पंजाब आते हैं।';
  const m = findAllMatches(hindi, 'पंजाब');
  assert(m.length === 2, 'findAllMatches: 2x पंजाब', `got ${m.length}`);
  assert(
    m.every((x) => hindi.slice(x.index, x.index + x.length) === 'पंजाब'),
    'findAllMatches: पंजाब slices byte-exact'
  );
  const punjabi = 'ਪੰਜਾਬ ਸੋਹਣਾ ਹੈ। ਪੰਜਾਬ ਵੇਖੋ।';
  const g = findAllMatches(punjabi, 'ਪੰਜਾਬ');
  assert(g.length === 2, 'findAllMatches: 2x ਪੰਜਾਬ', `got ${g.length}`);
  assert(
    g.every((x) => punjabi.slice(x.index, x.index + x.length) === 'ਪੰਜਾਬ'),
    'findAllMatches: ਪੰਜਾਬ slices byte-exact'
  );
}
assert(
  verifyMatch('say Punjab now', 4, 6, 'Punjab'),
  'verifyMatch: true for aligned match'
);
assert(
  !verifyMatch('say Punjab now', 5, 6, 'Punjab'),
  'verifyMatch: false for misaligned offset'
);
assert(
  verifyMatch('ਪੰਜਾਬ ਹੈ', 0, 5, 'ਪੰਜਾਬ'),
  'verifyMatch: true for native-script match'
);
assert(normalizeStr('पंजाब') === 'पंजाब', 'normalizeStr: NFC stable');
assert(countMatches('aa AA aA', 'aa') === 3, 'countMatches: 3 case-insensitive');

// ---------------------------------------------------------------------------
section('4. End-to-end search counts on real PDFs');

{
  const doc = await loadPdf('multilingual.pdf');
  const en = await searchDoc(doc, 'Punjab');
  const hi = await searchDoc(doc, 'पंजाब');
  const pa = await searchDoc(doc, 'ਪੰਜਾਬ');
  console.log(`  info  multilingual counts: Punjab=${en.total} पंजाब=${hi.total} ਪੰਜਾਬ=${pa.total}`);
  console.log(`  info  per-page Punjab: [${en.perPage}] पंजाब: [${hi.perPage}] ਪੰਜਾਬ: [${pa.perPage}]`);
  assert(en.total === 12, 'multilingual: Punjab x12', `got ${en.total}`);
  assert(hi.total === 12, 'multilingual: पंजाब x12', `got ${hi.total}`);
  assert(pa.total === 12, 'multilingual: ਪੰਜਾਬ x12', `got ${pa.total}`);
  // Spot-check distribution: English chapter page has 6, mixed page 1, test page 5.
  assert(en.perPage[1] === 6, 'multilingual: English chapter page has 6x Punjab', `got ${en.perPage[1]}`);
  assert(hi.perPage[2] === 6, 'multilingual: Hindi chapter page has 6x पंजाब', `got ${hi.perPage[2]}`);
  assert(pa.perPage[3] === 6, 'multilingual: Punjabi chapter page has 6x ਪੰਜਾਬ', `got ${pa.perPage[3]}`);
  // Case-insensitive query finds the same matches.
  const lower = await searchDoc(doc, 'punjab');
  assert(lower.total === 12, 'multilingual: lowercase query finds 12', `got ${lower.total}`);
  await doc.destroy();
}
{
  const doc = await loadPdf('hindi-sample.pdf');
  const hi = await searchDoc(doc, 'पंजाब');
  assert(hi.total === 6, 'hindi-sample: पंजाब x6', `got ${hi.total}`);
  await doc.destroy();
}
{
  const doc = await loadPdf('punjabi-sample.pdf');
  const pa = await searchDoc(doc, 'ਪੰਜਾਬ');
  assert(pa.total === 6, 'punjabi-sample: ਪੰਜਾਬ x6', `got ${pa.total}`);
  await doc.destroy();
}

// ---------------------------------------------------------------------------
section('4b. Full-text golden check (whitespace-normalized per page)');

// Golden extraction: every page must extract EXACTLY as authored — any
// ToUnicode corruption, dropped conjunct, inferred space inside a word, or
// missing line fails here. Goldens were verified by eye; regenerate samples
// and re-verify before changing them.
const GOLDEN = {
  'multilingual.pdf': [
    'Cambuz Multilingual Sample English | देवनागरी | Gurmukhi script Seven pages across three languages for exercising search, text selection, copying, thumbnails and bookmarks. The document outline lists every chapter below. Page 1/7',
    'English - Rivers and Fields Punjab is a region in South Asia. The name Punjab means land of five rivers. Many travellers visit Punjab every year. The fields of Punjab are famously fertile. River waters shaped Punjab over centuries. This page mentions Punjab six times for testing. Page 2/7',
    'देवनागरी - नदी और खेत पंजाब उत्तर भारत का एक राज्य है। पंजाब की राजधानी चंडीगढ़ है। हर साल लाखों लोग पंजाब आते हैं। पंजाब के खेत बहुत उपजाऊ हैं। पांच जलधाराएं पंजाब को सींचती हैं। इस पृष्ठ पर पंजाब छह बार आता है। Page 3/7',
    'ਨਦੀਆਂ ਅਤੇ ਖੇਤ ਪੰਜਾਬ ਦੱਖਣੀ ਏਸ਼ੀਆ ਦਾ ਇੱਕ ਖੇਤਰ ਹੈ। ਪੰਜਾਬ ਦੀ ਰਾਜਧਾਨੀ ਚੰਡੀਗੜ੍ਹ ਹੈ। ਹਰ ਸਾਲ ਲੱਖਾਂ ਲੋਕ ਪੰਜਾਬ ਆਉਂਦੇ ਹਨ। ਪੰਜਾਬ ਦੇ ਖੇਤ ਬਹੁਤ ਉਪਜਾਊ ਹਨ। ਪੰਜ ਨਦੀਆਂ ਪੰਜਾਬ ਦੀ ਜਾਨ ਹਨ। ਇਹ ਪੰਨਾ ਪਰਖ ਲਈ ਪੰਜਾਬ ਨਾਮ ਛੇ ਵਾਰ ਵਰਤਦਾ ਹੈ। Page 4/7',
    'Mixed Scripts Two scripts, three lines English line: Punjab (once on this page). देवनागरी उदाहरण: पंजाब (इस पृष्ठ पर एक बार)। Gurmukhi ਉਦਾਹਰਨ: ਪੰਜਾਬ (ਇਸ ਪੰਨੇ ਉਤੇ ਇੱਕ ਵਾਰ)। Page 5/7',
    'Search Test - Repeated Terms Each line below repeats the same three terms. Searching for any of them must find every line on this page. Punjab पंजाब ਪੰਜਾਬ Punjab पंजाब ਪੰਜਾਬ Punjab पंजाब ਪੰਜਾਬ Punjab पंजाब ਪੰਜਾਬ Punjab पंजाब ਪੰਜਾਬ Page 6/7',
    'Colophon This file exercises search, selection, copying, thumbnails and bookmarks across three scripts. Rendered with embedded Noto fonts and HarfBuzz shaping so conjuncts and vowel signs display exactly as readers expect. Page 7/7',
  ],
  'hindi-sample.pdf': [
    'नमूना दस्तावेज़ Cambuz PDF Reader यह चार पृष्ठ का दस्तावेज़ है। Page 1/4',
    'छह उदाहरण पंजाब उत्तर भारत का एक राज्य है। पंजाब की राजधानी चंडीगढ़ है। हर साल लाखों लोग पंजाब आते हैं। पंजाब के खेत बहुत उपजाऊ हैं। पांच जलधाराएं पंजाब को सींचती हैं। इस पृष्ठ पर पंजाब छह बार आता है। Page 2/4',
    'अक्षर और अंक अक्षर: क्ष त्र ज्ञ श्र द्ध ह्म उदाहरण: उत्तर राज्य पुस्तक कक्षा उदाहरण: यज्ञ शस्त्र वस्त्र बुद्ध मात्राएँ : का की कु कू के कै को कौ कं कः अंक: ० १ २ ३ ४ ५ ६ ७ ८ ९ भारत महान देश है। Page 3/4',
    'English और देवनागरी English and देवनागरी on one page. The river Satluj flows on. चंडीगढ़ एक सुंदर शहर है। Page 4/4',
  ],
  'punjabi-sample.pdf': [
    'ਨਮੂਨਾ ਦਸਤਾਵੇਜ Cambuz PDF Reader ਇਹ ਪਰਖ ਦਸਤਾਵੇਜ ਹੈ। Page 1/4',
    'ਛੇ ਉਦਾਹਰਨ ਪੰਜਾਬ ਦੱਖਣੀ ਏਸ਼ੀਆ ਦਾ ਇੱਕ ਖੇਤਰ ਹੈ। ਪੰਜਾਬ ਦੀ ਰਾਜਧਾਨੀ ਚੰਡੀਗੜ੍ਹ ਹੈ। ਹਰ ਸਾਲ ਲੱਖਾਂ ਲੋਕ ਪੰਜਾਬ ਆਉਂਦੇ ਹਨ। ਪੰਜਾਬ ਦੇ ਖੇਤ ਬਹੁਤ ਉਪਜਾਊ ਹਨ। ਪੰਜ ਨਦੀਆਂ ਪੰਜਾਬ ਦੀ ਜਾਨ ਹਨ। ਇਹ ਪੰਨਾ ਪਰਖ ਲਈ ਪੰਜਾਬ ਨਾਮ ਛੇ ਵਾਰ ਵਰਤਦਾ ਹੈ। Page 2/4',
    'ਲਗਾਂ ਅਤੇ ਅੰਕ ਲਗਾਂ: ਕਾ ਕੀ ਕੁ ਕੂ ਕੇ ਕੈ ਕੋ ਕੌ ਕੰ ਕੱ ਉਦਾਹਰਨ: ਪੁੱਤਰ ਸਕੂਲ ਕੁੜੀ ਉਦਾਹਰਨ: ਰੁੱਖ ਮੱਖਣ ਦੁੱਧ ਅੰਕ: ੦ ੧ ੨ ੩ ੪ ੫ ੬ ੭ ੮ ੯ ਸੂਬਾ ਸੁੰਦਰ ਹੈ। Page 3/4',
    'English ਅਤੇ Gurmukhi English and Gurmukhi on one page. The river Satluj flows on. ਚੰਡੀਗੜ੍ਹ ਇੱਕ ਸੁੰਦਰ ਨਗਰ ਹੈ। Page 4/4',
  ],
};

for (const [file, expectedPages] of Object.entries(GOLDEN)) {
  const doc = await loadPdf(file);
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const actual = tc.items
      .map((i) => (typeof i.str === 'string' ? i.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const expected = expectedPages[p - 1];
    if (actual === expected) {
      pass(`${file} p${p}: full text exact`);
    } else {
      // Show a compact diff to speed up diagnosis.
      let ctx = '';
      const len = Math.max(actual.length, expected.length);
      let first = -1;
      for (let i = 0; i < len; i++) {
        if (actual[i] !== expected[i]) {
          first = i;
          break;
        }
      }
      if (first >= 0) {
        ctx = `first diff at char ${first}: actual=${JSON.stringify(actual.slice(Math.max(0, first - 20), first + 40))} expected=${JSON.stringify(expected.slice(Math.max(0, first - 20), first + 40))}`;
      }
      fail(`${file} p${p}: full text exact`, ctx);
    }
  }
  await doc.destroy();
}

// ---------------------------------------------------------------------------
section('5. Document outlines (bookmarks)');

async function countOutline(items) {
  let n = 0;
  for (const it of items || []) {
    n += 1;
    n += await countOutline(it.items);
  }
  return n;
}
{
  const doc = await loadPdf('multilingual.pdf');
  const outline = await doc.getOutline();
  const n = await countOutline(outline);
  assert(n >= 7, 'multilingual: outline has ≥7 entries', `got ${n}`);
  // Every outline destination must resolve to a real page.
  let resolved = 0;
  async function check(items) {
    for (const it of items || []) {
      if (it.dest) {
        let explicit = it.dest;
        if (typeof explicit === 'string') explicit = await doc.getDestination(explicit);
        if (Array.isArray(explicit)) {
          const idx = await doc.getPageIndex(explicit[0]);
          if (idx >= 0 && idx < doc.numPages) resolved += 1;
        }
      }
      await check(it.items);
    }
  }
  await check(outline);
  assert(resolved >= 7, 'multilingual: ≥7 bookmark dests resolve', `got ${resolved}`);
  await doc.destroy();
}
{
  const doc = await loadPdf('hindi-sample.pdf');
  const n = await countOutline(await doc.getOutline());
  assert(n === 4, 'hindi-sample: outline has 4 entries', `got ${n}`);
  await doc.destroy();
}
{
  const doc = await loadPdf('punjabi-sample.pdf');
  const n = await countOutline(await doc.getOutline());
  assert(n === 4, 'punjabi-sample: outline has 4 entries', `got ${n}`);
  await doc.destroy();
}

// ---------------------------------------------------------------------------
section('6. Metadata');

{
  const doc = await loadPdf('multilingual.pdf');
  const { info } = await doc.getMetadata();
  assert(info && /Multilingual/.test(info.Title || ''), 'multilingual: Title set', info && info.Title);
  assert(!!(info && info.Author), 'multilingual: Author set');
  await doc.destroy();
}

// ---------------------------------------------------------------------------
section('7. Rotation viewport math');

{
  const doc = await loadPdf('welcome.pdf');
  const page = await doc.getPage(1);
  const v0 = page.getViewport({ scale: 1, rotation: 0 });
  const v90 = page.getViewport({ scale: 1, rotation: 90 });
  const v180 = page.getViewport({ scale: 1, rotation: 180 });
  assert(
    Math.abs(v90.width - v0.height) < 0.01 && Math.abs(v90.height - v0.width) < 0.01,
    'rotation 90° swaps width/height'
  );
  assert(
    Math.abs(v180.width - v0.width) < 0.01 && Math.abs(v180.height - v0.height) < 0.01,
    'rotation 180° preserves dimensions'
  );
  await doc.destroy();
}

// ---------------------------------------------------------------------------
section('8. JS syntax check (all app sources)');

for (const f of [
  'src/renderer.js',
  'src/search.js',
  'src/sidebar.js',
  'src/recents.js',
  'src/printing.js',
  'src/print-ui.js',
  'main.js',
  'preload.js',
  'server.js',
  'src/file-open.cjs',
  'scripts/create-samples.js',
  'scripts/stage-app.mjs',
  'scripts/check-packaged-app.mjs',
  'scripts/smoke-test-packaged.mjs',
  'scripts/test-main-process.mjs',
  'scripts/test-phase2.mjs',
  'scripts/test-phase2-dom.mjs',
  'scripts/test-phase3.mjs',
]) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
    pass(`${f} parses`);
  } catch (err) {
    fail(`${f} parses`, String(err.message).split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
section('9. Print integration and optional OCR engine isolation');

{
  const src = ['src/renderer.js', 'src/search.js', 'src/sidebar.js', 'src/recents.js', 'src/printing.js', 'src/print-ui.js', 'main.js']
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
  const required = ['open-pdf-in-system-viewer', 'save-print-ready-pdf', 'shell.openPath', 'buildPrintPdf'];
  for (const feature of required) {
    assert(src.includes(feature), `print preparation integration includes ${feature}`);
  }
  for (const removed of ["ipcMain.handle('print-pdf'", "ipcMain.handle('list-printers'", 'webContents.print(']) {
    assert(!src.includes(removed), `broken direct-print integration excludes ${removed}`);
  }
  const core = ['src/search.js', 'src/sidebar.js', 'src/recents.js', 'src/printing.js', 'src/print-ui.js']
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')
    .toLowerCase();
  const isolated = !core.includes('tesseract') && !core.includes('recognizepng') && !core.includes('createworker');
  assert(
    isolated && readFileSync(path.join(ROOT, 'main.js'), 'utf8').includes('./src/ocr-engine.cjs'),
    'OCR engine and language models stay in a separate optional main-process module'
  );
}

// ---------------------------------------------------------------------------
section('10. Recents pure helpers');

assert(makeId('a.pdf', 100, 5) === makeId('a.pdf', 100, 5), 'makeId: deterministic');
assert(makeId('a.pdf', 100, 5) !== makeId('b.pdf', 100, 5), 'makeId: differs by name');
assert(formatBytes(1536) === '1.5 KB', 'formatBytes: 1536 → 1.5 KB', formatBytes(1536));
assert(formatBytes(0) === '', 'formatBytes: 0 → empty');
assert(timeAgo(Date.now() - 60000).includes('min'), 'timeAgo: minutes');
assert(timeAgo(Date.now() - 3600000 * 3).includes('hour'), 'timeAgo: hours');
{
  // Older entries use the OS regional locale passed by the desktop app.
  const old = Date.UTC(2024, 0, 31, 12);
  assert(timeAgo(old, 'en-GB') === new Date(old).toLocaleDateString('en-GB'), 'timeAgo: old dates follow the given locale', timeAgo(old, 'en-GB'));
  assert(timeAgo(old, 'en-GB') !== timeAgo(old, 'en-US'), 'timeAgo: en-GB and en-US dates differ');
  assert(timeAgo(old, 'not a locale!') === new Date(old).toLocaleDateString(), 'timeAgo: an invalid locale falls back to the default');
  assert(timeAgo(old) === new Date(old).toLocaleDateString(), 'timeAgo: no locale uses the default');
}

// ---------------------------------------------------------------------------
console.log(`\n==============================`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
