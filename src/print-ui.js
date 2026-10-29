// Cambuz PDF Reader — print preparation and preview controller.
//
// Cambuz prepares one PDF artifact and previews that exact byte sequence. The
// desktop app can save it or, only after an explicit click, open it in the OS
// registered PDF viewer. Printer selection, copies, duplex/manual duplex,
// device preferences and print cancellation belong to that viewer and Windows.

import {
  PAPER_SIZES,
  PRINT_DEFAULTS,
  buildPrintPdf,
  getPaperDimensions,
  grayscaleRgbaInPlace,
  normalizePrintSettings,
  summarizePrintJob,
} from './printing.js';

const MAX_INK_SAVER_PIXELS = 18_000_000;
const MAX_INK_SAVER_DIMENSION = 10_000;
const INK_SAVER_DPI = 200;

const PRESETS = Object.freeze({
  'a4-fit': {
    paperSize: 'A4', orientation: 'portrait', scaling: 'fit',
    marginMode: 'normal', pagesPerSheet: 1, inkSaver: false,
  },
  actual: {
    paperSize: 'A4', orientation: 'portrait', scaling: 'actual',
    customScale: 100, marginMode: 'normal', pagesPerSheet: 1, inkSaver: false,
  },
  'two-up': {
    paperSize: 'A4', orientation: 'landscape', scaling: 'fit',
    marginMode: 'normal', pagesPerSheet: 2, inkSaver: false,
  },
  'four-up': {
    paperSize: 'A4', orientation: 'portrait', scaling: 'fit',
    marginMode: 'normal', pagesPerSheet: 4, inkSaver: false,
  },
  'ink-saver': {
    paperSize: 'A4', orientation: 'portrait', scaling: 'fit',
    marginMode: 'normal', pagesPerSheet: 1, inkSaver: true,
  },
});

function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Print interface is missing #${id}`);
  return found;
}

export class PrintController {
  constructor({
    pdfjsLib,
    standardFontDataUrl,
    getDoc,
    getSourceBytes,
    getCurrentPage,
    getTotalPages,
    getDocumentName,
    getDocumentGeneration,
    onStatus = () => {},
  }) {
    this.pdfjsLib = pdfjsLib;
    this.standardFontDataUrl = standardFontDataUrl;
    this.getDoc = getDoc;
    this.getSourceBytes = getSourceBytes;
    this.getCurrentPage = getCurrentPage;
    this.getTotalPages = getTotalPages;
    this.getDocumentName = getDocumentName;
    this.getDocumentGeneration = getDocumentGeneration;
    this.onStatus = onStatus;

    this.ui = {
      dialog: element('print-dialog'),
      toolbarButton: element('btn-print'),
      documentLabel: element('print-document-label'),
      closeButton: element('btn-print-close'),
      cancelButton: element('btn-print-cancel'),
      openSystemButton: element('btn-print-open-system'),
      openSystemLabel: element('print-open-system-label'),
      downloadButton: element('btn-print-download'),
      preset: element('print-preset'),
      pageModes: [...document.querySelectorAll('input[name="print-page-mode"]')],
      currentPageLabel: element('print-current-page-label'),
      pageRange: element('print-page-range'),
      rangeError: element('print-range-error'),
      paper: element('print-paper'),
      orientation: element('print-orientation'),
      pagesPerSheet: element('print-pages-per-sheet'),
      scaling: element('print-scaling'),
      customScaleRow: element('print-custom-scale-row'),
      customScale: element('print-custom-scale'),
      margins: element('print-margins'),
      customMarginRow: element('print-custom-margin-row'),
      customMargin: element('print-custom-margin'),
      inkSaver: element('print-ink-saver'),
      settingsError: element('print-settings-error'),
      previewSummary: element('print-preview-summary'),
      previewPrevious: element('btn-print-preview-prev'),
      previewNext: element('btn-print-preview-next'),
      previewPage: element('print-preview-page'),
      previewTotal: element('print-preview-total'),
      previewStage: element('print-preview-stage'),
      previewPlaceholder: element('print-preview-placeholder'),
      previewCanvas: element('print-preview-canvas'),
      previewCaption: element('print-preview-caption'),
      status: element('print-status'),
    };

    this.opened = false;
    this.busy = false;
    this.settings = { ...PRINT_DEFAULTS };
    this.settingsInitialized = false;
    this.previewDoc = null;
    this.previewRenderTask = null;
    this.previewPageNumber = 1;
    this.previewBuildTimer = null;
    this.previewBuildVersion = 0;
    this.previewBuildQueue = Promise.resolve();
    this.latestPdfBytes = null;
    this.latestPreviewKey = '';
    this.browserPdfUrls = new Set();
    this.resizeTimer = null;

    this.bindEvents();

    // If Cambuz itself is the registered PDF application, shell.openPath would
    // otherwise send the prepared copy back into this window. main.js blocks
    // that replacement and reports it here so the original remains open.
    const api = window.cambuzAPI;
    if (typeof api?.onSystemViewerUnavailable === 'function') {
      api.onSystemViewerUnavailable((_event, details) => {
        if (!this.opened) return;
        this.setStatus(
          details?.message || 'Cambuz is the default PDF app. Save the print-ready PDF and open it with another PDF viewer to print.',
          true
        );
      });
    }
  }

