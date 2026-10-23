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
const { getManualDuplexGuidance } = await import('../src/manual-duplex-guidance.js');
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

section('D1b. Phase 3 print dialog wiring');
const PRINT_IDS = [
  'print-dialog', 'print-document-label', 'btn-print-close', 'btn-print-cancel',
  'btn-print-current', 'btn-print-submit', 'btn-print-download', 'print-preset',
  'print-current-page-label', 'print-page-range', 'print-range-error',
  'print-printer', 'btn-refresh-printers', 'print-copies', 'print-collate',
  'print-duplex', 'print-duplex-help', 'print-paper',
  'print-orientation', 'print-pages-per-sheet', 'print-scaling',
  'print-custom-scale', 'print-margins', 'print-custom-margin',
  'print-ink-saver', 'print-settings-error', 'print-preview-summary',
  'btn-print-preview-prev', 'btn-print-preview-next', 'print-preview-page',
  'print-preview-total', 'print-preview-stage', 'print-preview-placeholder',
  'print-preview-canvas', 'print-preview-caption', 'print-status',
];
assert(
  PRINT_IDS.every((id) => document.getElementById(id)),
  `all ${PRINT_IDS.length} print controls and preview elements are present`
);
assert(
  document.getElementById('print-dialog').getAttribute('aria-modal') === 'true',
  'print preview is exposed as an accessible modal dialog'
);
assert(
  [...document.querySelectorAll('#print-preset option')].some((option) => option.value === 'ink-saver'),
  'Ink Saver preset is available'
);

