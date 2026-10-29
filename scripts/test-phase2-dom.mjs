#!/usr/bin/env node
// Cambuz PDF Reader — Phase 2 DOM tests (jsdom)
//
// Exercises the REAL app modules (search.js, sidebar.js, recents.js) against
// a DOM: search highlighting with native-script queries, outline building
// and navigation, recent-files storage, and index.html element wiring.
// Canvas rendering, PDF.js in-browser behavior, IndexedDB and fullscreen
// are covered by the live web preview + manual checklist (see README).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
function section(t) {
  console.log(`\n## ${t}`);
}

// --- Set up a DOM from the real index.html ---
const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:3000/src/index.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { SearchController } = await import('../src/search.js');
const { SidebarController } = await import('../src/sidebar.js');
const { PrintController } = await import('../src/print-ui.js');
const Recents = await import('../src/recents.js');

// ---------------------------------------------------------------------------
section('D1. index.html element wiring');

const REQUIRED_IDS = [
  'toolbar', 'btn-sidebar', 'btn-open', 'btn-close', 'btn-print', 'btn-prev', 'btn-next',
  'page-input', 'page-total', 'doc-title', 'btn-search', 'btn-zoom-out',
  'zoom-level', 'btn-zoom-in', 'btn-fit-page', 'btn-fit-width',
  'btn-rotate-ccw', 'btn-rotate-cw', 'btn-fullscreen', 'btn-theme', 'btn-help',
  'search-bar', 'search-input', 'search-count', 'btn-search-prev',
  'btn-search-next', 'btn-search-close', 'content-row', 'sidebar',
  'tab-thumbs', 'tab-outline', 'thumbs-panel', 'outline-panel',
  'main-content', 'welcome-screen', 'btn-welcome-open', 'btn-sample',
  'recent-section', 'recent-list', 'btn-clear-recents', 'chk-reopen-last',
  'btn-welcome-shortcuts', 'pdf-viewer', 'pdf-container', 'page-wrapper',
  'pdf-canvas', 'text-layer', 'drop-overlay', 'error-display',
  'error-message', 'btn-error-dismiss', 'status-bar', 'status-text',
  'status-meta', 'status-file', 'shortcuts-dialog', 'btn-shortcuts-close',
];
let allPresent = true;
for (const id of REQUIRED_IDS) {
  if (!document.getElementById(id)) {
    allPresent = false;
    fail(`element #${id} exists`, 'missing from index.html');
  }
}
if (allPresent) pass(`all ${REQUIRED_IDS.length} required elements present`);
assert(
  document.querySelector('#text-layer').classList.contains('textLayer'),
  'text-layer has textLayer class'
);
assert(
  document.querySelectorAll('.shortcuts-table kbd').length > 10,
  'shortcuts dialog documents keys',
  `${document.querySelectorAll('.shortcuts-table kbd').length} kbd tags`
);

section('D1b. Print preparation and system-viewer wiring');
const PRINT_IDS = [
  'print-dialog', 'print-document-label', 'btn-print-close', 'btn-print-cancel',
  'btn-print-open-system', 'print-open-system-label', 'btn-print-download', 'print-preset',
  'print-current-page-label', 'print-page-range', 'print-range-error', 'print-paper',
  'print-orientation', 'print-pages-per-sheet', 'print-scaling', 'print-custom-scale',
  'print-margins', 'print-custom-margin', 'print-ink-saver', 'print-settings-error',
  'print-preview-summary', 'btn-print-preview-prev', 'btn-print-preview-next',
  'print-preview-page', 'print-preview-total', 'print-preview-stage',
  'print-preview-placeholder', 'print-preview-canvas', 'print-preview-caption', 'print-status',
];
assert(
  PRINT_IDS.every((id) => document.getElementById(id)),
  `all ${PRINT_IDS.length} preparation, preview and handoff elements are present`
);
assert(
  document.getElementById('print-dialog').getAttribute('aria-modal') === 'true',
  'print preparation is exposed as an accessible modal dialog'
);
assert(
  [...document.querySelectorAll('#print-preset option')].some((option) => option.value === 'ink-saver'),
  'Ink Saver preparation preset is available'
);
assert(
  !document.getElementById('print-printer') && !document.getElementById('print-copies') &&
  !document.getElementById('print-duplex') && !document.getElementById('print-collate') &&
  !document.getElementById('print-manual-panel'),
  'Cambuz UI has no printer selector, copy/duplex controls or custom manual-duplex pass'
);
const systemNote = document.querySelector('.print-system-note');
assert(
  systemNote?.textContent.includes('system PDF viewer') &&
  systemNote.textContent.includes('choose a printer') &&
  systemNote.textContent.includes('does not rotate or reorder'),
  'UI clearly delegates physical printing and manual duplex without an orientation assumption'
);
assert(
  document.getElementById('btn-print-open-system').textContent.includes('Open PDF in system viewer') &&
  document.getElementById('btn-print-download').textContent.includes('Download print-ready PDF'),
  'system-viewer and independent PDF export actions are distinct and explicit'
);
assert(
  !/printed[ -]side (?:up|down)|reload into tray|model-specific loading/i.test(document.getElementById('print-dialog').textContent),
  'print interface contains no model-specific printer or paper-loading assumption'
);

