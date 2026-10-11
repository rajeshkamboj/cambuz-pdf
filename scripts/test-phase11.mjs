#!/usr/bin/env node
// Cambuz PDF Reader — Phase 11 tests: continuous scroll layout.
//
// Three layers are covered:
//   A. continuous-layout.js — the DOM-free geometry (page sizes, column
//      offsets, the reading page, the render window, scroll targets);
//   B. continuous-view.js   — the DOM view against a fake renderer: slot
//      lifecycle, lazy rendering, release of off-window canvases, re-layout
//      after a zoom, copy-protection classes and teardown;
//   C. the real renderer in jsdom — switching a loaded document between
//      single-page and continuous mode, following the scroll position, and
//      the wheel-at-the-edge page turn in single-page mode.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

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
function section(title) {
  console.log(`\n## ${title}`);
}

const Layout = await import('../src/continuous-layout.js');
const { ContinuousView } = await import('../src/continuous-view.js');

// ---------------------------------------------------------------------------
section('A1. Page sizes follow the reader rotation');

const letter = { width: 612, height: 792 };
assert(
  JSON.stringify(Layout.sizeForRotation(letter, 0)) === JSON.stringify(letter),
  'A1: no rotation keeps the page size'
);
assert(
  Layout.sizeForRotation(letter, 90).width === 792 &&
    Layout.sizeForRotation(letter, 90).height === 612,
  'A1: 90° swaps width and height'
);
assert(
  Layout.sizeForRotation(letter, 180).width === 612,
  'A1: 180° keeps the original orientation'
);
assert(
  Layout.sizeForRotation(letter, 270).width === 792,
  'A1: 270° swaps width and height'
);
assert(Layout.sizeForRotation(null, 90) === null, 'A1: an unknown page stays unknown');
assert(Layout.sizeForRotation({ width: 0, height: 10 }, 0) === null, 'A1: invalid sizes are refused');
assert(Layout.normalizeRotation(-90) === 270, 'A1: negative rotations normalise');
assert(Layout.normalizeRotation(450) === 90, 'A1: rotations beyond 360 normalise');
assert(Layout.normalizeRotation('nonsense') === 0, 'A1: a non-numeric rotation falls back to 0');
assert(
  Layout.scaledSize(letter, 1.5, 0).width === 918 &&
    Layout.scaledSize(letter, 1.5, 90).height === 918,
  'A1: scaledSize multiplies the rotated size'
);
assert(Layout.scaledSize(letter, 0, 0) === null, 'A1: a zero scale is refused');

// ---------------------------------------------------------------------------
section('A2. Column geometry (createMetrics)');

const sizes = new Map([
  [1, { width: 600, height: 800 }],
  [2, { width: 600, height: 400 }],
  [3, { width: 600, height: 600 }],
  [4, { width: 600, height: 400 }],
]);
const metrics = Layout.createMetrics({
  totalPages: 4,
  pad: 20,
  gap: 10,
  sizeAt: (page) => sizes.get(page) ?? null,
});
assert(
  JSON.stringify(metrics.tops) === JSON.stringify([20, 830, 1240, 1850]),
  'A2: page tops include the leading pad and the gaps',
  JSON.stringify(metrics.tops)
);
assert(metrics.totalHeight === 2270, 'A2: total height includes the trailing pad', String(metrics.totalHeight));
assert(metrics.estimated === 0, 'A2: fully measured columns report no estimates');

const partiallyMeasured = Layout.createMetrics({
  totalPages: 4,
  pad: 0,
  gap: 0,
  sizeAt: (page) => (page === 2 ? { width: 600, height: 400 } : null),
});
assert(
  partiallyMeasured.estimated === 3 && partiallyMeasured.heights[0] === 400,
  'A2: unmeasured pages borrow the median measured height'
);
assert(
  Layout.createMetrics({ totalPages: 0 }).totalHeight === 0,
  'A2: an empty document has no height'
);
const estimated = Layout.createMetrics({ totalPages: 3, pad: 0, gap: 0, sizeAt: () => null });
assert(estimated.estimated === 3 && estimated.heights[0] > 0, 'A2: nothing measured falls back to a sane page height');

// ---------------------------------------------------------------------------
section('A3. The reading page, the render window and scroll targets');

