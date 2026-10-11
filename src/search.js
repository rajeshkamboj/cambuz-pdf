// Cambuz PDF Reader — Search Engine (Phase 2)
//
// Unicode-safe text search with per-page match indexing and
// in-page highlight support.
//
// The pure matching helpers (normalizeStr, findAllMatches, ...) intentionally
// avoid all DOM access so they can be unit-tested in Node.js
// (see scripts/test-phase2.mjs). The SearchController class below is the
// DOM-aware driver used by the renderer.

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free, tested in Node)
// ---------------------------------------------------------------------------

/**
 * Canonicalize a string for comparison. NFC keeps Indic vowel signs,
 * anusvara/bindi and other combining marks in their composed form so a
 * query typed by the user matches the text stored in the PDF.
 */
export function normalizeStr(s) {
  return typeof s === 'string' ? s.normalize('NFC') : '';
}

/**
 * Case folding for case-insensitive search. Indic scripts have no case so
 * they pass through unchanged; Latin text folds as expected.
 */
export function foldCase(s) {
  return s.toLowerCase();
}

let graphemeSegmenter = null;

/** Yield graphemes with UTF-16 source offsets without retaining a page-sized array. */
function* getGraphemeSegments(text) {
  if (typeof Intl.Segmenter === 'function') {
    graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment, index } of graphemeSegmenter.segment(text)) {
      yield { segment, index, end: index + segment.length };
    }
    return;
  }

  // Compatibility fallback for older runtimes. It preserves combining marks,
  // variation selectors and join controls; supported Electron/Chromium builds
  // use Intl.Segmenter and its full Unicode grapheme rules.
  const segments = [];
  let joinNext = false;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    const length = char.length;
    const isExtend = /[\p{M}\u200c\u200d\ufe0e\ufe0f]/u.test(char);
    if ((isExtend || joinNext) && segments.length) {
      const last = segments[segments.length - 1];
      last.segment += char;
      last.end += length;
    } else {
      segments.push({ segment: char, index, end: index + length });
    }
    joinNext = char === '\u200d';
    index += length;
  }
  yield* segments;
}

/**
 * Build the normalized comparison text without constructing a per-code-unit
 * offset object for every character. Most PDF text maps one-to-one after
 * canonical normalization/case folding; `requiresDedup` marks the rare case
 * expansion that still needs grapheme-aware range checking.
 */
function buildComparisonText(text, matchCase) {
  const pieces = [];
  let requiresDedup = false;
  for (const { segment } of getGraphemeSegments(text)) {
    let normalized = normalizeStr(segment);
    if (!matchCase) normalized = foldCase(normalized);
    if (!normalized) continue;
    if (normalized.length > segment.length) requiresDedup = true;
    pieces.push(normalized);
  }
  return { text: pieces.join(''), requiresDedup };
}

/** Build a compact typed range map back to source graphemes for highlighting. */
function buildComparisonIndex(text, matchCase) {
  const comparison = buildComparisonText(text, matchCase);
  const starts = new Uint32Array(comparison.text.length);
  const ends = new Uint32Array(comparison.text.length);
  let offset = 0;
  for (const { segment, index, end } of getGraphemeSegments(text)) {
    let normalized = normalizeStr(segment);
    if (!matchCase) normalized = foldCase(normalized);
    for (let unit = 0; unit < normalized.length; unit += 1) {
      starts[offset] = index;
      ends[offset] = end;
      offset += 1;
    }
  }
  return { text: comparison.text, starts, ends, requiresDedup: comparison.requiresDedup };
}

function normalizeQuery(query, matchCase) {
  let needle = normalizeStr(typeof query === 'string' ? query : '');
  if (!matchCase) needle = foldCase(needle);
  return needle;
}

