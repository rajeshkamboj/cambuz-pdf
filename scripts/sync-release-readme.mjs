#!/usr/bin/env node
// Cambuz PDF Reader — synchronize README.md download badges, tables, checksums
// and permanent asset links with a published GitHub Release.
//
// Usage:
//   node scripts/sync-release-readme.mjs --tag v1.1.0-build.123 [--repo rajeshkamboj/cambuz-pdf] [--sha <sha>] [--run-id <id>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_README_PATH = path.join(REPO_ROOT, 'README.md');
const DEFAULT_PACKAGE_PATH = path.join(REPO_ROOT, 'package.json');
const DEFAULT_REPO = 'rajeshkamboj/cambuz-pdf';

export const MARKERS = Object.freeze({
  badge: {
    start: '<!-- release-sync:badge:start -->',
    end: '<!-- release-sync:badge:end -->',
  },
  downloads: {
    start: '<!-- release-sync:downloads:start -->',
    end: '<!-- release-sync:downloads:end -->',
  },
  links: {
    start: '<!-- release-sync:links:start -->',
    end: '<!-- release-sync:links:end -->',
  },
});

export const ASSET_SLOTS = Object.freeze([
  {
    key: 'winSetup',
    refId: 'win-setup-dl',
    label: 'Windows x64 installer (*-win-x64-setup.exe)',
    pattern: /^Cambuz-PDF-Reader-.+-win-x64-setup\.exe$/,
  },
  {
    key: 'winPortable',
    refId: 'win-portable-dl',
    label: 'Windows x64 portable (*-win-x64-portable.exe)',
    pattern: /^Cambuz-PDF-Reader-.+-win-x64-portable\.exe$/,
  },
  {
    key: 'linuxAppImage',
    refId: 'linux-dl',
    label: 'Linux x64 AppImage (*-linux-x86_64.AppImage)',
    pattern: /^Cambuz-PDF-Reader-.+-linux-x86_64\.AppImage$/,
  },
  {
    key: 'macDmg',
    refId: 'mac-dmg-dl',
    label: 'macOS arm64 DMG (*-mac-arm64.dmg)',
    pattern: /^Cambuz-PDF-Reader-.+-mac-arm64\.dmg$/,
  },
  {
    key: 'macZip',
    refId: 'mac-zip-dl',
    label: 'macOS arm64 ZIP (*-mac-arm64.zip)',
    pattern: /^Cambuz-PDF-Reader-.+-mac-arm64\.zip$/,
  },
]);

export const SHA256_DIGEST_RE = /^sha256:([0-9a-f]{64})$/i;
const TAG_VERSION_RE = /^v(\d+\.\d+\.\d+)(?:-(.+))?$/;

export function formatMiB(bytes) {
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(`Invalid asset byte size: ${JSON.stringify(bytes)}`);
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function escapeShieldsText(value) {
  return String(value)
    .replace(/-/g, '--')
    .replace(/_/g, '__')
    .replace(/ /g, '%20');
}

export function parseSemverTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = TAG_VERSION_RE.exec(tag.trim());
  if (!match) return null;
  const [major, minor, patch] = match[1].split('.').map((n) => Number.parseInt(n, 10));
  const prerelease = match[2] ?? null;
  let buildNumber = null;
  if (prerelease && /^build\.(\d+)$/.test(prerelease)) {
    buildNumber = Number.parseInt(prerelease.slice('build.'.length), 10);
  }
  return {
    version: match[1],
    major,
    minor,
    patch,
    prerelease,
    buildNumber,
  };
}

export function compareReleaseTags(currentTag, candidateTag) {
  const cur = parseSemverTag(currentTag);
  const next = parseSemverTag(candidateTag);
  if (!cur || !next) return 0;
  if (next.major !== cur.major) return next.major - cur.major;
  if (next.minor !== cur.minor) return next.minor - cur.minor;
  if (next.patch !== cur.patch) return next.patch - cur.patch;
  if (cur.buildNumber !== null && next.buildNumber !== null) {
    return next.buildNumber - cur.buildNumber;
  }
  return 0;
}

