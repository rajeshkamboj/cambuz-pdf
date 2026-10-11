// Cambuz PDF Reader — continuous scroll view (DOM layer).
//
// Continuous mode stacks every page in one scrollable column and keeps only the
// pages around the reading line alive: a page is a placeholder box until it
// scrolls into view, rendered pages outside the window are dropped (their canvas
// backing store is freed), and the page under the reading line is reported back
// to the renderer so the toolbar, status bar, sidebar, recents and search all
// keep following the document.
//
// The geometry itself lives in continuous-layout.js. This file owns the DOM:
// slots, canvases, scroll handling, render queue and cancellation.

import {
  PAGE_GAP,
  createMetrics,
  pageAtAnchor,
  visiblePageRange,
  scrollTopForPage,
  limitToCanvasBudget,
} from './continuous-layout.js';

/** Blank space above page 1 and below the last page, matching single-page mode. */
export const COLUMN_PAD = 20;

export class ContinuousView {
  /**
   * @param {object} options
   * @param {HTMLElement} options.viewerEl  the scrolling container (#pdf-viewer)
   * @param {HTMLElement} options.columnEl  the absolutely-positioned column (#pdf-column)
   * @param {object} options.deps
   * @param {(pageNum:number) => ({width:number,height:number}|null)} options.deps.displaySize
   *        page size in CSS px at the current scale/rotation, or null if unknown
   * @param {(pageNum:number) => Promise<({width:number,height:number}|null)>} options.deps.measurePage
   *        read and cache the page's unrotated size
   * @param {(pageNum:number, slot:object, token:object) => Promise<({width:number,height:number}|undefined)>} options.deps.renderPage
   *        paint one page into `slot.canvas` + `slot.textLayer`; must respect `token.cancelled`
   * @param {(pageNum:number) => void} [options.deps.onCurrentPageChange]
   * @param {(pageNum:number, slot:object) => void} [options.deps.onRendered]
   * @param {(msg:string) => void} [options.deps.onStatus]
   */
  constructor({ viewerEl, columnEl, deps }) {
    this.viewerEl = viewerEl;
    this.columnEl = columnEl;
    this.deps = deps;
    this.mounted = false;
    this.totalPages = 0;
    this.currentPage = 1;
    this.metrics = createMetrics({ totalPages: 0 });
    this.slots = new Map();
    this.generation = 0;
    // Page sizes do not depend on the zoom, so the measurement pass gets its
    // own token: re-layouting must not stop it.
    this.measureToken = 0;
    this.rendering = false;
    this.frame = null;
    this.measuring = false;
    this.textLayerClasses = new Set();
    this.onScroll = () => this.scheduleSync();
  }

  // --- lifecycle -----------------------------------------------------------

  /** Build the column for a document and reveal `startPage`. */
  async mount({ totalPages, startPage = 1 }) {
    this.unmount();
    this.mounted = true;
    this.measureToken += 1;
    this.totalPages = Math.max(0, Math.floor(Number(totalPages) || 0));
    this.currentPage = Math.min(this.totalPages || 1, Math.max(1, Math.floor(Number(startPage) || 1)));
    this.generation += 1;
    this.viewerEl.classList.add('continuous');
    this.columnEl.hidden = false;
    this.viewerEl.addEventListener('scroll', this.onScroll, { passive: true });

    // Measure the page we are about to show (and its neighbours) so the first
    // layout has real heights instead of placeholders.
    await this.measureAround(this.currentPage, 1);
    if (!this.mounted) return;
    this.metrics = this.buildMetrics();
    this.columnEl.style.height = `${this.metrics.totalHeight}px`;
    this.scrollToPage(this.currentPage);
    this.sync();
    await this.ensurePageReady(this.currentPage);
    if (!this.mounted) return;
    // Everything else is measured in the background; the column re-anchors as
    // each height becomes exact.
    this.measureAll();
  }

  unmount() {
    this.mounted = false;
    this.generation += 1;
    this.measureToken += 1;
    this.viewerEl.removeEventListener('scroll', this.onScroll);
    if (this.frame !== null) {
      cancelAnimationFrameSafe(this.frame);
      this.frame = null;
    }
    this.viewerEl.classList.remove('continuous');
    for (const pageNum of [...this.slots.keys()]) this.dropSlot(pageNum);
    this.columnEl.hidden = true;
    this.columnEl.style.height = '';
    this.columnEl.replaceChildren();
    this.totalPages = 0;
    this.metrics = createMetrics({ totalPages: 0 });
  }

