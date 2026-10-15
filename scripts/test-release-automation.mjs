#!/usr/bin/env node
// Cambuz PDF Reader — tests for automatic release publishing, README download
// synchronization, and cambuz-landing feature manifest validation.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateLandingContent,
  validateLandingContentFile,
  VALID_SCREENSHOT_IDS,
} from './validate-landing-content.mjs';
import {
  MARKERS,
  extractReleaseMetadata,
  updateReadmeContent,
  syncReleaseReadme,
  fetchPublishedRelease,
} from './sync-release-readme.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function pass(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function skip(name, reason) {
  skipped += 1;
  console.log(`  SKIP  ${name}${reason ? ` — ${reason}` : ''}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  failures.push(name);
}

function assert(cond, name, detail = '') {
  if (cond) pass(name);
  else fail(name, detail);
}

function section(title) {
  console.log(`\n## ${title}`);
}

function makeSampleRelease(overrides = {}) {
  const tag = overrides.tag_name ?? 'v1.1.0-build.456';
  const repo = overrides.repo ?? 'rajeshkamboj/cambuz-pdf';
  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;
  const defaultAssets = [
    {
      name: 'Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe',
      state: 'uploaded',
      size: 102032148,
      digest: 'sha256:9d39c28aa53ccc84f407e113df97c3c732c2def542c53629a43d8385f55ba365',
      browser_download_url: `${baseUrl}/Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe`,
    },
    {
      name: 'Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe',
      state: 'uploaded',
      size: 101614299,
      digest: 'sha256:30b5532358dd7870796477bf6296c614bbb3cd53868e44755d392e998be9a27a',
      browser_download_url: `${baseUrl}/Cambuz-PDF-Reader-1.1.0-win-x64-portable.exe`,
    },
    {
      name: 'Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage',
      state: 'uploaded',
      size: 97497590,
      digest: 'sha256:21e1b03ca255e506b28f4fec226e7007c1b4a4190adcf99dfad3534d3caa426f',
      browser_download_url: `${baseUrl}/Cambuz-PDF-Reader-1.1.0-linux-x86_64.AppImage`,
    },
    {
      name: 'Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg',
      state: 'uploaded',
      size: 111866296,
      digest: 'sha256:df3cc4424b7b20611b421d549e4cb1f7d9a22f53e4d3da24416d551a76fdcdbb',
      browser_download_url: `${baseUrl}/Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg`,
    },
    {
      name: 'Cambuz-PDF-Reader-1.1.0-mac-arm64.zip',
      state: 'uploaded',
      size: 116810366,
      digest: 'sha256:a11f78dd966d7579ba2b53d31e214affbf8883fdf1f8d3fdca26c0b3b2988512',
      browser_download_url: `${baseUrl}/Cambuz-PDF-Reader-1.1.0-mac-arm64.zip`,
    },
    {
      name: 'SHA256SUMS.txt',
      state: 'uploaded',
      size: 539,
      digest: 'sha256:2ec3e9237f90641a61c9c144177d3b3927f7328643cdcb2d06e0a99d344e9312',
      browser_download_url: `${baseUrl}/SHA256SUMS.txt`,
    },
  ];

  return {
    tag_name: tag,
    html_url: `https://github.com/${repo}/releases/tag/${tag}`,
    draft: false,
    prerelease: true,
    target_commitish: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
    body: `Built from commit \`a1b2c3d\` by [CI run 99887766](https://github.com/${repo}/actions/runs/99887766).`,
    assets: overrides.assets ?? defaultAssets,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
section('1. Landing-site feature manifest (docs/landing-content.json)');

const manifestPath = path.join(REPO_ROOT, 'docs', 'landing-content.json');
assert(fs.existsSync(manifestPath), 'docs/landing-content.json exists');

const validManifest = validateLandingContentFile(manifestPath);
assert(validManifest.schemaVersion === 1, 'manifest has schemaVersion 1');
assert(
  validManifest.releaseNotesPath === 'docs/RELEASE-NOTES-1.1.0.md',
  'manifest points to docs/RELEASE-NOTES-1.1.0.md',
);
assert(
  JSON.stringify(validManifest.features.map((f) => f.id)) ===
    JSON.stringify(['reading', 'search', 'selection', 'print', 'languages', 'desktop']),
  'manifest seeds the six required landing features in order',
);

const cloneManifest = () => JSON.parse(JSON.stringify(validManifest));

for (const badSchema of [undefined, null, 0, 2, '1']) {
  const m = cloneManifest();
  m.schemaVersion = badSchema;
  assert(
    !validateLandingContent(m).valid,
    `rejects invalid schemaVersion (${JSON.stringify(badSchema)})`,
  );
}

for (const badPath of ['', '   ', '../README.md', '/docs/RELEASE-NOTES-1.1.0.md', 'docs/DOES-NOT-EXIST.md', 'README.md']) {
  const m = cloneManifest();
  m.releaseNotesPath = badPath;
  assert(
    !validateLandingContent(m).valid,
    `rejects invalid releaseNotesPath (${JSON.stringify(badPath)})`,
  );
}

for (const field of ['id', 'headline', 'description', 'screenshotAlt', 'screenshotCaption', 'icon', 'screenshotId']) {
  const missing = cloneManifest();
  delete missing.features[0][field];
  assert(!validateLandingContent(missing).valid, `rejects missing required field "${field}"`);

  const nonString = cloneManifest();
  nonString.features[0][field] = 42;
  assert(!validateLandingContent(nonString).valid, `rejects non-string field "${field}"`);

  const blank = cloneManifest();
  blank.features[0][field] = '   ';
  assert(!validateLandingContent(blank).valid, `rejects blank string field "${field}"`);
}

{
  const dup = cloneManifest();
  dup.features[1].id = dup.features[0].id;
  assert(!validateLandingContent(dup).valid, 'rejects duplicate feature IDs');
}

for (const badId of ['Reading', 'reading_mode', '-reading', 'reading-', 'reading--mode', '1reading', 'reading mode']) {
  const m = cloneManifest();
  m.features[0].id = badId;
  assert(!validateLandingContent(m).valid, `rejects non-kebab-case feature id "${badId}"`);
}

{
  const zeroBullets = cloneManifest();
  zeroBullets.features[0].bullets = [];
  assert(!validateLandingContent(zeroBullets).valid, 'rejects fewer than 1 bullet');

  const nineBullets = cloneManifest();
  nineBullets.features[0].bullets = Array.from({ length: 9 }, (_, i) => `Bullet ${i + 1}`);
  assert(!validateLandingContent(nineBullets).valid, 'rejects more than 8 bullets');

  const emptyBullet = cloneManifest();
  emptyBullet.features[0].bullets = ['Valid bullet', ''];
  assert(!validateLandingContent(emptyBullet).valid, 'rejects empty string inside bullets');
}

for (const badScreenshot of ['unknown-slot', 'Reading', 'reading_slot']) {
  const m = cloneManifest();
  m.features[0].screenshotId = badScreenshot;
  assert(
    !validateLandingContent(m).valid,
    `rejects invalid screenshotId "${badScreenshot}" (allowed: ${VALID_SCREENSHOT_IDS.join(', ')})`,
  );
}

// ---------------------------------------------------------------------------
section('2. README markers and sync-release-readme.mjs');

const readmePath = path.join(REPO_ROOT, 'README.md');
const originalReadme = fs.readFileSync(readmePath, 'utf8');

for (const [name, pair] of Object.entries(MARKERS)) {
  assert(originalReadme.includes(pair.start), `README contains ${name} start marker`);
  assert(originalReadme.includes(pair.end), `README contains ${name} end marker`);
}
assert(
  originalReadme.includes('docs/landing-content.json'),
  'README documents docs/landing-content.json update requirement',
);
assert(
  originalReadme.includes('CAMBUZ_LANDING_DISPATCH_TOKEN'),
  'README documents CAMBUZ_LANDING_DISPATCH_TOKEN setup',
);

const sampleRelease = makeSampleRelease();
const meta = extractReleaseMetadata(sampleRelease, {
  repo: 'rajeshkamboj/cambuz-pdf',
  expectedTag: 'v1.1.0-build.456',
  packageVersion: '1.1.0',
});
assert(meta.tag === 'v1.1.0-build.456', 'extracts exact release tag');
assert(meta.assets.winSetup.sizeFormatted === '97.3 MiB', 'formats Windows installer size in MiB');
assert(meta.assets.winPortable.sizeFormatted === '96.9 MiB', 'formats Windows portable size in MiB');
assert(meta.assets.linuxAppImage.sizeFormatted === '93.0 MiB', 'formats Linux AppImage size in MiB');
assert(meta.assets.macDmg.sizeFormatted === '106.7 MiB', 'formats macOS DMG size in MiB');
assert(meta.assets.macZip.sizeFormatted === '111.4 MiB', 'formats macOS ZIP size in MiB');
assert(
  meta.assets.winSetup.sha256 === '9d39c28aa53ccc84f407e113df97c3c732c2def542c53629a43d8385f55ba365',
  'extracts 64-char hex SHA-256 from sha256:<hex> digest',
);

const updatedReadme = updateReadmeContent(originalReadme, meta);
assert(
  updatedReadme.includes('https://img.shields.io/badge/download-v1.1.0--build.456-success'),
  'rewrites download badge with escaped tag',
);
assert(
  updatedReadme.includes('[release-page]: https://github.com/rajeshkamboj/cambuz-pdf/releases/tag/v1.1.0-build.456'),
  'rewrites [release-page] reference link to exact tag',
);
assert(
  updatedReadme.includes(
    '[win-setup-dl]: https://github.com/rajeshkamboj/cambuz-pdf/releases/download/v1.1.0-build.456/Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe',
  ),
  'rewrites [win-setup-dl] to permanent /releases/download/<tag>/<file> URL',
);
assert(
  updatedReadme.includes('unsigned pre-release builds'),
  'describes automatic builds as unsigned pre-release builds',
);
assert(
  !updatedReadme.includes('/releases/latest'),
  'never uses /releases/latest in README',
);

// Verify text outside markers is untouched.
function stripMarkerInteriors(text) {
  let out = text;
  for (const pair of Object.values(MARKERS)) {
    const startIdx = out.indexOf(pair.start);
    const endIdx = out.indexOf(pair.end);
    out = `${out.slice(0, startIdx + pair.start.length)}${out.slice(endIdx)}`;
  }
  return out;
}
assert(
  stripMarkerInteriors(updatedReadme) === stripMarkerInteriors(originalReadme),
  'only text between the release-sync markers is modified',
);

// Rejects moving backwards, allows same-tag re-run and newer build numbers.
{
  let threwBackwards = false;
  try {
    const olderMeta = extractReleaseMetadata(makeSampleRelease({ tag_name: 'v1.1.0-build.100' }));
    updateReadmeContent(updatedReadme, olderMeta);
  } catch {
    threwBackwards = true;
  }
  assert(threwBackwards, 'refuses to move README backwards to an older build tag');

  const sameRunReadme = updateReadmeContent(updatedReadme, meta);
  assert(sameRunReadme === updatedReadme, 'allows re-running sync for the same build tag');
}

// Rejects missing assets, duplicate assets, bad digests, /releases/latest, and drafts.
for (const missingIdx of [0, 1, 2, 3, 4, 5]) {
  const r = makeSampleRelease();
  r.assets.splice(missingIdx, 1);
  let threw = false;
  try {
    extractReleaseMetadata(r);
  } catch {
    threw = true;
  }
  assert(threw, `rejects release when asset #${missingIdx + 1} is missing`);
}

{
  const r = makeSampleRelease();
  r.assets.push({ ...r.assets[0], name: 'Cambuz-PDF-Reader-1.1.0-extra-win-x64-setup.exe' });
  let threw = false;
  try {
    extractReleaseMetadata(r);
  } catch {
    threw = true;
  }
  assert(threw, 'rejects release with duplicate matching platform installer');
}

for (const badDigest of [null, '', '9d39c28aa53ccc84f407e113df97c3c732c2def542c53629a43d8385f55ba365', 'sha256:1234', 'sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']) {
  const r = makeSampleRelease();
  r.assets[0].digest = badDigest;
  let threw = false;
  try {
    extractReleaseMetadata(r);
  } catch {
    threw = true;
  }
  assert(threw, `rejects invalid asset digest (${JSON.stringify(badDigest)})`);
}

{
  const r = makeSampleRelease();
  r.assets[0].browser_download_url = 'https://github.com/rajeshkamboj/cambuz-pdf/releases/latest/download/Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe';
  let threw = false;
  try {
    extractReleaseMetadata(r);
  } catch {
    threw = true;
  }
  assert(threw, 'rejects /releases/latest asset download URL');
}

{
  const r = makeSampleRelease({ draft: true });
  let threw = false;
  try {
    extractReleaseMetadata(r);
  } catch {
    threw = true;
  }
  assert(threw, 'rejects draft release');
}

{
  let threw = false;
  try {
    await fetchPublishedRelease({
      repo: 'rajeshkamboj/cambuz-pdf',
      tag: 'latest',
      retries: 0,
      fetchImpl: async () => ({ ok: true, json: async () => makeSampleRelease() }),
    });
  } catch {
    threw = true;
  }
  assert(threw, 'fetchPublishedRelease refuses tag="latest"');
}

// End-to-end file sync test in a temporary directory.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cambuz-release-sync-'));
  const tmpReadme = path.join(tmpDir, 'README.md');
  const tmpReleaseJson = path.join(tmpDir, 'release.json');
  fs.writeFileSync(tmpReadme, originalReadme, 'utf8');
  fs.writeFileSync(tmpReleaseJson, JSON.stringify(sampleRelease, null, 2), 'utf8');

  const res = await syncReleaseReadme({
    tag: 'v1.1.0-build.456',
    readmePath: tmpReadme,
    releaseJsonPath: tmpReleaseJson,
  });
  assert(res.changed === true, 'syncReleaseReadme writes updated README to disk');
  const onDisk = fs.readFileSync(tmpReadme, 'utf8');
  assert(onDisk.includes('v1.1.0-build.456'), 'updated README on disk references v1.1.0-build.456');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
section('3. Desktop workflow (.github/workflows/desktop-build.yml)');

const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'desktop-build.yml');
const workflowYaml = fs.readFileSync(workflowPath, 'utf8');
const jsYaml = await import('js-yaml');
const workflowDoc = jsYaml.load(workflowYaml);

assert(Boolean(workflowDoc && typeof workflowDoc === 'object'), 'workflow YAML parses cleanly');
assert(
  Array.isArray(workflowDoc.on?.push?.['paths-ignore']) &&
    workflowDoc.on.push['paths-ignore'].includes('**.md'),
  'workflow push trigger ignores **.md commits to prevent README sync loops',
);
assert(
  Array.isArray(workflowDoc.on?.pull_request?.['paths-ignore']) &&
    workflowDoc.on.pull_request['paths-ignore'].includes('**.md'),
  'workflow pull_request trigger ignores **.md commits',
);
assert(workflowYaml.includes('node scripts/validate-landing-content.mjs'), 'workflow runs validate-landing-content.mjs');
assert(workflowYaml.includes("github.event_name == 'push'"), 'release job is restricted to push events (never pull_request)');
assert(
  workflowYaml.includes("needs.windows-x64.result == 'success'") &&
    workflowYaml.includes("needs.linux-x64.result == 'success'") &&
    workflowYaml.includes("needs.macos-arm64.result == 'success'"),
  'release job requires Windows, Linux, and macOS build jobs to succeed',
);
assert(
  workflowDoc.jobs?.['linux-x64']?.['continue-on-error'] !== true &&
    workflowDoc.jobs?.['macos-arm64']?.['continue-on-error'] !== true,
  'Linux and macOS build jobs do not mask failures with continue-on-error',
);

const releaseSteps = workflowDoc.jobs?.release?.steps ?? [];
const signatureStatusStep = releaseSteps.find((step) => step.name === 'Report optional code-signature status');
assert(
  Boolean(signatureStatusStep) &&
    signatureStatusStep.run.includes('release publication will continue') &&
    !signatureStatusStep.run.includes('exit 1'),
  'release job reports unsigned status without failing the release',
);
assert(
  !releaseSteps.some((step) => /Enforce code-signing|RELEASE BLOCKED.*code-signing/i.test(step.name ?? '')),
  'release job has no mandatory code-signing gate',
);

const windowsSteps = workflowDoc.jobs?.['windows-x64']?.steps ?? [];
const signPathSubmitStep = windowsSteps.find((step) => step.id === 'submit-signing');
assert(
  Boolean(signPathSubmitStep) && signPathSubmitStep['continue-on-error'] === true,
  'SignPath request failures are non-blocking',
);
const unsignedFallbackStep = windowsSteps.find((step) => step.name === 'Keep unsigned Windows files when SignPath is unavailable');
assert(
  Boolean(unsignedFallbackStep) &&
    unsignedFallbackStep.if.includes("steps.submit-signing.outcome != 'success'") &&
    unsignedFallbackStep.run.includes('an unsigned release can still be published'),
  'Windows build keeps unsigned executables when optional SignPath signing fails',
);
for (const pattern of [
  '*-win-x64-setup.exe',
  '*-win-x64-portable.exe',
  '*-linux-x86_64.AppImage',
  '*-mac-arm64.dmg',
  '*-mac-arm64.zip',
]) {
  assert(workflowYaml.includes(pattern), `workflow requires ${pattern}`);
}
assert(
  workflowYaml.includes('v${pkg_version}-build.${GITHUB_RUN_NUMBER}'),
  'workflow names automatic main pre-releases v<package.json version>-build.<github run number>',
);
assert(workflowYaml.includes('node scripts/sync-release-readme.mjs'), 'workflow runs sync-release-readme.mjs after release creation');
assert(
  workflowYaml.includes('https://api.github.com/repos/rajeshkamboj/cambuz-landing/dispatches') &&
    workflowYaml.includes('cambuz-release-published') &&
    workflowYaml.includes('CAMBUZ_LANDING_DISPATCH_TOKEN'),
  'workflow dispatches cambuz-release-published to rajeshkamboj/cambuz-landing with CAMBUZ_LANDING_DISPATCH_TOKEN',
);
assert(!workflowYaml.includes('/releases/latest'), 'workflow never references /releases/latest');

// ---------------------------------------------------------------------------
section('4. Optional macOS signing (missing secrets must yield an unsigned build)');

// GitHub Actions expands a missing secret (or variable) to ''. electron-builder
// keeps CSC_LINK='' as a configured certificate, resolves '' against the project
// directory and aborts with "<workspace> not a file". Pull-request builds skip
// signing, so only pushes (including every merge to main) failed.
const SIGNING_ENV_VARS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'CSC_INSTALLER_LINK',
  'CSC_INSTALLER_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
];
const expressionMappedSigningEnv = (envBlock, where) =>
  Object.entries(envBlock ?? {})
    .filter(([name, value]) => SIGNING_ENV_VARS.includes(name) && String(value).includes('${{'))
    .map(([name]) => `${where} sets ${name}`);