const printController = new PrintController({
  pdfjsLib: {},
  standardFontDataUrl: '',
  getDoc: () => ({ getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }) }),
  getSourceBytes: () => new Uint8Array([37, 80, 68, 70, 45]),
  getCurrentPage: () => 2,
  getTotalPages: () => 5,
  getDocumentName: () => 'test.pdf',
  getDocumentGeneration: () => 1,
  onStatus: () => {},
});
assert(!printController.isOpen, 'print controller starts closed');
const validPrintForm = printController.validateSettings(printController.readSettings());
assert(validPrintForm.valid, 'default PDF preparation settings validate');
assert(
  !Object.hasOwn(printController.readSettings(), 'copies') &&
  !Object.hasOwn(printController.readSettings(), 'duplexMode'),
  'renderer preparation state contains no physical-printer settings'
);
const sameSettingsKey = printController.previewKey(validPrintForm.settings);
assert(sameSettingsKey.includes('"paperSize":"A4"'), 'preview key tracks PDF preparation settings');

// Opening the system viewer must be a direct consequence of an explicit click.
{
  const preparedBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
  const openCalls = [];
  const saveCalls = [];
  window.cambuzAPI = {
    openPdfInSystemViewer: async (bytes, options) => {
      openCalls.push({ bytes: new Uint8Array(bytes), options });
      return { ok: true };
    },
    savePrintReadyPdf: async (bytes, options) => {
      saveCalls.push({ bytes: new Uint8Array(bytes), options });
      return { ok: false, canceled: true };
    },
  };
  printController.opened = true;
  printController.ui.dialog.style.display = 'flex';
  printController.latestPdfBytes = preparedBytes;
  printController.latestPreviewKey = sameSettingsKey;
  printController.updateActionState();
  assert(openCalls.length === 0 && !printController.ui.openSystemButton.disabled,
    'preparing a PDF does not automatically launch another application');

  await printController.openInSystemViewer();
  assert(openCalls.length === 1 && openCalls[0].options.suggestedName === 'test-print-ready.pdf' &&
    Buffer.from(openCalls[0].bytes).equals(Buffer.from(preparedBytes)),
  'explicit system-viewer action hands off the exact prepared bytes once');
  assert(printController.isOpen && /viewer’s Print command/.test(printController.ui.status.textContent),
    'successful handoff leaves the source document and preparation dialog open with delegated controls explained');

  await printController.downloadPdf();
  assert(saveCalls.length === 1 && /Save cancelled/.test(printController.ui.status.textContent) &&
    printController.latestPdfBytes === preparedBytes,
  'save cancellation is handled without discarding the prepared artifact');

  window.cambuzAPI.openPdfInSystemViewer = async () => ({ ok: false, error: 'No registered viewer' });
  await printController.openInSystemViewer();
  assert(/Could not open the system PDF viewer: No registered viewer/.test(printController.ui.status.textContent) &&
    printController.isOpen && !printController.busy,
  'system-viewer launch failure is reported without crashing or closing the document');

  printController.opened = false;
  printController.ui.dialog.style.display = 'none';
  delete window.cambuzAPI;
}

