# Code-Signing Setup Guide

> **Every release build must be code-signed.** The CI release job will refuse to
> publish a GitHub Release if the Windows or macOS binaries are not signed. This
> document walks you through the setup.

---

## Why code-signing is required

| Platform | Without signing | With signing |
|---|---|---|
| **Windows** | SmartScreen shows *"Windows protected your PC"* — most users will turn away. | Windows trusts the publisher. No warning on download or first run. |
| **macOS** | Gatekeeper blocks the app entirely. Users must right-click → Open. | Gatekeeper allows the app. If notarized, no prompt at all. |

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
 CI builds unsigned .exe → uploads to GitHub artifact → SignPath signs
 → signed .exe downloaded → checksums + smoke tests → release published
```

The private key lives on SignPath's hardware security modules — it never
touches this repository or GitHub secrets.

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

Push or merge to `main`. The CI will:
1. Build the unsigned `.exe` files
2. Submit them to SignPath for signing
3. **SignPath will email you** to approve the signing request (within 1 hour)
4. After approval, the signed files are downloaded and the release is published
5. Check the download: right-click the `.exe` → Properties → Digital Signatures
   — it should show **"SignPath Foundation"**

Once you're confident, you can set the signing policy to **auto-approve** for
tag builds.

### What happens without SignPath secrets

The build jobs still succeed (for PR testing), but the executables will be
unsigned. The release job will **block publication** with a clear error message.

---

## macOS — Developer ID + notarization ($99/yr)

There is no free program for macOS code signing. Apple requires the Developer
Program ($99/year) for Developer ID certificates and notarization.

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

1. The **macOS arm64** build job passes all five secrets to `electron-builder`.
2. `electron-builder` signs the `.app` with the Developer ID certificate, then
   submits it to Apple's notarization service via `notarytool`.
3. After notarization, `electron-builder` staples the ticket to the `.dmg` and
   `.zip`.
4. A post-build step verifies `codesign --verify --deep --strict` and writes
   `signed` to `SIGNED.txt`.
5. The release job gates on `SIGNED.txt`.

---

## Full list of secrets & variables

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
| Release blocked: "SIGNED.txt missing" | Secrets not configured | Add the secrets listed above, then push again |
| SignPath: "Signing request timed out" | Manual approval not completed | Check your email / SignPath dashboard and approve within 1 hour |
| SignPath: "Organization not found" | Wrong `SIGNPATH_ORGANIZATION_ID` | Copy the exact ID from SignPath → Settings |
| SignPath: "Project not found" | Wrong `SIGNPATH_PROJECT_SLUG` | Must match the project slug in SignPath exactly |
| macOS: `codesign` error | Certificate password wrong | Re-export the `.p12` and re-encode |
| macOS: notarization fails | Apple ID or app-specific password wrong | Regenerate at appleid.apple.com |