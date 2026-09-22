'use strict';

/**
 * Externe Hilfsprogramme, die die App benutzen kann, aber nicht braucht.
 *
 *   exiftool   zuverlässige Aufnahmedaten (siehe exif.js)
 *   pdftotext  Text aus PDF-Dateien lesen (Teil von poppler)
 *
 * Fehlt eins davon, arbeitet die App weiter — nur mit weniger Wissen über die
 * Dateien. Die Oberfläche sagt, was fehlt und was das bedeutet.
 */

const { execFile, execFileSync } = require('child_process');
const exif = require('./exif');

const IST_WINDOWS = process.platform === 'win32';

/** Sucht ein Programm an den üblichen Stellen (auch Homebrew). */
function findeProgramm(name, umgebung) {
  const kandidaten = [
    process.env[umgebung],
    IST_WINDOWS ? `${name}.exe` : name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/opt/local/bin/${name}`,
  ].filter(Boolean);

  for (const kandidat of kandidaten) {
    try {
      // pdftotext kennt kein -ver; -v schreibt die Version auf stderr und
      // beendet sich mit 0. Beides zusammen deckt beide Programme ab.
      execFileSync(kandidat, ['-v'], { stdio: 'ignore', timeout: 5000 });
      return kandidat;
    } catch (_) {
      try {
        execFileSync(kandidat, ['-ver'], { stdio: 'ignore', timeout: 5000 });
        return kandidat;
      } catch (__) {
        // nächsten Kandidaten versuchen
      }
    }
  }
  return null;
}

const PDFTOTEXT = findeProgramm('pdftotext', 'LZ_PDFTOTEXT');

/**
 * Liest den Anfang eines PDF als Text.
 * @param {string} pfad
 * @param {number} [maxZeichen]
 * @returns {Promise<string>} leer, wenn pdftotext fehlt oder das PDF kein Text enthält
 */
function pdfText(pfad, maxZeichen = 40000) {
  return new Promise((resolve) => {
    if (!PDFTOTEXT) return resolve('');
    const kind = execFile(PDFTOTEXT, ['-q', pfad, '-'], { maxBuffer: 1 << 26, timeout: 60000 }, (_err, stdout) => {
      resolve(String(stdout || '').slice(0, maxZeichen));
    });
    kind.on('error', () => resolve(''));
  });
}

/** Stand der Hilfsprogramme für die Oberfläche. */
function stand() {
  return {
    exiftool: Boolean(exif.EXIFTOOL),
    exiftoolPfad: exif.EXIFTOOL || '',
    pdftotext: Boolean(PDFTOTEXT),
    pdftotextPfad: PDFTOTEXT || '',
  };
}

module.exports = { PDFTOTEXT, pdfText, stand, findeProgramm };