function validateDownloadUrl(url, repo, tag, expectedName) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(`Asset "${expectedName}" is missing browser_download_url`);
  }
  if (url.includes('/releases/latest')) {
    throw new Error(`Asset "${expectedName}" uses forbidden /releases/latest URL: ${url}`);
  }
  const expectedPrefix = `https://github.com/${repo}/releases/download/${tag}/`;
  const encodedPrefix = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/`;
  if (
    url !== `${expectedPrefix}${expectedName}` &&
    url !== `${encodedPrefix}${expectedName}`
  ) {
    throw new Error(
      `Asset "${expectedName}" has unexpected browser_download_url "${url}" (expected "${expectedPrefix}${expectedName}")`,
    );
  }
}

function extractDigestHex(asset, requireDigest = true) {
  if (typeof asset.digest !== 'string' || asset.digest.trim().length === 0) {
    if (!requireDigest) return null;
    throw new Error(`Asset "${asset.name}" is missing GitHub API digest (expected sha256:<64 hex chars>)`);
  }
  const match = SHA256_DIGEST_RE.exec(asset.digest.trim());
  if (!match) {
    throw new Error(
      `Asset "${asset.name}" has invalid digest "${asset.digest}" (expected sha256:<64 hex chars>)`,
    );
  }
  return match[1].toLowerCase();
}

/**
 * Validate a GitHub Release API payload and extract normalized metadata.
 *
 * @param {object} release
 * @param {{ repo?: string, expectedTag?: string, packageVersion?: string, sha?: string, runId?: string }} [options]
 */
export function extractReleaseMetadata(release, options = {}) {
  const repo = options.repo || DEFAULT_REPO;
  if (!release || typeof release !== 'object') {
    throw new Error('Release API response must be a JSON object');
  }
  if (release.draft === true) {
    throw new Error(`Release "${release.tag_name ?? ''}" is a draft; refusing to sync README to a draft release`);
  }
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  if (!tag || tag === 'latest' || tag.includes('/')) {
    throw new Error(`Invalid release tag_name: ${JSON.stringify(release.tag_name)}`);
  }
  if (options.expectedTag && tag !== options.expectedTag) {
    throw new Error(`Release tag mismatch: expected "${options.expectedTag}", got "${tag}"`);
  }
  const parsedTag = parseSemverTag(tag);
  if (!parsedTag) {
    throw new Error(`Release tag "${tag}" does not start with a semantic version (expected v<major>.<minor>.<patch>...)`);
  }
  const version = options.packageVersion || parsedTag.version;
  if (options.packageVersion && parsedTag.version !== options.packageVersion) {
    const pkgSemver = parseSemverTag(`v${options.packageVersion}`);
    if (pkgSemver && compareReleaseTags(`v${options.packageVersion}`, tag) < 0) {
      throw new Error(
        `Refusing to move README backwards from package.json version ${options.packageVersion} to older tag ${tag}`,
      );
    }
  }

  const releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`;
  if (typeof release.html_url === 'string' && release.html_url.includes('/releases/latest')) {
    throw new Error(`Release html_url uses forbidden /releases/latest endpoint: ${release.html_url}`);
  }

  if (!Array.isArray(release.assets)) {
    throw new Error(`Release "${tag}" is missing an assets array`);
  }

  const resolvedAssets = {};
  for (const slot of ASSET_SLOTS) {
    const matches = release.assets.filter(
      (asset) => asset && typeof asset.name === 'string' && slot.pattern.test(asset.name),
    );
    if (matches.length !== 1) {
      const names = matches.map((a) => a.name).join(', ') || 'none';
      throw new Error(
        `Release "${tag}" must contain exactly 1 asset for ${slot.label}; found ${matches.length} (${names})`,
      );
    }
    const asset = matches[0];
    if (asset.state && asset.state !== 'uploaded') {
      throw new Error(`Asset "${asset.name}" is in state "${asset.state}" (expected "uploaded")`);
    }
    validateDownloadUrl(asset.browser_download_url, repo, tag, asset.name);
    const sizeFormatted = formatMiB(asset.size);
    const sha256 = extractDigestHex(asset, true);

    resolvedAssets[slot.key] = {
      key: slot.key,
      refId: slot.refId,
      name: asset.name,
      size: asset.size,
      sizeFormatted,
      sha256,
      browserDownloadUrl: asset.browser_download_url,
    };
  }

  const sumsMatches = release.assets.filter(
    (asset) => asset && asset.name === 'SHA256SUMS.txt',
  );
  if (sumsMatches.length !== 1) {
    throw new Error(
      `Release "${tag}" must contain exactly 1 SHA256SUMS.txt asset; found ${sumsMatches.length}`,
    );
  }
  const sumsAsset = sumsMatches[0];
  if (sumsAsset.state && sumsAsset.state !== 'uploaded') {
    throw new Error(`Asset "SHA256SUMS.txt" is in state "${sumsAsset.state}" (expected "uploaded")`);
  }
  validateDownloadUrl(sumsAsset.browser_download_url, repo, tag, 'SHA256SUMS.txt');
  if (!Number.isInteger(sumsAsset.size) || sumsAsset.size <= 0) {
    throw new Error(`Asset "SHA256SUMS.txt" has invalid size: ${JSON.stringify(sumsAsset.size)}`);
  }
  if (sumsAsset.digest !== undefined && sumsAsset.digest !== null) {
    extractDigestHex(sumsAsset, true);
  }

  // Extract optional commit SHA and CI run ID from options or release body.
  const body = typeof release.body === 'string' ? release.body : '';
  let commitSha = typeof options.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(options.sha.trim())
    ? options.sha.trim()
    : '';
  if (!commitSha && typeof release.target_commitish === 'string' && /^[0-9a-f]{7,40}$/i.test(release.target_commitish.trim())) {
    commitSha = release.target_commitish.trim();
  }
  if (!commitSha) {
    const bodyCommitMatch = /commit\s+`([0-9a-f]{7,40})`/i.exec(body);
    if (bodyCommitMatch) commitSha = bodyCommitMatch[1];
  }
  const shortSha = commitSha ? commitSha.slice(0, 7).toLowerCase() : null;

  let runId = typeof options.runId === 'string' && /^\d+$/.test(options.runId.trim())
    ? options.runId.trim()
    : '';
  if (!runId) {
    const bodyRunMatch = /\/actions\/runs\/(\d+)/.exec(body);
    if (bodyRunMatch) runId = bodyRunMatch[1];
  }

  return {
    repo,
    tag,
    version,
    prerelease: Boolean(release.prerelease) || tag.includes('-'),
    releaseUrl,
    shortSha,
    commitSha: commitSha || null,
    runId: runId || null,
    assets: resolvedAssets,
    sumsAsset: {
      name: 'SHA256SUMS.txt',
      size: sumsAsset.size,
      browserDownloadUrl: sumsAsset.browser_download_url,
    },
  };
}

