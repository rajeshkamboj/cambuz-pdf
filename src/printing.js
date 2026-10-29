// Cambuz PDF Reader — Phase 3 print preparation helpers.
// A print job is composed into a new, vector-preserving PDF before it reaches
// a printer. This keeps the preview, page selection, N-up layout, scaling and
// margins consistent instead of relying on browser-specific print CSS.

export const PAPER_SIZES = Object.freeze({
  A4: Object.freeze({ label: 'A4', widthMm: 210, heightMm: 297 }),
  Letter: Object.freeze({ label: 'Letter', widthMm: 215.9, heightMm: 279.4 }),
  Legal: Object.freeze({ label: 'Legal', widthMm: 215.9, heightMm: 355.6 }),
  A3: Object.freeze({ label: 'A3', widthMm: 297, heightMm: 420 }),
  A5: Object.freeze({ label: 'A5', widthMm: 148, heightMm: 210 }),
  Tabloid: Object.freeze({ label: 'Tabloid', widthMm: 279.4, heightMm: 431.8 }),
});

export const MARGIN_PRESETS_MM = Object.freeze({
  none: 0,
  narrow: 5,
  normal: 10,
  wide: 20,
});

export const PRINT_DEFAULTS = Object.freeze({
  pageMode: 'all',
  pageRange: '',
  paperSize: 'A4',
  orientation: 'portrait',
  scaling: 'fit',
  customScale: 100,
  marginMode: 'normal',
  customMargin: 10,
  pagesPerSheet: 1,
  inkSaver: false,
});

const MM_TO_PT = 72 / 25.4;
const VALID_PAGE_MODES = new Set(['current', 'all', 'range']);
const VALID_ORIENTATIONS = new Set(['portrait', 'landscape']);
const VALID_SCALING = new Set(['fit', 'actual', 'custom']);
const VALID_MARGIN_MODES = new Set(['none', 'narrow', 'normal', 'wide', 'custom']);
const VALID_PAGES_PER_SHEET = new Set([1, 2, 4]);
const MAX_CUSTOM_SCALE = 400;
const MAX_MARGIN_MM = 50;

