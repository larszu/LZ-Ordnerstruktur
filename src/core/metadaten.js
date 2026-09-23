'use strict';

/**
 * Metadaten in importierte Dateien schreiben — mit ExifTool, nach dem Kopieren.
 *
 * Zwei Anliegen:
 *
 *   **Urheber festhalten.** `Artist`, `Copyright` und Stichwörter stehen danach
 *   in jeder Datei. Rutscht ein Bild später aus seinem Ordner, ist immer noch
 *   erkennbar, von wem es ist und wozu es gehört.
 *
 *   **Ortsangaben entfernen.** Handys und viele Kameras schreiben die
 *   GPS-Koordinaten mit ins Bild. Bei Aufnahmen von einer Freizeit mit
 *   Minderjährigen hat das im Netz nichts zu suchen — und heute passiert es
 *   nur, wenn jemand daran denkt.
 *
 * Geschrieben wird **ausschließlich in die Kopien im Zielordner**, nie in die
 * Dateien auf der Speicherkarte. Schlägt das Schreiben fehl, bleibt die Kopie
 * trotzdem liegen: die Datei zu haben ist wichtiger als ihr Etikett.
 */

const { execFile } = require('child_process');
const exif = require('./exif');

/** Wie viele Dateien ExifTool je Aufruf bekommt. */
const BLOCK = 200;

/**
 * Baut die ExifTool-Argumente aus den Wünschen der Oberfläche.
 * @param {{urheber?: string, rechte?: string, stichworte?: string[], gpsEntfernen?: boolean}} wunsch
 * @returns {string[]} leer, wenn nichts zu tun ist
 */
function argumenteFuer(wunsch = {}) {
  const args = [];
  const urheber = String(wunsch.urheber || '').trim();
  const rechte = String(wunsch.rechte || '').trim();
  const stichworte = (wunsch.stichworte || []).map((w) => String(w || '').trim()).filter(Boolean);

  if (urheber) {
    args.push(`-Artist=${urheber}`, `-XMP:Creator=${urheber}`, `-IPTC:By-line=${urheber}`);
  }
  if (rechte) {
    args.push(`-Copyright=${rechte}`, `-XMP:Rights=${rechte}`, `-IPTC:CopyrightNotice=${rechte}`);
  }
  for (const wort of stichworte) {
    // `-Keywords+=` hängt an, statt vorhandene Stichwörter zu ersetzen.
    args.push(`-Keywords+=${wort}`, `-XMP:Subject+=${wort}`);
  }
  if (wunsch.gpsEntfernen) {
    args.push('-gps:all=', '-XMP:Geotag=', '-QuickTime:GPSCoordinates=');
  }
  return args;
}

/** Sagt, ob überhaupt etwas zu schreiben wäre. */
function istLeer(wunsch) {
  return argumenteFuer(wunsch).length === 0;
}

/**
 * Schreibt die Metadaten in die genannten Dateien.
 *
 * @param {string[]} dateien absolute Pfade im Zielordner
 * @param {object} wunsch siehe {@link argumenteFuer}
 * @param {(text: string) => void} [melde]
 * @returns {Promise<{geschrieben: number, fehler: Array<{grund: string}>}>}
 */
async function schreibe(dateien, wunsch, melde) {
  const args = argumenteFuer(wunsch);
  if (args.length === 0 || !dateien || dateien.length === 0) return { geschrieben: 0, fehler: [] };
  if (!exif.vorhanden) {
    return { geschrieben: 0, fehler: [{ grund: 'ExifTool steht nicht bereit — Metadaten wurden nicht geschrieben.' }] };
  }

  const fehler = [];
  let geschrieben = 0;

  for (let i = 0; i < dateien.length; i += BLOCK) {
    const teil = dateien.slice(i, i + BLOCK);
    melde && melde(`Metadaten: ${Math.min(i + BLOCK, dateien.length)} / ${dateien.length}`);
    const ergebnis = await einAufruf(teil, args);
    geschrieben += ergebnis.geschrieben;
    if (ergebnis.grund) fehler.push({ grund: ergebnis.grund });
  }
  return { geschrieben, fehler };
}

function einAufruf(dateien, args) {
  return new Promise((resolve) => {
    const alle = [
      ...exif.BEFEHL.vorArgs,
      '-q', '-m',
      // Ohne das legt ExifTool neben jeder Datei ein `_original` an.
      '-overwrite_original',
      '-charset', 'filename=utf8',
      ...args,
      '-@', '-',
    ];
    const kind = execFile(exif.BEFEHL.programm, alle, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      const text = String(stdout || '') + String(stderr || '');
      const treffer = text.match(/(\d+) image files updated/);
      const geschrieben = treffer ? Number(treffer[1]) : (err ? 0 : dateien.length);
      resolve({ geschrieben, grund: err ? String(stderr || err.message).trim().slice(0, 300) : '' });
    });
    kind.on('error', (err) => resolve({ geschrieben: 0, grund: err.message }));
    kind.stdin.on('error', () => {});
    kind.stdin.write(dateien.join('\n'));
    kind.stdin.end();
  });
}

module.exports = { BLOCK, argumenteFuer, istLeer, schreibe };