const invalidRangeForm = printController.validateSettings({ ...printController.readSettings(), pageMode: 'range', pageRange: '0' });
assert(!invalidRangeForm.valid && document.getElementById('print-range-error').textContent.includes('between 1 and 5'), 'print dialog shows invalid page-range feedback');
printController.applySettingsToForm({ ...printController.readSettings(), pageMode: 'all', pageRange: '' });
printController.applyPreset('two-up');
assert(
  printController.readSettings().pagesPerSheet === '2' && printController.readSettings().orientation === 'landscape',
  '2-up preset applies landscape layout settings'
);
printController.applyPreset('ink-saver');
assert(printController.readSettings().inkSaver, 'Ink Saver preset enables grayscale output');

// ---------------------------------------------------------------------------
section('D2. Search highlighting (real SearchController + DOM)');

// Fake 3-page document: English, Hindi, Punjabi.
// Page texts mirror the real sample style (each term twice per page).
const FAKE_PAGES = {
  1: ['Punjab is here. Punjab again.'],
  2: ['पंजाब यहाँ है। पंजाब दोबारा।'],
  3: ['ਪੰਜਾਬ ਇੱਥੇ ਹੈ। ਪੰਜਾਬ ਦੁਬਾਰਾ।'],
};
const fakeDoc = {
  numPages: 3,
  getPage: async (n) => ({
    getTextContent: async () => ({
      items: FAKE_PAGES[n].map((str) => ({ str })),
    }),
    cleanup: () => {},
  }),
};
let currentPage = 1;
const goToCalls = [];
let lastCount = '';
let lastStatus = '';
const textLayer = document.getElementById('text-layer');

function renderFakeTextLayer(page) {
  // Mimic PDF.js v4 TextLayer output: one <span> per text item.
  textLayer.innerHTML = '';
  for (const str of FAKE_PAGES[page]) {
    const span = document.createElement('span');
    span.textContent = str;
    textLayer.appendChild(span);
  }
}

const search = new SearchController({
  getDoc: () => fakeDoc,
  getCurrentPage: () => currentPage,
  goToPage: async (n) => {
    goToCalls.push(n);
    currentPage = n;
    renderFakeTextLayer(n);
    search.applyHighlights();
  },
  getTextLayerEl: () => textLayer,
  onStatus: (m) => {
    lastStatus = m;
  },
  onCount: (m) => {
    lastCount = m;
  },
});

renderFakeTextLayer(1);
await search.setQuery('Punjab');
assert(search.total === 2, 'English query finds 2 matches', `got ${search.total}`);
assert(lastCount === '1 of 2', 'count label "1 of 2"', lastCount);
{
  const marks = textLayer.querySelectorAll('mark.search-highlight');
  assert(marks.length === 2, 'two highlight marks created', `got ${marks.length}`);
  assert(
    [...marks].every((m) => m.textContent === 'Punjab'),
    'marks contain exact "Punjab" text'
  );
  assert(
    textLayer.querySelectorAll('mark.search-highlight.current').length === 1,
    'exactly one current mark'
  );
  assert(
    textLayer.textContent === 'Punjab is here. Punjab again.',
    'highlighting preserves underlying text'
  );
}
await search.next();
assert(lastCount === '2 of 2', 'next() advances count', lastCount);
await search.next();
assert(lastCount === '1 of 2', 'next() wraps around', lastCount);
await search.prev();
assert(lastCount === '2 of 2', 'prev() wraps back', lastCount);

// Native-script query: Hindi.
renderFakeTextLayer(2);
currentPage = 2;
await search.setQuery('पंजाब');
assert(search.total === 2, 'Hindi query finds 2 matches', `got ${search.total}`);
{
  const marks = textLayer.querySelectorAll('mark.search-highlight');
  assert(marks.length === 2, 'two Hindi marks created', `got ${marks.length}`);
  assert(
    [...marks].every((m) => m.textContent === 'पंजाब'),
    'marks contain byte-exact "पंजाब"'
  );
  assert(
    textLayer.textContent === 'ਪੰਜਾਬ'.replace('ਪੰਜਾਬ', 'पंजाब यहाँ है। पंजाब दोबारा।'),
    'Hindi underlying text preserved'
  );
}