function asPositiveInteger(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${label} must be a whole number greater than zero.`);
  }
  return n;
}

/**
 * Parse an explicit page list such as "1-3, 5, 8-9". Page numbers are
 * one-based, order is preserved, and duplicates/descending ranges are rejected
 * so a typo cannot silently produce a different print job.
 */
export function parsePageRanges(input, totalPages) {
  const pageCount = asPositiveInteger(totalPages, 'Document page count');
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Enter one or more pages, for example 1-3, 5.');

  const selected = [];
  const seen = new Set();
  const parts = text.split(',');

  for (const rawPart of parts) {
    const part = rawPart.trim();
    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!match) {
      throw new Error(`“${part || text}” is not a valid page number or range.`);
    }

    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
      throw new Error('Page numbers are too large.');
    }
    if (first < 1 || last < 1 || first > pageCount || last > pageCount) {
      throw new Error(`Page numbers must be between 1 and ${pageCount}.`);
    }
    if (first > last) {
      throw new Error(`Page range ${first}-${last} is backwards.`);
    }

    for (let page = first; page <= last; page += 1) {
      if (seen.has(page)) throw new Error(`Page ${page} is listed more than once.`);
      seen.add(page);
      selected.push(page);
    }
  }

  if (selected.length === 0) throw new Error('Select at least one page.');
  return selected;
}

/** Resolve current/all/range choices to validated, one-based page numbers. */
export function resolvePageSelection(settings, totalPages, currentPage = 1) {
  const pageCount = asPositiveInteger(totalPages, 'Document page count');
  const mode = settings?.pageMode ?? PRINT_DEFAULTS.pageMode;
  if (!VALID_PAGE_MODES.has(mode)) throw new Error('Choose current page, all pages, or selected pages.');

  if (mode === 'current') {
    const current = asPositiveInteger(currentPage, 'Current page');
    if (current > pageCount) throw new Error(`Current page must be between 1 and ${pageCount}.`);
    return [current];
  }
  if (mode === 'all') return Array.from({ length: pageCount }, (_, index) => index + 1);
  return parsePageRanges(settings?.pageRange, pageCount);
}

/**
 * Validate user-controlled settings and return a normalized, immutable copy.
 * Throws user-readable messages; callers should show them next to the dialog.
 */
export function normalizePrintSettings(input = {}) {
  const settings = { ...PRINT_DEFAULTS, ...input };

  if (!Object.hasOwn(PAPER_SIZES, settings.paperSize)) {
    throw new Error('Choose a supported paper size.');
  }
  if (!VALID_ORIENTATIONS.has(settings.orientation)) {
    throw new Error('Choose portrait or landscape orientation.');
  }
  if (!VALID_SCALING.has(settings.scaling)) {
    throw new Error('Choose fit to page, actual size, or custom scale.');
  }
  if (!VALID_MARGIN_MODES.has(settings.marginMode)) {
    throw new Error('Choose a supported margin setting.');
  }

  const pagesPerSheet = Number(settings.pagesPerSheet);
  if (!VALID_PAGES_PER_SHEET.has(pagesPerSheet)) {
    throw new Error('Pages per sheet must be 1, 2, or 4.');
  }

  const customScale = Number(settings.customScale);
  if (
    settings.scaling === 'custom' &&
    (!Number.isFinite(customScale) || customScale < 10 || customScale > MAX_CUSTOM_SCALE)
  ) {
    throw new Error(`Custom scale must be between 10% and ${MAX_CUSTOM_SCALE}%.`);
  }

  const customMargin = Number(settings.customMargin);
  if (
    settings.marginMode === 'custom' &&
    (!Number.isFinite(customMargin) || customMargin < 0 || customMargin > MAX_MARGIN_MM)
  ) {
    throw new Error(`Custom margins must be between 0 and ${MAX_MARGIN_MM} mm.`);
  }

  return Object.freeze({
    pageMode: settings.pageMode,
    pageRange: String(settings.pageRange ?? ''),
    paperSize: settings.paperSize,
    orientation: settings.orientation,
    scaling: settings.scaling,
    customScale: Number.isFinite(customScale) ? customScale : PRINT_DEFAULTS.customScale,
    marginMode: settings.marginMode,
    customMargin: Number.isFinite(customMargin) ? customMargin : PRINT_DEFAULTS.customMargin,
    pagesPerSheet,
    inkSaver: Boolean(settings.inkSaver),
  });
}

/** Paper dimensions in millimetres after applying the selected orientation. */
export function getPaperDimensions(settings) {
  const normalized = normalizePrintSettings(settings);
  const paper = PAPER_SIZES[normalized.paperSize];
  const short = Math.min(paper.widthMm, paper.heightMm);
  const long = Math.max(paper.widthMm, paper.heightMm);
  return normalized.orientation === 'landscape'
    ? { widthMm: long, heightMm: short }
    : { widthMm: short, heightMm: long };
}

export function getMarginsMm(settings) {
  const normalized = normalizePrintSettings(settings);
  const margin = normalized.marginMode === 'custom'
    ? normalized.customMargin
    : MARGIN_PRESETS_MM[normalized.marginMode];
  return { top: margin, right: margin, bottom: margin, left: margin };
}

/**
 * Create a reusable print plan. Coordinates use PDF points with (0,0) at the
 * bottom-left; page numbers remain one-based for display/API boundaries.
 */
export function createPrintPlan(settingsInput, pageNumbers) {
  const settings = normalizePrintSettings(settingsInput);
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    throw new Error('Select at least one page to print.');
  }

  const paper = getPaperDimensions(settings);
  const margins = getMarginsMm(settings);
  const paperWidth = paper.widthMm * MM_TO_PT;
  const paperHeight = paper.heightMm * MM_TO_PT;
  const left = margins.left * MM_TO_PT;
  const right = margins.right * MM_TO_PT;
  const bottom = margins.bottom * MM_TO_PT;
  const top = margins.top * MM_TO_PT;
  const contentWidth = paperWidth - left - right;
  const contentHeight = paperHeight - top - bottom;
  if (contentWidth <= 0 || contentHeight <= 0) {
    throw new Error('Margins leave no printable area. Reduce the margins or choose larger paper.');
  }

  let columns = 1;
  let rows = 1;
  if (settings.pagesPerSheet === 2) {
    if (settings.orientation === 'landscape') columns = 2;
    else rows = 2;
  } else if (settings.pagesPerSheet === 4) {
    columns = 2;
    rows = 2;
  }

  const cellWidth = contentWidth / columns;
  const cellHeight = contentHeight / rows;
  const sheets = [];
  for (let i = 0; i < pageNumbers.length; i += settings.pagesPerSheet) {
    const items = pageNumbers.slice(i, i + settings.pagesPerSheet).map((pageNumber, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const x = left + column * cellWidth;
      const y = bottom + contentHeight - (row + 1) * cellHeight;
      return {
        pageNumber,
        cell: { x, y, width: cellWidth, height: cellHeight },
      };
    });
    sheets.push({ items });
  }

  return Object.freeze({
    settings,
    paper,
    paperWidth,
    paperHeight,
    margins,
    content: { x: left, y: bottom, width: contentWidth, height: contentHeight },
    grid: { columns, rows, cellWidth, cellHeight },
    sheets,
  });
}

/** Calculate the image/page placement inside one N-up cell. */
export function calculatePagePlacement(pageWidth, pageHeight, cell, settingsInput, pageRotation = 0) {
  const settings = normalizePrintSettings(settingsInput);
  const width = Number(pageWidth);
  const height = Number(pageHeight);
  if (!(width > 0) || !(height > 0)) throw new Error('A source PDF page has invalid dimensions.');
  const normalizedRotation = ((Number(pageRotation) % 360) + 360) % 360;
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
  const displayedWidth = quarterTurn ? height : width;
  const displayedHeight = quarterTurn ? width : height;

  let scale;
  if (settings.scaling === 'fit') {
    scale = Math.min(cell.width / displayedWidth, cell.height / displayedHeight);
  } else if (settings.scaling === 'actual') {
    scale = 1;
  } else {
    scale = settings.customScale / 100;
  }

  const drawWidth = displayedWidth * scale;
  const drawHeight = displayedHeight * scale;
  return {
    scale,
    rotation: normalizedRotation,
    sourceWidth: width,
    sourceHeight: height,
    x: cell.x + (cell.width - drawWidth) / 2,
    y: cell.y + (cell.height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
    clip: { ...cell },
  };
}

/**
 * Assemble selected source pages into a new PDF. Source content remains
 * vector/raster PDF content (no screen-resolution screenshot is used). When
 * inkSaver is enabled, the supplied renderer returns a grayscale PNG at a
 * scale chosen for the final physical page placement.
 */
export async function buildPrintPdf({
  sourceBytes,
  settings: settingsInput,
  currentPage = 1,
  pageCount,
  onProgress = () => {},
  renderGrayscalePage = null,
}) {
  if (!(sourceBytes instanceof Uint8Array) && !(sourceBytes instanceof ArrayBuffer)) {
    throw new Error('The original PDF bytes are not available for printing.');
  }
  const bytes = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
  const settings = normalizePrintSettings(settingsInput);
  const pdfLib = await import('pdf-lib');
  const {
    PDFDocument,
    pushGraphicsState,
    popGraphicsState,
    rectangle,
    clip,
    endPath,
    degrees,
    rgb,
  } = pdfLib;

  onProgress({ stage: 'Preparing', progress: 0 });
  let sourcePdf;
  try {
    sourcePdf = await PDFDocument.load(bytes);
  } catch (error) {
    // Phase 5: never attempt to work around encryption. A protected document
    // can be read, but printing it would mean rewriting it, so refuse clearly.
    if (error?.name === 'EncryptedPDFError' || /encrypted/i.test(String(error?.message || ''))) {
      throw new Error(
        'This PDF is encrypted. Cambuz can display it, but a print job cannot be prepared from a protected document.'
      );
    }
    throw new Error(`This PDF could not be prepared for printing: ${error.message || 'unknown error'}`);
  }
  const actualPageCount = sourcePdf.getPageCount();
  if (pageCount !== undefined && Number(pageCount) !== actualPageCount) {
    throw new Error('The PDF changed while the print dialog was open. Close and reopen the print preview.');
  }
  const selectedPages = resolvePageSelection(settings, actualPageCount, currentPage);
  const plan = createPrintPlan(settings, selectedPages);
  const selectedIndices = selectedPages.map((pageNumber) => pageNumber - 1);
  onProgress({ stage: 'Preparing pages', progress: 0.08 });
  const output = await PDFDocument.create();
  const embeddedPages = await output.embedPdf(sourcePdf, selectedIndices);
  output.setTitle('Cambuz PDF print job');
  const sourcePages = sourcePdf.getPages();
  const pageToEmbedded = new Map();
  selectedPages.forEach((pageNumber, index) => pageToEmbedded.set(pageNumber, {
    page: embeddedPages[index],
    rotation: sourcePages[pageNumber - 1].getRotation().angle,
  }));

  let itemIndex = 0;
  const itemCount = selectedPages.length;
  for (const sheetPlan of plan.sheets) {
    const sheet = output.addPage([plan.paperWidth, plan.paperHeight]);
    // PDF pages have no inherent background colour. Paint the physical sheet
    // white *before* source content so transparent artwork composites as it
    // would on paper while legitimate dark page backgrounds remain untouched.
    sheet.drawRectangle({
      x: 0,
      y: 0,
      width: plan.paperWidth,
      height: plan.paperHeight,
      color: rgb(1, 1, 1),
    });
    for (const item of sheetPlan.items) {
      const embedded = pageToEmbedded.get(item.pageNumber);
      const embeddedPage = embedded.page;
      const placement = calculatePagePlacement(
        embeddedPage.width,
        embeddedPage.height,
        item.cell,
        settings,
        embedded.rotation
      );

      if (settings.inkSaver) {
        if (typeof renderGrayscalePage !== 'function') {
          throw new Error('Ink Saver rendering is unavailable in this environment.');
        }
        const pngBytes = await renderGrayscalePage(item.pageNumber, placement.scale, {
          width: embeddedPage.width,
          height: embeddedPage.height,
        });
        const grayImage = await output.embedPng(pngBytes);
        sheet.pushOperators(
          pushGraphicsState(),
          rectangle(item.cell.x, item.cell.y, item.cell.width, item.cell.height),
          clip(),
          endPath()
        );
        sheet.drawImage(grayImage, {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        });
        sheet.pushOperators(popGraphicsState());
      } else {
        // Clip actual-size/custom pages to their assigned cell so they cannot
        // overlap neighbouring N-up pages or the sheet margins.
        sheet.pushOperators(
          pushGraphicsState(),
          rectangle(item.cell.x, item.cell.y, item.cell.width, item.cell.height),
          clip(),
          endPath()
        );
        let drawX = placement.x;
        let drawY = placement.y;
        let drawRotation = 0;
        if (placement.rotation === 90) {
          drawRotation = -90; // PDF /Rotate is clockwise; PDF matrices are CCW.
          drawY += embeddedPage.width * placement.scale;
        } else if (placement.rotation === 180) {
          drawRotation = 180;
          drawX += embeddedPage.width * placement.scale;
          drawY += embeddedPage.height * placement.scale;
        } else if (placement.rotation === 270) {
          drawRotation = 90;
          drawX += embeddedPage.height * placement.scale;
        }
        sheet.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: embeddedPage.width * placement.scale,
          height: embeddedPage.height * placement.scale,
          rotate: degrees(drawRotation),
        });
        sheet.pushOperators(popGraphicsState());
      }
      itemIndex += 1;
      onProgress({
        stage: settings.inkSaver ? 'Rendering ink saver pages' : 'Composing pages',
        progress: 0.08 + (itemIndex / itemCount) * 0.82,
      });
    }
  }

  onProgress({ stage: 'Saving print-ready PDF', progress: 0.94 });
  const result = await output.save({ useObjectStreams: true });
  onProgress({ stage: 'Ready', progress: 1 });
  return {
    bytes: result,
    pageCount: plan.sheets.length,
    selectedPages,
    paper: plan.paper,
    plan,
  };
}

/** A compact summary for the print dialog, suitable for visible UI text. */
export function summarizePrintJob(settings, totalPages, currentPage = 1) {
  const normalized = normalizePrintSettings(settings);
  const pages = resolvePageSelection(normalized, totalPages, currentPage);
  const sheets = Math.ceil(pages.length / normalized.pagesPerSheet);
  return {
    selectedCount: pages.length,
    sheetCount: sheets,
    pages,
    pagesPerSheet: normalized.pagesPerSheet,
  };
}

/** Convert RGBA canvas pixels to opaque grayscale (sRGB luminance). */
export function grayscaleRgbaInPlace(rgba) {
  if (!rgba || typeof rgba.length !== 'number' || rgba.length % 4 !== 0) {
    throw new Error('Expected an RGBA pixel buffer.');
  }
  for (let i = 0; i < rgba.length; i += 4) {
    const gray = Math.round(rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722);
    rgba[i] = gray;
    rgba[i + 1] = gray;
    rgba[i + 2] = gray;
    rgba[i + 3] = 255;
  }
  return rgba;
}
