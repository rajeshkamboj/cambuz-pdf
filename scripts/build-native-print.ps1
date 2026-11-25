$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$out = Join-Path $root '.native-print'
New-Item -ItemType Directory -Force $out | Out-Null
$archive = Join-Path $env:TEMP "cambuz-pdfium-$PID.zip"
try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://files.pythonhosted.org/packages/fe/7f/8aa446529fa14523e5c18f89e823afc95526689f76a75efe68a82a10d850/pypdfium2-5.15.2-py3-none-win_amd64.whl' -OutFile $archive
    if ((Get-FileHash $archive).Hash -ne '74d1bace34fb01c660d0b64344d5a4b7d276942b7c6623c88ab59ea21c5acfbd') { throw 'PDFium checksum mismatch' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -eq 'pypdfium2_raw/pdfium.dll') { $name = 'pdfium.dll' }
            elseif ($entry.FullName -match '\.dist-info/(licenses/.+)$' -and $entry.Name) { $name = $Matches[1] }
            else { continue }
            $target = Join-Path $out $name
            [IO.Directory]::CreateDirectory((Split-Path $target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally { $zip.Dispose() }
} finally { Remove-Item $archive -ErrorAction SilentlyContinue }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /platform:x64 /target:exe "/out:$out\CambuzPrint.exe" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "$root\native\printing\NativePrint.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native print helper compilation failed' }