export function renderBadgeSection(meta) {
  const escapedTag = escapeShieldsText(meta.tag);
  const versionBadgeSuffix = meta.prerelease ? '--pre--release' : '';
  const versionAltSuffix = meta.prerelease ? ' pre-release' : '';
  const escapedVersion = escapeShieldsText(meta.version);
  return [
    `  <a href="${meta.releaseUrl}"><img src="https://img.shields.io/badge/download-${escapedTag}-success" alt="Download ${meta.tag}" /></a>`,
    `  <img src="https://img.shields.io/badge/version-${escapedVersion}${versionBadgeSuffix}-informational" alt="Version ${meta.version}${versionAltSuffix}" />`,
  ].join('\n');
}

export function renderDownloadsSection(meta) {
  const { assets, tag, version, repo, shortSha, runId } = meta;
  const releaseKind = meta.prerelease ? 'pre-release' : 'release';

  let provenanceLine;
  if (shortSha && runId) {
    provenanceLine = [
      `Every file is built from commit \`${shortSha}\` in`,
      `[CI run ${runId}](https://github.com/${repo}/actions/runs/${runId})`,
      `(all five jobs green) and attached to the [${tag} ${releaseKind}][release-page].`,
    ].join('\n');
  } else if (shortSha) {
    provenanceLine = `Every file is built from commit \`${shortSha}\` and attached to the [${tag} ${releaseKind}][release-page].`;
  } else {
    provenanceLine = `Every file is built in CI (all five platform artifacts verified) and attached to the [${tag} ${releaseKind}][release-page].`;
  }

  return `> **How downloads work right now:** version **${version}** is published as the
> **[${tag} ${releaseKind}][release-page]**, so the links below are permanent
> release-asset links — no GitHub account needed and no 30-day CI expiry.
> Automatic builds are **unsigned pre-release builds**: expect SmartScreen and Gatekeeper warnings.
> A manual acceptance pass on real hardware still gates a full stable release.

${provenanceLine}

| Platform & architecture | File | Best for | Size | Download |
| --- | --- | --- | ---: | --- |
| **Windows 10/11 · x64** *(recommended)* | \`${assets.winSetup.name}\` — NSIS installer | Normal install: pick a folder, Start Menu entry, optional \`.pdf\` association. Per-user, no admin rights. | ${assets.winSetup.sizeFormatted} | **[Download installer][win-setup-dl]** |
| Windows 10/11 · x64 | \`${assets.winPortable.name}\` | No install at all — run from Desktop, Downloads or a USB stick (it extracts itself at launch) | ${assets.winPortable.sizeFormatted} | **[Download portable][win-portable-dl]** |
| Linux x64 *(experimental)* | \`${assets.linuxAppImage.name}\` | Try Cambuz on Linux; single-file AppImage | ${assets.linuxAppImage.sizeFormatted} | **[Download AppImage][linux-dl]** |
| macOS 13+ · Apple Silicon *(experimental)* | \`${assets.macDmg.name}\` | Drag-to-Applications disk image; unsigned and not notarized | ${assets.macDmg.sizeFormatted} | **[Download DMG][mac-dmg-dl]** |
| macOS 13+ · Apple Silicon *(experimental)* | \`${assets.macZip.name}\` | Same app bundle as a plain ZIP | ${assets.macZip.sizeFormatted} | **[Download ZIP][mac-zip-dl]** |
| Windows arm64, Intel Mac, Linux arm64 | — | Not built | — | *unavailable* |

All five files, plus [\`SHA256SUMS.txt\`][sums-dl], are listed on the
[${tag} ${releaseKind} page][release-page]. Want a build of a newer commit? The
[Desktop builds workflow](https://github.com/${repo}/actions/workflows/desktop-build.yml)
publishes a new pinned pre-release on every successful push to \`main\` and also uploads
CI artifacts (CI artifacts need a signed-in GitHub account and expire after 30 days; the
release links above do not).

<details>
<summary><strong>SHA-256 checksums for the ${tag} files</strong> (published as <code>SHA256SUMS.txt</code> on the release)</summary>

| File | SHA-256 |
| --- | --- |
| \`${assets.winSetup.name}\` | \`${assets.winSetup.sha256}\` |
| \`${assets.winPortable.name}\` | \`${assets.winPortable.sha256}\` |
| \`${assets.linuxAppImage.name}\` | \`${assets.linuxAppImage.sha256}\` |
| \`${assets.macDmg.name}\` | \`${assets.macDmg.sha256}\` |
| \`${assets.macZip.name}\` | \`${assets.macZip.sha256}\` |

Verify after download: \`Get-FileHash -Algorithm SHA256 <file>\` (PowerShell) or
\`sha256sum -c SHA256SUMS.txt\` (Linux/macOS, next to the downloaded files). The builds are
unsigned, so the checksum is how you confirm a file is the one CI produced.

</details>

**At a glance:** version ${version} (${releaseKind}) · app ID \`com.cambuz.pdfreader\` · publisher
Cambuz · MIT licence with [third-party notices](THIRD-PARTY-NOTICES.md) · no telemetry ·
works fully offline after download · Electron 44 runtime (most of the installer size).`;
}