function countComparisonMatches(comparisonText, query, matchCase) {
  const needle = normalizeQuery(query, matchCase);
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= comparisonText.length) {
    const index = comparisonText.indexOf(needle, from);
    if (index < 0) break;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

/**
 * Find all non-overlapping occurrences of `query` inside `text`.
 *
 * Returns { index, length } ranges in the original UTF-16 string. When
 * normalization or lowercasing expands a grapheme, the range maps back to the
 * complete source grapheme so DOM highlighting never splits a combining
 * sequence or ligature-like cluster.
 *
 * @param {string} text
 * @param {string} query
 * @param {boolean} matchCase
 * @returns {{index:number,length:number}[]}
 */
export function findAllMatches(text, query, matchCase = false) {
  const rawText = typeof text === 'string' ? text : '';
  const rawQuery = typeof query === 'string' ? query : '';
  if (!rawQuery) return [];

  const haystack = buildComparisonIndex(rawText, matchCase);
  const needle = normalizeQuery(rawQuery, matchCase);
  if (!needle) return [];

  const matches = [];
  let from = 0;
  while (from <= haystack.text.length) {
    const index = haystack.text.indexOf(needle, from);
    if (index < 0) break;
    const firstStart = haystack.starts[index];
    const lastEnd = haystack.ends[index + needle.length - 1];
    if (firstStart !== undefined && lastEnd !== undefined) {
      const match = { index: firstStart, length: lastEnd - firstStart };
      const previous = matches[matches.length - 1];
      // Case conversion can expand one grapheme (for example, dotted-I).
      // Do not count two normalized code points as duplicate hits on the same
      // source grapheme.
      if (!previous || previous.index !== match.index || previous.length !== match.length) {
        matches.push(match);
      }
    }
    from = index + needle.length;
  }
  return matches;
}

/**
 * Verify that a previously computed match still lines up with the text
 * (used before wrapping DOM nodes so highlighting can never corrupt text).
 */
export function verifyMatch(text, index, length, query, matchCase = false) {
  const raw = typeof text === 'string' ? text : '';
  if (typeof query !== 'string' || !query || index < 0 || length <= 0 || index + length > raw.length) {
    return false;
  }
  const sourceRange = raw.slice(index, index + length);
  const comparison = buildComparisonText(sourceRange, matchCase).text;
  const expected = normalizeQuery(query, matchCase);
  // A comparison range may be the whole source grapheme while the query is a
  // substring of its normalized form (e.g. case-expanded dotted-I). The range
  // must still contain the query before it is safe to highlight.
  return comparison.includes(expected);
}

/** Count matches of `query` inside `text` without building highlight ranges. */
export function countMatches(text, query, matchCase = false) {
  const rawText = typeof text === 'string' ? text : '';
  if (typeof query !== 'string' || !query) return 0;
  const comparison = buildComparisonText(rawText, matchCase);
  if (comparison.requiresDedup) {
    return findAllMatches(rawText, query, matchCase).length;
  }
  return countComparisonMatches(comparison.text, query, matchCase);
}

/**
 * Reconstruct a page's logical text stream from PDF.js text items. Text may
 * be split across font/style runs; joining adjacent items lets a query find a
 * word even when a PDF divides it into several positioned spans. Explicit
 * PDF.js end-of-line markers remain separators, so words on separate lines
 * are not accidentally concatenated.
 */
export function getSearchableText(items) {
  const pieces = [];
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string') continue;
    pieces.push(item.str);
    if (item.hasEOL) pieces.push('\n');
  }
  return pieces.join('');
}

/** Count matches in the text items returned by PDF.js. */
export function countTextContentMatches(items, query, matchCase = false) {
  return countMatches(getSearchableText(items), query, matchCase);
}

const PAGE_TEXT_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const PAGE_TEXT_CACHE_MAX_PAGES = 2048;

/** Small LRU of extracted searchable text; both strings are included in its budget. */
class PageTextCache {
  constructor() {
    this.entries = new Map();
    this.bytes = 0;
  }

  get(pageNumber) {
    const entry = this.entries.get(pageNumber);
    if (!entry) return null;
    this.entries.delete(pageNumber);
    this.entries.set(pageNumber, entry);
    return entry;
  }

  set(pageNumber, entry) {
    const bytes = (entry.text.length + entry.comparisonText.length) * 2;
    if (bytes > PAGE_TEXT_CACHE_MAX_BYTES) return false;
    this.delete(pageNumber);
    while (
      this.entries.size >= PAGE_TEXT_CACHE_MAX_PAGES ||
      this.bytes + bytes > PAGE_TEXT_CACHE_MAX_BYTES
    ) {
      const oldestPage = this.entries.keys().next().value;
      if (oldestPage === undefined) break;
      this.delete(oldestPage);
    }
    this.entries.set(pageNumber, { ...entry, bytes });
    this.bytes += bytes;
    return true;
  }

