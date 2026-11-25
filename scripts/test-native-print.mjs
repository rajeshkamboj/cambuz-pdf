import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, rgb } from 'pdf-lib';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cambuz-print-test-'));
try {
  const resources = path.resolve('dist/win-unpacked/resources/native-print');
  for (const name of ['CambuzPrint.exe', 'pdfium.dll', 'licenses']) {
    assert.ok(fs.existsSync(path.join(resources, name)), name);
  }
  fs.copyFileSync(path.join(resources, 'pdfium.dll'), path.join(temp, 'pdfium.dll'));
  const smoke = path.join(temp, 'smoke.exe');
  execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/platform:x64', '/main:NativePrintSmoke', '/out:' + smoke,
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    'native/printing/NativePrint.cs', 'scripts/NativePrintSmoke.cs',
  ], { stdio: 'inherit' });
  const pdf = await PDFDocument.create();
  for (const red of [0, 1]) {
    pdf.addPage([144, 144]).drawRectangle({ x: 36, y: 36, width: 72, height: 72, color: rgb(red, 0, 0) });
  }
  const input = path.join(temp, 'prepared-शीट.pdf');
  const output = path.join(temp, 'spooled.pdf');
  fs.writeFileSync(input, await pdf.save());
  execFileSync(smoke, [input, output], { stdio: 'inherit', timeout: 60000 });
  if (fs.existsSync(output)) {
    const result = await PDFDocument.load(fs.readFileSync(output));
    assert.equal(result.getPageCount(), 2);
  }
} finally {
  fs.rmSync(temp, { force: true, recursive: true });
}