assert(Layout.pageAtAnchor(metrics, 0, 800) === 1, 'A3: the top of the column is page 1');
assert(Layout.pageAtAnchor(metrics, 100, 800) === 1, 'A3: the reading line still sits on page 1');
assert(Layout.pageAtAnchor(metrics, 400, 800) === 1, 'A3: a line inside page 1 keeps page 1');
assert(
  Layout.pageAtAnchor(metrics, 700, 800) === 2,
  'A3: the reading line decides the page (a line 30% down the viewport)'
);
assert(Layout.pageAtAnchor(metrics, 800, 800) === 2, 'A3: crossing a page top reports the new page');
assert(Layout.pageAtAnchor(metrics, 99999, 800) === 4, 'A3: scrolling past the end reports the last page');

const atStart = Layout.visiblePageRange(metrics, 0, 800, { ahead: 1 });
assert(
  JSON.stringify(atStart.pages) === JSON.stringify([1, 2]),
  'A3: the window widens forward (and clamps at page 1)',
  JSON.stringify(atStart.pages)
);
const inMiddle = Layout.visiblePageRange(metrics, 900, 800, { ahead: 1 });
assert(
  JSON.stringify(inMiddle.pages) === JSON.stringify([1, 2, 3, 4]),
  'A3: the window covers the pages under the viewport plus one ahead',
  JSON.stringify(inMiddle.pages)
);
const atEnd = Layout.visiblePageRange(metrics, 1800, 800, { ahead: 2 });
assert(
  atEnd.last === 4 && atEnd.pages.every((page) => page <= 4),
  'A3: the window never leaves the document'
);
assert(
  Layout.visiblePageRange(Layout.createMetrics({ totalPages: 0 }), 0, 800).pages.length === 0,
  'A3: an empty document has no visible pages'
);

assert(Layout.scrollTopForPage(metrics, 1, { viewportHeight: 800 }) === 20, 'A3: page 1 starts below the leading pad');
assert(Layout.scrollTopForPage(metrics, 3, { viewportHeight: 800 }) === 1240, 'A3: a page scrolls to its own top');
assert(
  Layout.scrollTopForPage(metrics, 3, { viewportHeight: 800, maxScrollTop: 1000 }) === 1000,
  'A3: the scroll target never exceeds the scrollable range'
);
assert(
  Layout.scrollTopForPage(metrics, 1, { viewportHeight: 800, center: true }) === 20,
  'A3: centring the first page clamps at the leading pad'
);
assert(
  Layout.scrollTopForPage(metrics, 2, { viewportHeight: 800, center: true }) === 630,
  'A3: centring moves the page into the middle of the viewport'
);
assert(Layout.scrollTopForPage(metrics, 0, { viewportHeight: 800 }) === 20, 'A3: page numbers are clamped to the document');

const offset = Layout.pageOffset(metrics, 3, 1440);
assert(offset === 200, 'A3: pageOffset measures how far the reader scrolled into a page', String(offset));
assert(Layout.restoreAnchor(metrics, 3, offset) === 1440, 'A3: restoreAnchor rebuilds the same scroll position');
assert(Layout.pageOffset(metrics, 3, 0) === 0, 'A3: a scroll above the page reports no offset');

assert(
  JSON.stringify(Layout.limitToCanvasBudget([1, 2, 3, 4, 5, 6], 3, 3)) === JSON.stringify([2, 3, 4]),
  'A3: the canvas budget keeps the reading page and its neighbours'
);
assert(
  JSON.stringify(Layout.limitToCanvasBudget([1, 2], 1, 4)) === JSON.stringify([1, 2]),
  'A3: a short window is never trimmed'
);
assert(
  JSON.stringify(Layout.limitToCanvasBudget([1, 2, 3, 4, 5, 6], 1, 2)) === JSON.stringify([1, 2]),
  'A3: at the top of the document the budget keeps the nearest pages'
);

// ---------------------------------------------------------------------------
section('B1. ContinuousView: mount, lazy slots and release');

const html = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:3000/src/index.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

/** Give an element a deterministic scrolling behaviour (jsdom has no layout). */
function fakeScroller(element, viewportHeight) {
  let top = 0;
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => viewportHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => parseFloat(element.innerHTML.includes('page-column') ? element.querySelector('#pdf-column')?.style.height || '0' : '0'),
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value) => {
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      top = Math.min(Math.max(0, Number(value) || 0), max);
    },
  });
}

const viewerEl = dom.window.document.getElementById('pdf-viewer');
const columnEl = dom.window.document.getElementById('pdf-column');
fakeScroller(viewerEl, 800);