  delete(pageNumber) {
    const entry = this.entries.get(pageNumber);
    if (!entry) return;
    this.entries.delete(pageNumber);
    this.bytes -= entry.bytes;
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

/** Gather text-layer span ranges in document order, preserving explicit BRs. */
function collectTextLayerSegments(layer) {
  const segments = [];
  let text = '';
  const showElement = layer.ownerDocument?.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
  const walker = document.createTreeWalker(layer, showElement);
  let node = walker.nextNode();
  while (node) {
    if (node.tagName === 'BR') {
      text += '\n';
    } else if (node.tagName === 'SPAN' && !node.querySelector('span')) {
      const value = node.textContent || '';
      const start = text.length;
      text += value;
      segments.push({ node, start, end: text.length, value });
    }
    node = walker.nextNode();
  }
  return { text, segments };
}

// ---------------------------------------------------------------------------
// SearchController — drives document search + highlighting in the renderer
// ---------------------------------------------------------------------------

export class SearchController {
  /**
   * @param {object} deps
   * @param {() => object|null} deps.getDoc - current PDFDocumentProxy or null
   * @param {() => number} deps.getCurrentPage
   * @param {(n:number) => Promise<void>} deps.goToPage
   * @param {() => HTMLElement|null} deps.getTextLayerEl
   * @param {(msg:string) => void} deps.onStatus - status line updates
   * @param {(msg:string) => void} deps.onCount - "x of y" label updates
   */
  constructor(deps) {
    this.deps = deps;
    this.query = '';
    this.matchCase = false;
    this.pageMatches = null; // 1-based: pageMatches[p] = { count }
    this.total = 0;
    this.numPages = 0;
    this.current = null; // { page, index } — index within page
    this.searchToken = 0;
    this.searching = false;
    this.pageTextCache = new PageTextCache();
    this.cachedDoc = null;
  }

  /** Start (or restart) a document search for `query`. */
  async setQuery(rawQuery) {
    const q = normalizeStr(rawQuery);
    if (q === this.query) return;
    this.searchToken += 1;
    const token = this.searchToken;
    this.query = q;
    this.pageMatches = null;
    this.total = 0;
    this.current = null;

    this.clearMarks();
    if (!q) {
      this.deps.onCount('');
      return;
    }

    const doc = this.deps.getDoc();
    if (!doc) {
      this.pageTextCache.clear();
      this.cachedDoc = null;
      return;
    }
    if (this.cachedDoc !== doc) {
      this.pageTextCache.clear();
      this.cachedDoc = doc;
    }
    this.searching = true;
    const n = doc.numPages;
    this.numPages = n;
    const pageMatches = new Array(n + 1).fill(null);
    let total = 0;

    for (let p = 1; p <= n; p++) {
      if (token !== this.searchToken) return; // superseded / cancelled
      try {
        const count = await this.#countPageMatches(doc, p, q, token);
        pageMatches[p] = { count };
        total += count;
      } catch (err) {
        console.warn(`Search: failed to index page ${p}:`, err);
        pageMatches[p] = { count: 0 };
      }
      if (p === n || p % 5 === 0) {
        this.deps.onStatus(`Searching… page ${p} of ${n}`);
      }
    }

    if (token !== this.searchToken) return;
    this.pageMatches = pageMatches;
    this.total = total;
    this.searching = false;

    if (total === 0) {
      this.deps.onCount('No matches');
      this.deps.onStatus(`No matches for “${truncate(q, 40)}”`);
      return;
    }

    // Jump to the first match on or after the current page (wrapping).
    const startPage = this.deps.getCurrentPage();
    let target = startPage;
    for (let i = 0; i < n; i++) {
      const p = ((startPage - 1 + i) % n) + 1;
      if (pageMatches[p].count > 0) {
        target = p;
        break;
      }
    }
    this.current = { page: target, index: 0 };
    if (target !== startPage) {
      await this.deps.goToPage(target); // renders, then calls applyHighlights
    } else {
      this.applyHighlights();
    }
    this.updateCount();
    this.deps.onStatus(
      `${total} match${total === 1 ? '' : 'es'} for “${truncate(q, 40)}”`
    );
    this.deps.onMarksChanged?.();
  }

  /**
   * Turn case-sensitive matching on or off and re-run the current query. The
   * comparison text is rebuilt per page (the page text cache is reused).
   */
  async setMatchCase(enabled) {
    const next = Boolean(enabled);
    if (next === this.matchCase) return;
    this.matchCase = next;
    const requery = this.query;
    if (!requery) {
      this.deps.onCount('');
      return;
    }
    // Force setQuery to run the same needle again with the new comparison.
    this.query = '';
    await this.setQuery(requery);
  }

  async #countPageMatches(doc, pageNum, query, token) {
    let pageText = this.pageTextCache.get(pageNum);
    if (!pageText) {
      const page = await doc.getPage(pageNum);
      try {
        if (!this.#isCurrentSearch(token, doc)) return 0;
        const textContent = await page.getTextContent();
        if (!this.#isCurrentSearch(token, doc)) return 0;
        const text = getSearchableText(textContent.items);
        const comparison = buildComparisonText(text, this.matchCase);
        pageText = {
          text,
          comparisonText: comparison.text,
          requiresDedup: comparison.requiresDedup,
          matchCase: this.matchCase,
        };
        this.pageTextCache.set(pageNum, pageText);
      } finally {
        try {
          page.cleanup();
        } catch (_) {
          // ignore — cleanup is best-effort
        }
      }
    } else if (pageText.matchCase !== this.matchCase) {
      const comparison = buildComparisonText(pageText.text, this.matchCase);
      pageText = {
        ...pageText,
        comparisonText: comparison.text,
        requiresDedup: comparison.requiresDedup,
        matchCase: this.matchCase,
      };
      this.pageTextCache.set(pageNum, pageText);
    }

    if (pageText.requiresDedup) return countMatches(pageText.text, query, this.matchCase);
    return countComparisonMatches(pageText.comparisonText, query, this.matchCase);
  }

  #isCurrentSearch(token, doc) {
    return token === this.searchToken && doc === this.deps.getDoc() && this.cachedDoc === doc;
  }

  /** Move to the next match (wrapping around the document). */
  async next() {
    if (!this.total || !this.pageMatches) return;
    const token = this.searchToken;
    let { page, index } = this.current;
    index += 1;
    if (index >= this.pageMatches[page].count) {
      page = this.#findPageWithMatches(page, 1);
      index = 0;
    }
    this.current = { page, index };
    if (token !== this.searchToken) return;
    if (page !== this.deps.getCurrentPage()) {
      await this.deps.goToPage(page);
    } else {
      this.applyHighlights();
    }
    this.updateCount();
    this.deps.onMarksChanged?.();
  }

  /** Move to the previous match (wrapping around the document). */
  async prev() {
    if (!this.total || !this.pageMatches) return;
    const token = this.searchToken;
    let { page, index } = this.current;
    index -= 1;
    if (index < 0) {
      page = this.#findPageWithMatches(page, -1);
      index = this.pageMatches[page].count - 1;
    }
    this.current = { page, index };
    if (token !== this.searchToken) return;
    if (page !== this.deps.getCurrentPage()) {
      await this.deps.goToPage(page);
    } else {
      this.applyHighlights();
    }
    this.updateCount();
    this.deps.onMarksChanged?.();
  }

  #findPageWithMatches(fromPage, dir) {
    const n = this.numPages;
    for (let i = 1; i <= n; i++) {
      const p = ((fromPage - 1 + dir * i + n * i) % n) + 1;
      if (this.pageMatches[p] && this.pageMatches[p].count > 0) return p;
    }
    return fromPage;
  }

  /**
   * Highlight all matches in one text layer and mark the current one. Called
   * after every text-layer render while a query is active. Defaults to the
   * page on screen (single-page mode); continuous mode passes the page and
   * text layer of each rendered slot. Safe to call with no query (clears
   * marks).
   */
  applyHighlights({ page = this.deps.getCurrentPage(), textLayerEl = this.deps.getTextLayerEl() } = {}) {
    const tl = textLayerEl;
    if (!tl) return;
    this.clearMarks(tl);
    if (!this.query || !this.total || !this.pageMatches) return;

    const pm = this.pageMatches[page];
    if (!pm || pm.count === 0) return;

    const currentIndex =
      this.current && this.current.page === page ? this.current.index : -1;
    const { text, segments } = collectTextLayerSegments(tl);
    const matches = findAllMatches(text, this.query, this.matchCase);
    const rangesBySegment = segments.map(() => []);

    matches.forEach((match, ordinal) => {
      if (!verifyMatch(text, match.index, match.length, this.query, this.matchCase)) return;
      const matchEnd = match.index + match.length;
      segments.forEach((segment, segmentIndex) => {
        const start = Math.max(match.index, segment.start);
        const end = Math.min(matchEnd, segment.end);
        if (start < end) {
          rangesBySegment[segmentIndex].push({
            start: start - segment.start,
            end: end - segment.start,
            ordinal,
          });
        }
      });
    });

    let currentMarked = false;
    segments.forEach((segment, segmentIndex) => {
      const ranges = rangesBySegment[segmentIndex];
      if (!ranges.length) return;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const range of ranges) {
        if (range.start > cursor) {
          frag.appendChild(document.createTextNode(segment.value.slice(cursor, range.start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = segment.value.slice(range.start, range.end);
        if (range.ordinal === currentIndex && !currentMarked) {
          mark.classList.add('current');
          currentMarked = true;
        }
        frag.appendChild(mark);
        cursor = range.end;
      }
      if (cursor < segment.value.length) {
        frag.appendChild(document.createTextNode(segment.value.slice(cursor)));
      }
      segment.node.textContent = '';
      segment.node.appendChild(frag);
    });

    // Only drag the viewport for the page the reader is on: pages rendered
    // ahead must not steal the scroll position.
    const current = tl.querySelector('mark.search-highlight.current');
    if (
      page === this.deps.getCurrentPage() &&
      current &&
      typeof current.scrollIntoView === 'function'
    ) {
      current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** Remove all highlight marks from one text layer. */
  clearMarks(textLayerEl = this.deps.getTextLayerEl()) {
    const tl = textLayerEl;
    if (!tl) return;
    const marks = tl.querySelectorAll('mark.search-highlight');
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
  }

  /**
   * Called by the renderer after a manual page change: if the new page
   * holds matches, make its first match current so next/prev continue
   * intuitively from where the user navigated.
   */
  syncCurrentToPage(page) {
    if (!this.total || !this.pageMatches) return;
    if (this.current && this.current.page === page) return;
    const pm = this.pageMatches[page];
    if (pm && pm.count > 0) {
      this.current = { page, index: 0 };
      this.updateCount();
    }
  }

  /** 1-based ordinal of the current match across the whole document. */
  currentOrdinal() {
    if (!this.total || !this.current) return 0;
    let ord = 0;
    for (let p = 1; p < this.current.page; p++) {
      ord += this.pageMatches[p] ? this.pageMatches[p].count : 0;
    }
    return ord + this.current.index + 1;
  }

  updateCount() {
    if (!this.query) {
      this.deps.onCount('');
      return;
    }
    if (!this.total) {
      this.deps.onCount('No matches');
      return;
    }
    this.deps.onCount(`${this.currentOrdinal()} of ${this.total}`);
  }

  hasMatches(page) {
    return !!(
      this.pageMatches &&
      this.pageMatches[page] &&
      this.pageMatches[page].count > 0
    );
  }

  /** Clear the query, state and highlights (keeps the search UI as-is). */
  clear() {
    this.searchToken += 1;
    this.query = '';
    this.pageMatches = null;
    this.total = 0;
    this.current = null;
    this.searching = false;
    this.clearMarks();
    this.deps.onCount('');
    this.deps.onMarksChanged?.();
  }

  /** Drop query state and every retained page string when a document closes. */
  clearDocument() {
    this.clear();
    this.pageTextCache.clear();
    this.cachedDoc = null;
  }

  /** Cancel an in-flight search without touching the UI. */
  cancel() {
    this.searchToken += 1;
    this.searching = false;
  }
}

function truncate(s, maxLen) {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}
