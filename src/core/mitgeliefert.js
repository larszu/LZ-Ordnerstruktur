'use strict';

/**
 * Findet die Programme, die im Paket mitgeliefert werden.
 *
 * ExifTool liegt der App bei, damit die Aufnahmedaten auch auf einem Rechner
 * gelesen werden, auf dem niemand etwas nachinstalliert hat — für Laien ist
 * genau das der Unterschied zwischen „funktioniert" und „funktioniert nicht".
 *
 * Zwei Fassungen, je nach Plattform:
 *   Windows   `exiftool.exe` samt `exiftool_files` — läuft eigenständig
 *   macOS     die Perl-Fassung; aufgerufen wird sie über das Perl, das macOS
 *             ohnehin mitbringt (`/usr/bin/perl`)
 *
 * Im gepackten Programm liegen sie unter `resources/exiftool`, im
 * Entwicklungsbetrieb in `node_modules`. Fehlt beides, ist das kein Fehler:
 * die App sucht dann ein selbst installiertes ExifTool (siehe exif.js).
 */

const fs = require('fs');
const path = require('path');

const IST_WINDOWS = process.platform === 'win32';

/**
 * Der Ordner mit den mitgelieferten Programmen.
 * Im gepackten Programm setzt Electron `process.resourcesPath`; im
 * Entwicklungsbetrieb wird aus `node_modules` geliefert.
 */
function ordner() {
  const kandidaten = [];
  if (process.resourcesPath) kandidaten.push(path.join(process.resourcesPath, 'exiftool'));
  // Entwicklungsbetrieb und Tests: direkt aus den Paketen.
  const ausNodeModules = IST_WINDOWS
    ? path.join(__dirname, '..', '..', 'node_modules', 'exiftool-vendored.exe', 'bin')
    : path.join(__dirname, '..', '..', 'node_modules', 'exiftool-vendored.pl', 'bin');
  kandidaten.push(ausNodeModules);
  return kandidaten;
}

/**
 * Wie ExifTool aufgerufen wird.
 *
 * @returns {{programm: string, vorArgs: string[], quelle: 'mitgeliefert'}|null}
 *          `vorArgs` steht vor den eigentlichen Argumenten — unter macOS ist
 *          das der Pfad des Perl-Skripts, unter Windows bleibt es leer.
 */
function exiftoolBefehl() {
  for (const basis of ordner()) {
    if (IST_WINDOWS) {
      const exe = path.join(basis, 'exiftool.exe');
      if (fs.existsSync(exe)) return { programm: exe, vorArgs: [], quelle: 'mitgeliefert' };
    } else {
      const skript = path.join(basis, 'exiftool');
      if (!fs.existsSync(skript)) continue;
      // Das Ausführungsrecht kann beim Packen verloren gehen — deshalb wird
      // Perl ausdrücklich aufgerufen, statt sich auf die Shebang-Zeile zu
      // verlassen. macOS bringt Perl mit; fehlt es, greift der nächste Weg.
      for (const perl of ['/usr/bin/perl', '/usr/local/bin/perl', '/opt/homebrew/bin/perl']) {
        if (fs.existsSync(perl)) return { programm: perl, vorArgs: [skript], quelle: 'mitgeliefert' };
      }
    }
  }
  return null;
}

module.exports = { ordner, exiftoolBefehl };