// Native-script query: Punjabi, starting from page 1 → must jump to page 3.
currentPage = 1;
renderFakeTextLayer(1);
goToCalls.length = 0;
await search.setQuery('ਪੰਜਾਬ');
assert(search.total === 2, 'Punjabi query finds 2 matches', `got ${search.total}`);
assert(goToCalls[0] === 3, 'new query jumps to first match page', `calls=${goToCalls}`);
{
  const marks = textLayer.querySelectorAll('mark.search-highlight');
  assert(
    marks.length === 2 && [...marks].every((m) => m.textContent === 'ਪੰਜਾਬ'),
    'marks contain byte-exact "ਪੰਜਾਬ"'
  );
}
// Cross-page next() from last match of page 3 wraps to page 3 (only match page).
await search.next();
assert(currentPage === 3 && lastCount === '2 of 2', 'same-page next() works', lastCount);

// No-match query.
await search.setQuery('zzz-no-such-word');
assert(search.total === 0, 'no-match query totals 0');
assert(lastCount === 'No matches', 'no-match label', lastCount);
assert(
  textLayer.querySelectorAll('mark.search-highlight').length === 0,
  'no-match query leaves no marks'
);

// Clear removes everything.
await search.setQuery('ਪੰਜਾਬ');
search.clear();
assert(search.total === 0 && search.query === '', 'clear() resets state');
assert(
  textLayer.querySelectorAll('mark.search-highlight').length === 0,
  'clear() removes marks'
);
assert(
  textLayer.textContent === 'ਪੰਜਾਬ ਇੱਥੇ ਹੈ। ਪੰਜਾਬ ਦੁਬਾਰਾ।',
  'clear() restores original text nodes'
);

// Multi-item page: matches spread across spans.
FAKE_PAGES[1] = ['Punjab here.', 'Nothing here.', 'Punjab again here.'];
renderFakeTextLayer(1);
currentPage = 1;
await search.setQuery('Punjab');
assert(search.total === 2, 'multi-span page totals 2', `got ${search.total}`);
assert(
  textLayer.querySelectorAll('mark.search-highlight').length === 2,
  'marks across multiple spans'
);
FAKE_PAGES[1] = ['Punjab is here. Punjab again.']; // restore

// ---------------------------------------------------------------------------
section('D3. Outline building + navigation (real SidebarController)');

const sidebarEl = document.getElementById('sidebar');
const sidebar = new SidebarController({
  sidebarEl,
  thumbsPanel: document.getElementById('thumbs-panel'),
  outlinePanel: document.getElementById('outline-panel'),
  tabThumbs: document.getElementById('tab-thumbs'),
  tabOutline: document.getElementById('tab-outline'),
  getDoc: () => null,
  getRotation: () => 0,
  goToPage: (n) => {
    goToCalls.push(n);
  },
  onStatus: (m) => {
    lastStatus = m;
  },
});

const fakeOutline = [
  { title: 'Chapter 1', dest: [{ num: 1, gen: 0 }], items: [] },
  {
    title: 'Chapter 2',
    dest: 'ch2',
    items: [
      { title: 'Section 2.1', dest: [{ num: 5, gen: 0 }], items: [] },
      { title: 'External', url: 'https://example.com/', items: [] },
    ],
  },
  { title: 'No dest', dest: null, items: [] },
];
sidebar.renderOutline(fakeOutline);
const links = [...document.querySelectorAll('#outline-panel .outline-link')].map(
  (el) => el.textContent
);
assert(
  JSON.stringify(links) === JSON.stringify(['Chapter 1', 'Chapter 2', 'Section 2.1', 'External', 'No dest']),
  'outline renders nested titles in order',
  JSON.stringify(links)
);
// Collapse/expand.
const expander = document.querySelector('#outline-panel .outline-expander');
assert(!!expander, 'parent item has expander');
expander.click();
assert(
  document.querySelector('#outline-panel .outline-item.collapsed') !== null,
  'expander collapses section'
);
expander.click();
assert(
  document.querySelector('#outline-panel .outline-item.collapsed') === null,
  'expander re-expands section'
);

