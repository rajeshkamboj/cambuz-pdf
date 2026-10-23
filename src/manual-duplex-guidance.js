// Printer-specific paper handling for the manual second pass.
// Keep model detection conservative: only give the HP LaserJet 1020 sequence
// when that exact model is present in the printer name. Other models must use
// their own feed guide rather than inheriting an unverified orientation.

const HP_LASERJET_1020 = /(?:^|[^a-z0-9])hp\s+laserjet\s+1020(?:\b|$)/i;
const SYSTEM_PRINTER_NAMES = new Set(['system printer', 'selected printer', 'printer']);

export function getManualDuplexGuidance(rawPrinterName = '') {
  const printerName = String(rawPrinterName || '').trim().replace(/\s+/g, ' ');
  const printerIsUnidentified = !printerName || SYSTEM_PRINTER_NAMES.has(printerName.toLowerCase());
  const displayName = printerIsUnidentified ? 'Printer not identified' : printerName;

  if (HP_LASERJET_1020.test(printerName)) {
    return {
      id: 'hp-laserjet-1020',
      printerName: displayName,
      profileLabel: 'Model-specific loading steps',
      stepOne: {
        title: 'Collect the printed stack',
        text: 'Without changing the stack’s orientation, remove it from the output bin. Keep the sheets in the same order, and do not discard blank sheets.',
      },
      stepTwo: {
        title: 'Reload into Tray 1',
        text: 'Maintaining that same orientation, insert the stack into Tray 1 with the printed side down.',
      },
      loadingLabels: ['Keep the same orientation', 'Printed side down'],
      noteTitle: 'HP LaserJet 1020 workflow',
      noteText: 'These loading steps are specific to the HP LaserJet 1020. Other printer models may feed paper differently.',
      generic: false,
    };
  }

  return {
    id: 'unverified',
    printerName: displayName,
    profileLabel: 'Printer-specific feed not verified',
    stepOne: {
      title: 'Collect the first-side stack',
      text: 'After the first pass finishes, collect every sheet, including blanks. Keep the sheets in the same order.',
    },
    stepTwo: {
      title: 'Reload using the printer’s feed guide',
      text: 'Cambuz cannot confirm this printer’s feed direction. Check its own instructions for how to orient the stack and which side should face up or down before loading.',
    },
    loadingLabels: ['Feed direction varies', 'Check this printer’s guide'],
    noteTitle: 'Loading instructions vary by printer',
    noteText: printerIsUnidentified
      ? 'The printer model was not identified. Check the printer’s own paper-loading guide before reloading; do not guess which side faces up or down.'
      : `Cambuz does not have verified loading steps for ${displayName}. Check this printer’s own paper-loading guide before reloading; do not guess which side faces up or down.`,
    generic: true,
  };
}
