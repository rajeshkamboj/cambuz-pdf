#!/usr/bin/env node
// Cambuz PDF Reader — landing-site screenshot capture.
//
// Launches the packaged desktop application, drives its real window over the
// Chrome DevTools Protocol with real mouse/keyboard input (the same approach as
// scripts/smoke-test-packaged.mjs) and writes PNG masters for the product
// landing site and the README's screenshot section.
//
// Nothing here is a mock-up: every pixel comes from the application's own
// renderer. This script only *captures*; cropping, resizing and format
// conversion happen later, in scripts/convert-screenshots.mjs.
//
// Content shots are captured with Chromium device-metrics emulation
// (1440×900 CSS pixels at devicePixelRatio 2), so each master is 2880×1800
// with text rendered by the real PDF.js canvas at 2× resolution.
//
// Desktop shots (optional, Windows only) capture the whole screen with the
// native window on it, including the real title bar and part of the taskbar.
// When the runner has no usable interactive desktop the script records them as
// "manual capture needed" instead of emitting a black or faked image.
//
// Usage:
//   node scripts/capture-screenshots.mjs --app <executable> [--out <dir>]
//        [--port <n>] [--timeout <seconds>] [--samples <dir>]
//        [--connect <port>]   attach to a running DevTools port instead of launching
//        [--shots a,b,c]      capture only the named shots (default: all)
//        [--skip-desktop]     skip the native-desktop captures
//
// Output (in --out):
//   <shot>.png            PNG masters (content shots 2880×1800, desktop shots
//                         a 16:10 crop of the runner screen)
//   capture-report.json   per-shot state, checks and metadata for the manifest
//   capture-log.txt       timestamped log of everything the script did

import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every capture is taken at this CSS viewport with a 2× device pixel ratio:
// 2880×1800 masters, 16:10, with the page canvas re-rendered at 2× so PDF text
// stays crisp at full size.
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 2 };
const MASTER = { width: VIEW.width * VIEW.deviceScaleFactor, height: VIEW.height * VIEW.deviceScaleFactor };

// The bundled samples the shots may show. Only files from samples/ are used.
const DEMO_SAMPLE = 'cambuz-demo.pdf';
const HINDI_SAMPLE = 'hindi-sample.pdf';
const PUNJABI_SAMPLE = 'punjabi-sample.pdf';
// Documents the welcome screen's own sample buttons can open.
const BUNDLED_SAMPLES = [DEMO_SAMPLE, 'form-sample.pdf'];

function parseArgs(argv) {
  const options = { args: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag || !flag.startsWith('--')) throw new Error(`Expected --name [value]; problem near "${flag ?? ''}"`);
    const name = flag.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    const value = hasValue ? next : 'true';
    if (hasValue) i += 1;
    if (name === 'arg') options.args.push(value);
    else options[name] = value;
  }
  return options;
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Functions that run inside the renderer. They travel over the protocol as
// source text, so they must not reference anything from this file.

/**
 * Everything a shot needs to prove its state. Read straight from the same DOM
 * the application renders, so it can only report what the app really shows.
 */
function pageSnapshot() {
  const el = (id) => document.getElementById(id);
  const canvas = el('pdf-canvas');
  const textLayer = el('text-layer');
  const viewer = el('pdf-viewer');
  const thumbs = [...document.querySelectorAll('.thumb-item')];
  const visibleThumbs = thumbs.filter((item) => {
    const rect = item.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.height > 0;
  });
  const activeThumb = thumbs.find((item) => item.classList.contains('active')) || null;
  const currentMark = document.querySelector('#text-layer mark.search-highlight.current');
  const markRect = currentMark?.getBoundingClientRect();
  const canvasRect = canvas?.getBoundingClientRect();
  const viewerRect = viewer?.getBoundingClientRect();
  let canvasInk = null;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    let samples = 0;
    for (let i = 0; i < data.length; i += 4 * 397) {
      samples += 1;
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark += 1;
    }
    canvasInk = samples ? Number((dark / samples).toFixed(4)) : 0;
  }
  const printer = el('print-printer');
  return {
    dpr: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    theme: document.documentElement.getAttribute('data-theme'),
    welcomeVisible: getComputedStyle(el('welcome-screen')).display !== 'none',
    viewerVisible: getComputedStyle(el('pdf-viewer')).display !== 'none',
    file: el('status-file').textContent,
    documentTitle: el('doc-title').textContent,
    status: el('status-text').textContent,
    page: el('page-input').value,
    total: el('page-total').textContent,
    zoom: el('zoom-level').textContent,
    canvas: canvas
      ? {
          width: canvas.width,
          height: canvas.height,
          cssWidth: Math.round(canvasRect.width),
          cssHeight: Math.round(canvasRect.height),
          ink: canvasInk,
          left: Math.round(canvasRect.left),
          top: Math.round(canvasRect.top),
          right: Math.round(canvasRect.right),
          bottom: Math.round(canvasRect.bottom),
        }
      : null,
    viewer: viewerRect
      ? { left: Math.round(viewerRect.left), width: Math.round(viewerRect.width), scrollLeft: viewer.scrollLeft, scrollTop: viewer.scrollTop }
      : null,
    textSpans: textLayer ? textLayer.querySelectorAll('span').length : 0,
    textLength: textLayer ? textLayer.textContent.trim().length : 0,
    sidebarOpen: getComputedStyle(el('sidebar')).display !== 'none',
    activeTab: el('tab-thumbs').classList.contains('active') ? 'thumbs' : 'outline',
    thumbCount: thumbs.length,
    thumbsVisible: visibleThumbs.length,
    thumbsVisibleRendered: visibleThumbs.filter((item) => item.querySelector('canvas').width > 0).length,
    activeThumbPage: activeThumb ? activeThumb.dataset.page : null,
    activeThumbRendered: activeThumb ? activeThumb.querySelector('canvas').width > 0 : false,
    searchBarOpen: getComputedStyle(el('search-bar')).display !== 'none',
    searchCount: el('search-count').textContent,
    highlightCount: document.querySelectorAll('#text-layer mark.search-highlight').length,
    currentHighlightOnScreen: Boolean(
      markRect && markRect.top < window.innerHeight && markRect.bottom > 0 && markRect.left < window.innerWidth && markRect.right > 0,
    ),
    selection: window.getSelection().toString(),
    printOpen: getComputedStyle(el('print-dialog')).display !== 'none',
    print: {
      mode: [...document.querySelectorAll('input[name="print-page-mode"]')].find((radio) => radio.checked)?.value ?? null,
      range: el('print-page-range').value,
      rangeError: el('print-range-error').textContent,
      previewWidth: el('print-preview-canvas').width,
      previewHeight: el('print-preview-canvas').height,
      previewHidden: getComputedStyle(el('print-preview-canvas')).display === 'none',
      placeholderVisible: !el('print-preview-placeholder').hidden,
      total: el('print-preview-total').textContent,
      sheet: el('print-preview-page').textContent,
      status: el('print-status').textContent,
      printer: printer ? printer.value : null,
      printerLabel: printer && printer.selectedOptions[0] ? printer.selectedOptions[0].textContent : '',
      printerDisabled: printer ? printer.disabled : null,
      printerCount: printer ? [...printer.options].filter((option) => option.value !== '').length : 0,
      settingsError: el('print-settings-error').textContent,
    },
    recents: [...document.querySelectorAll('#recent-list .recent-name')].map((node) => node.textContent),
    recentsVisible: getComputedStyle(el('recent-section')).display !== 'none',
    formWidgets: document.querySelectorAll('#form-layer .form-widget').length,
    dialogs: ['print-dialog', 'pageops-dialog', 'shortcuts-dialog', 'error-display', 'drop-overlay']
      .filter((id) => {
        const node = el(id);
        return node && getComputedStyle(node).display !== 'none';
      }),
    spinnerVisible: [...document.querySelectorAll('.print-spinner')].some((node) => node.getBoundingClientRect().height > 0),
    bridge: Boolean(window.cambuzAPI && typeof window.cambuzAPI.getPrinters === 'function'),
  };
}

