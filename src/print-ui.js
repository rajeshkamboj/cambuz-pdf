// Cambuz PDF Reader — Phase 3 print preview controller.
// The preview is a PDF.js render of the exact print-ready PDF sent to native
// printing or opened in the browser's system print dialog.

import {
  PAPER_SIZES,
  PRINT_DEFAULTS,
  buildPrintPdf,
  describeDuplexMode,
  getPaperDimensions,
  grayscaleRgbaInPlace,
  isManualDuplexMode,
  normalizePrintSettings,
  splitSheetsForManualDuplex,
  summarizePrintJob,
} from './printing.js';
import { getManualDuplexGuidance } from './manual-duplex-guidance.js';

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
      dialogHeader: element('print-dialog-header'),
      toolbarButton: element('btn-print'),
      documentLabel: element('print-document-label'),
      closeButton: element('btn-print-close'),
      cancelButton: element('btn-print-cancel'),
      currentButton: element('btn-print-current'),
      submitButton: element('btn-print-submit'),
      submitLabel: element('print-submit-label'),
      downloadButton: element('btn-print-download'),
      preset: element('print-preset'),
      pageModes: [...document.querySelectorAll('input[name="print-page-mode"]')],
      currentPageLabel: element('print-current-page-label'),
      pageRange: element('print-page-range'),
      rangeError: element('print-range-error'),
      printer: element('print-printer'),
      refreshPrinters: element('btn-refresh-printers'),
      printerHelp: element('print-printer-help'),
      copies: element('print-copies'),
      collate: element('print-collate'),
      duplex: element('print-duplex'),
      duplexHelp: element('print-duplex-help'),
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
      content: element('print-dialog-content'),
      manualPanel: element('print-manual-panel'),
      manualTitle: element('print-manual-title'),
      manualText: element('print-manual-text'),
      manualPrinterName: element('print-manual-printer-name'),
      manualProfile: element('print-manual-profile'),
      manualStepOneTitle: element('print-manual-step-one-title'),
      manualStepOneText: element('print-manual-step-one-text'),
      manualStepTwoTitle: element('print-manual-step-two-title'),
      manualStepTwoText: element('print-manual-step-two-text'),
      manualLoadingLabels: element('print-manual-loading-labels'),
      manualNoteTitle: element('print-manual-note-title'),
      manualNoteText: element('print-manual-note-text'),
      manualContinue: element('btn-print-manual-continue'),
      manualCancel: element('btn-print-manual-cancel'),
    };

    this.opened = false;
    this.settings = { ...PRINT_DEFAULTS };
    this.settingsInitialized = false;
    this.printersGeneration = 0;
    this.previewDoc = null;
    this.previewRenderTask = null;
    this.previewPageNumber = 1;
    this.previewBuildTimer = null;
    this.previewBuildVersion = 0;
    this.previewBuildQueue = Promise.resolve();
    this.latestPdfBytes = null;
    this.latestPreviewKey = '';
    this.browserPrintUrls = new Set();
    this.submitting = false;
    // The in-flight native print job (main process) and the "printer may be
    // offline" watchdog, so a job stuck on an unresponsive printer can always
    // be cancelled from this dialog instead of hanging on "Sending…".
    this.activePrintJobId = null;
    this.printJobSequence = 0;
    this.printWatchdogTimer = null;
    // Manual two-sided printing: the even-page pass waiting for the user to
    // reload the printed stack. Null when no second pass is pending.
    this.manualJob = null;
    this.resizeTimer = null;

    this.bindEvents();
  }

  get isOpen() {
    return this.opened;
  }

  bindEvents() {
    this.ui.toolbarButton.addEventListener('click', () => this.open());
    this.ui.closeButton.addEventListener('click', () => this.close(true));
    // While a job is sending, this button reads "Cancel print" and aborts the
    // native job, keeping the dialog open so another printer can be chosen.
    this.ui.cancelButton.addEventListener('click', () => {
      if (this.submitting) this.cancelActivePrint();
      else this.close(true);
    });
    this.ui.dialog.addEventListener('click', (event) => {
      if (event.target === this.ui.dialog) this.close(true);
    });
    this.ui.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') this.trapFocus(event);
    });
    this.ui.submitButton.addEventListener('click', () => this.print(false));
    this.ui.currentButton.addEventListener('click', () => this.print(true));
    this.ui.downloadButton.addEventListener('click', () => this.downloadPdf());
    this.ui.manualContinue.addEventListener('click', () => this.continueManualDuplex());
    this.ui.manualCancel.addEventListener('click', () => this.cancelManualDuplex());
    this.ui.refreshPrinters.addEventListener('click', () => this.refreshPrinters());
    this.ui.previewPrevious.addEventListener('click', () => this.showPreviewPage(this.previewPageNumber - 1));
    this.ui.previewNext.addEventListener('click', () => this.showPreviewPage(this.previewPageNumber + 1));

    for (const radio of this.ui.pageModes) {
      radio.addEventListener('change', () => this.onSettingsChanged());
    }

    const refreshOnInput = [
      this.ui.pageRange,
      this.ui.copies,
      this.ui.collate,
      this.ui.duplex,
      this.ui.paper,
      this.ui.orientation,
      this.ui.pagesPerSheet,
      this.ui.scaling,
      this.ui.customScale,
      this.ui.margins,
      this.ui.customMargin,
      this.ui.inkSaver,
    ];
    for (const control of refreshOnInput) {
      control.addEventListener('input', () => this.onSettingsChanged());
      control.addEventListener('change', () => this.onSettingsChanged());
    }

    this.ui.preset.addEventListener('change', () => this.applyPreset(this.ui.preset.value));
    this.ui.printer.addEventListener('change', () => this.updateActionState());
    window.addEventListener('resize', () => {
      if (!this.opened || !this.previewDoc) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.renderPreviewPage(), 120);
    });
  }

  trapFocus(event) {
    // The app-wide shortcut handler keeps keys from reaching the document while
    // this dialog is open. Keep Tab in the same modal too, including while the
    // manual second-side panel replaces the normal print action.
    const focusable = [...this.ui.dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((control) => !control.closest('[hidden]') && window.getComputedStyle(control).display !== 'none');
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const dialogHeading = this.ui.dialog.getAttribute('aria-labelledby') === 'print-manual-title'
      ? this.ui.manualTitle
      : null;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogHeading)) {
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
      this.setStatus('Open a PDF before printing.', true);
      return;
    }
    if (this.opened) return;

    this.opened = true;
    this.ui.dialog.style.display = 'flex';
    this.ui.documentLabel.textContent = `${this.getDocumentName()} · ${this.getTotalPages()} page${this.getTotalPages() === 1 ? '' : 's'}`;
    this.ui.currentPageLabel.textContent = `(page ${this.getCurrentPage()} of ${this.getTotalPages()})`;
    this.setStatus('Preparing print preview…');

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
    this.refreshPrinters();
    this.schedulePreview(true);
    requestAnimationFrame(() => {
      if (this.opened) this.ui.closeButton.focus();
      this.renderPreviewPage();
    });
  }

  close(restoreFocus = true) {
    const wasOpen = this.opened;
    this.opened = false;
    // Never leave a native job running behind a closed dialog: a job stuck on
    // an offline printer would otherwise stay "Sending…" until the app quits.
    this.cancelActivePrint();
    this.clearManualJob();
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
    this.ui.downloadButton.disabled = true;
    this.updateActionState();
    if (doc) {
      try { await doc.destroy(); } catch (_) { /* ignore cleanup errors */ }
    }
  }

  async onDocumentChanged() {
    if (this.opened) await this.close(false);
    else await this.destroyPreview();
    this.settingsInitialized = false;
  }

  readSettings() {
    const selectedMode = this.ui.pageModes.find((radio) => radio.checked);
    return {
      pageMode: selectedMode ? selectedMode.value : 'all',
      pageRange: this.ui.pageRange.value,
      copies: this.ui.copies.value,
      collate: this.ui.collate.checked,
      duplexMode: this.ui.duplex.value,
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
    this.ui.copies.value = value.copies;
    this.ui.collate.checked = value.collate;
    this.ui.duplex.value = value.duplexMode;
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
    const current = this.readSettings();
    this.settings = { ...current, ...preset };
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
    if (!this.opened) return;
    this.settings = this.readSettings();
    this.ui.preset.value = 'custom';
    this.updateControlVisibility();
    this.schedulePreview(false);
  }

  previewKey(settings) {
    // Copies, collation and duplex are printer settings; they do not change
    // the sheet PDF and should not force an expensive re-composition.
    const { copies: _copies, collate: _collate, duplexMode: _duplex, ...pdfSettings } = settings;
    return `${this.getDocumentGeneration()}:${this.getCurrentPage()}:${JSON.stringify(pdfSettings)}`;
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
    if (isManualDuplexMode(normalized.duplexMode) && Number(normalized.copies) > 1) {
      const error = new Error('Manual two-sided printing prints one copy at a time. Set copies to 1, or print the copies separately.');
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
      this.ui.previewSummary.textContent = 'Check the highlighted print settings.';
      return;
    }
    const dimensions = getPaperDimensions(settings);
    const paperLabel = PAPER_SIZES[settings.paperSize].label;
    const orientation = settings.orientation;
    const copyLabel = `${summary.copies} cop${summary.copies === 1 ? 'y' : 'ies'}`;
    this.ui.previewSummary.textContent =
      `${summary.selectedCount} page${summary.selectedCount === 1 ? '' : 's'} → ` +
      `${summary.sheetCount} sheet${summary.sheetCount === 1 ? '' : 's'} · ${copyLabel}`;
    this.ui.previewCaption.textContent =
      `${paperLabel} ${dimensions.widthMm} × ${dimensions.heightMm} mm · ${orientation} · ` +
      `${settings.pagesPerSheet} page${settings.pagesPerSheet === 1 ? '' : 's'} per sheet · ` +
      `${settings.scaling === 'fit' ? 'Fit to printable area' : settings.scaling === 'actual' ? 'Actual size' : `${settings.customScale}% scale`}` +
      `${settings.inkSaver ? ' · Ink Saver grayscale' : ''}` +
      ` · ${describeDuplexMode(settings.duplexMode)}` +
      `${summary.copies > 1 ? settings.collate ? ' · collated' : ' · uncollated' : ''}`;
  }

  updateActionState() {
    const settings = this.readSettings();
    const validation = this.validateSettings(settings);
    this.updateSummary(settings, validation.valid ? validation.summary : null);
    const previewReady = validation.valid && this.latestPdfBytes &&
      this.latestPreviewKey === this.previewKey(validation.settings);
    this.ui.submitButton.disabled = !previewReady || this.submitting || Boolean(this.manualJob);
    this.ui.currentButton.disabled = !this.getDoc() || this.submitting || Boolean(this.manualJob);
    this.ui.downloadButton.disabled = !this.latestPdfBytes;
  }

  schedulePreview(immediate = false) {
    clearTimeout(this.previewBuildTimer);
    const settings = this.readSettings();
    this.settings = settings;
    const validation = this.validateSettings(settings);
    this.updateSummary(settings, validation.valid ? validation.summary : null);
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
    this.setStatus('Updating print preview…');
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
      if (!sourceBytes) throw new Error('The original PDF bytes are no longer available. Reopen the document to print.');
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
          const percent = Math.round(progress * 100);
          this.setStatus(`${stage}… ${percent}%`);
        },
        renderGrayscalePage: (pageNumber, placementScale, dimensions) =>
          this.renderGrayscalePage(pageNumber, placementScale, dimensions),
      });

      if (
        !this.opened || version !== this.previewBuildVersion ||
        documentGeneration !== this.getDocumentGeneration()
      ) return null;

      this.latestPdfBytes = result.bytes;
      this.latestPreviewKey = key;
      this.settings = settings;
      this.previewPageNumber = 1;
      await this.loadPreviewDocument(result.bytes, version);
      if (!this.opened || version !== this.previewBuildVersion) return null;

      const copySuffix = summary.copies > 1 ? ` · ${summary.copies} copies` : '';
      this.setStatus(`Preview ready · ${result.pageCount} sheet${result.pageCount === 1 ? '' : 's'}${copySuffix}`);
      this.updateActionState();
      return result;
    }).catch((error) => {
      if (version === this.previewBuildVersion && this.opened) {
        console.error('Print preview failed:', error);
        this.setStatus(`Could not prepare print preview: ${error.message}`, true);
        this.ui.previewPlaceholder.hidden = false;
        this.ui.previewCanvas.style.display = 'none';
        this.ui.previewPlaceholder.querySelector('p').textContent = 'Print preview could not be prepared.';
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
    const areaLimit = pixels > MAX_INK_SAVER_PIXELS
      ? Math.sqrt(MAX_INK_SAVER_PIXELS / pixels)
      : 1;
    const widthLimit = viewport.width > MAX_INK_SAVER_DIMENSION
      ? MAX_INK_SAVER_DIMENSION / viewport.width
      : 1;
    const heightLimit = viewport.height > MAX_INK_SAVER_DIMENSION
      ? MAX_INK_SAVER_DIMENSION / viewport.height
      : 1;
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
    const task = page.render({
      canvasContext: context,
      viewport,
      background: 'rgb(255,255,255)',
    });
    await task.promise;

    // Use a deterministic luminance conversion for every painted pixel. The
    // raster is generated only for the optional Ink Saver preset; normal jobs
    // keep the source page's original vector content.
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    grayscaleRgbaInPlace(imageData.data);
    context.putImageData(imageData, 0, 0);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode Ink Saver page.')), 'image/png');
    });
    canvas.width = 0;
    canvas.height = 0;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // The PDF.js and PDF-lib page boxes normally match. If a third-party PDF
    // has unusual crop/rotation metadata, the placement is still bounded by
    // the cell clip and the preview shows the encoded page exactly.
    void embeddedDimensions;
    return bytes;
  }

  async refreshPrinters() {
    const generation = ++this.printersGeneration;
    const api = window.cambuzAPI;
    if (!api?.getPrinters) {
      this.ui.printer.innerHTML = '';
      const option = document.createElement('option');
      option.value = 'browser';
      option.textContent = 'System print dialog';
      this.ui.printer.appendChild(option);
      this.ui.printer.disabled = true;
      this.ui.printerHelp.textContent = 'Browser mode cannot set printer options. Choose sides, copies and collation in the browser/system print dialog.';
      this.updateActionState();
      return;
    }

    this.ui.printer.disabled = true;
    this.ui.printerHelp.textContent = 'Checking available printers…';
    try {
      const printers = await api.getPrinters();
      if (generation !== this.printersGeneration) return;
      this.ui.printer.innerHTML = '';
      const chooseOption = document.createElement('option');
      chooseOption.value = '';
      chooseOption.textContent = printers.length ? 'Choose in system print dialog…' : 'No printer detected — use system dialog';
      this.ui.printer.appendChild(chooseOption);
      for (const printer of printers) {
        const option = document.createElement('option');
        option.value = printer.name;
        const display = printer.displayName || printer.name;
        option.textContent = `${display}${printer.isDefault ? ' · Default' : ''}`;
        this.ui.printer.appendChild(option);
      }
      const defaultPrinter = printers.find((printer) => printer.isDefault);
      if (defaultPrinter) this.ui.printer.value = defaultPrinter.name;
      else this.ui.printer.value = '';
      this.ui.printer.disabled = false;
      this.ui.printerHelp.textContent = printers.length
        ? 'Select a printer for direct printing, or use the system dialog to verify driver options before printing.'
        : 'No printer was detected. Print opens the native system dialog so you can choose one.';
    } catch (error) {
      if (generation !== this.printersGeneration) return;
      this.ui.printer.innerHTML = '';
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Choose in system print dialog…';
      this.ui.printer.appendChild(option);
      this.ui.printer.disabled = false;
      this.ui.printerHelp.textContent = `Printer list unavailable: ${error.message}. The native system dialog can still be used.`;
    }
    this.updateActionState();
  }

  setStatus(message, isError = false) {
    this.ui.status.textContent = message;
    this.ui.status.dataset.error = isError ? 'true' : 'false';
    if (message) this.onStatus(message);
  }

  /**
   * Flip the dialog into/out of its "sending" state. While sending, the footer
   * Cancel button becomes "Cancel print" and a watchdog warns if the printer
   * has not responded for a while (usually: it is offline).
   */
  setSubmitting(active) {
    this.submitting = active;
    this.ui.cancelButton.textContent = active ? 'Cancel print' : 'Cancel';
    this.clearPrintWatchdog();
    if (active) {
      this.printWatchdogTimer = setTimeout(() => {
        this.printWatchdogTimer = null;
        if (this.submitting && this.opened) {
          this.setStatus('Still waiting for the printer to respond. If it is switched off or offline, press “Cancel print”.');
        }
      }, 20_000);
    }
  }

  clearPrintWatchdog() {
    if (this.printWatchdogTimer) {
      clearTimeout(this.printWatchdogTimer);
      this.printWatchdogTimer = null;
    }
  }

  /** Ask the main process to abort the in-flight native print job, if any. */
  cancelActivePrint() {
    const api = window.cambuzAPI;
    if (!this.activePrintJobId || typeof api?.cancelPrint !== 'function') return;
    // The pending printPdf() promise settles as cancelled; the print flow's
    // own finally block then restores the buttons and status line.
    api.cancelPrint(this.activePrintJobId).catch(() => { /* job already gone */ });
    if (this.opened) this.setStatus('Cancelling print…');
  }

  async print(forceCurrentPage) {
    if (!this.opened || this.submitting || this.manualJob) return;
    if (forceCurrentPage) {
      clearTimeout(this.previewBuildTimer);
      for (const radio of this.ui.pageModes) radio.checked = radio.value === 'current';
      this.settings = this.readSettings();
      this.ui.preset.value = 'custom';
      this.updateControlVisibility();
    }

    const settings = this.readSettings();
    const validation = this.validateSettings(settings);
    this.updateSummary(settings, validation.valid ? validation.summary : null);
    if (!validation.valid) {
      this.setStatus(validation.error.message, true);
      return;
    }

    const key = this.previewKey(validation.settings);
    let result = this.latestPdfBytes && this.latestPreviewKey === key
      ? { bytes: this.latestPdfBytes }
      : null;
    if (!result) {
      result = await this.requestPreview(validation.settings, validation.summary);
    }
    // The user may have changed settings while a slow PDF was composing.
    // Never send old sheet bytes with a new set of native printer options.
    const current = this.validateSettings(this.readSettings());
    if (!result?.bytes || !this.opened || !current.valid ||
        this.previewKey(current.settings) !== key || this.latestPreviewKey !== key) return;

    this.submitting = true;
    this.ui.submitButton.disabled = true;
    this.ui.currentButton.disabled = true;
    this.ui.submitLabel.textContent = 'Sending…';
    this.setStatus('Sending print job…');
    try {
      const api = window.cambuzAPI;
      if (api?.printPdf) {
        const paper = getPaperDimensions(validation.settings);
        const jobOptions = {
          deviceName: this.ui.printer.value || '',
          copies: current.settings.copies,
          collate: current.settings.collate,
          duplexMode: current.settings.duplexMode,
          paperSize: validation.settings.paperSize,
          orientation: validation.settings.orientation,
          widthMm: paper.widthMm,
          heightMm: paper.heightMm,
        };
        if (isManualDuplexMode(current.settings.duplexMode)) {
          await this.startManualDuplex(api, result.bytes, jobOptions);
        } else {
          const destination = await this.sendNativeJob(api, result.bytes, jobOptions);
          this.setStatus(`Print job sent to ${destination}.${current.settings.duplexMode === 'simplex' ? '' : ' Two-sided output depends on printer/driver support.'}`, false);
          this.onStatus(`Print job sent to ${destination}`);
        }
      } else {
        if (isManualDuplexMode(current.settings.duplexMode)) {
          throw new Error('Manual two-sided printing needs the Cambuz desktop app. Choose one-sided here, or print in the browser dialog yourself.');
        }
        this.openBrowserPrint(result.bytes);
      }
    } catch (error) {
      if (error?.code === 'PRINT_CANCELLED') {
        this.setStatus('Print cancelled.');
      } else {
        console.error('Printing failed:', error);
        this.setStatus(`Printing failed: ${error.message}`, true);
      }
    } finally {
      this.setSubmitting(false);
      this.ui.submitLabel.textContent = 'Print';
      this.updateActionState();
    }
  }

  /**
   * Send one native job and resolve with the destination name. Throws on
   * failure; a user cancellation throws an error with code 'PRINT_CANCELLED'.
   * The job id lets "Cancel print" abort this exact job in the main process.
   */
  async sendNativeJob(api, bytes, jobOptions) {
    const jobId = `print-${++this.printJobSequence}`;
    this.activePrintJobId = jobId;
    try {
      const nativeResult = await api.printPdf(bytes, { ...jobOptions, jobId });
      if (nativeResult?.cancelled) {
        const cancelled = new Error('Print cancelled.');
        cancelled.code = 'PRINT_CANCELLED';
        throw cancelled;
      }
      if (!nativeResult?.ok) throw new Error(nativeResult?.error || 'The operating system could not start the print job.');
      return nativeResult.printerName || jobOptions.deviceName || 'selected printer';
    } finally {
      if (this.activePrintJobId === jobId) this.activePrintJobId = null;
    }
  }

  /**
   * Manual two-sided: send the odd sheets now as a one-sided job, then keep the
   * even sheets (already in reverse order) until the user has reloaded the stack.
   */
  async startManualDuplex(api, bytes, jobOptions) {
    const split = await splitSheetsForManualDuplex(bytes);
    const passOptions = { ...jobOptions, copies: 1, collate: true, duplexMode: 'simplex' };
    const destination = await this.sendNativeJob(api, split.frontBytes, passOptions);
    if (split.backCount === 0) {
      this.setStatus(`Print job sent to ${destination}. The document fits on one side, so no second pass is needed.`, false);
      this.onStatus(`Print job sent to ${destination}`);
      return;
    }
    this.manualJob = {
      backBytes: split.backBytes,
      options: passOptions,
      destination,
      frontCount: split.frontCount,
      backCount: split.backCount,
    };
    this.showManualPanel();
    this.setStatus(`Side one sent to ${destination}. After the sheets finish printing, follow the loading guidance and press “Continue”.`, false);
    this.onStatus(`Side one sent to ${destination}`);
  }

  showManualPanel() {
    const job = this.manualJob;
    if (!job) return;

    const guidance = getManualDuplexGuidance(job.destination);
    this.ui.dialog.dataset.manualPending = 'true';
    this.ui.dialog.dataset.manualWorkflow = guidance.id;
    this.ui.dialog.setAttribute('aria-labelledby', 'print-manual-title');
    this.ui.dialogHeader.hidden = true;
    this.ui.content.hidden = true;
    this.ui.currentButton.hidden = true;
    this.ui.submitButton.hidden = true;
    this.ui.manualPanel.hidden = false;

    this.ui.manualText.textContent = 'First side printed — reload the paper to continue.';
    this.ui.manualPrinterName.textContent = guidance.printerName;
    this.ui.manualProfile.textContent = guidance.profileLabel;
    this.ui.manualStepOneTitle.textContent = guidance.stepOne.title;
    this.ui.manualStepOneText.textContent = guidance.stepOne.text;
    this.ui.manualStepTwoTitle.textContent = guidance.stepTwo.title;
    this.ui.manualStepTwoText.textContent = guidance.stepTwo.text;
    this.ui.manualNoteTitle.textContent = guidance.noteTitle;
    this.ui.manualNoteText.textContent = guidance.noteText;
    this.ui.manualLoadingLabels.replaceChildren(...guidance.loadingLabels.map((label) => {
      const tag = document.createElement('span');
      tag.textContent = label;
      return tag;
    }));

    this.ui.manualContinue.disabled = false;
    this.ui.manualCancel.disabled = false;
    // Focus the instruction heading so keyboard and screen-reader users start
    // at the top of the guidance without the browser scrolling past Step 1 to
    // reveal the Continue button on a narrow window.
    this.ui.manualTitle.focus();
  }

  clearManualJob({ restoreFocus = false } = {}) {
    this.manualJob = null;
    if (this.ui?.manualPanel) this.ui.manualPanel.hidden = true;
    if (this.ui?.dialogHeader) this.ui.dialogHeader.hidden = false;
    if (this.ui?.content) this.ui.content.hidden = false;
    if (this.ui?.currentButton) this.ui.currentButton.hidden = false;
    if (this.ui?.submitButton) this.ui.submitButton.hidden = false;
    if (this.ui?.dialog) {
      delete this.ui.dialog.dataset.manualPending;
      delete this.ui.dialog.dataset.manualWorkflow;
      this.ui.dialog.setAttribute('aria-labelledby', 'print-dialog-title');
    }
    if (restoreFocus) this.ui.cancelButton.focus();
  }

  async continueManualDuplex() {
    const job = this.manualJob;
    if (!job || this.submitting) return;
    const api = window.cambuzAPI;
    this.setSubmitting(true);
    this.ui.manualContinue.disabled = true;
    // Keep the panel's cancel button usable while side two is sending: it
    // becomes "Cancel print" so a stuck second side can be aborted too.
    this.ui.manualCancel.disabled = false;
    this.ui.manualCancel.textContent = 'Cancel print';
    this.setStatus('Sending side two…');
    try {
      const destination = await this.sendNativeJob(api, job.backBytes, job.options);
      this.clearManualJob({ restoreFocus: true });
      this.setStatus(`Side two sent to ${destination}. Check the sheet order on the printed output.`, false);
      this.onStatus(`Side two sent to ${destination}`);
    } catch (error) {
      if (error?.code === 'PRINT_CANCELLED') {
        this.setStatus('Side two cancelled. Press “Continue” to try again, or skip it.');
      } else {
        console.error('Printing side two failed:', error);
        this.setStatus(`Side two failed: ${error.message}. Press “Continue” to try again, or skip it.`, true);
      }
    } finally {
      this.setSubmitting(false);
      this.ui.manualContinue.disabled = false;
      this.ui.manualCancel.disabled = false;
      this.ui.manualCancel.textContent = 'Skip second side';
      this.updateActionState();
    }
  }

  cancelManualDuplex() {
    if (this.submitting) {
      this.cancelActivePrint();
      return;
    }
    if (!this.manualJob) return;
    this.clearManualJob({ restoreFocus: true });
    this.setStatus('Side two skipped. Only the odd pages were printed.', false);
    this.updateActionState();
  }

  openBrowserPrint(bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      URL.revokeObjectURL(url);
      this.downloadPdf(bytes);
      this.setStatus('The browser blocked the print window. The print-ready PDF was downloaded; open it and use Ctrl+P.', true);
      return;
    }

    this.browserPrintUrls.add(url);
    setTimeout(() => {
      if (this.browserPrintUrls.has(url)) {
        URL.revokeObjectURL(url);
        this.browserPrintUrls.delete(url);
      }
    }, 10 * 60 * 1000);
    try {
      popup.location.href = url;
      this.setStatus('Print-ready PDF opened. Set two-sided printing, copies and collation in the browser/system dialog; avoid extra scaling.');
      setTimeout(() => {
        try {
          if (!popup.closed) {
            popup.focus();
            popup.print();
          }
        } catch (_) {
          // Some browsers do not expose print() on their built-in PDF viewer;
          // the PDF remains open for Ctrl+P or the viewer's Print button.
        }
      }, 1200);
    } catch (error) {
      URL.revokeObjectURL(url);
      this.browserPrintUrls.delete(url);
      this.downloadPdf(bytes);
      this.setStatus(`Could not open the print window: ${error.message}. The print-ready PDF was downloaded.`, true);
    }
  }

  downloadPdf(bytes = this.latestPdfBytes) {
    if (!bytes) return;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const baseName = this.getDocumentName().replace(/\.pdf$/i, '') || 'document';
    anchor.href = url;
    anchor.download = `${baseName}-print-ready.pdf`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.setStatus('Print-ready PDF downloaded with your page selection and layout. Choose duplex, copies and collation when printing it.');
  }
}