export function renderLinksSection(meta) {
  const { assets, sumsAsset, releaseUrl } = meta;
  return [
    `[release-page]: ${releaseUrl}`,
    `[win-setup-dl]: ${assets.winSetup.browserDownloadUrl}`,
    `[win-portable-dl]: ${assets.winPortable.browserDownloadUrl}`,
    `[linux-dl]: ${assets.linuxAppImage.browserDownloadUrl}`,
    `[mac-dmg-dl]: ${assets.macDmg.browserDownloadUrl}`,
    `[mac-zip-dl]: ${assets.macZip.browserDownloadUrl}`,
    `[sums-dl]: ${sumsAsset.browserDownloadUrl}`,
  ].join('\n');
}

function replaceBetweenMarkers(content, sectionName, startMarker, endMarker, replacement) {
  const firstStart = content.indexOf(startMarker);
  if (firstStart === -1) {
    throw new Error(`README is missing start marker for "${sectionName}": ${startMarker}`);
  }
  if (content.indexOf(startMarker, firstStart + startMarker.length) !== -1) {
    throw new Error(`README has duplicate start marker for "${sectionName}": ${startMarker}`);
  }
  const firstEnd = content.indexOf(endMarker);
  if (firstEnd === -1) {
    throw new Error(`README is missing end marker for "${sectionName}": ${endMarker}`);
  }
  if (content.indexOf(endMarker, firstEnd + endMarker.length) !== -1) {
    throw new Error(`README has duplicate end marker for "${sectionName}": ${endMarker}`);
  }
  if (firstEnd < firstStart) {
    throw new Error(`README end marker appears before start marker for "${sectionName}"`);
  }

  const lineStart = content.lastIndexOf('\n', firstStart - 1);
  const indent = lineStart === -1 ? '' : content.slice(lineStart + 1, firstStart);
  const endPrefix = /^\s*$/.test(indent) ? indent : '';

  const before = content.slice(0, firstStart + startMarker.length);
  const after = content.slice(firstEnd);
  return `${before}\n${replacement}\n${endPrefix}${after}`;
}

