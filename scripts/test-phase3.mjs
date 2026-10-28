#!/usr/bin/env node
// Cambuz PDF Reader — Phase 3 print workflow tests.
// Exercises page-range validation, print-sheet geometry, vector-preserving PDF
// generation, output page counts/media boxes, Unicode content and Ink Saver.
// Native printer hardware is intentionally not simulated as a real print test.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import UPNGModule from '@pdf-lib/upng';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  PAPER_SIZES,
  PRINT_DEFAULTS,
  buildPrintPdf,
  calculatePagePlacement,
  createPrintPlan,
  getMarginsMm,
  getPaperDimensions,
  grayscaleRgbaInPlace,
  millimetresToMicrons,
  normalizePrintSettings,
  parsePageRanges,
  describeDuplexMode,
  isManualDuplexMode,
  resolvePageSelection,
  splitSheetsForManualDuplex,
  summarizePrintJob,
} from '../src/printing.js';

globalThis.DOMMatrix ||= DOMMatrix;
globalThis.ImageData ||= ImageData;
globalThis.Path2D ||= Path2D;

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standardFontDataUrl = pathToFileURL(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep).href;
const UPNG = UPNGModule.default;
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
function assert(condition, name, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}
function throws(fn, message, name) {
  try {
    fn();
    fail(name, 'did not throw');
  } catch (error) {
    if (error.message.includes(message)) pass(name);
    else fail(name, `unexpected error: ${error.message}`);
  }
}
async function rejects(fn, message, name) {
  try {
    await fn();
    fail(name, 'did not reject');
  } catch (error) {
    if (error.message.includes(message)) pass(name);
    else fail(name, `unexpected error: ${error.message}`);
  }
}
function section(title) {
  console.log(`\n## ${title}`);
}

async function loadSample(file) {
  return new Uint8Array(readFileSync(path.join(ROOT, 'samples', file)));
}

async function extractPages(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join(' '));
  }
  await doc.destroy();
  return pages;
}

async function rasterPage(bytes, pageNumber = 1) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), standardFontDataUrl, useSystemFonts: true }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
  const pixels = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
  const result = { width: canvas.width, height: canvas.height, pixels };
  await doc.destroy();
  return result;
}
function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [...image.pixels.slice(offset, offset + 4)];
}

section('1. Page selection and range validation');
assert(
  JSON.stringify(parsePageRanges('1-3, 5, 8-9', 9)) === JSON.stringify([1, 2, 3, 5, 8, 9]),
  'ranges parse into one-based pages in entered order'
);
assert(
  JSON.stringify(parsePageRanges('4, 1-2', 4)) === JSON.stringify([4, 1, 2]),
  'page lists preserve explicit ordering'
);
throws(() => parsePageRanges('', 5), 'Enter one or more pages', 'empty range rejected');
throws(() => parsePageRanges('0', 5), 'between 1 and 5', 'page zero rejected');
throws(() => parsePageRanges('6', 5), 'between 1 and 5', 'out-of-document page rejected');
throws(() => parsePageRanges('4-2', 5), 'backwards', 'descending range rejected');
throws(() => parsePageRanges('1, 1', 5), 'listed more than once', 'duplicate page rejected');
throws(() => parsePageRanges('2-x', 5), 'not a valid page', 'malformed range rejected');
assert(
  JSON.stringify(resolvePageSelection({ pageMode: 'current' }, 5, 3)) === '[3]',
  'current-page selection resolves correctly'
);
assert(
  resolvePageSelection({ pageMode: 'all' }, 5, 3).length === 5,
  'all-pages selection resolves every page'
);
assert(
  summarizePrintJob({ ...PRINT_DEFAULTS, pageMode: 'range', pageRange: '1-5', pagesPerSheet: 4 }, 5, 2).sheetCount === 2,
  'summary rounds an incomplete N-up sheet up'
);