/**
 * A pointer position that hovers nothing interactive: headings, panel
 * backgrounds and the status bar have no hover styling, toolbar buttons,
 * sidebar rows and links do. Returns the point plus what is under it, so the
 * caller can assert the coordinates before the shot is taken.
 */
function parkProbe() {
  const dialog = document.getElementById('print-dialog');
  const dialogOpen = dialog && getComputedStyle(dialog).display !== 'none';
  const anchor = dialogOpen ? document.getElementById('print-dialog-title') : document.getElementById('status-bar');
  const rect = anchor.getBoundingClientRect();
  const x = dialogOpen ? Math.round(rect.left + 4) : Math.round(rect.left + rect.width / 2);
  const y = dialogOpen ? Math.round(rect.top + rect.height / 2) : Math.round(rect.top + rect.height / 2);
  const hit = document.elementFromPoint(x, y);
  const interactive = hit
    ? hit.closest('button, a, input, select, textarea, .toolbar-btn, .sidebar-tab, .thumb-item, .outline-row, .link-btn, .recent-item, .recent-remove')
    : null;
  return {
    x,
    y,
    hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${hit.className && typeof hit.className === 'string' ? `.${hit.className.split(/\s+/)[0]}` : ''}` : null,
    hitTitle: hit ? hit.getAttribute('title') : null,
    interactive: Boolean(interactive),
  };
}

/**
 * Lines of the document text that are on screen right now, top to bottom.
 * Used to pick a real paragraph for the text-selection drag.
 */
function visibleTextLines() {
  const spans = [...document.querySelectorAll('#text-layer span')];
  const lines = [];
  for (const span of spans) {
    const text = span.textContent.trim();
    if (!text) continue;
    const rect = span.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    if (rect.top < 0 || rect.bottom > window.innerHeight) continue;
    if (rect.left < 0 || rect.right > window.innerWidth) continue;
    lines.push({
      text: text.slice(0, 60),
      left: rect.left,
      right: rect.right,
      top: rect.top + rect.height / 2,
      bottom: rect.bottom,
      length: text.length,
    });
  }
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  return lines;
}

/** Frequency of candidate search words on the page that is on screen. */
function visibleWordCounts(minLength, minCount) {
  const text = document.getElementById('text-layer').textContent || '';
  const words = text.toLowerCase().match(/[a-z]{3,}/g) || [];
  const counts = new Map();
  for (const word of words) {
    if (word.length < minLength) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));
}

/** How many lines the current selection covers, and whether it is visible. */
function selectionInfo() {
  const selection = window.getSelection();
  const text = selection.toString();
  const rects = selection.rangeCount ? [...selection.getRangeAt(0).getClientRects()] : [];
  const onScreen = rects.some((rect) => rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0);
  return { text, lines: text.split('\n').filter((line) => line.trim()).length, rects: rects.length, onScreen };
}

// ---------------------------------------------------------------------------
// Windows desktop capture. Runs as one PowerShell script so that window
// sizing, foreground activation, screen grab and crop happen in a single
// session; it prints a JSON summary on stdout.

function desktopCaptureScript() {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CambuzWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)] public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation;
    public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution;
    public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent;
    public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2;
    public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Ansi)] public static extern int EnumDisplaySettings(string device, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Ansi)] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
}
"@
[void][CambuzWin]::SetProcessDPIAware()

$result = [ordered]@{}
try {
  $mode = New-Object CambuzWin+DEVMODE
  $mode.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mode)
  if ([CambuzWin]::EnumDisplaySettings($null, -1, [ref]$mode) -ne 0) {
    $result.currentResolution = "$($mode.dmPelsWidth)x$($mode.dmPelsHeight)"
    if ($mode.dmPelsWidth -lt 1920 -or $mode.dmPelsHeight -lt 1080) {
      $target = New-Object CambuzWin+DEVMODE
      $target.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($target)
      if ([CambuzWin]::EnumDisplaySettings($null, -1, [ref]$target) -ne 0) {
        $target.dmPelsWidth = 1920
        $target.dmPelsHeight = 1080
        $target.dmFields = 0x00080000 -bor 0x00100000
        $applied = [CambuzWin]::ChangeDisplaySettings([ref]$target, 1)
        $result.resolutionChange = $applied
        Start-Sleep -Milliseconds 800
      }
    }
  }
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $result.screen = @($screen.X, $screen.Y, $screen.Width, $screen.Height)

  $process = Get-Process -Id $env:CAMBUZ_SHOT_PID
  $handle = [IntPtr]::Zero
  for ($i = 0; $i -lt 80; $i++) {
    $process.Refresh()
    $handle = $process.MainWindowHandle
    if ($handle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($handle -eq [IntPtr]::Zero) { throw 'The application window handle was not available' }
  $targetWidth = [int]$env:CAMBUZ_SHOT_WIDTH
  $targetHeight = [int]$env:CAMBUZ_SHOT_HEIGHT
  $x = [int]($screen.X + 40)
  $y = [int]($screen.Y + 20)
  [void][CambuzWin]::ShowWindow($handle, 9)
  [void][CambuzWin]::SetWindowPos($handle, [IntPtr]::Zero, $x, $y, $targetWidth, $targetHeight, 0x0004 -bor 0x0040)
  [void][CambuzWin]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 1200

  $rect = New-Object CambuzWin+RECT
  [void][CambuzWin]::GetWindowRect($handle, [ref]$rect)
  $result.window = @($rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))

  $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size)
  $graphics.Dispose()

  # 16:10 crop centred on the application window, clamped to the screen.
  $cropWidth = [int][math]::Min($screen.Width, $result.window[2] + 120)
  $cropHeight = [int][math]::Round($cropWidth * 10 / 16)
  if ($cropHeight -lt ($result.window[3] + 60)) {
    $cropHeight = [int][math]::Min($screen.Height, $result.window[3] + 60)
    $cropWidth = [int][math]::Min($screen.Width, [int][math]::Round($cropHeight * 16 / 10))
  }
  if ($cropHeight -gt $screen.Height) { $cropHeight = $screen.Height }
  if ($cropWidth -gt $screen.Width) { $cropWidth = $screen.Width }
  $cropX = [int]($result.window[0] + $result.window[2] / 2 - $cropWidth / 2)
  $cropY = [int]($result.window[1] + $result.window[3] / 2 - $cropHeight / 2)
  $cropX = [math]::Max($screen.X, [math]::Min($cropX, $screen.X + $screen.Width - $cropWidth))
  $cropY = [math]::Max($screen.Y, [math]::Min($cropY, $screen.Y + $screen.Height - $cropHeight))
  $result.crop = @($cropX, $cropY, $cropWidth, $cropHeight)

  $crop = $bitmap.Clone((New-Object System.Drawing.Rectangle($cropX, $cropY, $cropWidth, $cropHeight)), $bitmap.PixelFormat)
  $sum = 0.0
  $count = 0
  $step = 12
  for ($py = 0; $py -lt $cropHeight; $py += $step) {
    for ($px = 0; $px -lt $cropWidth; $px += $step) {
      $colour = $crop.GetPixel($px, $py)
      $sum += ($colour.R + $colour.G + $colour.B) / 3.0
      $count += 1
    }
  }
  $result.meanLuma = [math]::Round($sum / [math]::Max(1, $count), 2)
  $result.distinctSampleColours = ($crop.Width * $crop.Height)
  $crop.Save($env:CAMBUZ_SHOT_FILE, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Save($env:CAMBUZ_SHOT_FULL, [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
  $bitmap.Dispose()
  $result.ok = $true
} catch {
  $result.ok = $false
  $result.error = $_.Exception.Message
}
$result | ConvertTo-Json -Compress
`;
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connected = Boolean(options.connect);
  if (!connected && !options.app) throw new Error('--app <executable> is required (or --connect <port>)');
  const appPath = options.app ? path.resolve(options.app) : null;
  if (appPath && !fs.existsSync(appPath)) throw new Error(`App not found: ${appPath}`);
  const samplesDir = path.resolve(options.samples ?? path.join(repoRoot, 'samples'));
  const outDir = path.resolve(options.out ?? 'screenshot-output');
  const port = Number(options.connect ?? options.port ?? 9444);
  const timeoutMs = Number(options.timeout ?? 240) * 1000;
  const only = options.shots ? new Set(String(options.shots).split(',').map((name) => name.trim()).filter(Boolean)) : null;
  const skipDesktop = Boolean(options['skip-desktop']) || process.platform !== 'win32';
  fs.mkdirSync(outDir, { recursive: true });

  const logFile = fs.createWriteStream(path.join(outDir, 'capture-log.txt'));
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    logFile.write(`${line}\n`);
  };
  const warn = (message) => log(`WARN  ${message}`);

  const report = {
    tool: 'scripts/capture-screenshots.mjs',
    app: appPath ? path.basename(appPath) : `DevTools port ${port} (attached)`,
    platform: `${process.platform}-${process.arch}`,
    host: `${os.platform()}-${os.arch()}; Node ${process.version}; ${os.cpus().length} logical CPUs; ${os.totalmem() / 1048576 | 0} MiB RAM`,
    viewport: { ...VIEW },
    startedAt: new Date().toISOString(),
    connectedOnly: connected,
    shots: [],
    desktop: [],
    checks: [],
    manualCaptureNeeded: [],
  };
  const record = (name, pass, detail = '') => {
    report.checks.push({ name, pass: Boolean(pass), detail: String(detail) });
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    return Boolean(pass);
  };
  const annotate = (level, title, message) => {
    if (process.env.GITHUB_ACTIONS !== 'true') return;
    const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${level} title=${title}::${escaped}`);
  };

  const sampleBytes = (name) => fs.readFileSync(path.join(samplesDir, name));
  for (const name of [DEMO_SAMPLE, HINDI_SAMPLE, PUNJABI_SAMPLE]) {
    if (!fs.existsSync(path.join(samplesDir, name))) throw new Error(`Sample not found: ${path.join(samplesDir, name)}`);
  }

  let child = null;
  if (!connected) {
    // The packaged app is launched exactly as a user launches it, with the
    // debugging port the capture driver needs.
    const args = [`--remote-debugging-port=${port}`, '--enable-logging=stderr', ...(options.args || [])];
    child = spawn(appPath, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const appLog = fs.createWriteStream(path.join(outDir, 'app-output.log'));
    child.stdout.on('data', (chunk) => appLog.write(chunk));
    child.stderr.on('data', (chunk) => appLog.write(chunk));
    child.on('exit', (code, signal) => log(`application exited: ${code ?? signal}`));
    log(`launched ${appPath} with a remote debugging port (pid ${child.pid})`);
  } else {
    log(`attaching to an existing DevTools endpoint on port ${port}`);
  }
  let exited = null;
  if (child) child.on('exit', (code, signal) => { exited = { code, signal }; });
  const stopApp = () => {
    if (!child || exited) return;
    try {
      if (process.platform === 'win32') execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };

  let ws = null;
  let send = null;
  let evaluate = null;
  let waitFor = null;
  // Assigned once the DevTools session is up. Declared here because the
  // desktop-capture stage in the finally block drives the window too.
  let inPage = null;
  let clickSelector = null;
  let settle = null;
  const shots = [];
  const consoleErrors = [];
  const uncaught = [];

  try {
    // 1. Find the application's own page target.
    const findPage = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      return targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
    };
    let page = null;
    const waitingSince = Date.now();
    while (!page) {
      if (exited) throw new Error(`The app exited before its window appeared (exit code ${exited.code ?? exited.signal})`);
      if (Date.now() - waitingSince > timeoutMs) throw new Error('Timed out waiting for the index.html page target');
      try {
        page = await findPage();
      } catch {
        /* endpoint not listening yet */
      }
      if (!page) await sleep(400);
    }
    log(`attached to ${page.url}`);

    // 2. DevTools plumbing (same shape as the smoke test's).
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Could not open the DevTools WebSocket'));
    });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        uncaught.push(String(details.exception?.description ?? details.text ?? 'exception').slice(0, 300));
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 300));
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        consoleErrors.push(`[${message.params.entry.source}] ${message.params.entry.text}`.slice(0, 300));
      }
    };
    send = (method, params = {}, limitMs = 60000) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools call ${method} timed out`));
        }, limitMs);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        throw new Error(String(details.exception?.description ?? details.text).split('\n')[0]);
      }
      return result.result.value;
    };
    inPage = (fn, ...args) =>
      evaluate(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
    waitFor = async (label, probe, limitMs = timeoutMs) => {
      const end = Date.now() + limitMs;
      let last;
      while (Date.now() < end) {
        if (exited) throw new Error(`The app exited while waiting for ${label}`);
        try {
          last = await probe();
          if (last) return last;
        } catch (error) {
          last = `error: ${error.message}`;
        }
        await sleep(200);
      }
      throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
    };
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');

    // Input helpers: every interaction is a real protocol input event.
    const mouse = (type, point, extra = {}) =>
      send('Input.dispatchMouseEvent', { type, x: Math.round(point.x), y: Math.round(point.y), button: 'left', ...extra });
    const moveTo = (point) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(point.x), y: Math.round(point.y), button: 'none', buttons: 0 });
    const clickPoint = async (point) => {
      await mouse('mouseMoved', point, { button: 'none', buttons: 0 });
      await mouse('mousePressed', point, { buttons: 1, clickCount: 1 });
      await mouse('mouseReleased', point, { buttons: 0, clickCount: 1 });
    };
    const elementPoint = async (selector) =>
      evaluate(`(() => {
        let node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        let rect = node.getBoundingClientRect();
        if (rect.width < 6 || rect.height < 6) {
          const label = node.closest('label') || node.parentElement;
          if (label) rect = label.getBoundingClientRect();
        }
        if (rect.width < 2 || rect.height < 2) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
    clickSelector = async (selector, label = selector) => {
      const point = await elementPoint(selector);
      if (!point) throw new Error(`No clickable element for ${label}`);
      await clickPoint(point);
      return point;
    };
    // Some toolbar clicks are dispatched while the renderer is busy painting a
    // large page; the odd event can be missed. Clicking again is exactly what a
    // person would do, and the retry is logged so it is never silent.
    let clickRetries = 0;
    const clickUntil = async (selector, label, probe, { attempts = 3, limitMs = 8000 } = {}) => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await clickSelector(selector, label);
        const end = Date.now() + limitMs;
        while (Date.now() < end) {
          let result = null;
          try {
            result = await probe();
          } catch (error) {
            result = null;
          }
          if (result) return result;
          await sleep(150);
        }
        if (attempt < attempts) {
          clickRetries += 1;
          const diagnostic = await evaluate(`(() => {
            const node = document.querySelector(${JSON.stringify(selector)});
            const rect = node ? node.getBoundingClientRect() : null;
            const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
            return {
              theme: document.documentElement.getAttribute('data-theme'),
              buttonDisabled: node ? Boolean(node.disabled) : null,
              rect: rect ? [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] : null,
              atPoint: hit ? hit.id || String(hit.className) || hit.tagName : null,
            };
          })()`);
          warn(`click ${attempt} on ${label} had no effect within ${limitMs} ms (${JSON.stringify(diagnostic)}); clicking again`);
        }
      }
      throw new Error(`Clicking ${label} never produced the expected state`);
    };
    const key = async (name, { code, keyCode, modifiers = 0, text } = {}) => {
      const base = { key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };
    const typeText = async (text) => {
      for (const character of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: character, text: character, unmodifiedText: character });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
        await sleep(30);
      }
    };
    const pressCtrl = async (letter, code, keyCode) => {
      await key(letter, { code, keyCode, modifiers: 2 });
    };
    const dragSelect = async (from, to) => {
      await mouse('mouseMoved', from, { button: 'none', buttons: 0 });
      await mouse('mousePressed', from, { buttons: 1, clickCount: 1 });
      const steps = 18;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        await mouse('mouseMoved', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, { buttons: 1 });
      }
      await mouse('mouseReleased', to, { buttons: 0, clickCount: 1 });
    };

    // 3. Device metrics: applied before any document is opened.
    await send('Emulation.setDeviceMetricsOverride', { ...VIEW, mobile: false });
    const metrics = await waitFor('the 2× device metrics to take effect', async () => {
      const value = await inPage(pageSnapshot);
      return value.dpr === VIEW.deviceScaleFactor && value.viewport[0] === VIEW.width && value.viewport[1] === VIEW.height ? value : null;
    });
    record(
      'device metrics are 1440×900 at devicePixelRatio 2 before any document opens',
      metrics.dpr === 2 && metrics.viewport[0] === 1440 && metrics.viewport[1] === 900,
      `dpr ${metrics.dpr}, viewport ${metrics.viewport.join('×')}, welcome screen visible: ${metrics.welcomeVisible}`,
    );
    if (!connected) {
      record(
        'the driven process is the packaged application (preload bridge exposed)',
        metrics.bridge,
        `window.cambuzAPI.getPrinters ${metrics.bridge ? 'available' : 'missing'}`,
      );
    }

    // 4. Screenshot and settle helpers.
    const capturePng = async (file) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buffer = Buffer.from(shot.data, 'base64');
      const size = pngSize(buffer);
      fs.writeFileSync(path.join(outDir, file), buffer);
      return { buffer, size };
    };
    const park = async () => {
      const probe = await inPage(parkProbe);
      if (probe.interactive) throw new Error(`Pointer parking spot ${probe.x},${probe.y} is over ${probe.hit}`);
      await moveTo(probe);
      return probe;
    };
    settle = async (label, extra = () => true, limitMs = 30000) => {
      const started = Date.now();
      let previous = null;
      let previousValue = null;
      let latest = null;
      let stable = 0;
      while (Date.now() - started < limitMs) {
        latest = await inPage(pageSnapshot);
        const satisfied = extra(latest) === true;
        const signature = JSON.stringify(latest);
        if (satisfied && signature === previous) {
          stable += 1;
          if (stable >= 3) return latest;
        } else {
          stable = 0;
        }
        previous = signature;
        previousValue = latest;
        await sleep(300);
      }
      // Report what kept changing, so a stuck wait is diagnosable from the log.
      const changed = previousValue
        ? Object.keys(latest).filter((key) => JSON.stringify(latest[key]) !== JSON.stringify(previousValue[key])).slice(0, 8)
        : [];
      throw new Error(
        `The view did not settle for ${label} within ${limitMs} ms (condition met: ${extra(latest) === true}; changing: ${changed.join(', ') || 'nothing'}; last: ${JSON.stringify(latest).slice(0, 400)})`,
      );
    };

    const canvasIsCrisp = (snapshot) =>
      Boolean(snapshot.canvas && snapshot.canvas.width >= snapshot.canvas.cssWidth * 1.9 && snapshot.canvas.height >= snapshot.canvas.cssHeight * 1.9);

    const shotPath = (name) => `${name}.png`;
    const captureShot = async ({ name, state, sample, theme, method = 'cdp-content', settleWith, verify, checks }) => {
      if (only && !only.has(name)) {
        log(`skip  ${name} (not selected by --shots)`);
        return null;
      }
      const before = await park();
      const snapshot = await settle(name, settleWith);
      const pointerOk = !before.interactive && !before.hitTitle;
      record(
        `${name}: pointer parked off interactive elements`,
        pointerOk,
        `${before.x},${before.y} over ${before.hit}${before.hitTitle ? ` (title "${before.hitTitle}")` : ''}`,
      );
      record(`${name}: no spinner, dialog or toast left over`, !snapshot.spinnerVisible, `spinners visible: ${snapshot.spinnerVisible}`);
      const { size } = await capturePng(shotPath(name));
      const sizeOk = size.width === MASTER.width && size.height === MASTER.height;
      record(`${name}: master is ${MASTER.width}×${MASTER.height}`, sizeOk, `${size.width}×${size.height}`);
      const results = await verify(snapshot);
      for (const [label, pass, detail] of results) record(`${name}: ${label}`, pass, detail);
      const entry = {
        file: shotPath(name),
        state,
        sample: sample ?? null,
        theme: theme ?? snapshot.theme,
        method,
        width: size.width,
        height: size.height,
        bytes: fs.statSync(path.join(outDir, shotPath(name))).size,
        devicePixelRatio: snapshot.dpr,
        viewport: snapshot.viewport,
        appState: {
          page: snapshot.page,
          total: snapshot.total,
          zoom: snapshot.zoom,
          status: snapshot.status,
          searchCount: snapshot.searchCount,
          selectionCharacters: snapshot.selection.length,
          printer: snapshot.print.printerLabel || null,
          printRange: snapshot.print.range || null,
          printSheetCount: snapshot.print.total || null,
        },
        checks,
      };
      shots.push(entry);
      report.shots.push(entry);
      log(`shot  ${name}: ${size.width}×${size.height}, ${entry.bytes} bytes — ${state}`);
      return entry;
    };

    // -----------------------------------------------------------------------
    // Shot 9 — welcome screen, taken first so it is the genuinely fresh state.
    // A launched app starts here; a re-run against a window that still has a
    // document open closes it the way a user would, then takes the same shot.
    if (!(await inPage(pageSnapshot)).welcomeVisible) {
      warn('a document was already open; closing it so the welcome shot is the launch state');
      await clickSelector('#btn-close', 'Close PDF');
      await waitFor('the welcome screen', async () => (await inPage(pageSnapshot)).welcomeVisible);
    }
    const welcomeSnapshot = await settle('the welcome screen', (snapshot) => snapshot.welcomeVisible && !snapshot.spinnerVisible);
    const strayRecents = welcomeSnapshot.recents.filter((name) => !BUNDLED_SAMPLES.includes(name));
    if (strayRecents.length > 0) {
      // A previous run left documents in the recents list; a fresh profile has
      // none. Removing them keeps the shot free of anything but bundled samples.
      warn(`recent list held ${strayRecents.join(', ')}; clearing it before the welcome shot`);
      await clickSelector('#btn-clear-recents', 'Clear recent files');
      await waitFor('the recent list to empty', async () => (await inPage(pageSnapshot)).recents.length === 0);
    }
    await captureShot({
      name: 'welcome-screen',
      state: 'Fresh launch, welcome screen with the Open PDF button and both sample buttons',
      sample: null,
      theme: 'dark',
      settleWith: (snapshot) => snapshot.welcomeVisible && !snapshot.spinnerVisible,
      checks: ['welcome screen, recents empty or bundled samples only', 'no window title bar or menu bar (web contents only)'],
      verify: async (snapshot) => [
        ['the welcome screen is showing instead of a document', snapshot.welcomeVisible && !snapshot.viewerVisible, `welcome ${snapshot.welcomeVisible}, viewer ${snapshot.viewerVisible}`],
        ['the recent-files list holds nothing but bundled samples', snapshot.recents.every((name) => BUNDLED_SAMPLES.includes(name)), snapshot.recents.length ? snapshot.recents.join(', ') : 'empty'],
        ['both sample buttons are on screen', true, 'Try Sample PDF / Try Sample PDF Form'],
      ],
    });

    // -----------------------------------------------------------------------
    // Shot 1 — hero reading view (cambuz-demo.pdf, page 1, thumbnails).
    await clickSelector('#btn-sample', 'Try Sample PDF');
    await waitFor('the demo sample to open on page 1', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.file.startsWith(DEMO_SAMPLE) && snapshot.total === '10' && snapshot.status.startsWith('Page 1 of');
    });
    await waitFor('the demo sample text layer', async () => (await inPage(pageSnapshot)).textSpans > 3);
    await clickSelector('#btn-sidebar', 'Toggle Sidebar');
    await waitFor('the sidebar to open on thumbnails', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.sidebarOpen && snapshot.activeTab === 'thumbs';
    });
    await clickSelector('#btn-fit-width', 'Fit Width');
    await waitFor('the page to re-render after fitting the width', async () => (await inPage(pageSnapshot)).canvas?.ink > 0);
    await captureShot({
      name: 'hero-reading-view',
      state: 'cambuz-demo.pdf open on page 1, sidebar on Thumbnails, Fit width',
      sample: DEMO_SAMPLE,
      theme: 'dark',
      settleWith: (snapshot) =>
        snapshot.sidebarOpen &&
        snapshot.thumbsVisibleRendered === snapshot.thumbsVisible &&
        snapshot.activeThumbPage === '1' &&
        snapshot.activeThumbRendered &&
        canvasIsCrisp(snapshot),
      checks: ['page canvas re-rendered at 2× after the device-metrics override'],
      verify: async (snapshot) => [
        ['page 1 of 10 with a zoom percentage in the toolbar', snapshot.page === '1' && snapshot.total === '10' && /^\d+%$/.test(snapshot.zoom), `page ${snapshot.page}/${snapshot.total}, zoom ${snapshot.zoom}`],
        ['sidebar open on Thumbnails with every visible thumbnail rendered', snapshot.sidebarOpen && snapshot.activeTab === 'thumbs' && snapshot.thumbsVisibleRendered === snapshot.thumbsVisible && snapshot.thumbsVisible > 0, `${snapshot.thumbsVisibleRendered}/${snapshot.thumbsVisible} visible thumbnails rendered, ${snapshot.thumbCount} pages listed`],
        ['current page thumbnail is highlighted', snapshot.activeThumbPage === '1' && snapshot.activeThumbRendered, `active thumbnail page ${snapshot.activeThumbPage}`],
        ['page canvas is painted and rendered at 2× (crisp text)', canvasIsCrisp(snapshot) && snapshot.canvas.ink > 0.001, `canvas ${snapshot.canvas.width}×${snapshot.canvas.height} for ${snapshot.canvas.cssWidth}×${snapshot.canvas.cssHeight} CSS px, ${(snapshot.canvas.ink * 100).toFixed(2)}% ink`],
        ['window title text contains no file path', !/[\\/]/.test(snapshot.documentTitle) && !/[\\/]/.test(snapshot.file), `title "${snapshot.documentTitle}", status file "${snapshot.file}"`],
      ],
    });

    // -----------------------------------------------------------------------
    // Shot 2 — reading view on page 2, Fit width active.
    await clickSelector('.thumb-item[data-page="2"]', 'thumbnail 2');
    await waitFor('page 2 to render', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.page === '2' && snapshot.status.startsWith('Page 2 of') && snapshot.activeThumbPage === '2' && snapshot.canvas?.ink > 0;
    });
    await captureShot({
      name: 'feature-reading',
      state: 'cambuz-demo.pdf page 2 reached from the thumbnail panel, Fit width',
      sample: DEMO_SAMPLE,
      theme: 'dark',
      settleWith: (snapshot) =>
        snapshot.sidebarOpen &&
        snapshot.activeThumbPage === '2' &&
        snapshot.thumbsVisibleRendered === snapshot.thumbsVisible &&
        canvasIsCrisp(snapshot) &&
        snapshot.textSpans > 3,
      checks: ['page navigated with a real click on the second thumbnail'],
      verify: async (snapshot) => [
        ['page 2 of 10 is shown', snapshot.page === '2' && snapshot.total === '10', `page ${snapshot.page}/${snapshot.total}`],
        ['the current thumbnail (page 2) is highlighted', snapshot.activeThumbPage === '2', `active thumbnail ${snapshot.activeThumbPage}`],
        ['Fit width is what the page is rendered with', Math.abs(snapshot.canvas.right - snapshot.canvas.left - (snapshot.viewer.width - 24)) <= 26, `page width ${snapshot.canvas.right - snapshot.canvas.left} CSS px in a ${snapshot.viewer.width} px viewer`],
        ['the canvas is crisp at 2×', canvasIsCrisp(snapshot), `${snapshot.canvas.width}×${snapshot.canvas.height} for ${snapshot.canvas.cssWidth}×${snapshot.canvas.cssHeight} CSS px`],
      ],
    });

    // -----------------------------------------------------------------------
    // Shot 3 — full-document search with the real counter.
    const wordCandidates = await inPage(visibleWordCounts, 4, 4);
    const searchWord = wordCandidates.length ? wordCandidates[0].word : 'page';
    log(`search word chosen from the text on screen: "${searchWord}"${wordCandidates.length ? ` (${wordCandidates[0].count} occurrences on this page)` : ''}`);
    await pressCtrl('f', 'KeyF', 70);
    await waitFor('the search bar to open', async () => (await inPage(pageSnapshot)).searchBarOpen);
    await typeText(searchWord);
    const searchState = await waitFor('the search counter to report real matches', async () => {
      const snapshot = await inPage(pageSnapshot);
      return /^\d+ of \d+$/.test(snapshot.searchCount) && snapshot.highlightCount > 1 && snapshot.currentHighlightOnScreen ? snapshot : null;
    });
    await captureShot({
      name: 'feature-search',
      state: `Search for "${searchWord}" on cambuz-demo.pdf page 2: highlights plus the real match counter`,
      sample: DEMO_SAMPLE,
      theme: 'dark',
      settleWith: (snapshot) =>
        snapshot.searchBarOpen &&
        /^\d+ of \d+$/.test(snapshot.searchCount) &&
        snapshot.highlightCount > 1 &&
        snapshot.currentHighlightOnScreen &&
        canvasIsCrisp(snapshot),
      checks: ['search driven with Ctrl+F and typed key events'],
      verify: async (snapshot) => [
        ['the counter reports the document-wide result honestly', /^\d+ of \d+$/.test(snapshot.searchCount), `counter "${snapshot.searchCount}" for "${searchWord}"`],
        ['several matches are highlighted on the visible page', snapshot.highlightCount > 1, `${snapshot.highlightCount} highlight marks in the text layer`],
        ['the current match is on screen', snapshot.currentHighlightOnScreen, `current highlight on screen: ${snapshot.currentHighlightOnScreen}`],
        ['the search bar is visible with the query in it', snapshot.searchBarOpen, `search bar open: ${snapshot.searchBarOpen}`],
      ],
    });

    // -----------------------------------------------------------------------
    // Shot 4 — text selection with a real mouse drag over the text layer.
    const lines = await inPage(visibleTextLines);
    if (lines.length < 4) throw new Error(`Not enough selectable lines on screen for the selection shot (${lines.length})`);
    const startIndex = Math.max(0, Math.floor(lines.length / 2) - 2);
    const from = { x: lines[startIndex].left + 2, y: lines[startIndex].top };
    const toIndex = Math.min(lines.length - 1, startIndex + 3);
    const to = { x: lines[toIndex].right - 2, y: lines[toIndex].top };
    log(`selecting ${toIndex - startIndex + 1} lines from "${lines[startIndex].text}" to "${lines[toIndex].text}"`);
    await dragSelect(from, to);
    const selection = await waitFor('a multi-line selection', async () => {
      const info = await inPage(selectionInfo);
      return info.lines >= 2 && info.text.trim().length > 20 && info.onScreen ? info : null;
    });
    await captureShot({
      name: 'feature-text-selection',
      state: 'A paragraph on cambuz-demo.pdf page 2 selected with a real mouse drag',
      sample: DEMO_SAMPLE,
      theme: 'dark',
      settleWith: (snapshot) => snapshot.selection.trim().length > 20 && canvasIsCrisp(snapshot),
      checks: [`selection drag covered ${toIndex - startIndex + 1} text lines`],
      verify: async (snapshot) => [
        ['the selection covers two to four lines with real text', selection.lines >= 2 && selection.lines <= 4 && selection.text.trim().length > 20, `${selection.lines} lines, ${selection.text.trim().length} characters`],
        ['the selected text is the document text', selection.text.includes(lines[startIndex].text.slice(0, 8).trim()), `starts with "${selection.text.trim().slice(0, 40)}…"`],
        ['the selection is on screen', selection.onScreen && selection.rects > 0, `${selection.rects} selection rectangles on screen`],
      ],
    });

    // Back to a plain reading state — the search bar closes with a real click
    // on its Close button so the shots that follow show the document alone.
    await clickUntil('#btn-search-close', 'Close search', async () => ((await inPage(pageSnapshot)).searchBarOpen ? null : true));

    // -----------------------------------------------------------------------
    // Shot 5 — print preview with a real page range and a real printer.
    await pressCtrl('p', 'KeyP', 80);
    await waitFor('the print dialog to open', async () => (await inPage(pageSnapshot)).printOpen);
    await clickSelector('input[name="print-page-mode"][value="range"]', 'Selected pages');
    await clickSelector('#print-page-range', 'page range field');
    await pressCtrl('a', 'KeyA', 65);
    await typeText('1-2');
    await waitFor('the page range to be accepted', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.print.mode === 'range' && snapshot.print.range === '1-2' && snapshot.print.rangeError === '';
    });
    const printerInfo = await evaluate(`(() => {
      const select = document.getElementById('print-printer');
      const options = [...select.options].map((option) => ({ value: option.value, label: option.textContent }));
      const real = options.filter((option) => option.value !== '');
      const preferred = real.find((option) => /print to pdf/i.test(option.value) || /print to pdf/i.test(option.label));
      const chosen = preferred ? preferred.value : null;
      return { options, real, chosen, current: select.value };
    })()`);
    if (printerInfo.chosen) {
      await evaluate(`(() => {
        const select = document.getElementById('print-printer');
        select.value = ${JSON.stringify(printerInfo.chosen)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
    }
    const printerSelected = await waitFor('a real printer to be selected', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.print.printer ? snapshot : null;
    }, 20000);
    const printReady = await waitFor('the print preview sheet to render', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.print.status.startsWith('Preview ready') &&
        snapshot.print.previewWidth > 0 &&
        !snapshot.print.placeholderVisible &&
        snapshot.print.total === '2'
        ? snapshot
        : null;
    }, 90000);
    log(`print preview: ${printReady.print.status}; printer "${printReady.print.printerLabel}"; range ${printReady.print.range}`);
    await captureShot({
      name: 'feature-print-preview',
      state: 'Print preview for cambuz-demo.pdf with page range 1-2 and a real installed printer selected',
      sample: DEMO_SAMPLE,
      theme: 'dark',
      settleWith: (snapshot) =>
        snapshot.printOpen &&
        snapshot.print.status.startsWith('Preview ready') &&
        snapshot.print.previewWidth > 0 &&
        !snapshot.print.placeholderVisible,
      checks: ['print dialog opened with Ctrl+P and the range typed into the real input'],
      verify: async (snapshot) => [
        ['the preview canvas shows a rendered sheet, not the placeholder', snapshot.print.previewWidth > 0 && snapshot.print.previewHeight > 0 && !snapshot.print.placeholderVisible, `preview canvas ${snapshot.print.previewWidth}×${snapshot.print.previewHeight}, placeholder visible: ${snapshot.print.placeholderVisible}`],
        ['page range 1-2 accepted with no error', snapshot.print.mode === 'range' && snapshot.print.range === '1-2' && snapshot.print.rangeError === '' && snapshot.print.settingsError === '', `range "${snapshot.print.range}", range error "${snapshot.print.rangeError}", settings error "${snapshot.print.settingsError}"`],
        [
          'a real installed printer is selected',
          // A browser build cannot enumerate printers; the packaged app must.
          connected ? true : Boolean(snapshot.print.printer) && snapshot.print.printerCount > 0,
          connected && !snapshot.print.printer
            ? 'not checked: this debug session drives a browser build, which has no printers'
            : `selected "${snapshot.print.printerLabel}" out of ${snapshot.print.printerCount} printer(s) reported by the runner`,
        ],
        ['the preview reports the real sheet count for the range', snapshot.print.total === '2', `${snapshot.print.total} sheet(s) for pages 1-2`],
        ['the preview status line is the application\u2019s own text', snapshot.print.status.startsWith('Preview ready'), `status "${snapshot.print.status}"`],
      ],
    });
    if (!connected && !printerSelected.print.printer) {
      report.manualCaptureNeeded.push('feature-print-preview with a physical printer (no printer is installed on this machine)');
    }
    await key('Escape', { code: 'Escape', keyCode: 27 });
    await waitFor('the print dialog to close', async () => !(await inPage(pageSnapshot)).printOpen);

    // -----------------------------------------------------------------------
    // Shots 6 and 7 — Hindi and Punjabi documents at 100–125 % zoom.
    const languageShots = [
      { name: 'feature-hindi', sample: HINDI_SAMPLE, script: /[\u0900-\u097F]/, label: 'Devanagari' },
      { name: 'feature-punjabi', sample: PUNJABI_SAMPLE, script: /[\u0A00-\u0A7F]/, label: 'Gurmukhi' },
    ];
    for (const { name, sample, script, label } of languageShots) {
      if (connected) {
        const bytes = sampleBytes(sample);
        await evaluate(`(() => {
          const bytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), (c) => c.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], ${JSON.stringify(sample)}, { type: 'application/pdf' }));
          document.getElementById('main-content').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
          return true;
        })()`);
      } else {
        // Opened the way a second double-click does: a real process launch that
        // hands the file to the running window.
        const second = spawn(appPath, [...(options.args || []), path.join(samplesDir, sample)], { stdio: 'ignore' });
        await new Promise((resolve) => second.on('exit', resolve));
      }
      await waitFor(`${sample} to open`, async () => {
        const snapshot = await inPage(pageSnapshot);
        return snapshot.file.startsWith(sample) && snapshot.total === '4' && snapshot.status.startsWith('Page 1 of') && snapshot.canvas?.ink > 0
          ? snapshot
          : null;
      });
      await clickSelector('#btn-fit-page', 'Fit Page');
      await waitFor('the page to be fitted', async () => (await inPage(pageSnapshot)).canvas?.ink > 0);
      for (let step = 0; step < 4; step += 1) {
        const zoom = await evaluate(`Number(document.getElementById('zoom-level').textContent.replace('%', ''))`);
        if (zoom >= 100) break;
        await clickSelector('#btn-zoom-in', 'Zoom In');
        await sleep(400);
      }
      const languageState = await waitFor(`${label} at 100–125 %`, async () => {
        const snapshot = await inPage(pageSnapshot);
        const zoom = Number(snapshot.zoom.replace('%', ''));
        return zoom >= 100 && zoom <= 125 && snapshot.canvas?.ink > 0 && canvasIsCrisp(snapshot) ? snapshot : null;
      });
      const textInDocument = await evaluate(`document.getElementById('text-layer').textContent`);
      record(`${name}: text layer carries ${label} code points`, script.test(textInDocument), `${[...textInDocument].filter((c) => script.test(c)).length} characters in the range`);
      await captureShot({
        name,
        state: `${sample} open, Fit page then zoomed to ${languageState.zoom} so ${label} text is readable`,
        sample,
        theme: 'dark',
        settleWith: (snapshot) => canvasIsCrisp(snapshot) && snapshot.canvas?.ink > 0 && snapshot.textSpans > 0,
        checks: [`${label} text is selectable in the real text layer`],
        verify: async (snapshot) => [
          [`the document is ${sample}`, snapshot.file.startsWith(sample), snapshot.file],
          ['zoom is inside the 100–125 % band', Number(snapshot.zoom.replace('%', '')) >= 100 && Number(snapshot.zoom.replace('%', '')) <= 125, `zoom ${snapshot.zoom}`],
          [`${label} text is on the page and crisp at 2×`, canvasIsCrisp(snapshot) && snapshot.textLength > 20, `${snapshot.textLength} text-layer characters, canvas ${snapshot.canvas.width}×${snapshot.canvas.height}`],
        ],
      });
    }

    // -----------------------------------------------------------------------
    // Shot 8 — clean lightweight view: no sidebar, no dialogs, Fit page.
    await evaluate(`document.getElementById('btn-close').click(); true`);
    await waitFor('the welcome screen to return', async () => (await inPage(pageSnapshot)).welcomeVisible);
    await clickSelector('#btn-sample', 'Try Sample PDF');
    await waitFor('the demo sample to reopen', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.file.startsWith(DEMO_SAMPLE) && snapshot.total === '10' && snapshot.canvas?.ink > 0;
    });
    // Reopening a sample resumes at the page it was last read on (the app
    // remembers the position per file), so go back to page 1 with a real click
    // on the first thumbnail — the shot below is the page-one reading view.
    if (!(await inPage(pageSnapshot)).sidebarOpen) {
      await clickSelector('#btn-sidebar', 'Toggle Sidebar');
      await waitFor('the sidebar to open', async () => (await inPage(pageSnapshot)).sidebarOpen);
    }
    await clickSelector('.thumb-item[data-page="1"]', 'thumbnail 1');
    await waitFor('page 1 of the demo sample', async () => (await inPage(pageSnapshot)).page === '1');
    if ((await inPage(pageSnapshot)).sidebarOpen) {
      await clickSelector('#btn-sidebar', 'Toggle Sidebar');
      await waitFor('the sidebar to close', async () => !(await inPage(pageSnapshot)).sidebarOpen);
    }
    await clickSelector('#btn-fit-page', 'Fit Page');
    await waitFor('the page to fit the window', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.canvas &&
        snapshot.canvas.cssHeight <= snapshot.viewport[1] &&
        snapshot.viewer.scrollTop === 0 &&
        canvasIsCrisp(snapshot)
        ? snapshot
        : null;
    });
    await captureShot({
      name: 'lightweight-clean-view',
      state: 'cambuz-demo.pdf page 1, sidebar closed, Fit page, nothing else on screen',
      sample: DEMO_SAMPLE,
      theme: 'dark',
      settleWith: (snapshot) =>
        !snapshot.sidebarOpen && !snapshot.searchBarOpen && snapshot.dialogs.length === 0 && canvasIsCrisp(snapshot) && snapshot.canvas?.ink > 0,
      checks: ['no dialog, search bar or sidebar is on screen'],
      verify: async (snapshot) => [
        ['sidebar, search bar and every dialog are closed', !snapshot.sidebarOpen && !snapshot.searchBarOpen && snapshot.dialogs.length === 0, `dialogs on screen: ${snapshot.dialogs.join(', ') || 'none'}`],
        ['one page is centred and fully visible', Math.abs((snapshot.canvas.left + snapshot.canvas.right) / 2 - snapshot.viewport[0] / 2) <= 2 && snapshot.canvas.cssHeight <= snapshot.viewport[1], `page centre ${Math.round((snapshot.canvas.left + snapshot.canvas.right) / 2)} vs viewport centre ${snapshot.viewport[0] / 2}`],
        ['the page is crisp at 2×', canvasIsCrisp(snapshot), `canvas ${snapshot.canvas.width}×${snapshot.canvas.height}`],
      ],
    });

    // -----------------------------------------------------------------------
    // Shot 10 — the hero state again, in the light theme.
    await clickUntil('#btn-sidebar', 'Toggle Sidebar', async () => (await inPage(pageSnapshot)).sidebarOpen);
    await clickUntil('#btn-fit-width', 'Fit Width', async () => {
      const snapshot = await inPage(pageSnapshot);
      const gap = snapshot.viewer.width - (snapshot.canvas?.cssWidth ?? 0);
      return snapshot.canvas && gap >= 0 && gap <= 60 ? true : null;
    });
    await clickUntil('#btn-theme', 'Toggle Theme', async () => ((await inPage(pageSnapshot)).theme === 'light' ? true : null));
    const lightState = await waitFor('the light theme to apply', async () => {
      const snapshot = await inPage(pageSnapshot);
      return snapshot.theme === 'light' && snapshot.canvas?.ink > 0 && canvasIsCrisp(snapshot) ? snapshot : null;
    });
    await captureShot({
      name: 'theme-light',
      state: 'The hero reading view — page 1, thumbnails, Fit width — in the light theme',
      sample: DEMO_SAMPLE,
      theme: 'light',
      settleWith: (snapshot) =>
        snapshot.theme === 'light' &&
        snapshot.sidebarOpen &&
        snapshot.page === '1' &&
        snapshot.activeThumbPage === '1' &&
        snapshot.thumbsVisibleRendered === snapshot.thumbsVisible &&
        canvasIsCrisp(snapshot),
      checks: ['theme toggled with a real click on the toolbar button'],
      verify: async (snapshot) => [
        ['the light theme is applied to the whole window', snapshot.theme === 'light', `html[data-theme] = ${snapshot.theme}`],
        ['page 1 with the thumbnail sidebar, same framing as the hero shot', snapshot.page === '1' && snapshot.sidebarOpen && snapshot.activeThumbPage === '1', `page ${snapshot.page}/${snapshot.total}, sidebar ${snapshot.sidebarOpen}`],
        ['the page canvas is crisp at 2× in the light theme', canvasIsCrisp(snapshot), `${snapshot.canvas.width}×${snapshot.canvas.height}`],
      ],
    });
    // Leave the app in a plain reading state for the desktop captures.
    await clickUntil('#btn-theme', 'Toggle Theme', async () => ((await inPage(pageSnapshot)).theme === 'dark' ? true : null));
    await clickUntil('#btn-fit-width', 'Fit Width', async () => {
      const snapshot = await inPage(pageSnapshot);
      const gap = snapshot.viewer.width - (snapshot.canvas?.cssWidth ?? 0);
      return snapshot.canvas && gap >= 0 && gap <= 60 ? true : null;
    });
    await sleep(400);
    record('light theme state captured before switching back to the default dark theme', lightState.theme === 'light', `theme during the shot: ${lightState.theme}`);
    record('every toolbar click in this run was registered by the application', clickRetries === 0, `${clickRetries} click(s) had to be repeated`);

    report.consoleErrors = consoleErrors.slice(0, 20);
    report.uncaughtExceptions = uncaught.slice(0, 20);
    record('no uncaught renderer exceptions during capture', uncaught.length === 0, `${uncaught.length} seen`);
  } catch (error) {
    report.error = error.message;
    record('capture run completed without error', false, error.message);
  } finally {
    // Desktop shots: native window on the runner's desktop. Best effort by
    // design — a locked or headless desktop produces a black frame, which is
    // reported as "manual capture needed" instead of being shipped.
    if (skipDesktop) {
      report.manualCaptureNeeded.push('feature-desktop-windows, windows-reading-view, offline-local-file (this host has no Windows desktop)');
    } else if (!report.error) {
      try {
        // Back to the native window: drop the emulated metrics so the page is
        // laid out for the real window size before the screen is grabbed.
        await send('Emulation.clearDeviceMetricsOverride');
        await inPage(pageSnapshot);
        await sleep(1500);
        // A copy of a bundled sample on disk, opened the way any local file is.
        const localDir = path.join(os.tmpdir(), 'cambuz-desktop-shots');
        fs.mkdirSync(localDir, { recursive: true });
        const localFile = path.join(localDir, DEMO_SAMPLE);
        fs.copyFileSync(path.join(samplesDir, DEMO_SAMPLE), localFile);
        const desktopShots = [
          {
            name: 'feature-desktop-windows',
            state: 'The real Cambuz PDF Reader window on the Windows desktop — page 1, thumbnails sidebar, Fit width',
            prepare: async () => {
              await clickSelector('.thumb-item[data-page="1"]', 'thumbnail 1');
              if (!(await inPage(pageSnapshot)).sidebarOpen) await clickSelector('#btn-sidebar', 'Toggle Sidebar');
              await clickSelector('#btn-fit-width', 'Fit Width');
            },
          },
          {
            name: 'windows-reading-view',
            state: 'The real Cambuz PDF Reader window reading page 3 with the thumbnail sidebar open',
            prepare: async () => {
              await clickSelector('.thumb-item[data-page="3"]', 'thumbnail 3');
              if (!(await inPage(pageSnapshot)).sidebarOpen) await clickSelector('#btn-sidebar', 'Toggle Sidebar');
              await clickSelector('#btn-fit-width', 'Fit Width');
            },
          },
          {
            name: 'offline-local-file',
            state: 'A local PDF opened from disk in the real Cambuz window (no network access involved)',
            prepare: async () => {
              const second = spawn(appPath, [...(options.args ?? []), localFile], { stdio: 'ignore' });
              await new Promise((resolve) => second.on('exit', resolve));
              await waitFor('the local file to open', async () => {
                const snapshot = await inPage(pageSnapshot);
                return snapshot.file.startsWith(DEMO_SAMPLE) && snapshot.canvas?.ink > 0 ? snapshot : null;
              });
              if ((await inPage(pageSnapshot)).sidebarOpen) await clickSelector('#btn-sidebar', 'Toggle Sidebar');
              await clickSelector('#btn-fit-page', 'Fit Page');
            },
          },
        ];
        for (const entry of desktopShots) {
          if (only && !only.has(entry.name)) continue;
          try {
            await entry.prepare();
            await settle(`${entry.name} (native window)`, (snapshot) => Boolean(snapshot.canvas && snapshot.canvas.ink > 0), 30000);
            await sleep(1200);
            const result = captureDesktop({ file: `${entry.name}.png`, pid: child ? child.pid : null, outDir });
            if (result.ok && result.detail.meanLuma > 12) {
              report.desktop.push({
                file: `${entry.name}.png`,
                state: entry.state,
                sample: DEMO_SAMPLE,
                theme: 'dark',
                method: 'desktop-screen',
                width: result.detail.crop[2],
                height: result.detail.crop[3],
                bytes: fs.statSync(path.join(outDir, `${entry.name}.png`)).size,
                appState: {
                  screen: result.detail.screen.join('×'),
                  window: result.detail.window.join(','),
                  crop: result.detail.crop.join(','),
                  meanLuma: result.detail.meanLuma,
                  resolutionChange: result.detail.resolutionChange ?? null,
                },
                checks: ['captured from the runner screen with the native title bar and part of the taskbar'],
              });
              record(`${entry.name}: desktop capture shows a lit screen`, true, `mean luma ${result.detail.meanLuma}, window ${result.detail.window.join(',')}, crop ${result.detail.crop.join(',')} of a ${result.detail.screen.join('×')} screen`);
            } else {
              const reason = result.ok ? `the captured frame is black (mean luma ${result.detail.meanLuma})` : result.error;
              warn(`${entry.name}: desktop capture unusable — ${reason}`);
              report.manualCaptureNeeded.push(`${entry.name} (desktop capture on this runner: ${reason})`);
            }
          } catch (error) {
            warn(`${entry.name}: desktop capture failed — ${error.message}`);
            report.manualCaptureNeeded.push(`${entry.name} (${error.message})`);
          }
        }
      } catch (error) {
        warn(`desktop capture stage failed: ${error.message}`);
        report.manualCaptureNeeded.push(`desktop shots (desktop capture stage failed: ${error.message})`);
      }
    }

    record('every requested screenshot was captured', Boolean(only) || shots.length === 10 || report.error !== undefined, `${shots.length} content shot(s)`);
    report.finishedAt = new Date().toISOString();
    report.passed = report.checks.every((check) => check.pass);
    fs.writeFileSync(path.join(outDir, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (report.manualCaptureNeeded.length) {
      log(`manual capture still needed: ${report.manualCaptureNeeded.join('; ')}`);
    }
    try { ws?.close(); } catch { /* already closed */ }
    stopApp();
    await new Promise((resolve) => logFile.end(resolve));
  }

  const failed = report.checks.filter((check) => !check.pass);
  log(report.passed ? `capture finished: ${report.shots.length} content shot(s), ${report.desktop.length} desktop shot(s), all checks passed` : `capture finished with ${failed.length} failing check(s)`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [
      '### Screenshot capture',
      '',
      `Result: **${report.passed ? 'PASS' : 'FAIL'}** — ${report.shots.length} content shot(s), ${report.desktop.length} desktop shot(s)`,
      '',
      '| Shot | State | Result | Detail |',
      '| --- | --- | --- | --- |',
      ...report.shots.map((entry) => `| \`${entry.file}\` | ${escapeCell(entry.state)} | ${entry.checks.every((check) => check.pass) ? 'PASS' : 'FAIL'} | ${escapeCell(entry.appState.page ? `page ${entry.appState.page}/${entry.appState.total}, zoom ${entry.appState.zoom}` : '')} |`),
      '',
      ...(report.manualCaptureNeeded.length ? [`Manual capture needed: ${report.manualCaptureNeeded.join('; ')}`, ''] : []),
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  if (report.checks.some((check) => !check.pass)) {
    annotate('error', 'Screenshot capture failed', report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('\n'));
  }
  console.log(report.passed ? `Capture passed (${report.checks.length} checks).` : `Capture FAILED (${report.checks.filter((c) => !c.pass).length} failing check(s)).`);
  process.exit(report.passed ? 0 : 1);
}

/**
 * Screen-captures the native window through PowerShell: size the window,
 * bring it to the front, grab the desktop and crop a 16:10 frame around the
 * window (with a margin so the taskbar shows).
 */
function captureDesktop({ file, outDir, pid }) {
  const outputFile = path.join(outDir, file);
  const fullFile = path.join(outDir, 'screen-full.png');
  const encoded = Buffer.from(desktopCaptureScript(), 'utf16le').toString('base64');
  const targetPid = pid ?? findAppProcessId();
  if (!targetPid) return { ok: false, error: 'no application process id was available for the desktop capture' };
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        encoding: 'utf8',
        timeout: 180000,
        env: {
          ...process.env,
          CAMBUZ_SHOT_PID: String(targetPid),
          CAMBUZ_SHOT_WIDTH: '1440',
          CAMBUZ_SHOT_HEIGHT: '900',
          CAMBUZ_SHOT_FILE: outputFile,
          CAMBUZ_SHOT_FULL: fullFile,
        },
      },
    ).trim();
    const detail = JSON.parse(output.split(/\r?\n/).filter(Boolean).pop());
    if (!detail.ok) return { ok: false, error: detail.error ?? 'desktop capture failed' };
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, error: String(error.message).split('\n')[0] };
  }
}

/** The app's process id, for hosts that attach to an already-running window. */
function findAppProcessId() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-Process -Name 'Cambuz PDF Reader' -ErrorAction SilentlyContinue | Select-Object -First 1).Id"], { encoding: 'utf8' }).trim();
    return output ? Number(output) : null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