function extractCurrentReadmeTag(readmeContent) {
  const match = /\[release-page\]:\s*https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/releases\/tag\/([^\s]+)/.exec(
    readmeContent,
  );
  return match ? match[1].trim() : null;
}

/**
 * Rewrite only the three marked sections in README content.
 *
 * @param {string} readmeContent
 * @param {ReturnType<typeof extractReleaseMetadata>} meta
 * @param {{ allowDowngrade?: boolean }} [options]
 */
export function updateReadmeContent(readmeContent, meta, options = {}) {
  if (typeof readmeContent !== 'string' || readmeContent.length === 0) {
    throw new Error('README content must be a non-empty string');
  }
  if (!options.allowDowngrade) {
    const currentTag = extractCurrentReadmeTag(readmeContent);
    if (currentTag && compareReleaseTags(currentTag, meta.tag) < 0) {
      throw new Error(
        `Refusing to move README backwards from current tag "${currentTag}" to older tag "${meta.tag}"`,
      );
    }
  }

  let updated = readmeContent;
  updated = replaceBetweenMarkers(
    updated,
    'badge',
    MARKERS.badge.start,
    MARKERS.badge.end,
    renderBadgeSection(meta),
  );
  updated = replaceBetweenMarkers(
    updated,
    'downloads',
    MARKERS.downloads.start,
    MARKERS.downloads.end,
    renderDownloadsSection(meta),
  );
  updated = replaceBetweenMarkers(
    updated,
    'links',
    MARKERS.links.start,
    MARKERS.links.end,
    renderLinksSection(meta),
  );
  return updated;
}

/**
 * Fetch a published release by exact tag from the GitHub Releases API, with
 * short retries in case asset digests are still settling right after upload.
 *
 * @param {{ repo: string, tag: string, token?: string, retries?: number, retryDelayMs?: number, fetchImpl?: typeof fetch }} params
 */