const manualPanel = document.getElementById('print-manual-panel');
const printCss = readFileSync(path.join(ROOT, 'src', 'print.css'), 'utf8');
const manualSteps = [...manualPanel.querySelectorAll('.print-manual-steps > li')];
const manualCardsHaveOwnLabelsAndArt = manualSteps.length === 3 && manualSteps.every((step) =>
  step.querySelector('h4')?.textContent.trim() &&
  step.querySelector('.print-manual-card-copy')?.textContent.trim() &&
  (step.querySelector('.print-manual-art') || step.querySelector('.print-manual-continue-art'))
);
assert(
  manualPanel?.tagName === 'SECTION' && manualPanel.getAttribute('aria-labelledby') === 'print-manual-title' &&
  manualPanel.getAttribute('aria-describedby').includes('print-manual-note') &&
  document.getElementById('print-manual-title')?.textContent === 'Print the second side' &&
  document.getElementById('print-manual-text')?.textContent.includes('reload the paper'),
  'manual second-side panel is labelled and includes the requested title and reload subtitle'
);
assert(
  document.getElementById('print-manual-step')?.textContent === 'Step 2 of 2' &&
  document.getElementById('print-manual-printer-name')?.textContent === 'Printer not identified' &&
  document.getElementById('print-manual-profile')?.textContent.includes('not verified'),
  'manual panel has a progress indicator, printer field and an unverified default profile'
);
assert(
  manualCardsHaveOwnLabelsAndArt &&
  manualSteps[0].querySelector('h4').textContent.includes('Collect') &&
  manualSteps[1].querySelector('h4').textContent.includes('feed guide') &&
  manualSteps[2].querySelector('h4').textContent.includes('Continue') &&
  manualSteps[0].querySelectorAll('svg').length === 1 &&
  manualSteps[1].querySelectorAll('svg').length === 1 &&
  manualSteps[2].querySelector('.print-manual-continue-chip')?.textContent.includes('Continue'),
  'three numbered instructions have distinct labels, explanatory copy and local vector artwork'
);
assert(
  manualPanel.querySelector('#btn-print-manual-continue')?.textContent.trim() === 'Continue' &&
  manualPanel.querySelector('#btn-print-manual-cancel')?.textContent.trim() === 'Skip second side' &&
  document.getElementById('btn-print-download') && document.getElementById('btn-print-cancel'),
  'Continue, Skip second side, Cancel and print-ready PDF download actions remain available'
);
assert(
  manualPanel.querySelector('#print-manual-loading-labels').textContent.includes('Feed direction varies') &&
  manualPanel.querySelector('#print-manual-note-text').textContent.includes('model was not identified') &&
  !/printed side down/i.test(manualPanel.textContent),
  'default guidance is clearly unverified and does not claim an unknown printer loads printed-side down'
);
const hpGuidance = getManualDuplexGuidance('HP LaserJet 1020');
const otherGuidance = getManualDuplexGuidance('Brother HL-L2350DW');
assert(
  hpGuidance.id === 'hp-laserjet-1020' &&
  hpGuidance.stepOne.text.includes('Without changing the stack’s orientation') &&
  hpGuidance.stepOne.text.includes('same order') && hpGuidance.stepOne.text.includes('blank sheets') &&
  hpGuidance.stepTwo.text.includes('Tray 1') && hpGuidance.stepTwo.text.includes('printed side down') &&
  hpGuidance.loadingLabels.join('|') === 'Keep the same orientation|Printed side down',
  'HP LaserJet 1020 guidance separates unchanged orientation, sheet order and printed-side-down loading'
);
assert(
  otherGuidance.id === 'unverified' && otherGuidance.generic &&
  !/printed side down/i.test(otherGuidance.stepTwo.text) &&
  otherGuidance.stepTwo.text.includes('which side should face up or down') &&
  getManualDuplexGuidance('system printer').printerName === 'Printer not identified',
  'other or unidentified printers receive cautious, model-specific guidance rather than the HP feed sequence'
);
assert(
  !/rotate\s*180|180\s*°|180\s*degrees/i.test(manualPanel.textContent) &&
  /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(printCss) &&
  /@media \(max-width: 680px\)[\s\S]*?\.print-manual-steps\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(printCss) &&
  /\.print-manual-card:not\(:last-child\)::after/.test(printCss),
  'three-step flow is horizontal when space permits, stacks on narrow screens and has a clear no-rotation paper-flow connector'
);
assert(
  /#print-dialog\[data-manual-pending="true"\][\s\S]*?#btn-print-current,[\s\S]*?#btn-print-submit/.test(printCss) &&
  !/\.print-download-btn\s*\{\s*display:\s*none;/.test(printCss) &&
  /prefers-reduced-motion/.test(printCss) && /:focus-visible/.test(printCss) &&
  /@media \(max-height: 620px\)/.test(printCss),
  'manual state keeps Download and Cancel, provides visible focus and reduced-motion support, and compacts for short windows'
);
assert(
  document.getElementById('print-dialog-content') &&
  document.getElementById('print-dialog').getAttribute('aria-modal') === 'true',
  'manual instructions can replace the preview inside the existing accessible modal'
);
const printController = new PrintController({
  pdfjsLib: {},
  standardFontDataUrl: '',
  getDoc: () => null,
  getSourceBytes: () => null,
  getCurrentPage: () => 2,
  getTotalPages: () => 5,
  getDocumentName: () => 'test.pdf',
  getDocumentGeneration: () => 1,
  onStatus: () => {},
});
assert(!printController.isOpen, 'print controller starts closed');
const validPrintForm = printController.validateSettings(printController.readSettings());
assert(validPrintForm.valid && validPrintForm.summary.selectedCount === 5, 'default print form validates all pages');
assert(validPrintForm.settings.duplexMode === 'simplex' && validPrintForm.settings.collate, 'print defaults are one-sided and collated');
printController.applySettingsToForm({ ...validPrintForm.settings, duplexMode: 'shortEdge', collate: false, copies: 2 });
assert(printController.readSettings().duplexMode === 'shortEdge' && !printController.readSettings().collate, 'two-sided and collation controls round-trip through the form');
assert(printController.previewKey({ ...validPrintForm.settings, duplexMode: 'longEdge', collate: false, copies: 3 }) ===
  printController.previewKey(validPrintForm.settings), 'native job choices do not regenerate the preview PDF');
// Manual two-sided (no duplex unit): odd sheets first, even sheets after a reload.
{
  // Mirror the state created by open() so focus management is exercised against
  // a visible modal rather than jsdom's initially hidden HTML fixture.
  printController.opened = true;
  printController.ui.dialog.style.display = 'flex';
  const { PDFDocument } = await import('pdf-lib');
  const threePages = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) threePages.addPage([210, 297]);
  const composedBytes = await threePages.save();
  printController.latestPdfBytes = composedBytes;
  printController.updateActionState();
  const pageCountOf = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();
  const calls = [];
  let nextPrinterName = 'HP LaserJet 1020';
  const fakeApi = {
    printPdf: async (bytes, options) => {
      calls.push({ pages: await pageCountOf(bytes), options });
      return { ok: true, printerName: nextPrinterName };
    },
  };
  globalThis.window.cambuzAPI = fakeApi;
  const manualBase = {
    deviceName: 'HP LaserJet 1020', copies: 1, collate: true, duplexMode: 'manual',
    paperSize: 'A4', orientation: 'portrait', widthMm: 210, heightMm: 297,
  };

  const copiesForm = printController.validateSettings({ ...printController.readSettings(), duplexMode: 'manual', copies: '2' });
  assert(!copiesForm.valid && document.getElementById('print-settings-error').textContent.includes('one copy at a time'),
    'manual two-sided is limited to one copy with a clear message');

  await printController.startManualDuplex(fakeApi, composedBytes, manualBase);
  assert(calls.length === 1 && calls[0].pages === 2 && calls[0].options.duplexMode === 'simplex',
    'manual pass 1 sends the odd sheets (2 of 3) as a one-sided job');
  assert(printController.manualJob && printController.manualJob.backCount === 1,
    'manual pass 2 (one even sheet) is held until the user confirms');
  assert(!document.getElementById('print-manual-panel').hidden &&
    printController.ui.dialog.dataset.manualPending === 'true' && printController.ui.content.hidden &&
    printController.ui.dialogHeader.hidden && printController.ui.submitButton.hidden &&
    printController.ui.dialog.getAttribute('aria-labelledby') === 'print-manual-title',
  'manual workflow replaces the preview controls with its own accessible second-side state');
  assert(printController.ui.manualText.textContent.includes('First side printed') &&
    printController.ui.manualPrinterName.textContent === 'HP LaserJet 1020' &&
    printController.ui.dialog.dataset.manualWorkflow === 'hp-laserjet-1020' &&
    printController.ui.manualStepOneText.textContent.includes('same order') &&
    printController.ui.manualStepOneText.textContent.includes('blank sheets') &&
    printController.ui.manualStepTwoText.textContent.includes('printed side down') &&
    [...printController.ui.manualLoadingLabels.querySelectorAll('span')].map((tag) => tag.textContent).join('|') ===
      'Keep the same orientation|Printed side down' &&
    document.activeElement === printController.ui.manualTitle,
  'HP-specific instructions render distinctly and place focus at the heading after pass one');
  assert(printController.ui.submitButton.disabled, 'submit is disabled while the second side is pending');
  assert(!printController.ui.downloadButton.disabled && !printController.ui.cancelButton.disabled &&
    !printController.ui.manualCancel.disabled && printController.ui.manualCancel.textContent.trim() === 'Skip second side',
  'Download print-ready PDF, Cancel and Skip second side remain available during the pending pass');

  // Tab is trapped only among controls in the active manual-duplex state.
  printController.ui.dialog.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
  }));
  assert(document.activeElement === printController.ui.cancelButton,
    'Shift+Tab from the focused instruction heading stays inside the manual workflow');
  printController.ui.cancelButton.focus();
  printController.ui.dialog.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, cancelable: true,
  }));
  assert(document.activeElement === printController.ui.manualCancel,
    'Tab wraps from Cancel to the first visible manual-duplex action');
  printController.ui.manualCancel.focus();
  printController.ui.dialog.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
  }));
  assert(document.activeElement === printController.ui.cancelButton,
    'Shift+Tab wraps from Skip second side to Cancel at the end of the modal');

  await printController.continueManualDuplex();
  assert(calls.length === 2 && calls[1].pages === 1 && calls[1].options.duplexMode === 'simplex' &&
    calls[1].options.deviceName === 'HP LaserJet 1020' && calls[1].options.paperSize === 'A4' &&
    calls[1].options.orientation === 'portrait',
  'manual pass 2 sends the unchanged even-sheet PDF with the original printer and page-layout settings');
  assert(printController.manualJob === null && document.getElementById('print-manual-panel').hidden &&
    !printController.ui.content.hidden && !printController.ui.dialogHeader.hidden &&
    !printController.ui.submitButton.hidden && !printController.ui.dialog.hasAttribute('data-manual-pending') &&
    document.activeElement === printController.ui.cancelButton,
  'manual panel closes after side two is sent, restores the print preview state and returns focus to Cancel');

  await printController.startManualDuplex(fakeApi, composedBytes, manualBase);
  printController.cancelManualDuplex();
  assert(printController.manualJob === null && calls.length === 3 && document.activeElement === printController.ui.cancelButton &&
    !printController.ui.dialog.hasAttribute('data-manual-pending') && !printController.ui.content.hidden,
  'Skip second side clears the pending job without another print and restores the original preview state');

  nextPrinterName = 'Brother HL-L2350DW';
  await printController.startManualDuplex(fakeApi, composedBytes, manualBase);
  assert(printController.ui.manualPrinterName.textContent === 'Brother HL-L2350DW' &&
    printController.ui.dialog.dataset.manualWorkflow === 'unverified' &&
    printController.ui.manualStepTwoText.textContent.includes('Cambuz cannot confirm') &&
    !/printed side down/i.test(printController.ui.manualStepTwoText.textContent) &&
    printController.ui.manualNoteText.textContent.includes('Brother HL-L2350DW'),
  'state transition uses clearly labelled non-HP guidance for an unrecognized printer');
  printController.cancelManualDuplex();
  assert(calls.length === 4 && printController.manualJob === null,
    'skipping an unverified printer workflow also avoids sending the second pass');

  nextPrinterName = 'HP LaserJet 1020';
  await printController.startManualDuplex(fakeApi, composedBytes, manualBase);
  const callsBeforeDialogCancel = calls.length;
  printController.ui.cancelButton.click();
  assert(!printController.isOpen && printController.manualJob === null && printController.ui.manualPanel.hidden &&
    !printController.ui.content.hidden && !printController.ui.dialog.hasAttribute('data-manual-pending') &&
    calls.length === callsBeforeDialogCancel,
  'Cancel exits the manual workflow and clears the second-side job without printing it');
  delete globalThis.window.cambuzAPI;
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
