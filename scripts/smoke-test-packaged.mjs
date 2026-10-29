#!/usr/bin/env node
// Cambuz PDF Reader — packaged-app smoke test.
//
// Starts an executable with Chromium's remote-debugging port and drives the real
// renderer over the DevTools protocol. No test hooks are added to the app. Checks:
//   1. the window opens, the title is right and the preload bridge is exposed;
//   2. both welcome-screen sample buttons open their documents, and the form
//      sample shows its fillable fields;
//   3. when --launch-pdf/--second-pdf are given, a launch-with-file argument opens
//      its document and a second process hands off to the running window;
//   4. a PDF is opened through the same drop path a user uses; PDF.js reports the
//      expected page count, paints the page canvas and builds a text layer;
//   5. the text layer sits exactly over the canvas, every span is over painted
//      glyphs, and spans are the top element under the pointer;
//   6. real mouse input (DevTools Input events) selects multi-line text, Ctrl+C
//      copies it, and on Windows the system clipboard receives it;
//   7. Hindi and Punjabi PDFs select and copy their Unicode text;
//   8. a PDF that denies copying refuses selection and says why;
//   9. page navigation, zoom, print-preview preparation, a 100-page first/repeat
//      search probe, a scanned-page render and repeated open/close cycles work;
//   10. startup/first-page timings and Windows process-tree memory are recorded
//      as observations, never treated as performance pass thresholds.
// A screenshot, the app's log, console/log errors and a JSON report are written
// to --out so they can be uploaded as CI evidence. Exits non-zero on any
// gating check failure.
//
// Usage:
//   node scripts/smoke-test-packaged.mjs --app <executable> [--pdf <file>]
//        [--out <dir>] [--port <n>] [--timeout <seconds>] [--arg <switch>]...
//        [--launch-pdf <file>] [--second-pdf <file>]
// When --launch-pdf is given, the app is started with that file path (as a
// double-click / Open With launch would) and the run first checks the document
// opened; --second-pdf then starts a second process with another file and
// checks the running window switched to it. Both probe the OS file-open
// integration with real process launches, not the in-page drop path.

import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Documents used by the selection checks.
const HINDI_PDF = path.join(repoRoot, 'samples', 'hindi-sample.pdf');
const PUNJABI_PDF = path.join(repoRoot, 'samples', 'punjabi-sample.pdf');
const COPY_DENIED_PDF = path.join(repoRoot, 'scripts', 'fixtures', 'secure-permissions-only.pdf');

function parseArgs(argv) {
  const options = { args: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || !flag.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value pairs; problem near "${flag ?? ''}"`);
    }
    const name = flag.slice(2);
    if (name === 'arg') options.args.push(value);
    else options[name] = value;
  }
  return options;
}

async function makePackagedSearchProbe() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Cambuz Phase 8 packaged search probe');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 100; number += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`CAMBUZ PERFORMANCE CHECK PAGE ${String(number).padStart(3, '0')}`, {
      x: 36,
      y: 740,
      size: 14,
      font,
    });
  }
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------
// Functions that run inside the renderer. They are serialised with toString(),
// so they must not refer to anything from this file.

function firstSpansForDrag(lastIndex) {
  const spans = [...document.querySelectorAll('#text-layer span')].filter((span) => span.textContent.trim().length > 0);
  if (spans.length < 2) return null;
  spans[0].scrollIntoView({ block: 'center' });
  const first = spans[0].getBoundingClientRect();
  const last = spans[Math.min(lastIndex, spans.length - 1)].getBoundingClientRect();
  return {
    from: { x: first.left + 2, y: first.top + first.height / 2 },
    to: { x: last.right - 2, y: last.top + last.height / 2 },
    firstText: spans[0].textContent,
  };
}

function pageAlignment() {
  const canvas = document.getElementById('pdf-canvas');
  const layer = document.getElementById('text-layer');
  const c = canvas.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  const maxEdgeDelta = Math.max(
    Math.abs(c.left - l.left),
    Math.abs(c.top - l.top),
    Math.abs(c.width - l.width),
    Math.abs(c.height - l.height),
  );
  const sx = canvas.width / c.width;
  const sy = canvas.height / c.height;
  const ctx = canvas.getContext('2d');
  let inspected = 0;
  let withInk = 0;
  for (const span of layer.querySelectorAll('span')) {
    if (span.textContent.trim().length < 3) continue;
    const r = span.getBoundingClientRect();
    if (r.top < c.top || r.bottom > c.bottom || r.left < c.left || r.right > c.right) continue;
    const x = Math.floor((r.left - c.left) * sx);
    const y = Math.floor((r.top - c.top) * sy);
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(r.width * sx)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(r.height * sy)));
    const data = ctx.getImageData(x, y, w, h).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 160 || data[i + 1] < 160 || data[i + 2] < 160) dark += 1;
    }
    inspected += 1;
    if (dark > 0) withInk += 1;
  }
  return { maxEdgeDelta: Number(maxEdgeDelta.toFixed(2)), inspected, withInk };
}

function textHitTest() {
  const layer = document.getElementById('text-layer');
  const spans = [...layer.querySelectorAll('span')].filter((span) => span.textContent.trim().length > 0);
  let visible = 0;
  let hit = 0;
  for (const span of spans) {
    const r = span.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
    visible += 1;
    const top = document.elementFromPoint(cx, cy);
    if (top && layer.contains(top)) hit += 1;
    if (visible >= 12) break;
  }
  return { visible, hit, userSelect: getComputedStyle(layer).userSelect };
}

function viewerState() {
  const layer = document.getElementById('text-layer');
  const canvas = document.getElementById('pdf-canvas');
  return {
    welcomeVisible: getComputedStyle(document.getElementById('welcome-screen')).display !== 'none',
    file: document.getElementById('status-file').textContent,
    pages: Number(document.getElementById('page-total').textContent),
    page: Number(document.getElementById('page-input').value),
    zoom: document.getElementById('zoom-level').textContent,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    status: document.getElementById('status-text').textContent,
    textLength: layer.textContent.trim().length,
    noCopyClass: layer.classList.contains('no-copy'),
    userSelect: getComputedStyle(layer).userSelect,
    formWidgets: document.querySelectorAll('#form-layer .form-widget').length,
    errorShown: getComputedStyle(document.getElementById('error-display')).display !== 'none',
  };
}

function canvasPaintStats() {
  const canvas = document.getElementById('pdf-canvas');
  if (!canvas?.width || !canvas?.height) return { width: 0, height: 0, dark: 0, samples: 0 };
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let dark = 0;
  let samples = 0;
  for (let i = 0; i < data.length; i += 4 * 61) {
    samples += 1;
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark += 1;
  }
  return { width: canvas.width, height: canvas.height, dark, samples };
}

function measureSearchInPage(query) {
  const input = document.getElementById('search-input');
  const count = document.getElementById('search-count');
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const observer = new MutationObserver(() => finish());
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Search did not finish for ${query}`));
    }, 20000);
    const finish = () => {
      const label = count.textContent.trim();
      if (!/\bof\s+100\b/.test(label)) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve({ elapsedMs: performance.now() - startedAt, label });
    };
    observer.observe(count, { childList: true, characterData: true, subtree: true });
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    queueMicrotask(finish);
  });
}