const directSigningMappings = expressionMappedSigningEnv(workflowDoc.env, 'workflow env');
for (const [jobId, job] of Object.entries(workflowDoc.jobs ?? {})) {
  directSigningMappings.push(...expressionMappedSigningEnv(job.env, `jobs.${jobId}.env`));
  for (const step of job.steps ?? []) {
    directSigningMappings.push(...expressionMappedSigningEnv(step.env, `jobs.${jobId} step "${step.name ?? step.uses ?? 'run'}"`));
  }
}
assert(
  directSigningMappings.length === 0,
  'no env block maps a secret/expression straight onto an electron-builder signing variable',
  directSigningMappings.join('; '),
);

const macBuildStep = (workflowDoc.jobs?.['macos-arm64']?.steps ?? []).find(
  (step) => typeof step.run === 'string' && /\bnpm run build:mac\b/.test(step.run),
);
assert(Boolean(macBuildStep), 'macOS job has a step that runs npm run build:mac');
assert(macBuildStep?.shell === 'bash', 'macOS build step runs its credential guard under bash');
assert(
  /secrets\.MAC_CSC_LINK\b/.test(String(macBuildStep?.env?.MAC_CSC_LINK)) &&
    /secrets\.MAC_CSC_KEY_PASSWORD\b/.test(String(macBuildStep?.env?.MAC_CSC_KEY_PASSWORD)),
  'macOS build step receives the certificate as MAC_CSC_LINK / MAC_CSC_KEY_PASSWORD',
);

