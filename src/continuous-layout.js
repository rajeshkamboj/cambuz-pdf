// Cambuz PDF Reader — continuous scroll layout math (DOM-free).
//
// Continuous mode stacks every page in one scrollable column. This module owns
// the arithmetic — page sizes, column offsets, which page the reader is looking
// at, which pages to render, and where to scroll to reach a page — so the DOM
// layer (continuous-view.js) and the regression tests share one definition of
// the geometry. Nothing here touches PDF.js or the document object model.
//
// Coordinate space: "column space" runs from 0 at the top of the scrollable
// content to `totalHeight` at the bottom, and already includes the leading
// `pad` above page 1, the gap between pages and the trailing `pad`. A scroll
// container's `scrollTop` uses that same space, so no call site needs to
// remember an offset.

/** Vertical gap between two pages in continuous mode (CSS px). */
export const PAGE_GAP = 16;

/** Fraction of the viewport height treated as the reader's "reading line". */
export const ANCHOR_RATIO = 0.3;

/** Extra pages rendered above and below the visible range. */
export const RENDER_AHEAD = 1;

/** Largest number of page canvases kept alive at once. */
export const MAX_LIVE_CANVASES = 4;

/** Normalize any rotation in degrees to 0 | 90 | 180 | 270. */
export function normalizeRotation(deg) {
  const value = Number(deg);
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

/**
 * Width/height of a page once the reader's rotation is applied. PDF.js swaps
 * the axes for every 90° step, so the same swap is applied here to the
 * unrotated page size.
 */
export function sizeForRotation(baseSize, rotation) {
  if (!baseSize) return null;
  const width = Number(baseSize.width);
  const height = Number(baseSize.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  const swapped = normalizeRotation(rotation) % 180 === 90;
  return swapped ? { width: height, height: width } : { width, height };
}

/** Page size in CSS px at `scale` and `rotation` (null when unknown). */
export function scaledSize(baseSize, scale, rotation) {
  const size = sizeForRotation(baseSize, rotation);
  const factor = Number(scale);
  if (!size || !Number.isFinite(factor) || factor <= 0) return null;
  return { width: size.width * factor, height: size.height * factor };
}

function midpoint(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return middle;
}

/**
 * Build the column geometry for `totalPages` pages.
 *
 * @param {object} options
 * @param {number} options.totalPages - number of pages (>= 0)
 * @param {number} [options.pad] - blank space above page 1 and below the last page
 * @param {number} [options.gap] - space between consecutive pages
 * @param {(pageNum:number) => ({width:number,height:number}|null)} options.sizeAt
 *        page size in CSS px, or null while it is still unknown
 * @returns {{ heights:number[], tops:number[], totalHeight:number, estimated:number }}
 *          `estimated` counts the pages whose height is still a guess.
 */
export function createMetrics({
  totalPages,
  pad = 0,
  gap = PAGE_GAP,
  sizeAt,
} = {}) {
  const count = Math.max(0, Math.floor(Number(totalPages) || 0));
  const heights = new Array(count);
  const tops = new Array(count);
  const known = [];
  const raw = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const size = sizeAt ? sizeAt(index + 1) : null;
    const height = size && Number.isFinite(size.height) && size.height > 0 ? size.height : null;
    raw[index] = height;
    if (height !== null) known.push(height);
  }
  // Unmeasured pages borrow the median of what has been measured (median, not
  // mean, so one unusually long page cannot distort the whole column). When
  // nothing is measured yet, fall back to a US-Letter-at-100% placeholder.
  const estimate = midpoint(known) ?? 1056;
  let cursor = Math.max(0, Number(pad) || 0);
  let estimated = 0;
  for (let index = 0; index < count; index += 1) {
    const height = raw[index] ?? estimate;
    if (raw[index] === null) estimated += 1;
    heights[index] = height;
    tops[index] = cursor;
    cursor += height + gap;
  }
  const totalHeight = count ? cursor - gap + Math.max(0, Number(pad) || 0) : 0;
  return { heights, tops, totalHeight, estimated };
}

/** Index (0-based) of the last page whose top is at or above `y`, or -1. */
function pageIndexAtOrAbove(tops, y) {
  let low = 0;
  let high = tops.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (tops[middle] <= y) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** 1-based page number under the reading line, clamped to the document. */
export function pageAtAnchor(metrics, scrollTop, viewportHeight, anchorRatio = ANCHOR_RATIO) {
  const { tops } = metrics;
  if (!tops.length) return 1;
  const line = Number(scrollTop) + Math.max(0, Number(viewportHeight) || 0) * anchorRatio;
  const index = Math.max(0, pageIndexAtOrAbove(tops, line));
  return Math.min(tops.length, index + 1);
}

/**
 * Inclusive 1-based page range intersecting the viewport, widened by `ahead`
 * pages in both directions.
 */
export function visiblePageRange(
  metrics,
  scrollTop,
  viewportHeight,
  { ahead = RENDER_AHEAD, totalPages } = {}
) {
  const { tops, heights } = metrics;
  const count = tops.length;
  if (!count) return { first: 0, last: 0, pages: [] };
  const limit = Math.min(count, Math.max(0, Math.floor(Number(totalPages) || count)));
  const height = Math.max(0, Number(viewportHeight) || 0);
  const top = Number(scrollTop) || 0;
  const bottom = top + height;

  // First page whose bottom edge is below the viewport top.
  let first = pageIndexAtOrAbove(tops, top);
  if (first < 0) first = 0;
  while (first < limit - 1 && tops[first] + heights[first] <= top) first += 1;

  let last = first;
  while (last < limit - 1 && tops[last + 1] < bottom) last += 1;

  const stride = Math.max(0, Math.floor(Number(ahead) || 0));
  const from = Math.max(0, first - stride);
  const to = Math.min(limit - 1, last + stride);
  const pages = [];
  for (let index = from; index <= to; index += 1) pages.push(index + 1);
  return { first: from + 1, last: to + 1, pages };
}

/**
 * `scrollTop` that puts `pageNum` at the top of the viewport, inside it, or
 * centred (when `center` is set). Returns 0 for an empty column.
 */
export function scrollTopForPage(
  metrics,
  pageNum,
  { viewportHeight = 0, center = false, offset = 0, maxScrollTop = Infinity } = {}
) {
  const { tops, heights, totalHeight } = metrics;
  if (!tops.length) return 0;
  const index = Math.min(
    tops.length,
    Math.max(1, Math.floor(Number(pageNum) || 1))
  ) - 1;
  let target = tops[index] - Math.max(0, Number(offset) || 0);
  if (center) {
    target = tops[index] - Math.max(0, (Number(viewportHeight) || 0) - heights[index]) / 2;
  }
  const ceiling = Number.isFinite(maxScrollTop)
    ? maxScrollTop
    : Math.max(0, totalHeight);
  return Math.min(Math.max(0, target), Math.max(0, ceiling));
}

/** How far `scrollTop` sits inside `pageNum` (0 when above the page). */
export function pageOffset(metrics, pageNum, scrollTop) {
  const { tops } = metrics;
  if (!tops.length) return 0;
  const index = Math.min(tops.length, Math.max(1, Math.floor(Number(pageNum) || 1))) - 1;
  return Math.max(0, (Number(scrollTop) || 0) - tops[index]);
}

/**
 * Keep the reader looking at the same part of the same page after the column
 * geometry changes (a page was measured, the zoom changed, the window was
 * resized): same page under the reading line, same distance into it.
 */
export function restoreAnchor(metrics, pageNum, offsetWithinPage) {
  const { tops } = metrics;
  if (!tops.length) return 0;
  const index = Math.min(tops.length, Math.max(1, Math.floor(Number(pageNum) || 1))) - 1;
  return Math.max(0, tops[index] + Math.max(0, Number(offsetWithinPage) || 0));
}

/**
 * Trim a page list to the canvas budget: the reading page and its neighbours
 * win, and anything past `maxLive` pages is dropped (it stays a placeholder
 * until the reader scrolls it back into the window).
 */
export function limitToCanvasBudget(pages, anchorPage, maxLive = MAX_LIVE_CANVASES) {
  const list = [...pages];
  const budget = Math.max(1, Math.floor(Number(maxLive) || 1));
  if (list.length <= budget) return list;
  const anchor = Number(anchorPage) || list[0];
  return list
    .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)
    .slice(0, budget)
    .sort((a, b) => a - b);
}