  /** Set a class on every page's text layer (e.g. copy protection). */
  setTextLayerClass(className, enabled) {
    if (enabled) this.textLayerClasses.add(className);
    else this.textLayerClasses.delete(className);
    for (const slot of this.slots.values()) {
      slot.textLayer.classList.toggle(className, enabled);
    }
  }

  // --- geometry ------------------------------------------------------------

  buildMetrics() {
    return createMetrics({
      totalPages: this.totalPages,
      pad: COLUMN_PAD,
      gap: PAGE_GAP,
      sizeAt: (pageNum) => this.deps.displaySize?.(pageNum) ?? null,
    });
  }

  viewerHeight() {
    return this.viewerEl.clientHeight || 0;
  }

  maxScrollTop() {
    return Math.max(0, this.metrics.totalHeight - this.viewerHeight());
  }

  /** Recompute the column after a zoom/rotation change or new measurements. */
  refreshMetrics({ anchorPage = this.currentPage } = {}) {
    const previousTop = this.metrics.tops?.[Math.min(anchorPage, this.metrics.tops.length) - 1] ?? 0;
    this.metrics = this.buildMetrics();
    this.columnEl.style.height = `${this.metrics.totalHeight}px`;
    const nextTop = this.metrics.tops?.[Math.min(anchorPage, this.metrics.tops.length) - 1] ?? 0;
    if (nextTop !== previousTop) {
      // Keep the reader on the same part of the same page while heights above
      // (or the anchor page itself) change.
      this.viewerEl.scrollTop = Math.min(
        Math.max(0, this.viewerEl.scrollTop + (nextTop - previousTop)),
        this.maxScrollTop()
      );
    }
    this.layoutSlots();
  }

  /** Position every live slot at its place in the column. */
  layoutSlots() {
    for (const slot of this.slots.values()) {
      const top = this.metrics.tops?.[slot.pageNum - 1];
      if (top === undefined) continue;
      const size = slot.renderedSize ?? this.deps.displaySize?.(slot.pageNum) ?? null;
      slot.el.style.top = `${top}px`;
      if (size) {
        slot.el.style.width = `${Math.floor(size.width)}px`;
        slot.el.style.height = `${Math.floor(size.height)}px`;
        // Keep the (possibly stale) bitmap stretched to the new box until the
        // re-render lands, so the column never collapses.
        slot.canvas.style.width = `${Math.floor(size.width)}px`;
        slot.canvas.style.height = `${Math.floor(size.height)}px`;
      }
    }
  }

  /** Re-render the visible window at the current zoom/rotation. */
  async relayout({ anchorPage = this.currentPage } = {}) {
    if (!this.mounted) return;
    // Anything in flight was drawn at the previous zoom/rotation.
    this.generation += 1;
    this.refreshMetrics({ anchorPage });
    for (const slot of [...this.slots.values()]) {
      if (slot.token) {
        slot.token.cancelled = true;
        try {
          slot.token.task?.cancel?.();
        } catch (_) {
          // The task may have finished between the read and the cancel.
        }
        slot.token = null;
      }
      slot.renderedSize = null;
      slot.state = 'stale';
      this.resolveSlot(slot);
    }
    this.sync();
    await this.ensurePageReady(anchorPage);
  }

  // --- navigation ----------------------------------------------------------

  scrollToPage(pageNum, { center = false } = {}) {
    this.viewerEl.scrollTop = scrollTopForPage(this.metrics, pageNum, {
      viewportHeight: this.viewerHeight(),
      center,
      maxScrollTop: this.maxScrollTop(),
    });
  }

  /** Scroll to a page, render it, and resolve once it is on screen. */
  async goToPage(pageNum, { center = false } = {}) {
    if (!this.mounted) return;
    const page = Math.min(this.totalPages || 1, Math.max(1, Math.floor(Number(pageNum) || 1)));
    await this.measureAround(page, 1);
    if (!this.mounted) return;
    this.refreshMetrics({ anchorPage: page });
    this.scrollToPage(page, { center });
    this.sync();
    await this.ensurePageReady(page);
  }

  /** Scroll by a number of viewport heights (Space / PageUp / PageDown). */
  scrollByViewport(direction = 1) {
    const height = this.viewerHeight() || 1;
    const step = Math.max(40, height - 40);
    this.viewerEl.scrollTop = Math.min(
      Math.max(0, this.viewerEl.scrollTop + direction * step),
      this.maxScrollTop()
    );
    this.sync();
  }

