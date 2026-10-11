const { contextBridge, ipcRenderer } = require('electron');

// The OS regional locale forwarded by main.js (see systemLocaleArguments).
const LOCALE_SWITCH = '--cambuz-system-locale=';
const localeArgument = process.argv.find((arg) => arg.startsWith(LOCALE_SWITCH));

contextBridge.exposeInMainWorld('cambuzAPI', {
  systemLocale: localeArgument ? localeArgument.slice(LOCALE_SWITCH.length) : undefined,
  openFile: () => ipcRenderer.invoke('dialog-open-file'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readSample: (name) => ipcRenderer.invoke('read-sample', name),
  // Phase 9: opening PDFs from the OS. The renderer calls rendererReady once
  // its open-file-path listener is registered; a file that arrived before
  // then is returned ({ file }) instead of being pushed.
  rendererReady: () => ipcRenderer.invoke('renderer-ready'),
  onOpenFilePath: (callback) => ipcRenderer.on('open-file-path', callback),
  getPrinters: () => ipcRenderer.invoke('list-printers'),
  printPdf: (pdfBytes, options) => ipcRenderer.invoke('print-pdf', pdfBytes, options),
  onMenuPrint: (callback) => ipcRenderer.on('menu-print', callback),
  onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
  onMenuCloseFile: (callback) => ipcRenderer.on('menu-close-file', callback),
  onMenuZoomIn: (callback) => ipcRenderer.on('menu-zoom-in', callback),
  onMenuZoomOut: (callback) => ipcRenderer.on('menu-zoom-out', callback),
  onMenuFitPage: (callback) => ipcRenderer.on('menu-fit-page', callback),
  onMenuFitWidth: (callback) => ipcRenderer.on('menu-fit-width', callback),
  onMenuPrevPage: (callback) => ipcRenderer.on('menu-prev-page', callback),
  onMenuNextPage: (callback) => ipcRenderer.on('menu-next-page', callback),
  onMenuToggleTheme: (callback) => ipcRenderer.on('menu-toggle-theme', callback),
  onMenuFind: (callback) => ipcRenderer.on('menu-find', callback),
  onMenuSelectAll: (callback) => ipcRenderer.on('menu-select-all', callback),
  onMenuRotateCW: (callback) => ipcRenderer.on('menu-rotate-cw', callback),
  onMenuRotateCCW: (callback) => ipcRenderer.on('menu-rotate-ccw', callback),
  onMenuFullscreen: (callback) => ipcRenderer.on('menu-fullscreen', callback),
  onMenuSidebar: (callback) => ipcRenderer.on('menu-sidebar', callback),
  onMenuViewMode: (callback) => ipcRenderer.on('menu-view-mode', callback),
  onMenuShortcuts: (callback) => ipcRenderer.on('menu-shortcuts', callback),
  // Phase 4: page tools, Save As / Duplicate and merge/split file access.
  openPdfPaths: () => ipcRenderer.invoke('dialog-open-pdfs'),
  savePdf: (pdfBytes, options) => ipcRenderer.invoke('save-pdf', pdfBytes, options),
  savePdfFiles: (files, options) => ipcRenderer.invoke('save-pdf-files', files, options),
  onMenuPageTools: (callback) => ipcRenderer.on('menu-page-tools', callback),
  onMenuSaveAs: (callback) => ipcRenderer.on('menu-save-as', callback),
  onMenuDuplicate: (callback) => ipcRenderer.on('menu-duplicate', callback),
  // Phase 5: forms and document security.
  onMenuForms: (callback) => ipcRenderer.on('menu-forms', callback),
  onMenuSecurity: (callback) => ipcRenderer.on('menu-security', callback),
  // Phase 7: a bounded PNG + language request is sent to the optional local engine.
  getOcrStatus: () => ipcRenderer.invoke('ocr-status'),
  ocrPage: (imageBytes, languages) => ipcRenderer.invoke('ocr-page', imageBytes, languages),
});