  get isOpen() {
    return this.opened;
  }

  bindEvents() {
    this.ui.toolbarButton.addEventListener('click', () => this.open());
    this.ui.closeButton.addEventListener('click', () => this.close(true));
    this.ui.cancelButton.addEventListener('click', () => this.close(true));
    this.ui.dialog.addEventListener('click', (event) => {
      if (event.target === this.ui.dialog && !this.busy) this.close(true);
    });
    this.ui.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') this.trapFocus(event);
    });
    this.ui.openSystemButton.addEventListener('click', () => this.openInSystemViewer());
    this.ui.downloadButton.addEventListener('click', () => this.downloadPdf());
    this.ui.previewPrevious.addEventListener('click', () => this.showPreviewPage(this.previewPageNumber - 1));
    this.ui.previewNext.addEventListener('click', () => this.showPreviewPage(this.previewPageNumber + 1));

    for (const radio of this.ui.pageModes) {
      radio.addEventListener('change', () => this.onSettingsChanged());
    }
    for (const control of [
      this.ui.pageRange,
      this.ui.paper,
      this.ui.orientation,
      this.ui.pagesPerSheet,
      this.ui.scaling,
      this.ui.customScale,
      this.ui.margins,
      this.ui.customMargin,
      this.ui.inkSaver,
    ]) {
      control.addEventListener('input', () => this.onSettingsChanged());
      control.addEventListener('change', () => this.onSettingsChanged());
    }

    this.ui.preset.addEventListener('change', () => this.applyPreset(this.ui.preset.value));
    window.addEventListener('resize', () => {
      if (!this.opened || !this.previewDoc) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.renderPreviewPage(), 120);
    });
  }

  trapFocus(event) {
    const focusable = [...this.ui.dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((control) => !control.closest('[hidden]') && window.getComputedStyle(control).display !== 'none');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async open() {
    const doc = this.getDoc();
    if (!doc || !this.getSourceBytes()) {
      this.setStatus('Open a PDF before preparing it for printing.', true);
      return;
    }
    if (this.opened) return;

    this.opened = true;
    this.ui.dialog.style.display = 'flex';
    this.ui.documentLabel.textContent = `${this.getDocumentName()} · ${this.getTotalPages()} page${this.getTotalPages() === 1 ? '' : 's'}`;
    this.ui.currentPageLabel.textContent = `(page ${this.getCurrentPage()} of ${this.getTotalPages()})`;
    this.setStatus('Preparing print-ready PDF…');

    if (!this.settingsInitialized) {
      try {
        const page = await doc.getPage(this.getCurrentPage());
        if (!this.opened || this.getDoc() !== doc) return;
        const viewport = page.getViewport({ scale: 1 });
        this.settings = {
          ...PRINT_DEFAULTS,
          orientation: viewport.width > viewport.height ? 'landscape' : 'portrait',
        };
      } catch (_) {
        this.settings = { ...PRINT_DEFAULTS };
      }
      this.settingsInitialized = true;
    }

    this.applySettingsToForm(this.settings);
    this.schedulePreview(true);
    requestAnimationFrame(() => {
      if (this.opened) this.ui.closeButton.focus();
      this.renderPreviewPage();
    });
  }

  close(restoreFocus = true) {
    if (this.busy) return Promise.resolve();
    const wasOpen = this.opened;
    this.opened = false;
    this.previewBuildVersion += 1;
    clearTimeout(this.previewBuildTimer);
    this.ui.dialog.style.display = 'none';
    this.setStatus('', false);
    const cleanup = this.destroyPreview();
    if (restoreFocus && wasOpen) this.ui.toolbarButton.focus();
    return cleanup;
  }

  async destroyPreview() {
    this.previewBuildVersion += 1;
    clearTimeout(this.previewBuildTimer);
    if (this.previewRenderTask) {
      try { this.previewRenderTask.cancel(); } catch (_) { /* already finished */ }
      this.previewRenderTask = null;
    }
    const doc = this.previewDoc;
    this.previewDoc = null;
    this.latestPdfBytes = null;
    this.latestPreviewKey = '';
    this.ui.previewCanvas.style.display = 'none';
    this.ui.previewCanvas.width = 0;
    this.ui.previewCanvas.height = 0;
    this.ui.previewPlaceholder.hidden = false;
    this.ui.previewPage.textContent = '0';
    this.ui.previewTotal.textContent = '0';
    this.ui.previewPrevious.disabled = true;
    this.ui.previewNext.disabled = true;
    this.updateActionState();
    if (doc) {
      try { await doc.destroy(); } catch (_) { /* ignore cleanup errors */ }
    }
  }

  async onDocumentChanged() {
    this.busy = false;
    if (this.opened) await this.close(false);
    else await this.destroyPreview();
    this.settingsInitialized = false;
  }

  readSettings() {
    const selectedMode = this.ui.pageModes.find((radio) => radio.checked);
    return {
      pageMode: selectedMode ? selectedMode.value : 'all',
      pageRange: this.ui.pageRange.value,
      paperSize: this.ui.paper.value,
      orientation: this.ui.orientation.value,
      scaling: this.ui.scaling.value,
      customScale: this.ui.customScale.value,
      marginMode: this.ui.margins.value,
      customMargin: this.ui.customMargin.value,
      pagesPerSheet: this.ui.pagesPerSheet.value,
      inkSaver: this.ui.inkSaver.checked,
    };
  }

  applySettingsToForm(settings) {
    const value = { ...PRINT_DEFAULTS, ...settings };
    for (const radio of this.ui.pageModes) radio.checked = radio.value === value.pageMode;
    this.ui.pageRange.value = value.pageRange || '';
    this.ui.paper.value = value.paperSize;
    this.ui.orientation.value = value.orientation;
    this.ui.scaling.value = value.scaling;
    this.ui.customScale.value = value.customScale;
    this.ui.margins.value = value.marginMode;
    this.ui.customMargin.value = value.customMargin;
    this.ui.pagesPerSheet.value = String(value.pagesPerSheet);
    this.ui.inkSaver.checked = Boolean(value.inkSaver);
    this.updateControlVisibility();
  }

  applyPreset(name) {
    if (name === 'custom') return;
    const preset = PRESETS[name];
    if (!preset) return;
    this.settings = { ...this.readSettings(), ...preset };
    this.applySettingsToForm(this.settings);
    this.onSettingsChanged();
  }

  updateControlVisibility() {
    const mode = this.ui.pageModes.find((radio) => radio.checked)?.value || 'all';
    this.ui.pageRange.disabled = mode !== 'range';
    this.ui.customScaleRow.style.display = this.ui.scaling.value === 'custom' ? 'flex' : 'none';
    this.ui.customMarginRow.style.display = this.ui.margins.value === 'custom' ? 'flex' : 'none';
    this.ui.customScale.disabled = this.ui.scaling.value !== 'custom';
    this.ui.customMargin.disabled = this.ui.margins.value !== 'custom';
  }

  onSettingsChanged() {
    if (!this.opened || this.busy) return;
    this.settings = this.readSettings();
    this.ui.preset.value = 'custom';
    this.updateControlVisibility();
    this.schedulePreview(false);
  }

  previewKey(settings) {
    return `${this.getDocumentGeneration()}:${this.getCurrentPage()}:${JSON.stringify(settings)}`;
  }

  validateSettings(settings) {
    this.ui.rangeError.textContent = '';
    this.ui.settingsError.textContent = '';
    let normalized;
    try {
      normalized = normalizePrintSettings(settings);
    } catch (error) {
      this.ui.settingsError.textContent = error.message;
      return { valid: false, error };
    }
    try {
      const summary = summarizePrintJob(normalized, this.getTotalPages(), this.getCurrentPage());
      return { valid: true, settings: normalized, summary };
    } catch (error) {
      if (normalized.pageMode === 'range') this.ui.rangeError.textContent = error.message;
      else this.ui.settingsError.textContent = error.message;
      return { valid: false, error };
    }
  }

  updateSummary(settings, summary) {
    if (!summary) {
      this.ui.previewSummary.textContent = 'Check the highlighted preparation settings.';
      return;
    }
    const dimensions = getPaperDimensions(settings);
    const paperLabel = PAPER_SIZES[settings.paperSize].label;
    this.ui.previewSummary.textContent =
      `${summary.selectedCount} page${summary.selectedCount === 1 ? '' : 's'} → ` +
      `${summary.sheetCount} prepared sheet${summary.sheetCount === 1 ? '' : 's'}`;
    this.ui.previewCaption.textContent =
      `${paperLabel} ${dimensions.widthMm} × ${dimensions.heightMm} mm · ${settings.orientation} · ` +
      `${settings.pagesPerSheet} page${settings.pagesPerSheet === 1 ? '' : 's'} per sheet · ` +
      `${settings.scaling === 'fit' ? 'Fit to printable area' : settings.scaling === 'actual' ? 'Actual size' : `${settings.customScale}% scale`}` +
      `${settings.inkSaver ? ' · Ink Saver grayscale' : ''}`;
  }

  updateActionState() {
    const validation = this.validateSettings(this.readSettings());
    this.updateSummary(validation.valid ? validation.settings : this.readSettings(), validation.valid ? validation.summary : null);
    const previewReady = Boolean(
      validation.valid && this.latestPdfBytes &&
      this.latestPreviewKey === this.previewKey(validation.settings)
    );
    this.ui.openSystemButton.disabled = !previewReady || this.busy;
    this.ui.downloadButton.disabled = !previewReady || this.busy;
    this.ui.cancelButton.disabled = this.busy;
    this.ui.closeButton.disabled = this.busy;
  }

  schedulePreview(immediate = false) {
    clearTimeout(this.previewBuildTimer);
    const settings = this.readSettings();
    this.settings = settings;
    const validation = this.validateSettings(settings);
    this.updateSummary(validation.valid ? validation.settings : settings, validation.valid ? validation.summary : null);
    this.updateActionState();

    if (!validation.valid) {
      this.latestPreviewKey = '';
      this.setStatus(validation.error.message, true);
      return Promise.resolve(null);
    }

    const key = this.previewKey(validation.settings);
    if (this.latestPdfBytes && this.latestPreviewKey === key) {
      this.updateActionState();
      return Promise.resolve({ bytes: this.latestPdfBytes });
    }

    if (immediate) return this.requestPreview(validation.settings, validation.summary);
    this.setStatus('Updating print-ready PDF…');
    this.ui.previewPlaceholder.hidden = false;
    this.ui.previewCanvas.style.display = 'none';
    this.previewBuildTimer = setTimeout(() => {
      this.requestPreview(validation.settings, validation.summary);
    }, 300);
    return Promise.resolve(null);
  }

  requestPreview(settings, summary) {
    const key = this.previewKey(settings);
    if (this.latestPdfBytes && this.latestPreviewKey === key) {
      return Promise.resolve({ bytes: this.latestPdfBytes });
    }

    const version = ++this.previewBuildVersion;
    const documentGeneration = this.getDocumentGeneration();
    const task = this.previewBuildQueue.catch(() => {}).then(async () => {
      if (!this.opened || version !== this.previewBuildVersion) return null;
      const sourceBytes = this.getSourceBytes();
      if (!sourceBytes) throw new Error('The original PDF bytes are no longer available. Reopen the document to prepare it.');
      this.setStatus('Preparing print-ready PDF…');
      this.ui.previewPlaceholder.hidden = false;
      this.ui.previewPlaceholder.querySelector('p').textContent = 'Building accurate print preview…';
      this.ui.previewCanvas.style.display = 'none';

      const result = await buildPrintPdf({
        sourceBytes,
        settings,
        currentPage: this.getCurrentPage(),
        pageCount: this.getTotalPages(),
        onProgress: ({ stage, progress }) => {
          if (version !== this.previewBuildVersion) return;
          this.setStatus(`${stage}… ${Math.round(progress * 100)}%`);
        },
        renderGrayscalePage: (pageNumber, placementScale, dimensions) =>
          this.renderGrayscalePage(pageNumber, placementScale, dimensions),
      });

      if (!this.opened || version !== this.previewBuildVersion ||
          documentGeneration !== this.getDocumentGeneration()) return null;

      this.latestPdfBytes = result.bytes;
      this.latestPreviewKey = key;
      this.settings = settings;
      this.previewPageNumber = 1;
      await this.loadPreviewDocument(result.bytes, version);
      if (!this.opened || version !== this.previewBuildVersion) return null;

      this.setStatus(`Print-ready PDF prepared · ${result.pageCount} sheet${result.pageCount === 1 ? '' : 's'}`);
      this.updateActionState();
      return result;
    }).catch((error) => {
      if (version === this.previewBuildVersion && this.opened) {
        console.error('Print preparation failed:', error);
        this.setStatus(`Could not prepare the PDF: ${error.message}`, true);
        this.ui.previewPlaceholder.hidden = false;
        this.ui.previewCanvas.style.display = 'none';
        this.ui.previewPlaceholder.querySelector('p').textContent = 'Print-ready PDF could not be prepared.';
        this.latestPdfBytes = null;
        this.latestPreviewKey = '';
        this.updateActionState();
      }
      return null;
    });
    this.previewBuildQueue = task.catch(() => {});
    return task;
  }

  async loadPreviewDocument(bytes, version) {
    const loadingTask = this.pdfjsLib.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: this.standardFontDataUrl,
    });
    const doc = await loadingTask.promise;
    if (!this.opened || version !== this.previewBuildVersion) {
      await doc.destroy().catch(() => {});
      return;
    }
    const previous = this.previewDoc;
    this.previewDoc = doc;
    this.ui.previewTotal.textContent = String(doc.numPages);
    this.ui.previewPage.textContent = '1';
    this.ui.previewPrevious.disabled = true;
    this.ui.previewNext.disabled = doc.numPages <= 1;
    if (previous) await previous.destroy().catch(() => {});
    await this.renderPreviewPage();
  }

  async showPreviewPage(pageNumber) {
    if (!this.previewDoc) return;
    this.previewPageNumber = Math.max(1, Math.min(this.previewDoc.numPages, pageNumber));
    this.ui.previewPage.textContent = String(this.previewPageNumber);
    this.ui.previewPrevious.disabled = this.previewPageNumber <= 1;
    this.ui.previewNext.disabled = this.previewPageNumber >= this.previewDoc.numPages;
    await this.renderPreviewPage();
  }

  async renderPreviewPage() {
    if (!this.previewDoc || !this.opened) return;
    if (this.previewRenderTask) {
      try { this.previewRenderTask.cancel(); } catch (_) { /* already complete */ }
      this.previewRenderTask = null;
    }

    try {
      const page = await this.previewDoc.getPage(this.previewPageNumber);
      const stage = this.ui.previewStage;
      const maxWidth = Math.max(160, stage.clientWidth - 36);
      const maxHeight = Math.max(180, stage.clientHeight - 36);
      const unitViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth / unitViewport.width, maxHeight / unitViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = this.ui.previewCanvas;
      const context = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, viewport.width, viewport.height);
      this.ui.previewPlaceholder.hidden = true;
      canvas.style.display = 'block';
      const task = page.render({
        canvasContext: context,
        viewport,
        background: 'rgb(255,255,255)',
      });
      this.previewRenderTask = task;
      await task.promise;
      if (this.previewRenderTask === task) this.previewRenderTask = null;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') {
        console.warn('Print preview page render failed:', error);
        this.setStatus(`Preview render failed: ${error.message}`, true);
      }
    }
  }

  async renderGrayscalePage(pageNumber, placementScale, embeddedDimensions) {
    const sourceDoc = this.getDoc();
    if (!sourceDoc) throw new Error('The source document is no longer open.');
    const page = await sourceDoc.getPage(pageNumber);
    let scale = Math.max(0.05, placementScale * INK_SAVER_DPI / 72);
    let viewport = page.getViewport({ scale });
    const pixels = viewport.width * viewport.height;
    const areaLimit = pixels > MAX_INK_SAVER_PIXELS ? Math.sqrt(MAX_INK_SAVER_PIXELS / pixels) : 1;
    const widthLimit = viewport.width > MAX_INK_SAVER_DIMENSION ? MAX_INK_SAVER_DIMENSION / viewport.width : 1;
    const heightLimit = viewport.height > MAX_INK_SAVER_DIMENSION ? MAX_INK_SAVER_DIMENSION / viewport.height : 1;
    const cap = Math.min(areaLimit, widthLimit, heightLimit);
    if (cap < 1) {
      scale *= cap;
      viewport = page.getViewport({ scale });
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable for Ink Saver rendering.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context,
      viewport,
      background: 'rgb(255,255,255)',
    }).promise;

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    grayscaleRgbaInPlace(imageData.data);
    context.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode Ink Saver page.')), 'image/png');
    });
    canvas.width = 0;
    canvas.height = 0;
    void embeddedDimensions;
    return new Uint8Array(await blob.arrayBuffer());
  }

  setStatus(message, isError = false) {
    this.ui.status.textContent = message;
    this.ui.status.dataset.error = isError ? 'true' : 'false';
    if (message) this.onStatus(message);
  }

  setBusy(active, label = 'Open PDF in system viewer') {
    this.busy = active;
    this.ui.openSystemLabel.textContent = active ? 'Opening…' : label;
    this.updateActionState();
  }

  preparedFileName() {
    const baseName = this.getDocumentName().replace(/\.pdf$/i, '') || 'document';
    return `${baseName}-print-ready.pdf`;
  }

  async currentPreparedBytes() {
    const validation = this.validateSettings(this.readSettings());
    if (!validation.valid) {
      this.setStatus(validation.error.message, true);
      return null;
    }
    const key = this.previewKey(validation.settings);
    let result = this.latestPdfBytes && this.latestPreviewKey === key
      ? { bytes: this.latestPdfBytes }
      : await this.requestPreview(validation.settings, validation.summary);
    const current = this.validateSettings(this.readSettings());
    if (!result?.bytes || !this.opened || !current.valid ||
        this.previewKey(current.settings) !== key || this.latestPreviewKey !== key) return null;
    return result.bytes;
  }

  async openInSystemViewer() {
    if (!this.opened || this.busy) return;
    const bytes = await this.currentPreparedBytes();
    if (!bytes || !this.opened) return;

    const api = window.cambuzAPI;
    if (typeof api?.openPdfInSystemViewer !== 'function') {
      this.openBrowserPdf(bytes);
      return;
    }

    this.setBusy(true);
    this.setStatus('Opening the prepared PDF in your system viewer…');
    try {
      const result = await api.openPdfInSystemViewer(bytes, { suggestedName: this.preparedFileName() });
      if (!result?.ok) throw new Error(result?.error || 'The system PDF viewer could not be opened.');
      this.setStatus('Prepared PDF opened in the system viewer. Use that viewer’s Print command for printer selection, copies, duplex and cancellation.');
    } catch (error) {
      console.error('Opening the system PDF viewer failed:', error);
      this.setStatus(`Could not open the system PDF viewer: ${error.message} You can still save the print-ready PDF.`, true);
    } finally {
      this.setBusy(false);
    }
  }

  openBrowserPdf(bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    let popup = null;
    try {
      popup = window.open(url, '_blank');
    } catch (_) {
      // A sandboxed/embedded browser may deny window creation by throwing.
    }
    if (!popup) {
      URL.revokeObjectURL(url);
      this.setStatus('The browser blocked the PDF window. Download the print-ready PDF and open it manually.', true);
      return;
    }
    this.browserPdfUrls.add(url);
    setTimeout(() => {
      if (this.browserPdfUrls.delete(url)) URL.revokeObjectURL(url);
    }, 10 * 60 * 1000);
    this.setStatus('Prepared PDF opened in a new tab. Use that viewer’s Print command; Cambuz did not submit a print job.');
  }

  async downloadPdf() {
    if (!this.opened || this.busy) return;
    const bytes = await this.currentPreparedBytes();
    if (!bytes || !this.opened) return;
    const api = window.cambuzAPI;

    if (typeof api?.savePrintReadyPdf === 'function') {
      this.busy = true;
      this.setStatus('Choose where to save the print-ready PDF…');
      this.updateActionState();
      try {
        const result = await api.savePrintReadyPdf(bytes, { suggestedName: this.preparedFileName() });
        if (result?.canceled) {
          this.setStatus('Save cancelled. The prepared PDF remains available in this preview.');
        } else if (!result?.ok) {
          throw new Error(result?.error || 'The print-ready PDF could not be saved.');
        } else {
          this.setStatus(`Print-ready PDF saved as ${result.name}. This confirms the file was written, not that physical printing is correct.`);
        }
      } catch (error) {
        this.setStatus(`Could not save the print-ready PDF: ${error.message}`, true);
      } finally {
        this.busy = false;
        this.updateActionState();
      }
      return;
    }

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.preparedFileName();
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.setStatus('Print-ready PDF downloaded. This confirms the file was exported, not that physical printing is correct.');
  }
}
