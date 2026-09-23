'use strict';

/**
 * Ad-hoc-Signatur für die gepackte macOS-App.
 *
 * Ohne ein (kostenpflichtiges) Apple-Developer-Zertifikat überspringt
 * electron-builder das Signieren ganz. Übrig bleibt dann nur die
 * `linker-signed`-Signatur, die der Linker auf die Electron-Binärdatei gesetzt
 * hat: Sie deckt weder die Info.plist noch die Ressourcen der App ab
 * (`Sealed Resources=none`).
 *
 * Auf Apple Silicon verlangt macOS aber eine gültige Signatur über das ganze
 * Bundle. Fehlt sie und trägt die Datei zusätzlich die Quarantäne-Markierung
 * aus dem Browser, meldet der Finder nicht „unbekannter Entwickler", sondern
 * **„… ist beschädigt und kann nicht geöffnet werden"** — obwohl die Datei
 * völlig in Ordnung ist.
 *
 * Eine Ad-hoc-Signatur (`codesign --sign -`) räumt genau das aus: Sie versiegelt
 * das Bundle ohne Zertifikat. Die App gilt weiterhin als „nicht verifizierter
 * Entwickler" — das lässt sich mit Rechtsklick → Öffnen bestätigen —, aber sie
 * gilt nicht mehr als beschädigt.
 *
 * Läuft als `afterPack`-Haken, also bevor DMG und ZIP gebaut werden.
 */

const { execFileSync } = require('child_process');
const path = require('path');

/** @param {import('electron-builder').AfterPackContext} kontext */
module.exports = async function adhocSign(kontext) {
  if (kontext.electronPlatformName !== 'darwin') return;

  // Ist richtig signiert worden, wird hier nichts angefasst.
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('  • Ad-hoc-Signatur übersprungen — es wird mit Zertifikat signiert.');
    return;
  }

  const name = kontext.packager.appInfo.productFilename;
  const app = path.join(kontext.appOutDir, `${name}.app`);

  try {
    // --deep signiert Helfer, Frameworks und die App in einem Zug.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
    console.log(`  • ad-hoc signiert  app=${path.basename(app)}`);
  } catch (err) {
    // Ohne Signatur wäre das Paket auf Apple Silicon unbrauchbar — dann lieber
    // den Bau abbrechen, als ein „beschädigtes" DMG zu veröffentlichen.
    const ausgabe = [err.stdout, err.stderr].filter(Boolean).map(String).join('\n').trim();
    throw new Error(`Ad-hoc-Signatur fehlgeschlagen für ${app}\n${ausgabe || err.message}`);
  }
};