// Navigation with mocked doc.
const navCalls = [];
sidebar.deps.getDoc = () => ({
  getDestination: async (name) => (name === 'ch2' ? [{ num: 9, gen: 0 }] : null),
  getPageIndex: async (ref) => ref.num - 1,
});
sidebar.deps.goToPage = (n) => navCalls.push(n);
await sidebar.followOutline(fakeOutline[0]);
assert(navCalls[0] === 1, 'explicit dest navigates to page 1', `${navCalls}`);
await sidebar.followOutline(fakeOutline[1]);
assert(navCalls[1] === 9, 'named dest resolves to page 9', `${navCalls}`);
await sidebar.followOutline(fakeOutline[1].items[1]); // external url
assert(navCalls.length === 2, 'external url does not navigate pages');
await sidebar.followOutline(fakeOutline[2]); // no dest
assert(lastStatus.includes('no destination'), 'missing dest shows status', lastStatus);

// Empty outline message.
sidebar.renderOutline(null);
assert(
  document.querySelector('#outline-panel .sidebar-empty') !== null,
  'null outline shows empty message'
);
sidebar.renderOutline([]);
assert(
  document.querySelector('#outline-panel .sidebar-empty').textContent.includes('no bookmarks'),
  'empty outline shows no-bookmarks message'
);

// Tab switching.
sidebar.setTab('outline');
assert(
  document.getElementById('outline-panel').style.display === 'block' &&
    document.getElementById('thumbs-panel').style.display === 'none',
  'outline tab shows outline panel'
);
sidebar.setTab('thumbs');
assert(
  document.getElementById('thumbs-panel').style.display === 'block' &&
    document.getElementById('outline-panel').style.display === 'none',
  'thumbnails tab shows thumbs panel'
);

// Sidebar open/close.
sidebar.setOpen(true);
assert(sidebar.open === true, 'sidebar opens');
sidebar.toggle();
assert(sidebar.open === false, 'sidebar toggles closed');

// ---------------------------------------------------------------------------
section('D4. Recent files (real recents.js + localStorage)');

localStorage.clear();
assert(Recents.getReopenLast() === true, 'reopen-last defaults to true');
Recents.setReopenLast(false);
assert(Recents.getReopenLast() === false, 'reopen-last persists false');
Recents.setReopenLast(true);

const e1 = Recents.addRecent({ name: 'a.pdf', path: null, size: 100, pages: 5, mtime: 1 });
const e2 = Recents.addRecent({ name: 'b.pdf', path: '/x/b.pdf', size: 200, pages: 9, mtime: 2 });
let list = Recents.getRecents();
assert(list.length === 2 && list[0].name === 'b.pdf', 'recents newest-first');
Recents.updateRecentPage(e2.id, 7);
list = Recents.getRecents();
assert(list[0].lastPage === 7, 'last page persists');
// Re-adding refreshes position but keeps last page.
Recents.addRecent({ name: 'b.pdf', path: '/x/b.pdf', size: 200, pages: 9, mtime: 2 });
list = Recents.getRecents();
assert(list[0].name === 'b.pdf' && list[0].lastPage === 7, 're-add keeps last page');
Recents.removeRecent(e1.id);
assert(Recents.getRecents().length === 1, 'removeRecent drops entry');
Recents.clearRecents();
assert(Recents.getRecents().length === 0, 'clearRecents empties list');
assert(Recents.formatBytes(1024 * 1024 * 2.5) === '2.5 MB', 'formatBytes MB');

// ---------------------------------------------------------------------------
section('D5. Renderer module loads against real DOM');

try {
  const renderer = await import('../src/renderer.js');
  assert(typeof renderer.initApp === 'function', 'renderer exports initApp()');
} catch (err) {
  fail('renderer imports cleanly', err.message);
}
await printController.destroyPreview();

// ---------------------------------------------------------------------------
console.log(`\n==============================`);
console.log(`Phase 2 DOM tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
