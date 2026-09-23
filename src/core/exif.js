'use strict';

// Anbindung an ExifTool. Optional: fehlt das Programm, arbeitet die App
// trotzdem weiter – das Aufnahmedatum kommt dann aus Dateiname oder
// Änderungsdatum (siehe importPlan.js). ExifTool wird nur zum Lesen der
// Metadaten benutzt, es verändert keine Dateien.
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const mitgeliefert = require('./mitgeliefert');

const IST_WINDOWS = process.platform === 'win32';

/**
 * Sucht ExifTool — in dieser Reihenfolge:
 *
 *   1. `LZ_EXIFTOOL` bzw. `SOLA_EXIFTOOL`, falls jemand einen Pfad vorgibt
 *   2. die **mitgelieferte** Fassung im Paket (der Normalfall)
 *   3. ein selbst installiertes ExifTool im Pfad oder bei Homebrew
 *
 * Punkt 3 bleibt erhalten, damit ein neueres, selbst gepflegtes ExifTool
 * weiterhin benutzt werden kann — es geht der mitgelieferten Fassung aber
 * nicht vor, sonst hinge das Verhalten der App am Rechner.
 *
 * @returns {{programm: string, vorArgs: string[], quelle: string}|null}
 */
function findeExiftool() {
  const vorgabe = process.env.LZ_EXIFTOOL || process.env.SOLA_EXIFTOOL;
  if (vorgabe && pruefe({ programm: vorgabe, vorArgs: [] })) {
    return { programm: vorgabe, vorArgs: [], quelle: 'vorgegeben' };
  }

  const paket = mitgeliefert.exiftoolBefehl();
  if (paket && pruefe(paket)) return paket;

  for (const kandidat of [
    IST_WINDOWS ? 'exiftool.exe' : 'exiftool',
    '/opt/homebrew/bin/exiftool',
    '/usr/local/bin/exiftool',
    '/usr/bin/exiftool',
    '/opt/local/bin/exiftool',
  ]) {
    const befehl = { programm: kandidat, vorArgs: [], quelle: 'selbst installiert' };
    if (pruefe(befehl)) return befehl;
  }
  return null;
}

/** Ruft `-ver` auf; nur was antwortet, gilt als brauchbar. */
function pruefe(befehl) {
  try {
    execFileSync(befehl.programm, [...befehl.vorArgs, '-ver'], { stdio: 'ignore', timeout: 10000 });
    return true;
  } catch (_) {
    return false;
  }
}

const BEFEHL = findeExiftool();

/** Der reine Programmpfad — für Anzeige und Rückwärtskompatibilität. */
const EXIFTOOL = BEFEHL ? (BEFEHL.vorArgs[0] || BEFEHL.programm) : null;

/** Felder, die der Import ausliest. */
const FELDER = [
  'DateTimeOriginal', // Aufnahmezeitpunkt bei Fotos
  'CreateDate', // Ersatz, wenn DateTimeOriginal fehlt
  'MediaCreateDate', // Aufnahmezeitpunkt bei Videos
  'Model', // Kameramodell
  'SerialNumber', // Seriennummer (Kamera -> Person, später)
  'InternalSerialNumber',
];

/** Ein Pfad-Schlüssel, der auf beiden Plattformen zur ExifTool-Ausgabe passt. */
function schluessel(pfad) {
  return String(pfad).replace(/\\/g, '/');
}

/**
 * Liest die Metadaten vieler Dateien in einem einzigen ExifTool-Aufruf.
 * Die Pfade gehen über stdin (`-@ -`), nicht als Argumente – so greift auch
 * bei tausenden Dateien keine Kommandozeilen-Längenbeschränkung.
 *
 * @param {string[]} pfade absolute Dateipfade
 * @returns {Promise<Object<string, object>>} Map normalisierter Pfad -> Metadaten
 */
function leseMetadaten(pfade) {
  return new Promise((resolve) => {
    if (!BEFEHL || !pfade || pfade.length === 0) return resolve({});
    const args = [
      ...BEFEHL.vorArgs,
      '-q', '-m', '-fast2',
      '-charset', 'filename=utf8', // Umlaute in Pfaden (z.B. 05_Jürgen) unter Windows
      '-api', 'QuickTimeUTC', // QuickTime-Zeiten stehen in UTC -> lokale Zeit
      '-d', '%Y-%m-%d %H:%M:%S',
      '-json',
      ...FELDER.map((f) => `-${f}`),
      '-@', '-',
    ];
    const kind = execFile(BEFEHL.programm, args, { maxBuffer: 1 << 28 }, (_err, stdout) => {
      const daten = {};
      try {
        for (const eintrag of JSON.parse(stdout || '[]')) {
          daten[schluessel(eintrag.SourceFile)] = eintrag;
        }
      } catch (_) {
        // Unlesbare Ausgabe -> leere Map, der Aufrufer fällt auf Name/mtime zurück.
      }
      resolve(daten);
    });
    kind.on('error', () => resolve({}));
    kind.stdin.on('error', () => {});
    kind.stdin.write(pfade.map((p) => path.resolve(p)).join('\n'));
    kind.stdin.end();
  });
}

module.exports = {
  BEFEHL,
  EXIFTOOL,
  vorhanden: Boolean(BEFEHL),
  quelle: BEFEHL ? BEFEHL.quelle : '',
  FELDER,
  schluessel,
  leseMetadaten,
};
