# Code-Signing Setup Guide

> **Every release build must be code-signed.** The CI release job will refuse to
> publish a GitHub Release if the Windows or macOS binaries are not signed. This
> document walks you through obtaining the certificates and configuring the
> GitHub repository secrets that the
> [Desktop builds workflow](../.github/workflows/desktop-build.yml) expects.

---

## Why code-signing is required

| Platform | Without signing | With signing |
|---|---|---|
| **Windows** | SmartScreen shows *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."* Users must click **More info → Run anyway**. | Windows trusts the publisher. No warning on download or first run. |
| **macOS** | Gatekeeper blocks the app entirely: *"Cambuz PDF Reader can't be opened because it is from an unidentified developer."* Users must right-click → Open or remove the quarantine attribute. | Gatekeeper allows the app. If notarized, there is no prompt at all. |

Linux AppImages are not code-signed in the traditional sense (there is no
standard Authenticode equivalent). Integrity is verified through SHA-256
checksums instead.

---

## 1. Windows code-signing

### What you need

- A **code-signing certificate** (`.pfx` / `.p12` file) issued by a publicly
  trusted Certificate Authority (CA). Common options:

  | CA | Type | Approx. cost | Notes |
  |---|---|---|---|
  | **Sectigo** (formerly Comodo) | Standard OV | $70–200/yr | Works immediately; SmartScreen reputation builds over time. |
  | **Sectigo** | EV (Extended Validation) | $200–500/yr | Instant SmartScreen trust; requires business verification and often a hardware token or cloud HSM. |
  | **DigiCert** | OV or EV | $200–600/yr | High reputation; EV available with cloud-based signing. |
  | **SSL.com** | EV | $250/yr | Supports cloud HSM (eSigner) — no USB token needed in CI. |

  **EV certificates** give instant SmartScreen trust but are more expensive and
  require business identity verification. **OV certificates** work too —
  SmartScreen builds trust after enough users download the signed binary.

- The certificate exported as a **`.pfx`** file (PKCS#12) with a password.

### Prepare the certificate for CI

```bash
# Base64-encode the .pfx file (no line breaks)
base64 -w 0 your-certificate.pfx > win-csc-link.txt

# On macOS:
base64 -i your-certificate.pfx | tr -d '\n' > win-csc-link.txt
```

### Configure GitHub secrets

Go to **Settings → Secrets and variables → Actions** in the
`rajeshkamboj/cambuz-pdf` repository and add:

| Secret name | Value |
|---|---|
| `WIN_CSC_LINK` | Contents of `win-csc-link.txt` (the base64-encoded `.pfx`) |
| `WIN_CSC_KEY_PASSWORD` | The password for the `.pfx` file |

### How it works in CI

1. The **Windows x64** build job passes `CSC_LINK` and `CSC_KEY_PASSWORD` to
   `electron-builder`, which decodes the `.pfx` and signs every `.exe` using
   `signtool`.
2. A post-build step runs `Get-AuthenticodeSignature` on both the installer and
   portable executable. If both are valid, it writes `signed` to `SIGNED.txt`.
3. The `SIGNED.txt` file is uploaded as part of the build artifacts.
4. The **release** job checks `SIGNED.txt`. If it says anything other than
   `signed`, the release is **blocked** with a clear error message listing the
   required secrets.

---

## 2. macOS code-signing and notarization

### What you need

1. **Apple Developer Program** membership ($99/year).
   [Enroll here](https://developer.apple.com/programs/).

2. A **Developer ID Application** certificate created in your Apple Developer
   account and exported as a `.p12` file with a password.

3. An **app-specific password** for notarization (generated at
   [appleid.apple.com](https://appleid.apple.com) → Security → App-Specific
   Passwords).

4. Your **Apple Team ID** (visible in your Apple Developer account under
   Membership).

### Prepare the certificate for CI

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
2. `electron-builder` signs the `.app` bundle with the Developer ID certificate
   using `codesign`, then submits it to Apple's notarization service using
   `notarytool` with the Apple ID credentials.
3. After notarization succeeds, `electron-builder` staples the notarization
   ticket to the `.dmg` and `.zip`.
4. A post-build step runs `codesign --verify --deep --strict` and checks
   stapling. If everything passes, it writes `signed` to `SIGNED.txt`.
5. The release job gates on `SIGNED.txt` as described above.

---

## 3. Full list of secrets

| Secret | Required for | Purpose |
|---|---|---|
| `WIN_CSC_LINK` | Windows | Base64-encoded `.pfx` certificate |
| `WIN_CSC_KEY_PASSWORD` | Windows | `.pfx` password |
| `MAC_CSC_LINK` | macOS | Base64-encoded `.p12` certificate |
| `MAC_CSC_KEY_PASSWORD` | macOS | `.p12` password |
| `APPLE_ID` | macOS | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password |
| `APPLE_TEAM_ID` | macOS | Apple Developer Team ID |
| `CAMBUZ_LANDING_DISPATCH_TOKEN` | Landing site sync | Fine-grained PAT for `rajeshkamboj/cambuz-landing` |

---

## 4. Verifying the signature locally

### Windows

```powershell
# Check Authenticode signature
Get-AuthenticodeSignature "Cambuz-PDF-Reader-1.1.0-win-x64-setup.exe"

# Expected: Status = Valid, SignerCertificate shows your publisher CN
```

### macOS

```bash
# Verify code signature
codesign --verify --deep --strict "Cambuz PDF Reader.app"

# Show signing details
codesign -dv --verbose=4 "Cambuz PDF Reader.app"

# Check Gatekeeper acceptance
spctl --assess --type execute "Cambuz PDF Reader.app"

# Check notarization stapling
xcrun stapler validate "Cambuz-PDF-Reader-1.1.0-mac-arm64.dmg"
```

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| CI release job blocked with "SIGNED.txt missing" | Secrets not configured | Add the secrets listed above, then re-run or push again |
| Windows: `signtool` error `0x80070005` | Certificate password wrong or `.pfx` corrupted | Re-export the `.pfx` and re-encode; verify the password |
| macOS: `The executable does not have the hardened runtime enabled` | electron-builder version too old or hardened runtime disabled | Ensure `electron-builder` ≥ 26.x (check `package.json`) |
| macOS: notarization fails with `Invalid credentials` | Apple ID or app-specific password wrong | Regenerate the app-specific password at appleid.apple.com |
| macOS: notarization fails with `The binary is not signed with a valid Developer ID` | Certificate is not a "Developer ID Application" cert | Create the correct certificate type in your Apple Developer account |
| `CSC_LINK` is empty in CI | Secret name typo or not set | Check **Settings → Secrets** for exact name match |