section('2. Print settings, paper and layout geometry');
assert(PAPER_SIZES.A4.widthMm === 210 && PAPER_SIZES.A4.heightMm === 297, 'A4 paper size is 210 × 297 mm');
assert(
  JSON.stringify(getPaperDimensions({ ...PRINT_DEFAULTS, paperSize: 'A4', orientation: 'landscape' })) ===
    JSON.stringify({ widthMm: 297, heightMm: 210 }),
  'landscape orientation swaps paper dimensions'
);
assert(
  JSON.stringify(getPaperDimensions({ ...PRINT_DEFAULTS, paperSize: 'Letter', orientation: 'portrait' })) ===
    JSON.stringify({ widthMm: 215.9, heightMm: 279.4 }),
  'Letter portrait dimensions are correct'
);
assert(getMarginsMm({ ...PRINT_DEFAULTS, marginMode: 'wide' }).left === 20, 'wide margins resolve to 20 mm');
assert(getMarginsMm({ ...PRINT_DEFAULTS, marginMode: 'custom', customMargin: 12 }).top === 12, 'custom margin is applied uniformly');
assert(millimetresToMicrons(210) === 210000, 'native printer paper dimensions convert to microns');
const grayPixels = grayscaleRgbaInPlace(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]));
assert(grayPixels[0] === grayPixels[1] && grayPixels[1] === grayPixels[2], 'Ink Saver converts RGB pixels to grayscale');
assert(grayPixels[4] === grayPixels[5] && grayPixels[5] === grayPixels[6] && grayPixels[7] === 255, 'grayscale conversion makes output pixels opaque');
assert(normalizePrintSettings({ ...PRINT_DEFAULTS, duplexMode: 'longEdge', collate: false }).duplexMode === 'longEdge', 'two-sided long-edge and uncollated choices are accepted');
assert(normalizePrintSettings({ ...PRINT_DEFAULTS, duplexMode: 'shortEdge' }).duplexMode === 'shortEdge', 'two-sided short-edge choice is accepted');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, duplexMode: 'two-sided' }), 'one-sided', 'invalid duplex mode rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, collate: 'false' }), 'Collate must', 'non-boolean collation rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, copies: 0 }), 'Copies must', 'zero copies rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, copies: 100 }), 'Copies must', 'copies above the limit rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, pagesPerSheet: 3 }), 'Pages per sheet', 'unsupported N-up setting rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, scaling: 'custom', customScale: 401 }), 'Custom scale', 'custom scale above 400% rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, marginMode: 'custom', customMargin: 51 }), 'Custom margins', 'custom margin above 50 mm rejected');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, paperSize: 'Unknown' }), 'paper size', 'unsupported paper size rejected');

const landscape2up = createPrintPlan({ ...PRINT_DEFAULTS, orientation: 'landscape', pagesPerSheet: 2 }, [1, 2, 3]);
assert(landscape2up.grid.columns === 2 && landscape2up.grid.rows === 1, 'landscape 2-up uses two side-by-side cells');
assert(landscape2up.sheets.length === 2 && landscape2up.sheets[1].items.length === 1, 'three pages at 2-up produce a second partial sheet');
const portrait2up = createPrintPlan({ ...PRINT_DEFAULTS, pagesPerSheet: 2 }, [1, 2]);
assert(portrait2up.grid.columns === 1 && portrait2up.grid.rows === 2, 'portrait 2-up uses two vertical cells');
const portrait4up = createPrintPlan({ ...PRINT_DEFAULTS, pagesPerSheet: 4 }, [1, 2, 3, 4, 5]);
assert(portrait4up.grid.columns === 2 && portrait4up.grid.rows === 2, '4-up uses a 2 × 2 grid');
assert(portrait4up.sheets.length === 2, 'five pages at 4-up produce two sheets');
const fit = calculatePagePlacement(612, 792, { x: 0, y: 0, width: 300, height: 500 }, { ...PRINT_DEFAULTS, scaling: 'fit' });
assert(fit.scale === Math.min(300 / 612, 500 / 792), 'Fit scaling uses the smaller cell ratio');
const actual = calculatePagePlacement(612, 792, { x: 0, y: 0, width: 300, height: 500 }, { ...PRINT_DEFAULTS, scaling: 'actual' });
assert(actual.width === 612 && actual.height === 792, 'Actual Size retains original page dimensions');
const custom = calculatePagePlacement(612, 792, { x: 0, y: 0, width: 900, height: 1100 }, { ...PRINT_DEFAULTS, scaling: 'custom', customScale: 150 });
assert(custom.scale === 1.5 && custom.width === 918, 'Custom scale applies the selected percentage');
const rotated = calculatePagePlacement(612, 792, { x: 0, y: 0, width: 900, height: 700 }, { ...PRINT_DEFAULTS, scaling: 'fit' }, 90);
assert(rotated.width === 792 * rotated.scale && rotated.height === 612 * rotated.scale, 'PDF page rotation is reflected in fit geometry');