function selectionText() {
  return window.getSelection().toString();
}

function clearSelection() {
  window.getSelection().removeAllRanges();
  window.__copyEvents = window.__copyEvents || [];
  window.__copyEvents.length = 0;
  if (!window.__copyListenerInstalled) {
    window.__copyListenerInstalled = true;
    document.addEventListener(
      'copy',
      (event) => {
        window.__copyEvents.push({ text: window.getSelection().toString(), prevented: event.defaultPrevented });
      },
      true,
    );
  }
}

function copyEvents() {
  return window.__copyEvents || [];
}

// ---------------------------------------------------------------------------
// Windows clipboard access. Text travels as base64 of UTF-8 so that non-ASCII
// (Devanagari, Gurmukhi) survives the console's code page.

function powershell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', timeout: 30000 },
  ).trim();
}

function readWindowsClipboard() {
  const output = powershell(
    "$ErrorActionPreference = 'Stop'; $text = Get-Clipboard -Raw; if ($null -eq $text) { $text = '' }; " +
      '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)))',
  );
  return Buffer.from(output, 'base64').toString('utf8');
}

function writeWindowsClipboard(text) {
  const base64 = Buffer.from(text, 'utf8').toString('base64');
  powershell(
    "$ErrorActionPreference = 'Stop'; Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
      base64 +
      "')))",
  );
}