const bashProbe = process.platform === 'win32' ? null : spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
if (!macBuildStep) {
  skip('macOS build step credential guard behaviour', 'build step not found');
} else if (bashProbe?.stdout?.trim() !== 'ok') {
  skip('macOS build step credential guard behaviour', 'needs bash on Linux/macOS');
} else {
  // Run the real step script with a stand-in `npm` that records which signing
  // variables electron-builder would have been started with.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cambuz-mac-signing-'));
  try {
    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir);
    const stepScript = path.join(tmpDir, 'build-step.sh');
    fs.writeFileSync(stepScript, macBuildStep.run, 'utf8');
    const recorder = path.join(tmpDir, 'record-npm.cjs');
    fs.writeFileSync(
      recorder,
      [
        "const fs = require('fs');",
        "const watched = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_IDENTITY_AUTO_DISCOVERY', 'MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD'];",
        'const env = {};',
        'for (const name of watched) if (Object.prototype.hasOwnProperty.call(process.env, name)) env[name] = process.env[name];',
        'fs.writeFileSync(process.env.NPM_STUB_RECORD, JSON.stringify({ args: process.argv.slice(2), env }));',
        "process.exit(Number(process.env.NPM_STUB_EXIT || '0'));",
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/usr/bin/env bash\nexec "$NPM_STUB_NODE" "$NPM_STUB_JS" "$@"\n', { mode: 0o755 });

    // Resolve the step's `env:` block the way GitHub Actions does: a secret that
    // is not configured expands to an empty string.
    const resolveStepEnv = (secrets) =>
      Object.fromEntries(
        Object.entries(macBuildStep.env ?? {}).map(([name, value]) => {
          const text = String(value);
          const secretRef = /^\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}$/.exec(text.trim());
          if (secretRef) return [name, secrets[secretRef[1]] ?? ''];
          return [name, text.includes('${{') ? '' : text];
        }),
      );

    let runCount = 0;
    const runMacBuildStep = (secrets, inheritedEnv = {}) => {
      runCount += 1;
      const record = path.join(tmpDir, `npm-call-${runCount}.json`);
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', stepScript], {
        encoding: 'utf8',
        env: {
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          // Inherited from the workflow-level env, exactly as on the runner.
          CSC_IDENTITY_AUTO_DISCOVERY: String(workflowDoc.env?.CSC_IDENTITY_AUTO_DISCOVERY),
          NPM_STUB_NODE: process.execPath,
          NPM_STUB_JS: recorder,
          NPM_STUB_RECORD: record,
          ...inheritedEnv,
          ...resolveStepEnv(secrets),
        },
      });
      const call = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : null;
      return { status: result.status, output: `${result.stdout}${result.stderr}`.trim(), call };
    };

    const unsigned = runMacBuildStep({});
    assert(
      unsigned.status === 0 && unsigned.call?.args?.join(' ') === 'run build:mac',
      'macOS build still runs npm run build:mac when no signing secrets are configured',
      unsigned.output,
    );
    assert(
      unsigned.call != null && !('CSC_LINK' in unsigned.call.env) && !('CSC_KEY_PASSWORD' in unsigned.call.env),
      'missing MAC_CSC_LINK leaves CSC_LINK / CSC_KEY_PASSWORD unset (not empty) for electron-builder',
      JSON.stringify(unsigned.call?.env),
    );
    assert(
      unsigned.call?.env?.CSC_IDENTITY_AUTO_DISCOVERY === 'false',
      'unsigned macOS build keeps identity auto-discovery off',
      JSON.stringify(unsigned.call?.env),
    );

    const blank = runMacBuildStep({ MAC_CSC_LINK: ' \n\t ' });
    assert(
      blank.status === 0 && blank.call != null && !('CSC_LINK' in blank.call.env),
      'whitespace-only MAC_CSC_LINK is treated as not configured',
      JSON.stringify(blank.call?.env) || blank.output,
    );

    const inheritedEmpty = runMacBuildStep({}, { CSC_LINK: '', CSC_KEY_PASSWORD: '' });
    assert(
      inheritedEmpty.status === 0 &&
        inheritedEmpty.call != null &&
        !('CSC_LINK' in inheritedEmpty.call.env) &&
        !('CSC_KEY_PASSWORD' in inheritedEmpty.call.env),
      'an inherited empty CSC_LINK / CSC_KEY_PASSWORD is removed before electron-builder starts',
      JSON.stringify(inheritedEmpty.call?.env) || inheritedEmpty.output,
    );

    const fakeCertificate = 'MIIKbFakeBase64DeveloperIdCertificate==';
    const signed = runMacBuildStep({ MAC_CSC_LINK: fakeCertificate, MAC_CSC_KEY_PASSWORD: 'p12-password' });
    assert(
      signed.status === 0 &&
        signed.call?.env?.CSC_LINK === fakeCertificate &&
        signed.call?.env?.CSC_KEY_PASSWORD === 'p12-password',
      'configured MAC_CSC_LINK / MAC_CSC_KEY_PASSWORD are exported as CSC_LINK / CSC_KEY_PASSWORD',
      JSON.stringify(signed.call?.env) || signed.output,
    );
    assert(
      signed.call?.env?.CSC_IDENTITY_AUTO_DISCOVERY === 'true',
      'a configured certificate enables identity discovery so electron-builder finds it in its temporary keychain',
      JSON.stringify(signed.call?.env),
    );
    assert(
      signed.call != null && !('MAC_CSC_LINK' in signed.call.env) && !('MAC_CSC_KEY_PASSWORD' in signed.call.env),
      'raw MAC_CSC_* secrets are not passed on to the build a second time',
      JSON.stringify(signed.call?.env),
    );

    const noPassword = runMacBuildStep({ MAC_CSC_LINK: fakeCertificate });
    assert(
      noPassword.status === 0 &&
        noPassword.call?.env?.CSC_LINK === fakeCertificate &&
        !('CSC_KEY_PASSWORD' in noPassword.call.env),
      'a certificate without MAC_CSC_KEY_PASSWORD exports CSC_LINK only',
      JSON.stringify(noPassword.call?.env) || noPassword.output,
    );

    const brokenBuild = runMacBuildStep({}, { NPM_STUB_EXIT: '7' });
    assert(brokenBuild.status !== 0, 'a failing electron-builder run still fails the macOS build step', `exit ${brokenBuild.status}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log(`\nRelease automation tests: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
if (failed > 0) {
  console.log(`Failures:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
