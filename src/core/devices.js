'use strict';

// Erkennt angesteckte Wechseldatenträger (Kameras, Kartenleser, SD-Karten),
// damit man die Quelle im Importfenster mit einem Klick wählen kann, statt sie
// im Finder/Explorer zu suchen. Rein lesend; findet nichts Passendes, bleibt die
// Liste leer und man wählt den Ordner von Hand.
//
// `listVolumes` listet darüber hinaus alle eingehängten Datenträger mit freiem
// Platz — daraus sagt die App am Drehtag, welche Platte angeschlossen ist und
// welche davon das Arbeitslaufwerk, die Sicherung oder das Archiv ist.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Ein DCIM-Ordner ist das sichere Zeichen für eine Kamera / SD-Karte. */
function hatDcim(wurzel) {
  try {
    return fs.readdirSync(wurzel).some((n) => n.toUpperCase() === 'DCIM');
  } catch (_) {
    return false;
  }
}

/**
 * Freier und gesamter Platz eines Datenträgers. Lässt sich das nicht lesen
 * (Netzlaufwerk, abgezogene Platte), bleibt beides `null` — dann zeigt die
 * Oberfläche keine Zahl statt einer falschen.
 */
function platzAuf(pfad) {
  try {
    const s = fs.statfsSync(pfad);
    return { frei: s.bavail * s.bsize, gesamt: s.blocks * s.bsize };
  } catch (_) {
    return { frei: null, gesamt: null };
  }
}

function eintrag(pfad, name, zusatz = {}) {
  return {
    pfad,
    name: name || path.basename(pfad) || pfad,
    kamera: hatDcim(pfad),
    wechsel: true,
    start: false,
    ...platzAuf(pfad),
    ...zusatz,
  };
}

/** macOS: alles unter /Volumes außer dem Startvolume. */
function macGeraete({ mitStart = false } = {}) {
  const out = [];
  let bootReal = '/';
  try {
    bootReal = fs.realpathSync('/');
  } catch (_) {
    // egal – dann wird nichts ausgeschlossen
  }
  if (mitStart) out.push(eintrag('/', 'Startvolume', { wechsel: false, start: true }));
  let namen = [];
  try {
    namen = fs.readdirSync('/Volumes');
  } catch (_) {
    return out;
  }
  for (const name of namen) {
    const pfad = path.join('/Volumes', name);
    try {
      if (fs.realpathSync(pfad) === bootReal) continue; // Startvolume überspringen
      if (!fs.statSync(pfad).isDirectory()) continue;
    } catch (_) {
      continue;
    }
    out.push(eintrag(pfad, name));
  }
  return out;
}

/**
 * Windows: Laufwerke aus Win32_LogicalDisk. Typ 2 ist ein Wechseldatenträger
 * (Karte, Stick), Typ 3 eine feste Platte — die Sicherungsplatte am Dreh ist
 * meist Typ 3, deshalb lässt sich beides abfragen.
 */
function winGeraete({ typen = [2] } = {}) {
  const out = [];
  let roh = '';
  const filter = typen.map((t) => `$_.DriveType -eq ${t}`).join(' -or ');
  try {
    roh = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_LogicalDisk | Where-Object { ${filter} } | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress`],
      { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
  } catch (_) {
    return out;
  }
  let daten;
  try {
    daten = JSON.parse(roh || 'null');
  } catch (_) {
    return out;
  }
  if (!daten) return out;
  for (const d of Array.isArray(daten) ? daten : [daten]) {
    const laufwerk = d.DeviceID ? `${d.DeviceID}\\` : '';
    if (!laufwerk) continue;
    out.push(eintrag(
      laufwerk,
      d.VolumeName ? `${d.VolumeName} (${d.DeviceID})` : d.DeviceID,
      { wechsel: Number(d.DriveType) === 2, start: /^c:/i.test(String(d.DeviceID || '')) },
    ));
  }
  return out;
}

/** Linux: eingehängte Datenträger unter den üblichen Mount-Punkten. */
function linuxGeraete({ mitStart = false } = {}) {
  const out = [];
  if (mitStart) out.push(eintrag('/', 'Systemplatte', { wechsel: false, start: true }));
  const nutzer = process.env.USER || process.env.LOGNAME || '';
  const basen = [`/media/${nutzer}`, '/media', `/run/media/${nutzer}`, '/mnt'];
  const gesehen = new Set();
  for (const basis of basen) {
    let namen;
    try {
      namen = fs.readdirSync(basis);
    } catch (_) {
      continue;
    }
    for (const name of namen) {
      const pfad = path.join(basis, name);
      if (gesehen.has(pfad)) continue;
      try {
        if (!fs.statSync(pfad).isDirectory()) continue;
      } catch (_) {
        continue;
      }
      gesehen.add(pfad);
      out.push(eintrag(pfad, name));
    }
  }
  return out;
}

/**
 * Listet angesteckte Wechseldatenträger. Kameras / SD-Karten (mit DCIM) stehen
 * oben.
 * @returns {Array<{pfad: string, name: string, kamera: boolean}>}
 */
function listRemovable() {
  let liste = [];
  try {
    if (process.platform === 'darwin') liste = macGeraete();
    else if (process.platform === 'win32') liste = winGeraete();
    else liste = linuxGeraete();
  } catch (_) {
    liste = [];
  }
  return liste.sort((a, b) => (b.kamera - a.kamera) || a.name.localeCompare(b.name, 'de'));
}

/**
 * Listet alle eingehängten Datenträger — nicht nur Wechselmedien, sondern auch
 * die angeschlossenen Platten. Damit kann die App sagen: „Außerdem
 * angeschlossen: T7 Shield (Arbeitslaufwerk)".
 * @returns {Array<{pfad: string, name: string, kamera: boolean, wechsel: boolean,
 *                  start: boolean, frei: number|null, gesamt: number|null}>}
 */
function listVolumes() {
  let liste = [];
  try {
    if (process.platform === 'darwin') liste = macGeraete({ mitStart: true });
    else if (process.platform === 'win32') liste = winGeraete({ typen: [2, 3] });
    else liste = linuxGeraete({ mitStart: true });
  } catch (_) {
    liste = [];
  }
  return liste.sort((a, b) => (b.kamera - a.kamera) || (a.start - b.start) || a.name.localeCompare(b.name, 'de'));
}

/**
 * Stand eines einzelnen Pfades: ist er noch da, wie viel Platz ist frei.
 * Gebraucht für die Ziele — eine abgezogene Sicherungsplatte muss auffallen,
 * bevor kopiert wird.
 */
function volumeStand(pfad) {
  if (!pfad) return { pfad: '', vorhanden: false, frei: null, gesamt: null };
  let vorhanden = false;
  try {
    vorhanden = fs.statSync(pfad).isDirectory();
  } catch (_) {
    vorhanden = false;
  }
  return { pfad, vorhanden, ...(vorhanden ? platzAuf(pfad) : { frei: null, gesamt: null }) };
}

module.exports = { listRemovable, listVolumes, volumeStand, platzAuf, hatDcim };