const pageSizes = new Map();
for (let page = 1; page <= 12; page += 1) {
  pageSizes.set(page, { width: 600, height: page === 3 ? 300 : 800 });
}
const measuredPages = [];
const measuredSet = new Set();
const renderedPages = [];
const currentPages = [];
let scale = 1;
let released = 0;

const view = new ContinuousView({
  viewerEl,
  columnEl,
  deps: {
    displaySize: (page) => {
      const size = measuredSet.has(page) ? pageSizes.get(page) : null;
      return size ? { width: size.width * scale, height: size.height * scale } : null;
    },
    measurePage: async (page) => {
      measuredPages.push(page);
      measuredSet.add(page);
      return pageSizes.get(page) ?? null;
    },
    renderPage: async (page, slot, token) => {
      if (token.cancelled) return undefined;
      renderedPages.push(page);
      slot.canvas.width = 10;
      slot.canvas.height = 10;
      slot.textLayer.textContent = `Page ${page} text`;
      const size = view.deps.displaySize(page);
      return size ?? undefined;
    },
    onCurrentPageChange: (page) => currentPages.push(page),
  },
});

await view.mount({ totalPages: 12, startPage: 1 });

assert(view.mounted, 'B1: the view reports itself mounted');
assert(!columnEl.hidden, 'B1: the column is revealed');
assert(viewerEl.classList.contains('continuous'), 'B1: the viewer switches to column scrolling');
assert(renderedPages.includes(1), 'B1: the starting page is rendered');
const slotOne = columnEl.querySelector('.page-slot[data-page="1"]');
assert(Boolean(slotOne), 'B1: page 1 has a slot in the column');
assert(
  slotOne.querySelector('.page-slot-placeholder').textContent === '1',
  'B1: an unrendered slot shows its page number as a placeholder'
);
assert(
  columnEl.querySelectorAll('.page-slot').length <= Layout.MAX_LIVE_CANVASES + Layout.RENDER_AHEAD,
  'B1: only a window of pages exists in the DOM',
  String(columnEl.querySelectorAll('.page-slot').length)
);
assert(
  !columnEl.querySelector('.page-slot[data-page="12"]'),
  'B1: distant pages are not created'
);
assert(
  parseFloat(columnEl.style.height) === view.metrics.totalHeight,
  'B1: the column height matches the geometry',
  `${columnEl.style.height} vs ${view.metrics.totalHeight}px`
);

view.setTextLayerClass('no-copy', true);
assert(
  [...columnEl.querySelectorAll('.page-slot-text')].every((layer) => layer.classList.contains('no-copy')),
  'B1: copy protection reaches every live text layer'
);
assert(view.textLayerClasses.has('no-copy'), 'B1: the class is remembered for new slots');

// --- scrolling: current page, window and canvas release -------------------
viewerEl.scrollTop = view.metrics.tops[5] + 100;
view.sync();
assert(view.currentPage === 6, 'B1: the reading page follows the scroll position', String(view.currentPage));
assert(currentPages.includes(6), 'B1: the page change is reported to the renderer');
assert(
  columnEl.querySelector('.page-slot[data-page="6"]'),
  'B1: the page under the reading line gets a slot'
);
const renderedBefore = renderedPages.length;
await view.ensurePageReady(6);
assert(renderedPages.includes(6), 'B1: the page under the reading line is rendered');
assert(renderedPages.length > renderedBefore, 'B1: rendering happens after the scroll, not before');
assert(
  !columnEl.querySelector('.page-slot[data-page="1"]'),
  'B1: pages that left the window are dropped again'
);
assert(
  !columnEl.querySelector('.page-slot[data-page="1"] canvas') ||
    columnEl.querySelector('.page-slot[data-page="1"]') === null,
  'B1: dropped pages release their canvas'
);

// --- goToPage lands with exact geometry ----------------------------------
await view.goToPage(9);
assert(
  Math.abs(viewerEl.scrollTop - view.metrics.tops[8]) <= 1,
  'B1: goToPage scrolls the page to the top of the viewport',
  `${viewerEl.scrollTop} vs ${view.metrics.tops[8]}`
);
assert(view.currentPage === 9, 'B1: goToPage updates the reading page');
assert(renderedPages.includes(9), 'B1: goToPage resolves after the page is painted');