  /** Pages currently rendered or queued, nearest-first by page number. */
  livePages() {
    return [...this.slots.keys()].sort((a, b) => a - b);
  }

  // --- scroll tracking -----------------------------------------------------

  scheduleSync() {
    if (!this.mounted || this.frame !== null) return;
    this.frame = requestAnimationFrameSafe(() => {
      this.frame = null;
      this.sync();
    });
  }

  /** Follow the scroll position: report the reading page and fix the window. */
  sync() {
    if (!this.mounted || !this.totalPages) return;
    const scrollTop = this.viewerEl.scrollTop;
    const viewportHeight = this.viewerHeight();
    const anchor = pageAtAnchor(this.metrics, scrollTop, viewportHeight);
    if (anchor !== this.currentPage) {
      this.currentPage = anchor;
      this.deps.onCurrentPageChange?.(anchor);
    }
    const range = visiblePageRange(this.metrics, scrollTop, viewportHeight, {
      totalPages: this.totalPages,
    });
    this.keepPages(limitToCanvasBudget(range.pages, anchor));
  }

  /** Create/queue slots for `pages`, drop everything else. */
  keepPages(pages) {
    const wanted = new Set(pages);
    for (const pageNum of [...this.slots.keys()]) {
      if (!wanted.has(pageNum)) this.dropSlot(pageNum);
    }
    for (const pageNum of pages) {
      if (!this.slots.has(pageNum)) this.createSlot(pageNum);
    }
    this.pump();
  }

  // --- slots ---------------------------------------------------------------

  createSlot(pageNum) {
    const el = document.createElement('div');
    el.className = 'page-slot';
    el.dataset.page = String(pageNum);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `Page ${pageNum}`);

    const canvas = document.createElement('canvas');
    canvas.className = 'page-slot-canvas';

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer page-slot-text';
    textLayer.setAttribute('aria-label', `Page ${pageNum} text`);
    for (const className of this.textLayerClasses) textLayer.classList.add(className);

    const placeholder = document.createElement('div');
    placeholder.className = 'page-slot-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = String(pageNum);
    placeholder.appendChild(label);

    el.append(canvas, textLayer, placeholder);
    this.columnEl.appendChild(el);