section('3. Composed print PDFs — ranges, paper, N-up and Unicode');
const welcome = await loadSample('welcome.pdf');
const rangeJob = await buildPrintPdf({
  sourceBytes: welcome,
  settings: { ...PRINT_DEFAULTS, pageMode: 'range', pageRange: '3, 1', paperSize: 'A4', orientation: 'portrait' },
  currentPage: 2,
});
assert(rangeJob.pageCount === 2 && rangeJob.selectedPages.join(',') === '3,1', 'selected pages remain in range-entry order');
const rangeTexts = await extractPages(rangeJob.bytes);
assert(rangeTexts.length === 2, 'selected range produces two PDF output pages');
assert(rangeTexts[0].includes('Page 3 of 5') && rangeTexts[1].includes('Page 1 of 5'), 'composed PDF contains the exact selected source pages');

const currentJob = await buildPrintPdf({
  sourceBytes: welcome,
  settings: { ...PRINT_DEFAULTS, pageMode: 'current' },
  currentPage: 4,
});
const currentTexts = await extractPages(currentJob.bytes);
assert(currentJob.pageCount === 1 && currentTexts[0].includes('Page 4 of 5'), 'current-page print exports only the active page');

const twoUp = await buildPrintPdf({
  sourceBytes: welcome,
  settings: { ...PRINT_DEFAULTS, pageMode: 'all', pagesPerSheet: 2, orientation: 'landscape' },
});
const twoUpTexts = await extractPages(twoUp.bytes);
assert(twoUp.pageCount === 3 && twoUpTexts.length === 3, 'five-page landscape 2-up job has three sheets');
assert(twoUpTexts[0].includes('Page 1 of 5') && twoUpTexts[0].includes('Page 2 of 5'), 'first 2-up sheet includes pages 1 and 2');
assert(twoUpTexts[2].includes('Page 5 of 5'), 'last partial 2-up sheet includes the final page');
const twoUpDoc = await PDFDocument.load(twoUp.bytes);
const twoUpSize = twoUpDoc.getPage(0).getSize();
assert(Math.round(twoUpSize.width) > Math.round(twoUpSize.height), 'landscape 2-up output uses landscape A4 media boxes');

const fourUp = await buildPrintPdf({
  sourceBytes: welcome,
  settings: { ...PRINT_DEFAULTS, pageMode: 'all', pagesPerSheet: 4 },
});
const fourUpTexts = await extractPages(fourUp.bytes);
assert(fourUp.pageCount === 2 && fourUpTexts[0].includes('Page 4 of 5'), 'four-up sheet composes the first four pages');
assert(fourUpTexts[1].includes('Page 5 of 5'), 'four-up final sheet contains the fifth page');

const letterLandscape = await buildPrintPdf({
  sourceBytes: welcome,
  settings: { ...PRINT_DEFAULTS, pageMode: 'current', paperSize: 'Letter', orientation: 'landscape', marginMode: 'custom', customMargin: 14, scaling: 'custom', customScale: 90 },
  currentPage: 1,
});
const letterDoc = await PDFDocument.load(letterLandscape.bytes);
const letterSize = letterDoc.getPage(0).getSize();
assert(Math.abs(letterSize.width - 792) < 1 && Math.abs(letterSize.height - 612) < 1, 'custom-scale print PDF has Letter landscape dimensions');

