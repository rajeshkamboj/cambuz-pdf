# Optional Code-Signing Setup Guide

> **Code-signing is optional.** The CI workflow publishes tested unsigned Windows
> and macOS builds when credentials are not configured or a signing request is
> rejected or fails. Signing helps identify the publisher and can reduce OS
> warnings, but it is not required for a GitHub Release.

---

## Why signing helps

| Platform | Without signing | With signing |
|---|---|---|
| **Windows** | SmartScreen may show a warning for an unknown publisher; users can check the published SHA-256 and choose **More info → Run anyway**. | Authenticode identifies the publisher. SmartScreen reputation prompts may still appear, especially for a new OV-signed app. |
| **macOS** | Gatekeeper may block the first launch; users may need to approve opening the app manually. | A Developer ID signature and successful notarization provide the smoothest Gatekeeper experience. |

Linux AppImages are not code-signed in the traditional sense. Integrity is
verified through SHA-256 checksums instead.

---

## Windows — SignPath Foundation (free for open source)

Cambuz uses **[SignPath Foundation](https://signpath.org/)** for free Windows
code signing. The Foundation provides an OV certificate issued by **Sectigo**
(a trusted CA). The publisher name shown in Windows will be **"SignPath
Foundation"**.

### How it works

```
 CI builds unsigned .exe → optionally submits to SignPath
 → signed .exe is used if signing succeeds; otherwise unsigned .exe is kept
 → checksums + smoke tests → release published either way
```

The private key lives on SignPath's hardware security modules — it never
touches this repository or GitHub secrets. If SignPath declines an application,
or a signing request later fails or times out, CI keeps the unsigned files and
continues through the normal tests and release steps.

### What you need to do (one-time setup)

#### Prerequisites

- [x] MIT license on the repository (OSI-approved ✓)
- [x] Public CI on GitHub Actions ✓
- [x] Multi-factor authentication enabled on your GitHub account
  ([settings/security](https://github.com/settings/security))
- [x] At least one published release on the repository
- [x] 6 months of activity on your GitHub account/organization

#### Apply

1. Go to [signpath.org/apply](https://signpath.org/apply).
2. Provide:
   - Repository URL: `https://github.com/rajeshkamboj/cambuz-pdf`
   - License: MIT
   - Project description: "Free desktop PDF reader for Windows, Linux and macOS"
   - Release workflow file: `.github/workflows/desktop-build.yml`
3. Wait for approval (~15 minutes, may take longer if they have questions).

#### Configure SignPath (after approval)

1. Enable MFA on your SignPath account.
2. In SignPath, create a **project** (e.g. `cambuz-pdf`).
3. Link it to the `rajeshkamboj/cambuz-pdf` GitHub repository.
4. Create an **artifact configuration** — use the file at
   `.signpath/artifact-configuration.xml` in this repository (it tells SignPath
   to sign both the installer and portable `.exe`).
5. Create a **signing policy** (e.g. `release-signing`):
   - Origin: GitHub, limited to `main` branch pushes and `v*` tags
   - Approvers: yourself (or set auto-approval for tag builds)
6. Install the **SignPath GitHub App** on the `rajeshkamboj/cambuz-pdf` repository.

#### Configure GitHub secrets and variables

Go to **Settings → Secrets and variables → Actions** in the repository:

**Secret** (Settings → Secrets → New repository secret):

| Name | Value |
|---|---|
| `SIGNPATH_API_TOKEN` | CI user token from SignPath (Settings → API tokens) |

**Variables** (Settings → Variables → New repository variable):

| Name | Value |
|---|---|
| `SIGNPATH_ORGANIZATION_ID` | Your SignPath organization ID |
| `SIGNPATH_PROJECT_SLUG` | Project slug (e.g. `cambuz-pdf`) |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Signing policy slug (e.g. `release-signing`) |

#### First signed release

If SignPath approves the application and all four settings above are present,
push or merge to `main`. CI will build the unsigned `.exe` files, submit them,
and use the signed files if SignPath completes the request. Check a signed
`.exe` by right-clicking it → Properties → Digital Signatures; it should show
**"SignPath Foundation"**. Once the setup is stable, you can set the signing
policy to **auto-approve** for tag builds.

### What happens when SignPath is unavailable or rejects the application

Nothing needs to be changed to keep releasing. If the SignPath credentials are
missing/incomplete, or an optional signing request fails or times out, CI keeps
the original unsigned Windows installer and portable executable. Provided the
normal tests, builds and smoke checks pass, the release is still published with
SHA-256 checksums. Windows may show a SmartScreen warning; verify the checksum
before choosing **More info → Run anyway**.

---

## macOS — Developer ID + notarization ($99/yr)

There is no free program for macOS code signing. Apple requires the Developer
Program ($99/year) for Developer ID certificates and notarization. These
credentials are optional: without them, the workflow builds and publishes an
unsigned app bundle and labels its signing status in the release notes.

### What you need

1. **Apple Developer Program** membership ($99/yr).
   [Enroll here](https://developer.apple.com/programs/).
2. A **Developer ID Application** certificate from your Apple Developer account,
   exported as a `.p12` file with a password.
3. An **app-specific password** for notarization (generated at
   [appleid.apple.com](https://appleid.apple.com) → Security → App-Specific
   Passwords).
4. Your **Apple Team ID** (visible in your Apple Developer account under
   Membership).

### Prepare the certificate

```bash
# Base64-encode the .p12 file
base64 -w 0 "Developer ID Application.p12" > mac-csc-link.txt

# On macOS:
base64 -i "Developer ID Application.p12" | tr -d '\n' > mac-csc-link.txt
```

### Configure GitHub secrets

| Secret name | Value |
|---|---|
| `MAC_CSC_LINK` | Contents of `mac-csc-link.txt` (base64-encoded `.p12`) |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Your Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password generated above |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID |

### How it works in CI

1. The **macOS arm64** build job exports `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`
   to `electron-builder` as `CSC_LINK` / `CSC_KEY_PASSWORD` **only when
   `MAC_CSC_LINK` is set**, and only then lets it look for a signing identity
   (in the temporary keychain it creates from that certificate). Without the
   secret the job builds an unsigned app, which the release accepts. The
   secrets are never mapped straight onto `CSC_LINK` because GitHub Actions
   turns a missing secret into an empty string, which `electron-builder`
   would treat as a certificate path.
2. `electron-builder` signs the `.app` with the Developer ID certificate, then
   submits it to Apple's notarization service via `notarytool` (when
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are set).
3. After notarization, `electron-builder` staples the ticket to the `.dmg` and
   `.zip`.
4. A post-build step verifies `codesign --verify --deep --strict` and records
   `signed` or `unsigned` in `SIGNED.txt`.
5. The release notes report the status; unsigned builds still publish.

---

## Optional secrets & variables

None of these are needed to publish unsigned builds. Configure them only for
code-signing or the optional landing-site notification.

| Name | Type | Platform | Purpose |
|---|---|---|---|
| `SIGNPATH_API_TOKEN` | Secret | Windows | SignPath CI user token |
| `SIGNPATH_ORGANIZATION_ID` | Variable | Windows | SignPath organization ID |
| `SIGNPATH_PROJECT_SLUG` | Variable | Windows | SignPath project slug |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Variable | Windows | SignPath signing policy slug |
| `MAC_CSC_LINK` | Secret | macOS | Base64-encoded `.p12` certificate |
| `MAC_CSC_KEY_PASSWORD` | Secret | macOS | `.p12` password |
| `APPLE_ID` | Secret | macOS | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Secret | macOS | App-specific password |
| `APPLE_TEAM_ID` | Secret | macOS | Apple Developer Team ID |
| `CAMBUZ_LANDING_DISPATCH_TOKEN` | Secret | Landing site | Fine-grained PAT for `cambuz-landing` |

---

## Verifying signatures locally

### Windows

```powershell
Get-AuthenticodeSignature "Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe"
# Expected: Status = Valid, SignerCertificate shows "SignPath Foundation"
```

### macOS

```bash
codesign --verify --deep --strict "Cambuz PDF Reader.app"
codesign -dv --verbose=4 "Cambuz PDF Reader.app"
spctl --assess --type execute "Cambuz PDF Reader.app"
xcrun stapler validate "Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg"
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Release is unsigned | Signing credentials unavailable, application rejected, or request failed | This is expected and does not block publication; verify the SHA-256 before running |
| SignPath: "Signing request timed out" | Manual approval not completed | The release continues unsigned; check your email / SignPath dashboard if you want to retry signing |
| SignPath: "Organization not found" | Wrong `SIGNPATH_ORGANIZATION_ID` | Copy the exact ID from SignPath → Settings |
| SignPath: "Project not found" | Wrong `SIGNPATH_PROJECT_SLUG` | Must match the project slug in SignPath exactly |
| macOS: `Build DMG and ZIP` fails with `/Users/runner/work/cambuz-pdf/cambuz-pdf not a file` (push builds only; pull requests pass) | An empty `CSC_LINK` reached `electron-builder`, e.g. a workflow change mapped `CSC_LINK: ${{ secrets.MAC_CSC_LINK }}` directly while the secret is unset | Pass the secret as `MAC_CSC_LINK` and let the build step export `CSC_LINK` only when it is non-empty (as the workflow does); `npm test` checks for this |
| macOS: `codesign` error | Certificate password wrong | Re-export the `.p12` and re-encode |
| macOS: notarization fails | Apple ID or app-specific password wrong | Regenerate at appleid.apple.com |