    const slot = {
      pageNum,
      el,
      canvas,
      textLayer,
      placeholder,
      state: 'empty',
      token: null,
      renderedSize: null,
      waiters: [],
      renderPromise: null,
    };
    this.slots.set(pageNum, slot);
    const top = this.metrics.tops?.[pageNum - 1];
    if (top !== undefined) el.style.top = `${top}px`;
    const size = this.deps.displaySize?.(pageNum) ?? null;
    if (size) {
      el.style.width = `${Math.floor(size.width)}px`;
      el.style.height = `${Math.floor(size.height)}px`;
    } else {
      // A page that scrolled into view before the background pass reached it:
      // measure it now so the placeholder gets its real size.
      const token = this.measureToken;
      Promise.resolve(this.deps.measurePage?.(pageNum))
        .then(() => {
          if (!this.mounted || token !== this.measureToken) return;
          this.refreshMetrics();
        })
        .catch(() => {});
    }
    return slot;
  }

  dropSlot(pageNum) {
    const slot = this.slots.get(pageNum);
    if (!slot) return;
    this.slots.delete(pageNum);
    if (slot.token) {
      slot.token.cancelled = true;
      try {
        slot.token.task?.cancel?.();
      } catch (_) {
        // A render task can finish between the cancel and the timer.
      }
    }
    this.releaseCanvas(slot);
    slot.el.remove();
    this.resolveSlot(slot);
  }

  releaseCanvas(slot) {
    slot.canvas.width = 0;
    slot.canvas.height = 0;
    slot.canvas.style.width = '';
    slot.canvas.style.height = '';
    slot.textLayer.textContent = '';
  }

  // --- render queue --------------------------------------------------------

  /** Nearest page waiting for paint, or null when the window is up to date. */
  nextRenderable() {
    let best = null;
    for (const slot of this.slots.values()) {
      if (slot.state !== 'empty' && slot.state !== 'stale') continue;
      const distance = Math.abs(slot.pageNum - this.currentPage);
      if (!best || distance < best.distance || (distance === best.distance && slot.pageNum < best.slot.pageNum)) {
        best = { slot, distance };
      }
    }
    return best ? best.slot : null;
  }

  /** Resolve when a page has been painted (resolves as soon as it is rendered). */
  ensurePageReady(pageNum) {
    if (!this.mounted) return Promise.resolve();
    const page = Math.min(this.totalPages || 1, Math.max(1, Math.floor(Number(pageNum) || 1)));
    const slot = this.slots.get(page);
    if (!slot || slot.state === 'rendered') return Promise.resolve();
    if (!slot.renderPromise) {
      slot.renderPromise = new Promise((resolve) => slot.waiters.push(resolve));
    }
    this.pump();
    return slot.renderPromise;
  }

  resolveSlot(slot) {
    for (const resolve of slot.waiters.splice(0)) resolve();
    slot.renderPromise = null;
  }

  /**
   * Paint the window one page at a time, always the page nearest the reading
   * line first. The loop re-scans the live slots on every pass, so a page that
   * became stale while another render was running is picked up again.
   */
  async pump() {
    if (this.rendering || !this.mounted) return;
    this.rendering = true;
    try {
      let slot = this.nextRenderable();
      while (slot && this.mounted) {
        await this.renderSlot(slot);
        if (!this.mounted) return;
        slot = this.nextRenderable();
      }
    } finally {
      this.rendering = false;
    }
  }

  async renderSlot(slot) {
    const generation = this.generation;
    slot.state = 'rendering';
    const token = { cancelled: false, task: null };
    slot.token = token;
    try {
      const size = await this.deps.renderPage(slot.pageNum, slot, token);
      if (generation !== this.generation || token.cancelled || !this.slots.has(slot.pageNum)) return;
      if (size && size.width > 0 && size.height > 0) {
        slot.renderedSize = size;
        slot.el.style.width = `${Math.floor(size.width)}px`;
        slot.el.style.height = `${Math.floor(size.height)}px`;
      }
      slot.state = 'rendered';
      slot.el.classList.add('page-slot-rendered');
      const top = this.metrics.tops?.[slot.pageNum - 1];
      if (top !== undefined) slot.el.style.top = `${top}px`;
      this.deps.onRendered?.(slot.pageNum, slot);
    } catch (error) {
      if (generation !== this.generation || token.cancelled) return;
      if (error && error.name === 'RenderingCancelledException') return;
      slot.state = 'error';
      slot.el.classList.add('page-slot-error');
      this.deps.onStatus?.(`Page ${slot.pageNum} could not be rendered.`);
    } finally {
      if (slot.token === token) {
        slot.token = null;
        this.resolveSlot(slot);
      }
    }
  }

  // --- measurement ---------------------------------------------------------

  /** Measure `pageNum` ± radius before using their heights. */
  async measureAround(pageNum, radius = 1) {
    const first = Math.max(1, pageNum - radius);
    const last = Math.min(this.totalPages || 1, pageNum + radius);
    for (let page = first; page <= last; page += 1) {
      await this.deps.measurePage?.(page);
    }
  }

  /**
   * Measure the remaining pages in the background so that unseen geometry is
   * exact. Work is taken in small chunks, nearest the reading page first and
   * re-ordered after every chunk — so a jump to a distant page starts landing
   * on measured geometry within a few frames — and each chunk yields a frame
   * to keep scrolling responsive.
   */
  async measureAll() {
    if (this.measuring) return;
    this.measuring = true;
    const token = this.measureToken;
    const CHUNK = 16;
    try {
      for (;;) {
        if (!this.mounted || token !== this.measureToken) return;
        const pending = [];
        for (let page = 1; page <= this.totalPages; page += 1) {
          if (!this.deps.displaySize?.(page)) pending.push(page);
        }
        if (!pending.length) return;
        pending.sort(
          (a, b) =>
            Math.abs(a - this.currentPage) - Math.abs(b - this.currentPage) || a - b
        );
        let measuredInChunk = false;
        for (const page of pending.slice(0, CHUNK)) {
          if (!this.mounted || token !== this.measureToken) return;
          await this.deps.measurePage?.(page);
          measuredInChunk = true;
        }
        if (!this.mounted || token !== this.measureToken) return;
        if (measuredInChunk) {
          this.refreshMetrics();
          this.sync();
        }
        await yieldToBrowser();
      }
    } finally {
      this.measuring = false;
    }
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function requestAnimationFrameSafe(callback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16);
}

function cancelAnimationFrameSafe(handle) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}