const hindi = await loadSample('hindi-sample.pdf');
const hindiJob = await buildPrintPdf({
  sourceBytes: hindi,
  settings: { ...PRINT_DEFAULTS, pageMode: 'range', pageRange: '1-2', pagesPerSheet: 2, orientation: 'landscape' },
});
const hindiTexts = await extractPages(hindiJob.bytes);
assert(hindiTexts.length === 1 && hindiTexts[0].includes('पंजाब'), 'Hindi text survives vector N-up print composition');
const punjabi = await loadSample('punjabi-sample.pdf');
const punjabiJob = await buildPrintPdf({
  sourceBytes: punjabi,
  settings: { ...PRINT_DEFAULTS, pageMode: 'range', pageRange: '2', inkSaver: false },
});
const punjabiTexts = await extractPages(punjabiJob.bytes);
assert(punjabiTexts[0].includes('ਪੰਜਾਬ'), 'Punjabi text survives print-ready PDF composition');

// End-to-end artifact regression: assemble varied source artwork using pdf-lib,
// feed it through production buildPrintPdf(), then independently rasterize the
// resulting PDF through PDF.js and inspect actual pixels (not PDF operators).
{
  const fixture = await PDFDocument.create();
  const normal = fixture.addPage([300, 400]);
  // Small vector bars stand in for printed glyph strokes; existing assertions
  // above separately verify searchable Hindi/Punjabi text survives composition.
  normal.drawRectangle({ x: 24, y: 350, width: 140, height: 3, color: (await import('pdf-lib')).rgb(0, 0, 0) });
  normal.drawRectangle({ x: 24, y: 358, width: 90, height: 3, color: (await import('pdf-lib')).rgb(0, 0, 0) });
  normal.drawRectangle({ x: 30, y: 270, width: 100, height: 50, color: (await import('pdf-lib')).rgb(0.4, 0.4, 0.4) });
  normal.drawRectangle({ x: 150, y: 250, width: 80, height: 80, color: (await import('pdf-lib')).rgb(1, 0, 0), opacity: 0.5 });
  const dark = fixture.addPage([300, 400]);
  dark.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: (await import('pdf-lib')).rgb(0.05, 0.08, 0.12) });
  dark.drawRectangle({ x: 24, y: 350, width: 140, height: 3, color: (await import('pdf-lib')).rgb(1, 1, 1) });
  const composed = await buildPrintPdf({
    sourceBytes: new Uint8Array(await fixture.save()),
    settings: { ...PRINT_DEFAULTS, pageMode: 'all', paperSize: 'A4', orientation: 'portrait' },
  });
  const outputPdf = await PDFDocument.load(composed.bytes);
  assert(outputPdf.getPageCount() === 2, 'real composed output retains the two-page fixture');
  const page1 = await rasterPage(composed.bytes, 1);
  const whiteCorner = pixelAt(page1, 5, 5);
  assert(whiteCorner[0] > 245 && whiteCorner[1] > 245 && whiteCorner[2] > 245, 'rasterized print artifact has a white physical-sheet background');
  const page1Ink = page1.pixels.filter((_, index) => index % 4 === 0 && page1.pixels[index] < 100).length;
  assert(page1Ink > 50, 'rasterized artifact retains visible black text / darker artwork');
  const page2 = await rasterPage(composed.bytes, 2);
  const darkInterior = pixelAt(page2, 140, 140);
  assert(darkInterior[0] < 80 && darkInterior[1] < 100 && darkInterior[2] < 130, 'legitimate dark page background remains dark above the white sheet fill');
  const pageSize = outputPdf.getPage(0).getSize();
  assert(Math.abs(pageSize.width - 595.28) < 1 && Math.abs(pageSize.height - 841.89) < 1, 'raster-tested artifact retains A4 portrait media dimensions');
}