// --- relayout: zoom keeps the reader in place ----------------------------
scale = 2;
await view.relayout({ anchorPage: 9 });
assert(
  columnEl.querySelector('.page-slot[data-page="9"]').style.width === '1200px',
  'B1: zooming re-sizes the column slots'
);
assert(view.currentPage === 9, 'B1: zooming keeps the reader on the same page');
const afterZoom = renderedPages.filter((page) => page === 9).length;
assert(afterZoom >= 2, 'B1: zooming re-renders the page at the new scale');
assert(
  [...columnEl.querySelectorAll('.page-slot-canvas')].every(
    (canvas) => canvas.width <= 2000 && canvas.height <= 2000
  ),
  'B1: re-rendered pages stay inside the test render budget'
);

// --- measurement pass fills the column -----------------------------------
await view.goToPage(1);
scale = 1;
await view.relayout({ anchorPage: 1 });
for (let attempt = 0; attempt < 400 && view.metrics.estimated > 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert(view.metrics.estimated === 0, 'B1: every page is measured in the background');
assert(measuredPages.includes(12), 'B1: the measurement pass reaches the last page');
assert(
  columnEl.style.height === `${20 + (11 * 800 + 300) + 11 * Layout.PAGE_GAP + 20}px`,
  'B1: the column tightens to the exact page heights',
  columnEl.style.height
);
assert(view.metrics.estimated === 0 && measuredSet.size === 12, 'B1: no page is left estimated');

// --- teardown -------------------------------------------------------------
const canvasesBeforeUnmount = [...columnEl.querySelectorAll('.page-slot-canvas')];
view.unmount();
released = canvasesBeforeUnmount.filter((canvas) => canvas.width === 0 && canvas.height === 0).length;
assert(!view.mounted, 'B1: unmount clears the mounted flag');
assert(columnEl.hidden, 'B1: the column is hidden again');
assert(columnEl.childElementCount === 0, 'B1: unmount removes every slot');
assert(
  released === canvasesBeforeUnmount.length,
  'B1: unmount releases every canvas backing store',
  `${released}/${canvasesBeforeUnmount.length}`
);
assert(!viewerEl.classList.contains('continuous'), 'B1: the viewer leaves column mode');

// ---------------------------------------------------------------------------
section('C1. Search: case-sensitive matching');

const { SearchController } = await import('../src/search.js');
const caseTextLayer = dom.window.document.getElementById('text-layer');
const CASE_PAGES = {
  1: ['Cambuz cambuz CAMBUZ.'],
  2: ['Plain lower case here.'],
};
const caseDoc = {
  numPages: 2,
  getPage: async (page) => ({
    getTextContent: async () => ({ items: CASE_PAGES[page].map((str) => ({ str })) }),
    cleanup: () => {},
  }),
};
const caseSearch = new SearchController({
  getDoc: () => caseDoc,
  getCurrentPage: () => 1,
  goToPage: async () => {},
  getTextLayerEl: () => caseTextLayer,
  onStatus: () => {},
  onCount: () => {},
});
await caseSearch.setQuery('cambuz');
assert(caseSearch.total === 3, 'C1: the default search is case-insensitive', String(caseSearch.total));
await caseSearch.setMatchCase(true);
assert(caseSearch.matchCase === true, 'C1: case-sensitive matching can be switched on');
assert(
  caseSearch.total === 1,
  'C1: case-sensitive matching keeps only the exact-case match',
  String(caseSearch.total)
);
await caseSearch.setMatchCase(false);
assert(caseSearch.total === 3, 'C1: switching back restores the case-insensitive matches', String(caseSearch.total));
caseSearch.clear();
assert(caseSearch.total === 0, 'C1: clearing the query drops the matches');

// ---------------------------------------------------------------------------
section('C2. The real renderer switches layout modes');

globalThis.IntersectionObserver = undefined;
globalThis.fetch = async (resource) => {
  const relative = String(resource)
    .replace(/^https?:\/\/localhost:3000\//, '')
    .replace(/^\/+/, '');
  const target = new URL(relative, `file://${ROOT}/`);
  const buffer = await readFile(target);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
};

const appDom = new JSDOM(html, {
  url: 'http://localhost:3000/src/index.html?pdf=/samples/cambuz-demo.pdf',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
});
globalThis.window = appDom.window;
globalThis.document = appDom.window.document;
globalThis.localStorage = appDom.window.localStorage;
appDom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const state = {
    canvas: this,
    getTransform: () => identity,
    getImageData: (x, y, width = 1, height = 1) => ({ data: new Uint8ClampedArray(Math.max(1, width * height * 4)), width, height }),
    createImageData: (width = 1, height = 1) => ({ data: new Uint8ClampedArray(Math.max(1, width * height * 4)), width, height }),
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    isPointInPath: () => false,
  };
  return new Proxy(state, {
    get: (target, property) => (property in target ? target[property] : () => {}),
    set: (target, property, value) => { target[property] = value; return true; },
  });
};
appDom.window.Path2D = class Path2D {
  addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
  closePath() {} rect() {} arc() {} ellipse() {} transform() {}
};
globalThis.Path2D = appDom.window.Path2D;
appDom.window.confirm = () => true;
appDom.window.URL.createObjectURL = () => 'blob:cambuz-test';

const appViewer = appDom.window.document.getElementById('pdf-viewer');
const appColumn = appDom.window.document.getElementById('pdf-column');
fakeScroller(appViewer, 800);
Object.defineProperty(appViewer, 'scrollHeight', {
  configurable: true,
  get: () => {
    const column = appColumn.hidden ? null : parseFloat(appColumn.style.height || '0');
    if (column) return column;
    const page = appDom.window.document.getElementById('page-wrapper');
    return parseFloat(page?.style.height || '0');
  },
});

const renderer = await import('../src/renderer.js?phase11-view-mode');
await renderer.initApp();
const appElement = (id) => appDom.window.document.getElementById(id);
const appFlush = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (id) => appElement(id).dispatchEvent(
  new appDom.window.MouseEvent('click', { bubbles: true, cancelable: true })
);

for (let attempt = 0; attempt < 120 && appElement('doc-title').textContent !== 'cambuz-demo.pdf'; attempt += 1) {
  await appFlush(50);
}
await appFlush(300);
assert(appElement('doc-title').textContent === 'cambuz-demo.pdf', 'C1: the ten-page sample opens');
assert(appColumn.hidden, 'C1: the column stays hidden in single-page mode');
assert(
  /Page 1 \/ 10/.test(appElement('status-meta').textContent),
  'C1: single-page mode renders page 1 of 10',
  appElement('status-meta').textContent
);
assert(appElement('btn-view-mode').textContent.includes('Page'), 'C1: the layout button starts on single page');

click('btn-view-mode');
for (let attempt = 0; attempt < 120 && appColumn.hidden; attempt += 1) await appFlush(50);
await appFlush(400);

assert(!appColumn.hidden, 'C1: switching to continuous mode reveals the column');
assert(
  appViewer.classList.contains('continuous'),
  'C1: the viewer carries the continuous layout class'
);
assert(
  appDom.window.localStorage.getItem('cambuz.viewMode') === 'continuous',
  'C1: the layout choice is remembered'
);
const appSlots = [...appColumn.querySelectorAll('.page-slot')];
assert(appSlots.length >= 1, 'C1: the column contains page slots');
assert(
  appSlots.some((slot) => slot.dataset.page === '1' && slot.querySelector('canvas').width > 0),
  'C1: the first page is painted in the column'
);
assert(
  appColumn.querySelectorAll('.page-slot').length < 10,
  'C1: distant pages stay unrendered (lazy window)',
  String(appColumn.querySelectorAll('.page-slot').length)
);
assert(
  appElement('btn-view-mode').textContent.includes('Scroll'),
  'C1: the layout button reports continuous mode'
);

// Jump to page 5 through the page box: the column scrolls and renders it.
appElement('page-input').value = '5';
appElement('page-input').dispatchEvent(
  new appDom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
);
await appFlush(500);
assert(
  appColumn.querySelector('.page-slot[data-page="5"]'),
  'C1: jumping to a page creates its slot in the column'
);
assert(
  appColumn.querySelector('.page-slot[data-page="5"] canvas')?.width > 0,
  'C1: the page that was jumped to is rendered'
);
assert(/Page 5 \/ 10/.test(appElement('status-meta').textContent), 'C1: the status line follows the jump');

// Scrolling across a page boundary moves the page counter with the reader.
const slotFive = appColumn.querySelector('.page-slot[data-page="5"]');
appViewer.scrollTop = parseFloat(slotFive.style.top) + parseFloat(slotFive.style.height) + 5;
appViewer.dispatchEvent(new appDom.window.Event('scroll'));
await appFlush(500);
assert(
  appElement('page-input').value === '6',
  'C1: the page box follows the scroll position',
  appElement('page-input').value
);
assert(/Page 6 \/ 10/.test(appElement('status-meta').textContent), 'C1: the status line follows the scroll position');

// The column is a real stack: consecutive slots are offset by their heights.
const slotSix = appColumn.querySelector('.page-slot[data-page="6"]');
if (slotFive && slotSix) {
  const expectedSixTop =
    parseFloat(slotFive.style.top) + parseFloat(slotFive.style.height) + Layout.PAGE_GAP;
  assert(
    Math.abs(parseFloat(slotSix.style.top) - expectedSixTop) <= 1,
    'C2: consecutive slots are stacked by their heights plus the page gap',
    `${slotSix.style.top} vs ${expectedSixTop}`
  );
} else {
  fail('C2: consecutive slots are stacked by their heights plus the page gap', 'slots missing');
}

// Zooming in continuous mode keeps the page and grows the column.
const widthBeforeZoom = parseFloat(appColumn.querySelector('.page-slot[data-page="6"]').style.width);
click('btn-zoom-in');
await appFlush(500);
const widthAfterZoom = parseFloat(appColumn.querySelector('.page-slot[data-page="6"]')?.style.width || '0');
assert(appElement('page-input').value === '6', 'C2: zooming keeps the reader on the same page');
assert(
  widthAfterZoom > widthBeforeZoom,
  'C2: zooming re-lays out the column at the larger scale',
  `${widthBeforeZoom} → ${widthAfterZoom}`
);
assert(
  appColumn.querySelector('.page-slot[data-page="6"] canvas')?.width > 0,
  'C2: the page under the reading line is re-rendered after zooming'
);

// Rotating swaps the slot's footprint.
const sizeBeforeRotate = {
  width: parseFloat(appColumn.querySelector('.page-slot[data-page="6"]').style.width),
  height: parseFloat(appColumn.querySelector('.page-slot[data-page="6"]').style.height),
};
click('btn-rotate-cw');
await appFlush(600);
const sizeAfterRotate = {
  width: parseFloat(appColumn.querySelector('.page-slot[data-page="6"]')?.style.width || '0'),
  height: parseFloat(appColumn.querySelector('.page-slot[data-page="6"]')?.style.height || '0'),
};
assert(appElement('page-input').value === '6', 'C2: rotating keeps the reader on the same page');
assert(
  sizeBeforeRotate.height > sizeBeforeRotate.width &&
    sizeAfterRotate.width > sizeAfterRotate.height,
  'C2: rotation swaps the page footprint in the column',
  JSON.stringify({ sizeBeforeRotate, sizeAfterRotate })
);
click('btn-rotate-ccw');
await appFlush(600);

// Back to single page: the classic canvas view returns on the same page.
click('btn-view-mode');
await appFlush(600);
assert(appColumn.hidden, 'C1: switching back hides the column');
assert(
  /Page 6 \/ 10/.test(appElement('status-meta').textContent),
  'C1: the single page is painted again',
  appElement('status-meta').textContent
);
assert(appElement('page-input').value === '6', 'C1: the reader stays on the same page across the switch');

// Wheel at the end of a page turns it, so single-page reading needs no arrows.
appViewer.scrollTop = 100000;
const wheel = (deltaY) => appViewer.dispatchEvent(
  new appDom.window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
);
wheel(120);
await appFlush(400);
assert(appElement('page-input').value === '7', 'C1: a wheel gesture at the end of the page turns it', appElement('page-input').value);

// A second document in continuous mode: the column is rebuilt for it.
click('btn-view-mode');
await appFlush(400);
click('btn-sample-form');
for (let attempt = 0; attempt < 120 && appElement('doc-title').textContent !== 'form-sample.pdf'; attempt += 1) {
  await appFlush(50);
}
await appFlush(600);
assert(appElement('doc-title').textContent === 'form-sample.pdf', 'C3: a second document opens in continuous mode');
assert(!appColumn.hidden, 'C3: the column stays in continuous mode across documents');
assert(
  appElement('page-total').textContent === '1',
  'C3: the page count follows the new document',
  appElement('page-total').textContent
);
assert(
  [...appColumn.querySelectorAll('.page-slot')].every((slot) => slot.dataset.page === '1'),
  'C3: slots from the previous document are gone',
  [...appColumn.querySelectorAll('.page-slot')].map((slot) => slot.dataset.page).join(',')
);
assert(
  appColumn.querySelector('.page-slot[data-page="1"] canvas')?.width > 0,
  'C3: the new document is rendered in the column'
);
assert(
  appElement('page-input').value === '1',
  'C3: the reader starts on page 1 of the new document',
  appElement('page-input').value
);

appDom.window.close();

// ---------------------------------------------------------------------------
console.log(`\nPhase 11 tests: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log(`Failures:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