export async function fetchPublishedRelease({
  repo = DEFAULT_REPO,
  tag,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  retries = 4,
  retryDelayMs = 2000,
  fetchImpl = globalThis.fetch,
}) {
  if (!tag || typeof tag !== 'string' || tag.trim() === '' || tag.trim() === 'latest') {
    throw new Error(`A pinned release tag is required (got ${JSON.stringify(tag)})`);
  }
  const cleanTag = tag.trim();
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(cleanTag)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cambuz-pdf-release-sync',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(
          `GitHub Releases API returned HTTP ${response.status} for ${url}: ${bodyText.slice(0, 300)}`,
        );
      }
      const release = await response.json();
      // Validate that all required assets and their sha256 digests are present.
      extractReleaseMetadata(release, { repo, expectedTag: cleanTag });
      return release;
    } catch (err) {
      lastError = err;
      if (attempt < retries && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}

/**
 * High-level synchronization entry point.
 */
export async function syncReleaseReadme(options = {}) {
  const readmePath = path.resolve(options.readmePath || DEFAULT_README_PATH);
  const packagePath = path.resolve(options.packagePath || DEFAULT_PACKAGE_PATH);
  const repo = options.repo || process.env.GH_REPO || process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const tag = options.tag || process.env.TAG || process.env.RELEASE_TAG || '';
  const sha = options.sha ?? process.env.GITHUB_SHA ?? '';
  const runId = options.runId ?? process.env.GITHUB_RUN_ID ?? '';

  if (!tag || tag === 'latest') {
    throw new Error('Missing required release tag (--tag <tag> or TAG environment variable)');
  }

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const release = options.release
    ? options.release
    : options.releaseJsonPath
      ? JSON.parse(fs.readFileSync(path.resolve(options.releaseJsonPath), 'utf8'))
      : await fetchPublishedRelease({
          repo,
          tag,
          token: options.token,
          retries: options.retries,
          retryDelayMs: options.retryDelayMs,
          fetchImpl: options.fetchImpl,
        });

  const meta = extractReleaseMetadata(release, {
    repo,
    expectedTag: tag,
    packageVersion: pkg.version,
    sha,
    runId,
  });

  const currentReadme = fs.readFileSync(readmePath, 'utf8');
  const nextReadme = updateReadmeContent(currentReadme, meta, {
    allowDowngrade: options.allowDowngrade,
  });

  if (!options.dryRun && nextReadme !== currentReadme) {
    fs.writeFileSync(readmePath, nextReadme, 'utf8');
  }

  return {
    changed: nextReadme !== currentReadme,
    meta,
    readmePath,
    content: nextReadme,
  };
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag' && argv[i + 1]) {
      out.tag = argv[++i];
    } else if (arg === '--repo' && argv[i + 1]) {
      out.repo = argv[++i];
    } else if (arg === '--readme' && argv[i + 1]) {
      out.readmePath = argv[++i];
    } else if (arg === '--package' && argv[i + 1]) {
      out.packagePath = argv[++i];
    } else if (arg === '--sha' && argv[i + 1]) {
      out.sha = argv[++i];
    } else if (arg === '--run-id' && argv[i + 1]) {
      out.runId = argv[++i];
    } else if (arg === '--release-json' && argv[i + 1]) {
      out.releaseJsonPath = argv[++i];
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--allow-downgrade') {
      out.allowDowngrade = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const cliOptions = parseCliArgs(process.argv.slice(2));
    const result = await syncReleaseReadme(cliOptions);
    const assetSummary = Object.values(result.meta.assets)
      .map((a) => `${a.name} (${a.sizeFormatted}, sha256:${a.sha256.slice(0, 12)}…)`)
      .join(', ');
    console.log(
      `${result.changed ? 'Updated' : 'Verified (no changes needed)'} ${path.relative(REPO_ROOT, result.readmePath)} for ${result.meta.tag}: ${assetSummary}`,
    );
  } catch (err) {
    console.error(`Failed to sync README release links: ${err.message}`);
    process.exit(1);
  }
}