section('4. PDF page rotation and Ink Saver output');
const rotatable = await PDFDocument.load(welcome);
rotatable.getPage(0).setRotation(degrees(90));
const rotatedSource = new Uint8Array(await rotatable.save());
const rotatedJob = await buildPrintPdf({
  sourceBytes: rotatedSource,
  settings: { ...PRINT_DEFAULTS, pageMode: 'current', orientation: 'landscape' },
});
const rotatedPdf = await PDFDocument.load(rotatedJob.bytes);
const rotatedOutputSize = rotatedPdf.getPage(0).getSize();
assert(rotatedOutputSize.width > rotatedOutputSize.height, 'rotated source page is composed on landscape media');
const rotatedText = (await extractPages(rotatedJob.bytes))[0];
assert(rotatedText.includes('Page 1 of 5'), 'rotated PDF keeps original page text content');
const rotatedPreviewDoc = await pdfjsLib.getDocument({ data: rotatedJob.bytes.slice(), standardFontDataUrl }).promise;
const rotatedPreviewPage = await rotatedPreviewDoc.getPage(1);
const rotatedPreviewText = await rotatedPreviewPage.getTextContent();
const rotatedTitle = rotatedPreviewText.items.find((item) => item.str === 'Cambuz PDF Reader');
assert(rotatedTitle && Math.abs(rotatedTitle.transform[1]) > 0, 'PDF /Rotate is applied to the placed page content');
await rotatedPreviewDoc.destroy();

const rgba = new Uint8Array([
  230, 20, 20, 255, 20, 220, 20, 255,
  20, 20, 230, 255, 245, 245, 245, 255,
]);
const pngBytes = new Uint8Array(UPNG.encode([rgba.buffer], 2, 2, 0));
let grayCalls = 0;
const inkJob = await buildPrintPdf({
  sourceBytes: welcome,
  settings: { ...PRINT_DEFAULTS, pageMode: 'current', inkSaver: true },
  currentPage: 2,
  renderGrayscalePage: async (pageNumber, scale, dimensions) => {
    grayCalls += 1;
    assert(pageNumber === 2 && scale > 0 && dimensions.width > 0, 'Ink Saver renderer receives the selected page and placement');
    return pngBytes;
  },
});
assert(grayCalls === 1 && inkJob.pageCount === 1, 'Ink Saver uses a grayscale image for the selected source page');
assert((await PDFDocument.load(inkJob.bytes)).getPageCount() === 1, 'Ink Saver output remains a valid PDF');
await rejects(
  () => buildPrintPdf({ sourceBytes: welcome, settings: { ...PRINT_DEFAULTS, inkSaver: true } }),
  'Ink Saver rendering is unavailable',
  'Ink Saver fails clearly when no grayscale renderer is available'
);

console.log('\n## Manual two-sided (no duplex unit)');
assert(normalizePrintSettings({ ...PRINT_DEFAULTS, duplexMode: 'manual' }).duplexMode === 'manual', 'manual two-sided mode is accepted');
throws(() => normalizePrintSettings({ ...PRINT_DEFAULTS, duplexMode: 'manualLongEdge' }), 'one-sided', 'retired manual mode names are rejected');
assert(isManualDuplexMode('manual') && !isManualDuplexMode('longEdge') && !isManualDuplexMode('simplex'), 'only the manual mode is sequenced by Cambuz');
assert(describeDuplexMode('manual') === 'manual two-sided' && describeDuplexMode('longEdge') === 'two-sided, long edge', 'duplex labels are human readable');
{
  // Five composed sheets, each a distinct width so the output order is checkable.
  const composed = await PDFDocument.create();
  for (let i = 1; i <= 5; i += 1) composed.addPage([100 + i, 200]);
  const composedBytes = await composed.save();
  const split = await splitSheetsForManualDuplex(composedBytes);
  const widthsOf = async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    return doc.getPages().map((page) => page.getWidth() - 100);
  };
  const front = await widthsOf(split.frontBytes);
  const back = await widthsOf(split.backBytes);
  assert(split.frontCount === 3 && split.backCount === 2, 'manual split: 3 front sheets and 2 back sheets for 5 composed pages');
  assert(JSON.stringify(front) === '[1,3,5]', `manual split: front pass keeps sheets 1,3,5 in order (got ${JSON.stringify(front)})`);
  assert(JSON.stringify(back) === '[4,2]', `manual split: back pass is sheets 4,2 (reverse order) (got ${JSON.stringify(back)})`);
}
{
  const single = await PDFDocument.create();
  single.addPage([101, 200]);
  const split = await splitSheetsForManualDuplex(await single.save());
  assert(split.frontCount === 1 && split.backCount === 0, 'manual split: a one-sheet job needs no second pass');
}

console.log('\n==============================');
console.log(`Phase 3 print tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(failed ? 1 : 0);