function readWindowsProcessTreeMemory(rootPid) {
  const root = Number(rootPid);
  if (!Number.isSafeInteger(root) || root < 1) throw new Error('Invalid packaged-app process id.');
  const result = powershell(`
    $ErrorActionPreference = 'Stop'
    $root = ${root}
    $all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add([int]$root)
    $changed = $true
    while ($changed) {
      $changed = $false
      foreach ($entry in $all) {
        if ($ids.Contains([int]$entry.ParentProcessId) -and $ids.Add([int]$entry.ProcessId)) { $changed = $true }
      }
    }
    $rows = @(
      foreach ($entry in $all) {
        if ($ids.Contains([int]$entry.ProcessId)) {
          $process = Get-Process -Id ([int]$entry.ProcessId) -ErrorAction SilentlyContinue
          if ($process) {
            [pscustomobject]@{
              WorkingSetBytes = [int64]$process.WorkingSet64
              PrivateBytes = [int64]$process.PrivateMemorySize64
            }
          }
        }
      }
    )
    $workingSet = [int64](($rows | Measure-Object -Property WorkingSetBytes -Sum).Sum)
    $privateBytes = [int64](($rows | Measure-Object -Property PrivateBytes -Sum).Sum)
    [pscustomobject]@{ processCount = $rows.Count; workingSetBytes = $workingSet; privateBytes = $privateBytes } | ConvertTo-Json -Compress
  `);
  const parsed = JSON.parse(result);
  return {
    processCount: Number(parsed.processCount),
    workingSetBytes: Number(parsed.workingSetBytes),
    privateBytes: Number(parsed.privateBytes),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.app) throw new Error('--app <executable> is required');
  const appPath = path.resolve(options.app);
  if (!fs.existsSync(appPath)) throw new Error(`App not found: ${appPath}`);

  const pdfPath = path.resolve(options.pdf ?? path.join(repoRoot, 'samples', 'cambuz-demo.pdf'));
  const outDir = path.resolve(options.out ?? 'smoke-test-output');
  const port = Number(options.port ?? 9333);
  const timeoutMs = Number(options.timeout ?? 120) * 1000;
  // OS file-open probes (Phase 9): real launch arguments, not the drop path.
  const launchPdfPath = options['launch-pdf'] ? path.resolve(options['launch-pdf']) : null;
  const secondPdfPath = options['second-pdf'] ? path.resolve(options['second-pdf']) : null;
  if (launchPdfPath && !fs.existsSync(launchPdfPath)) throw new Error(`Launch PDF not found: ${launchPdfPath}`);
  if (secondPdfPath && !fs.existsSync(secondPdfPath)) throw new Error(`Second PDF not found: ${secondPdfPath}`);
  fs.mkdirSync(outDir, { recursive: true });

  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfName = path.basename(pdfPath);
  const expectedPages = (await PDFDocument.load(pdfBytes, { ignoreEncryption: true })).getPageCount();
  const searchProbeBytes = await makePackagedSearchProbe();
  const searchProbeName = 'phase8-packaged-search-100p.pdf';
  const isWindows = process.platform === 'win32';

  const report = {
    app: path.basename(appPath),
    platform: `${process.platform}-${process.arch}`,
    startedAt: new Date().toISOString(),
    pdf: pdfName,
    expectedPages,
    checks: [],
    informational: {},
    consoleErrors: [],
    consoleWarnings: [],
    uncaughtExceptions: [],
  };
  // Inside GitHub Actions each result is also published as an annotation, so it is
  // visible in the run's check results without opening the uploaded evidence.
  const inCi = process.env.GITHUB_ACTIONS === 'true';
  const annotate = (level, title, message) => {
    if (!inCi) return;
    const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${level} title=${title}::${escaped}`);
  };
  // Failures are annotated one by one. Passing checks are published together, in a
  // single summary annotation at the end: GitHub keeps only about ten annotations per
  // step, which would otherwise hide most of the checks.
  const record = (name, pass, detail = '') => {
    report.checks.push({ name, pass: Boolean(pass), detail: String(detail) });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!pass) annotate('error', 'Smoke check failed', `${name}${detail ? ` — ${detail}` : ''}`);
    return Boolean(pass);
  };
  const note = (name, detail) => {
    report.informational[name] = String(detail);
    console.log(`INFO  ${name}: ${detail}`);
  };
  const capped = (list, text) => {
    if (list.length < 50) list.push(String(text).slice(0, 500));
  };
  const hostCpus = os.cpus();
  note(
    'native smoke environment',
    `${process.env.RUNNER_OS || os.platform()}-${process.env.RUNNER_ARCH || os.arch()}; Node ${process.version}; ${hostCpus.length} logical CPUs (${hostCpus[0]?.model || 'unknown'}); ${(os.totalmem() / 1048576).toFixed(0)} MiB RAM; GitHub image ${process.env.ImageOS || 'not exported'}`,
  );

  const logStream = fs.createWriteStream(path.join(outDir, 'app-output.log'));
  const appLaunchStartedAt = performance.now();
  const child = spawn(appPath, [`--remote-debugging-port=${port}`, '--enable-logging=stderr', ...options.args, ...(launchPdfPath ? [launchPdfPath] : [])], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group on POSIX so the whole tree can be stopped; taskkill /T on Windows.
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk) => logStream.write(chunk));
  child.stderr.on('data', (chunk) => logStream.write(chunk));
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });
  const stopApp = () => {
    if (exited) return;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // The process tree is already gone.
    }
  };
  const exitDescription = () => (exited ? `exit code ${exited.code ?? exited.signal}` : 'still running');
  const memorySnapshot = (stage) => {
    if (!isWindows) {
      note(`Windows process-tree memory (${stage})`, 'not measured: this smoke run is not on Windows');
      return null;
    }
    try {
      const sample = readWindowsProcessTreeMemory(child.pid);
      const mib = (bytes) => (bytes / 1048576).toFixed(1);
      note(
        `Windows process-tree memory (${stage})`,
        `${sample.processCount} processes; working set ${mib(sample.workingSetBytes)} MiB; private bytes ${mib(sample.privateBytes)} MiB`,
      );
      return sample;
    } catch (error) {
      note(`Windows process-tree memory (${stage})`, `unavailable: ${error.message.split('\\n')[0]}`);
      return null;
    }
  };

  let ws = null;
  let send = null;
  let evaluate = null;
  let waitFor = null;
  // Runs an in-page function with JSON-serialisable arguments.
  const inPage = (fn, ...args) =>
    evaluate(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
  // Dispatches real pointer input through the DevTools Input domain.
  const dragSelect = async (from, to) => {
    const at = (type, point, extra = {}) =>
      send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', ...extra });
    await at('mouseMoved', from, { button: 'none', buttons: 0 });
    await at('mousePressed', from, { buttons: 1, clickCount: 1 });
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await at('mouseMoved', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, { buttons: 1 });
    }
    await at('mouseReleased', to, { buttons: 0, clickCount: 1 });
  };
  const clickSelector = async (selector) => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`Could not find a clickable element: ${selector}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const pressCtrlC = async () => {
    const key = { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, modifiers: 2 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  // A known value on the clipboard, so a copy that never reaches it is not mistaken
  // for success. Best-effort: a failure here is reported and the clipboard check then fails.
  const setSentinel = (text) => {
    try {
      writeWindowsClipboard(text);
    } catch (error) {
      note('clipboard sentinel', `could not be set: ${error.message.split('\n')[0]}`);
    }
  };

  try {
    // 1. Find the window's DevTools target.
    const findPage = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      return targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
    };
    const startedWaiting = Date.now();
    let page = null;
    while (!page) {
      if (exited) throw new Error(`The app exited before its window appeared (${exitDescription()}).`);
      if (Date.now() - startedWaiting > timeoutMs) throw new Error('Timed out waiting for the window (no index.html page target).');
      try {
        page = await findPage();
      } catch {
        // DevTools endpoint not listening yet.
      }
      if (!page) await sleep(500);
    }

    // 2. Attach over the DevTools protocol.
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Could not open the DevTools WebSocket.'));
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
        capped(report.uncaughtExceptions, details.exception?.description ?? details.text ?? 'exception');
      } else if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
        if (message.params.type === 'error') capped(report.consoleErrors, text);
        else if (message.params.type === 'warning') capped(report.consoleWarnings, text);
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (entry.level === 'error') capped(report.consoleErrors, `[${entry.source}] ${entry.text}`);
      }
    };
    send = (method, params = {}, limitMs = 30000) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools call ${method} timed out`));
        }, limitMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
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
    waitFor = async (label, probe, limitMs = timeoutMs) => {
      const end = Date.now() + limitMs;
      let last;
      while (Date.now() < end) {
        if (exited) throw new Error(`The app exited while waiting for ${label} (${exitDescription()}).`);
        try {
          last = await probe();
          if (last) return last;
        } catch (error) {
          last = `error: ${error.message}`;
        }
        await sleep(250);
      }
      const errors = report.consoleErrors.slice(0, 3).join(' | ') || 'none';
      throw new Error(`Timed out waiting for ${label} (last value: ${JSON.stringify(last)}; console errors: ${errors}).`);
    };

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');

    // 3. Renderer ready: the renderer module must have run and attached its drop handler.
    //    (Static HTML alone is not enough: a blocked module leaves the page looking loaded.)
    await waitFor(
      'the renderer script to start (its drop handler attached to #main-content)',
      async () => {
        const target = await send('Runtime.evaluate', { expression: "document.getElementById('main-content')" });
        if (!target.result?.objectId) return false;
        const { listeners } = await send('DOMDebugger.getEventListeners', { objectId: target.result.objectId });
        return listeners.some((listener) => listener.type === 'drop');
      },
      60000,
    );
    const startupMs = performance.now() - appLaunchStartedAt;
    note('startup: process spawn to renderer-ready event', `${startupMs.toFixed(1)} ms; includes CDP target polling/attachment`);
    const navigationTiming = await evaluate(`(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry ? { domContentLoadedMs: entry.domContentLoadedEventEnd, loadMs: entry.loadEventEnd } : null;
    })()`);
    if (navigationTiming) {
      note(
        'renderer navigation timing',
        `DOMContentLoaded ${navigationTiming.domContentLoadedMs.toFixed(1)} ms; load ${navigationTiming.loadMs.toFixed(1)} ms from document navigation start`,
      );
    } else {
      note('renderer navigation timing', 'Navigation Timing entry unavailable');
    }
    const shell = await evaluate(`({
      title: document.title,
      protocol: location.protocol,
      bridge: ['openFile', 'readFile', 'readSample', 'openPdfInSystemViewer', 'savePrintReadyPdf', 'savePdf', 'rendererReady', 'onOpenFilePath'].every((name) => typeof window.cambuzAPI?.[name] === 'function'),
    })`);
    record('window title is "Cambuz PDF Reader"', shell.title === 'Cambuz PDF Reader', shell.title);
    record('preload bridge (window.cambuzAPI) is exposed', shell.bridge);
    record('renderer page is loaded from the packaged app', shell.protocol === 'file:' || shell.protocol === 'http:', shell.protocol);

    // Let any "reopen last document" start-up load finish before the test drives the UI.
    await sleep(2500);

    // Helpers that move the viewer between documents.
    const closeDocument = async () => {
      const state = await inPage(viewerState);
      if (state.welcomeVisible) return;
      await evaluate(`document.getElementById('btn-close').click(); true`);
      await waitFor('the welcome screen to return', () => evaluate(`getComputedStyle(document.getElementById('welcome-screen')).display !== 'none'`));
    };

    // 3b. OS file-open probes (Phase 9). The app was started with --launch-pdf
    // exactly as a double-click / Open With launch starts it; a second process
    // with --second-pdf exercises the single-instance handoff. Both run before
    // the drop-driven suite so the launch state is observed first.
    if (launchPdfPath) {
      const launchName = path.basename(launchPdfPath);
      const launchExpectedPages = (await PDFDocument.load(fs.readFileSync(launchPdfPath), { ignoreEncryption: true })).getPageCount();
      try {
        const launched = await waitFor(`the launch PDF ${launchName} to open and render page 1`, async () => {
          const current = await inPage(viewerState);
          return current.file.startsWith(launchName) && current.pages === launchExpectedPages &&
            current.status.startsWith('Page 1 of') && current.canvasWidth > 0 && current.canvasHeight > 0
            ? current
            : null;
        });
        record('launching with a PDF path opens the document', true, `${launched.pages} page(s): ${launchName}`);
      } catch (error) {
        const state = await inPage(viewerState).catch(() => ({ file: '(unknown)', status: '(unknown)' }));
        record('launching with a PDF path opens the document', false, `${error.message} (file "${state.file}", status "${state.status}")`);
      }
    }
    if (secondPdfPath) {
      const secondName = path.basename(secondPdfPath);
      const secondExpectedPages = (await PDFDocument.load(fs.readFileSync(secondPdfPath), { ignoreEncryption: true })).getPageCount();
      try {
        // No debugging port: the second process must hand off and exit on its own.
        const second = spawn(appPath, [...options.args, secondPdfPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        second.stdout.on('data', (chunk) => logStream.write(`[second-instance] ${chunk}`));
        second.stderr.on('data', (chunk) => logStream.write(`[second-instance] ${chunk}`));
        const secondExit = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try { second.kill(); } catch { /* already gone */ }
            resolve({ code: 'timeout' });
          }, 60000);
          second.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
          second.on('error', (error) => { clearTimeout(timer); resolve({ code: `spawn error: ${error.message}` }); });
        });
        record('a second launch hands off and exits', secondExit.code === 0, `second process exit: ${secondExit.code ?? secondExit.signal}`);
        const switched = await waitFor('the running window to switch to the second PDF', async () => {
          const current = await inPage(viewerState);
          return current.file.startsWith(secondName) && current.pages === secondExpectedPages &&
            current.status.startsWith('Page 1 of') && current.canvasWidth > 0 && current.canvasHeight > 0
            ? current
            : null;
        });
        record('opening a second PDF while running switches the document', true, `${switched.pages} page(s): ${secondName}`);
      } catch (error) {
        record('opening a second PDF while running switches the document', false, error.message);
      }
    }

    await closeDocument();
    memorySnapshot('settled welcome-screen idle');
    const dropDocument = async (bytes, name) => {
      await closeDocument();
      const b64 = Buffer.from(bytes).toString('base64');
      const openStartedAt = performance.now();
      await evaluate(`(() => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], ${JSON.stringify(name)}, { type: 'application/pdf' }));
        document.getElementById('main-content').dispatchEvent(
          new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
        );
        return true;
      })()`);
      const state = await waitFor(`${name} to open and render page 1`, async () => {
        const current = await inPage(viewerState);
        return current.file.startsWith(name) && current.pages > 0 &&
          current.status.startsWith('Page 1 of') && current.canvasWidth > 0 && current.canvasHeight > 0
          ? current
          : null;
      });
      state.openToFirstPageMs = performance.now() - openStartedAt;
      return state;
    };
    const waitForPageOne = () =>
      waitFor('page 1 to finish rendering', () => evaluate(`document.getElementById('status-text').textContent.startsWith('Page 1 of')`));

    // 4. The two welcome-screen sample buttons, exactly as a user clicks them.
    await closeDocument();
    await evaluate(`document.getElementById('btn-sample-form').click(); true`);
    try {
      const formState = await waitFor('the form sample to open', async () => {
        const state = await inPage(viewerState);
        return state.file.startsWith('form-sample.pdf') && state.pages > 0 ? state : null;
      });
      record('"Try Sample PDF Form" opens form-sample.pdf', true, `${formState.pages} page(s)`);
      await waitFor('the form fields to appear', async () => (await inPage(viewerState)).formWidgets > 0, 30000);
      const widgets = (await inPage(viewerState)).formWidgets;
      record('the form sample shows fillable fields', widgets > 0, `${widgets} field widget(s) on page 1`);
    } catch (error) {
      record('"Try Sample PDF Form" opens form-sample.pdf', false, error.message);
    }
    await closeDocument();
    await evaluate(`document.getElementById('btn-sample').click(); true`);
    try {
      const sampleState = await waitFor('the sample PDF to open', async () => {
        const state = await inPage(viewerState);
        return state.file.startsWith('cambuz-demo.pdf') && state.pages > 0 ? state : null;
      });
      record('"Try Sample PDF" opens cambuz-demo.pdf', true, `${sampleState.pages} page(s)`);
    } catch (error) {
      const state = await inPage(viewerState).catch(() => ({ status: '(unknown)' }));
      record('"Try Sample PDF" opens cambuz-demo.pdf', false, `${error.message} (status "${state.status}")`);
    }

    // 5. Open the bundled PDF through the drop path.
    const dropped = await dropDocument(pdfBytes, pdfName);
    record('dropped PDF opens in the renderer', dropped.pages > 0, `${dropped.pages} page(s) reported`);
    record(`page count matches the file (${expectedPages})`, dropped.pages === expectedPages, `${dropped.pages} reported`);
    note(
      'open-to-first-page render (sample PDF)',
      `${dropped.openToFirstPageMs.toFixed(1)} ms from native-window file-drop dispatch until page 1 canvas/status are ready`,
    );
    memorySnapshot('after sample PDF first page rendered');

    // 6. Page 1 rendered: canvas painted and text layer built.
    await waitForPageOne();
    const canvas = await evaluate(`(() => {
      const el = document.getElementById('pdf-canvas');
      if (!el || !el.width || !el.height) return { width: 0, height: 0, dark: 0, samples: 0 };
      const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
      let dark = 0;
      let samples = 0;
      for (let i = 0; i < data.length; i += 4 * 61) {
        samples += 1;
        if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark += 1;
      }
      return { width: el.width, height: el.height, dark, samples };
    })()`);
    const darkShare = canvas.samples ? canvas.dark / canvas.samples : 0;
    record(
      'page 1 canvas is painted (not blank)',
      canvas.width > 0 && darkShare > 0.001,
      `${canvas.width}x${canvas.height}, ${(darkShare * 100).toFixed(2)}% dark samples`,
    );
    const textLength = await waitFor('the PDF.js text layer', () =>
      evaluate(`Array.from(document.querySelectorAll('.textLayer span')).map((span) => span.textContent).join('').length`),
    );
    record('PDF.js text layer produced selectable text', textLength > 0, `${textLength} characters`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'rendered-page.png'), Buffer.from(shot.data, 'base64'));
    record('screenshot captured', true, 'rendered-page.png');

    // 7. The text layer is aligned with the canvas and is what the pointer hits.
    const alignment = await inPage(pageAlignment);
    record(
      'text layer sits exactly over the page canvas',
      alignment.maxEdgeDelta <= 1.5,
      `largest edge difference ${alignment.maxEdgeDelta}px`,
    );
    record(
      'text spans are painted over glyph ink',
      alignment.inspected >= 3 && alignment.withInk / alignment.inspected >= 0.9,
      `${alignment.withInk}/${alignment.inspected} spans have ink under them`,
    );
    const hits = await inPage(textHitTest);
    record(
      'the text layer is the top element under visible text',
      hits.visible > 0 && hits.hit === hits.visible && hits.userSelect === 'text',
      `${hits.hit}/${hits.visible} visible spans are hit; user-select ${hits.userSelect}`,
    );

    // 8. Exercise page navigation and zoom through the packaged renderer.
    const setPageWithEnter = async (pageNumber) => {
      await evaluate(`(() => {
        const input = document.getElementById('page-input');
        input.focus();
        input.value = ${JSON.stringify(String(pageNumber))};
        return true;
      })()`);
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      return waitFor(`page ${pageNumber} to render`, async () => {
        const state = await inPage(viewerState);
        return state.page === pageNumber && state.status.startsWith(`Page ${pageNumber} of`) && state.canvasWidth > 0;
      });
    };
    try {
      await setPageWithEnter(5);
      await clickSelector('#btn-next');
      await waitFor('next-page button to navigate to page 6', () =>
        evaluate(`document.getElementById('page-input').value === '6' && document.getElementById('status-text').textContent.startsWith('Page 6 of')`));
      await clickSelector('#btn-prev');
      await waitFor('previous-page button to navigate back to page 5', () =>
        evaluate(`document.getElementById('page-input').value === '5' && document.getElementById('status-text').textContent.startsWith('Page 5 of')`));
      record('page-number entry and previous/next navigation render the requested pages', true, 'keyboard jump to page 5; next to 6; previous back to 5');
    } catch (error) {
      record('page-number entry and previous/next navigation render the requested pages', false, error.message);
    } finally {
      await setPageWithEnter(1).catch(() => {});
      await waitForPageOne().catch(() => {});
    }

    try {
      const zoomBefore = await evaluate(`(() => {
        const canvas = document.getElementById('pdf-canvas');
        return { label: document.getElementById('zoom-level').textContent, width: canvas.width, height: canvas.height };
      })()`);
      await clickSelector('#btn-zoom-in');
      await waitFor('zoom-in to rerender the current page', () =>
        evaluate(`(() => {
          const canvas = document.getElementById('pdf-canvas');
          return document.getElementById('zoom-level').textContent !== ${JSON.stringify(zoomBefore.label)} &&
            (canvas.width !== ${zoomBefore.width} || canvas.height !== ${zoomBefore.height}) &&
            document.getElementById('status-text').textContent.startsWith('Page 1 of');
        })()`));
      const zoomed = await evaluate(`(() => {
        const canvas = document.getElementById('pdf-canvas');
        return { label: document.getElementById('zoom-level').textContent, width: canvas.width, height: canvas.height, pixels: canvas.width * canvas.height };
      })()`);
      await clickSelector('#btn-zoom-out');
      await waitFor('zoom-out to restore the initial zoom and canvas', () =>
        evaluate(`(() => {
          const canvas = document.getElementById('pdf-canvas');
          return document.getElementById('zoom-level').textContent === ${JSON.stringify(zoomBefore.label)} &&
            canvas.width === ${zoomBefore.width} && canvas.height === ${zoomBefore.height} &&
            document.getElementById('status-text').textContent.startsWith('Page 1 of');
        })()`));
      record(
        'zoom in/out renders and stays within the canvas pixel budget',
        zoomed.label !== zoomBefore.label && zoomed.pixels <= 16000000,
        `${zoomBefore.label} → ${zoomed.label} → ${zoomBefore.label}; ${zoomed.pixels.toLocaleString()} backing pixels`,
      );
    } catch (error) {
      record('zoom in/out renders and stays within the canvas pixel budget', false, error.message);
    }

    try {
      const printStartedAt = performance.now();
      await clickSelector('#btn-print');
      const printPreview = await waitFor('the packaged print preview to build and render', () =>
        evaluate(`(() => {
          const dialog = document.getElementById('print-dialog');
          const canvas = document.getElementById('print-preview-canvas');
          const status = document.getElementById('print-status').textContent;
          return getComputedStyle(dialog).display !== 'none' && canvas.width > 0 && canvas.height > 0 && status.startsWith('Preview ready')
            ? { width: canvas.width, height: canvas.height, status }
            : null;
        })()`), 60000);
      note(
        'print preview preparation',
        `${(performance.now() - printStartedAt).toFixed(1)} ms to prepare and render the first of ${await evaluate("document.getElementById('print-preview-total').textContent")} sheet(s); ${printPreview.width}×${printPreview.height}`,
      );
      record('packaged print preview prepares a print-ready PDF and renders a sheet', true, printPreview.status);
      await clickSelector('#btn-print-cancel');
      await waitFor('print preview to close', () =>
        evaluate(`getComputedStyle(document.getElementById('print-dialog')).display === 'none'`));
      note('OS printing', 'preview/PDF preparation tested; no job was submitted to a physical or virtual printer in unattended CI');
      memorySnapshot('after print preview closed');
    } catch (error) {
      record('packaged print preview prepares a print-ready PDF and renders a sheet', false, error.message);
      await evaluate(`document.getElementById('btn-print-cancel').click(); true`).catch(() => {});
    }

    // 9. Real mouse selection and Ctrl+C on the cambuz demo.
    await inPage(clearSelection);
    const demoDrag = await inPage(firstSpansForDrag, 3);
    if (!demoDrag) {
      record('mouse drag selects multi-line text', false, 'fewer than two text spans on page 1');
    } else {
      await dragSelect(demoDrag.from, demoDrag.to);
      const selected = await evaluate('window.getSelection().toString()');
      const firstLine = demoDrag.firstText.trim().slice(0, 12);
      record(
        'mouse drag selects multi-line text',
        selected.includes('\n') && selected.includes(firstLine),
        `${selected.length} characters, ${selected.split('\n').length} lines`,
      );

      if (isWindows) setSentinel('CAMBUZ-SMOKE-SENTINEL');
      await pressCtrlC();
      await sleep(400);
      const events = await inPage(copyEvents);
      const copied = events[events.length - 1];
      record(
        'Ctrl+C copies the selection',
        Boolean(copied) && !copied.prevented && copied.text === selected,
        copied ? `copy event with ${copied.text.length} characters, not prevented` : 'no copy event after Ctrl+C',
      );
      if (!copied) {
        // Diagnostic only: Chromium's copy command, without the key binding.
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', commands: ['copy'] });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC' });
        await sleep(300);
        note('copy command without the key binding', `${(await inPage(copyEvents)).length} copy event(s)`);
      }

      if (isWindows) {
        try {
          const clipboard = await waitFor(
            'the Windows clipboard to receive the copied text',
            () => {
              const value = readWindowsClipboard();
              return value !== 'CAMBUZ-SMOKE-SENTINEL' && value.length > 0 ? value : null;
            },
            15000,
          );
          record(
            'the Windows clipboard receives the copied text',
            clipboard.includes(firstLine) && /\r?\n/.test(clipboard),
            `${clipboard.length} characters on the clipboard, ${clipboard.split(/\r?\n/).length} lines`,
          );
        } catch (error) {
          record('the Windows clipboard receives the copied text', false, error.message);
        }
      } else {
        note('clipboard check', 'runs on Windows only; this platform checks the copy event');
      }
    }

    // 10. Indian-language text: Hindi and Punjabi PDFs select and copy their Unicode.
    const indianChecks = [
      { file: HINDI_PDF, label: 'Hindi', pattern: /[\u0900-\u097F]/ },
      { file: PUNJABI_PDF, label: 'Punjabi', pattern: /[\u0A00-\u0A7F]/ },
    ];
    for (const { file, label, pattern } of indianChecks) {
      if (!fs.existsSync(file)) {
        record(`${label} text can be selected and copied`, false, `${path.basename(file)} is missing`);
        continue;
      }
      try {
        await dropDocument(fs.readFileSync(file), path.basename(file));
        await waitFor(`the ${label} text layer`, () => evaluate(`document.querySelectorAll('#text-layer span').length > 1`));
        await inPage(clearSelection);
        const drag = await inPage(firstSpansForDrag, 1);
        await dragSelect(drag.from, drag.to);
        const selected = await evaluate('window.getSelection().toString()');
        const sentinel = `CAMBUZ-${label.toUpperCase()}-SENTINEL`;
        if (isWindows) setSentinel(sentinel);
        await pressCtrlC();
        await sleep(300);
        const events = await inPage(copyEvents);
        const copied = events[events.length - 1];
        record(
          `${label} text can be selected and copied`,
          pattern.test(selected) && Boolean(copied) && copied.text === selected && !copied.prevented,
          `${selected.length} characters selected; copy event ${copied ? 'fired' : 'missing'}`,
        );
        if (isWindows) {
          const clipboard = await waitFor(
            `the ${label} text on the Windows clipboard`,
            () => {
              const value = readWindowsClipboard();
              return value !== sentinel && value.length > 0 ? value : null;
            },
            15000,
          ).catch(() => '');
          record(
            `${label} text reaches the Windows clipboard as Unicode`,
            pattern.test(clipboard) && clipboard.includes(selected.split('\n')[0].trim().slice(0, 6)),
            `${clipboard.length} characters on the clipboard`,
          );
        }
      } catch (error) {
        record(`${label} text can be selected and copied`, false, error.message);
      }
    }

    // 11. A document whose author denies copying refuses selection, and says why.
    try {
      const denied = await dropDocument(fs.readFileSync(COPY_DENIED_PDF), path.basename(COPY_DENIED_PDF));
      await waitFor('the copy-denied document text layer', () => evaluate(`document.querySelectorAll('#text-layer span').length > 0`));
      await inPage(clearSelection);
      const drag = await inPage(firstSpansForDrag, 1);
      if (drag) await dragSelect(drag.from, drag.to);
      const selected = await evaluate('window.getSelection().toString()');
      const state = await inPage(viewerState);
      record(
        'a document that denies copying refuses selection and says why',
        denied.pages > 0 && state.noCopyClass && state.userSelect === 'none' && selected.length === 0 &&
          state.status.includes('copying not allowed'),
        `status "${state.status}"; selected ${selected.length} characters`,
      );
    } catch (error) {
      record('a document that denies copying refuses selection and says why', false, error.message);
    }

    // 12. Measure first and cached repeat searches in the packaged renderer on 100 pages.
    try {
      const searchDoc = await dropDocument(searchProbeBytes, searchProbeName);
      record('packaged renderer opens the 100-page search probe', searchDoc.pages === 100, `${searchDoc.pages} pages`);
      note(
        '100-page search probe first-page render',
        `${searchDoc.openToFirstPageMs.toFixed(1)} ms from drop dispatch to page 1 rendered; ${searchProbeBytes.length} bytes`,
      );
      memorySnapshot('after 100-page search probe first page rendered');

      await clickSelector('#btn-search');
      const firstSearch = await inPage(measureSearchInPage, 'CAMBUZ');
      record('packaged search finds the marker on all 100 pages', firstSearch.label === '1 of 100', firstSearch.label);
      await clickSelector('#btn-search-close');
      await clickSelector('#btn-search');
      const repeatSearch = await inPage(measureSearchInPage, 'cambuz');
      record('packaged case-insensitive repeat search returns the same 100-page result', repeatSearch.label === '1 of 100', repeatSearch.label);
      note(
        'packaged 100-page full-document search timings',
        `first query ${firstSearch.elapsedMs.toFixed(2)} ms; same-marker cached re-query ${repeatSearch.elapsedMs.toFixed(2)} ms; timings use renderer performance.now() and include PDF.js text indexing/highlighting`,
      );
      memorySnapshot('after 100-page first and repeat searches');
      await clickSelector('#btn-search-close');
    } catch (error) {
      record('packaged 100-page first/repeat search probe completes', false, error.message);
    }

    // 13. Investigate the Node-canvas failure separately; verify actual Electron renders the scan.
    try {
      const scanPath = path.join(repoRoot, 'samples', 'phase7-scanned.pdf');
      const scanBytes = fs.readFileSync(scanPath);
      const scan = await dropDocument(scanBytes, path.basename(scanPath));
      const painted = await inPage(canvasPaintStats);
      const darkShare = painted.samples ? painted.dark / painted.samples : 0;
      record(
        'packaged Electron paints the scanned image page',
        scan.pages === 4 && painted.width > 0 && painted.height > 0 && darkShare > 0.001,
        `${scan.pages} pages; canvas ${painted.width}×${painted.height}; ${(darkShare * 100).toFixed(2)}% dark samples`,
      );
      record('scanned page remains image-only in the text layer', scan.textLength === 0, `${scan.textLength} selectable characters`);
      note(
        'scanned-page raster diagnostic',
        'this check uses packaged Chromium/Electron; it does not claim to fix the separate Node @napi-rs/canvas SIGSEGV',
      );
    } catch (error) {
      record('packaged Electron paints the scanned image page', false, error.message);
    }

    // 14. Exercise repeated document open/close and verify canvas release each cycle.
    try {
      const cycleStartedAt = performance.now();
      const cycleCount = 3;
      let cyclesPassed = 0;
      const cycleDetails = [];
      for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
        const opened = await dropDocument(pdfBytes, pdfName);
        const pageReady = opened.pages === expectedPages && opened.canvasWidth > 0 && opened.canvasHeight > 0;
        await closeDocument();
        const closed = await waitFor(`closed document state after cycle ${cycle}`, async () => {
          const state = await inPage(viewerState);
          return state.welcomeVisible && state.canvasWidth === 0 && state.canvasHeight === 0 && state.textLength === 0
            ? state
            : null;
        });
        const passed = pageReady && closed.welcomeVisible;
        if (passed) cyclesPassed += 1;
        cycleDetails.push(`cycle ${cycle}: ${passed ? 'open/render/close passed' : 'failed'}`);
      }
      record(
        'three repeated PDF open/first-render/close cycles release the viewer canvas',
        cyclesPassed === cycleCount,
        `${cyclesPassed}/${cycleCount} passed; ${cycleDetails.join('; ')}`,
      );
      note('three document lifecycle cycles', `${(performance.now() - cycleStartedAt).toFixed(1)} ms total`);
      memorySnapshot('after three open-close cycles with document closed');
    } catch (error) {
      record('three repeated PDF open/first-render/close cycles release the viewer canvas', false, error.message);
    }

    record('no uncaught renderer exceptions', report.uncaughtExceptions.length === 0, `${report.uncaughtExceptions.length} seen`);
  } catch (error) {
    report.error = error.message;
    record('smoke test completed without error', false, error.message);
    try {
      if (send) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, 10000);
        fs.writeFileSync(path.join(outDir, 'failure.png'), Buffer.from(shot.data, 'base64'));
      }
    } catch {
      // Screenshot is best-effort on failure.
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.passed = report.checks.length > 0 && report.checks.every((check) => check.pass);
    fs.writeFileSync(path.join(outDir, 'smoke-test-result.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (inCi) {
      if (isWindows) {
        const metricKeys = [
          'native smoke environment',
          'startup: process spawn to renderer-ready event',
          'renderer navigation timing',
          'Windows process-tree memory (settled welcome-screen idle)',
          'open-to-first-page render (sample PDF)',
          'Windows process-tree memory (after sample PDF first page rendered)',
          'print preview preparation',
          'packaged 100-page full-document search timings',
          'Windows process-tree memory (after 100-page first and repeat searches)',
          'three document lifecycle cycles',
          'Windows process-tree memory (after three open-close cycles with document closed)',
        ];
        const measurements = metricKeys
          .filter((key) => report.informational[key] !== undefined)
          .map((key) => `${key}: ${report.informational[key]}`);
        annotate(
          'notice',
          'Native runtime measurements',
          `${report.app} (${report.platform}); single-run observations, not timing thresholds\n${measurements.join('\n')}`,
        );
      }
      const passedCount = report.checks.filter((check) => check.pass).length;
      const lines = [
        ...report.checks.map((check) => `${check.pass ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`),
        ...Object.entries(report.informational).map(([name, detail]) => `INFO  ${name}: ${detail}`),
      ];
      annotate(
        report.passed ? 'notice' : 'error',
        'Smoke test summary',
        `${report.app} (${report.platform}): ${passedCount} of ${report.checks.length} checks passed\n${lines.join('\n')}`,
      );
    }
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
    stopApp();
    await new Promise((resolve) => logStream.end(resolve));
  }

  const failed = report.checks.filter((check) => !check.pass).length;
  console.log(report.passed ? `Smoke test passed (${report.checks.length} checks).` : `Smoke test FAILED (${failed} failing check(s)).`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [
      `### Smoke test: ${report.app} (${report.platform})`,
      '',
      `Result: **${report.passed ? 'PASS' : 'FAIL'}** — PDF \`${report.pdf}\` (${report.expectedPages} pages)`,
      '',
      '| Check | Result | Detail |',
      '| --- | --- | --- |',
      ...report.checks.map((check) => `| ${escapeCell(check.name)} | ${check.pass ? 'PASS' : 'FAIL'} | ${escapeCell(check.detail)} |`),
      '',
      ...Object.entries(report.informational).map(([name, detail]) => `- **${escapeCell(name)}:** ${escapeCell(detail)}`),
      '',
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
