'use strict';

// Der unreine Teil des Imports: Dateien sammeln, ihre Metadaten mit ExifTool
// lesen und den von importPlan berechneten Plan auf der Platte umsetzen.
//
// Sicherheitsprinzipien (wie beim Anlegen der Struktur):
//   - nichts wird überschrieben – bei Namensgleichheit wird durchnummeriert
//   - Standard ist KOPIEREN, nicht Verschieben (eine Speicherkarte bleibt heil)
//   - inhaltsgleiche Dateien (gleicher Name, gleiche Größe) werden übersprungen,
//     damit ein zweiter Lauf derselben Karte nichts verdoppelt
//   - jeder Lauf schreibt ein Protokoll in den Zielordner (_Import-Protokolle)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const exif = require('./exif');
const metadaten = require('./metadaten');
const { buildImportPlan } = require('./importPlan');

// Vergleichsmethoden nach dem Vorbild von FreeFileSync: „Datum & Größe" ist der
// schnelle Standard, „Inhalt" vergleicht Byte für Byte, „Größe" nur die Länge.
// (FreeFileSync ist GPL-Software – hier ist nur die Logik nachgebaut, kein Code
// übernommen.)
const VERGLEICH_METHODEN = [
  { key: 'zeitgroesse', label: 'Datum & Größe' },
  { key: 'inhalt', label: 'Inhalt (Prüfsumme)' },
  { key: 'groesse', label: 'Nur Größe' },
];

const PROTOKOLL_ORDNER = '_Import-Protokolle';
const UEBERSPRINGEN_ORDNER = new Set([PROTOKOLL_ORDNER, '_LZ-Sortierer-Protokolle']);

const BILD = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.bmp', '.webp', '.dng', '.tif', '.tiff', '.arw', '.sr2', '.raf', '.cr2', '.cr3', '.nef', '.orf', '.rw2']);
const VIDEO = new Set(['.mp4', '.mov', '.3gp', '.mkv', '.m4v', '.avi', '.mts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.flv']);

/** 'bild' | 'video' | '' */
function art(name) {
  const e = path.extname(name).toLowerCase();
  if (BILD.has(e)) return 'bild';
  if (VIDEO.has(e)) return 'video';
  return '';
}

/** Läuft rekursiv durch `wurzel` und liefert alle Foto-/Videodateien. */
async function* medienUnter(wurzel) {
  let eintraege;
  try {
    eintraege = await fsp.readdir(wurzel, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of eintraege) {
    if (e.name.startsWith('.')) continue; // versteckte Dateien / .DS_Store
    const p = path.join(wurzel, e.name);
    if (e.isDirectory()) {
      if (UEBERSPRINGEN_ORDNER.has(e.name)) continue;
      yield* medienUnter(p);
    } else if (e.isFile() && art(e.name)) {
      yield p;
    }
  }
}

/** Sammelt alle Medien unter `quelle`. */
async function sammleMedien(quelle) {
  const out = [];
  for await (const p of medienUnter(quelle)) out.push(p);
  return out;
}

/** Liest zu jeder Datei Metadaten (falls ExifTool da ist) sowie das Änderungsdatum. */
async function leseInfos(dateien, melde) {
  const meta = {};
  if (exif.vorhanden) {
    const block = 1500;
    for (let i = 0; i < dateien.length; i += block) {
      Object.assign(meta, await exif.leseMetadaten(dateien.slice(i, i + block)));
      melde && melde(`Aufnahmedaten: ${Math.min(i + block, dateien.length)} / ${dateien.length}`);
    }
  }
  return dateien.map((p) => {
    let mtime = null;
    try {
      mtime = fs.statSync(p).mtime;
    } catch (_) {
      // bleibt null – dann greift Name oder es wird übersprungen
    }
    return {
      pfad: p,
      name: path.basename(p),
      exif: meta[exif.schluessel(path.resolve(p))] || meta[exif.schluessel(p)] || null,
      mtime,
      art: art(p),
    };
  });
}

/**
 * Trockenlauf: sammelt, liest Metadaten und berechnet den Plan – verändert nichts.
 * @returns {Promise<object>} Rückgabe von buildImportPlan, ergänzt um `gefunden`
 */
async function scanImport({ quelle, schema, ktx, config, melde }) {
  const dateien = await sammleMedien(quelle);
  melde && melde(
    `${dateien.length} Dateien gefunden` +
    (exif.vorhanden ? ', lese Aufnahmedaten …' : ' (ohne ExifTool – Datum aus Name/Änderungsdatum)'),
  );
  const infos = await leseInfos(dateien, melde);
  const ergebnis = buildImportPlan({ dateien: infos, schema, ktx, config });
  // Die gelesenen Metadaten mitgeben: daraus erkennt die App, welche Kameras
  // auf der Karte waren — auch die, die noch keiner Person zugeordnet sind.
  return { ...ergebnis, gefunden: dateien.length, metadaten: infos.map((i) => i.exif).filter(Boolean) };
}

/**
 * Vergleich vor dem Kopieren (wie FreeFileSync): ordnet jede Quelldatei einer
 * Kategorie zu, ohne etwas zu verändern.
 *   - `neu`    : am Ziel noch nicht vorhanden → wird kopiert
 *   - `gleich` : schon vorhanden und identisch → wird übersprungen
 *   - `anders` : Zielname vorhanden, aber anderer Inhalt → wird als Kopie angelegt
 *
 * @returns {Promise<object>} Kategorien, Beispieleinträge und der volle Plan
 */
async function vergleicheImport({ quelle, zielBasis, schema, ktx, config, methode = 'zeitgroesse', melde }) {
  const scan = await scanImport({ quelle, schema, ktx, config, melde });
  const kategorien = { neu: 0, gleich: 0, anders: 0 };
  const eintraege = [];

  if (zielBasis) {
    melde && melde('Vergleiche mit dem Zielordner …');
    for (const s of scan.plan) {
      const direkt = path.join(zielBasis, ...s.zielRel.split('/'), s.zielName);
      let kategorie = 'neu';
      if (fs.existsSync(direkt)) kategorie = sindGleich(s.von, direkt, methode) ? 'gleich' : 'anders';
      kategorien[kategorie] += 1;
      eintraege.push({
        name: path.basename(s.von),
        ziel: `${s.zielRel}/${s.zielName}`,
        datum: s.datum,
        quelle: s.quelle,
        kategorie,
      });
    }
  }

  return {
    plan: scan.plan,
    kategorien,
    eintraege,
    gefunden: scan.gefunden,
    quellen: scan.zusammenfassung.quellen,
    uebersprungenDatum: scan.uebersprungen,
    warnungen: scan.warnungen,
    jahr: scan.jahr,
    metadaten: scan.metadaten,
    zielBekannt: Boolean(zielBasis),
  };
}

// ---- Ausführen --------------------------------------------------------------

async function freierName(ordner, name) {
  const ext = path.extname(name);
  const stamm = path.basename(name, ext);
  let ziel = path.join(ordner, name);
  let n = 1;
  while (fs.existsSync(ziel)) {
    ziel = path.join(ordner, `${stamm}_${n}${ext}`);
    n += 1;
  }
  return ziel;
}

function hashDatei(pfad) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
  } catch (_) {
    return null;
  }
}

/**
 * Sind Quell- und Zieldatei „gleich"? Nach FreeFileSync-Art:
 *  - immer verschieden, wenn die Größe abweicht;
 *  - `groesse`: gleiche Größe genügt;
 *  - `zeitgroesse`: zusätzlich Änderungszeit auf 2 s genau (FAT/DST-Toleranz);
 *  - `inhalt`: zusätzlich gleiche Prüfsumme.
 */
function sindGleich(quelle, ziel, methode = 'zeitgroesse') {
  let sq;
  let sz;
  try {
    sq = fs.statSync(quelle);
    sz = fs.statSync(ziel);
  } catch (_) {
    return false;
  }
  if (sq.size !== sz.size) return false;
  if (methode === 'groesse') return true;
  if (methode === 'inhalt') {
    const hq = hashDatei(quelle);
    const hz = hashDatei(ziel);
    return Boolean(hq) && hq === hz;
  }
  // zeitgroesse (Standard)
  return Math.abs(sq.mtimeMs - sz.mtimeMs) <= 2000;
}

async function verschiebe(von, ziel) {
  await fsp.rename(von, ziel).catch(async (e) => {
    if (e.code === 'EXDEV') {
      await fsp.copyFile(von, ziel);
      await fsp.unlink(von);
    } else {
      throw e;
    }
  });
}

async function protokoll(zielBasis, zeilen) {
  const ordner = path.join(zielBasis, PROTOKOLL_ORDNER);
  await fsp.mkdir(ordner, { recursive: true });
  const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const datei = path.join(ordner, `import_${stempel}.txt`);
  await fsp.writeFile(datei, zeilen.join('\n'), 'utf8');
  return datei;
}

/**
 * Setzt den Plan um. Kopiert (Standard) oder verschiebt die Dateien in den
 * jeweiligen Zielordner unter `zielBasis`.
 *
 * @param {object} args
 * @param {object[]} args.plan       aus {@link scanImport}
 * @param {string}   args.zielBasis  Basisordner (bei Sola der gewählte Zielordner)
 * @param {boolean}  [args.verschieben=false]
 * @param {string}   [args.methode='zeitgroesse']  wie „schon vorhanden" erkannt wird
 * @param {(text: string) => void} [args.melde]
 */
async function runImport({ plan, zielBasis, verschieben = false, methode = 'zeitgroesse', melde, sollAbbrechen, metadatenWunsch }) {
  const modus = verschieben ? 'verschoben' : 'kopiert';
  const log = [
    `Import am ${new Date().toLocaleString('de-DE')}`,
    `Modus: ${verschieben ? 'verschoben' : 'kopiert'} · Zielbasis: ${zielBasis}`,
    '',
  ];
  let erledigt = 0;
  let uebersprungen = 0;
  let abgebrochen = false;
  const fehler = [];
  // Die Kopien im Zielordner — nur in sie werden später Metadaten geschrieben,
  // nie in die Dateien auf der Karte.
  const geschrieben = [];

  if (!zielBasis) {
    return { erledigt: 0, uebersprungen: 0, abgebrochen: false, fehler: [{ von: '', grund: 'Kein Zielordner gewählt.' }], protokoll: '', modus };
  }

  for (const s of plan) {
    // Abbrechen wirkt zwischen zwei Dateien: die laufende wird fertig
    // geschrieben, danach hört der Lauf auf. So bleibt keine halbe Datei liegen.
    if (sollAbbrechen && sollAbbrechen()) {
      abgebrochen = true;
      log.push('', `ABGEBROCHEN nach ${erledigt} Dateien.`);
      break;
    }
    const zielOrdner = path.join(zielBasis, ...s.zielRel.split('/'));
    try {
      const direkt = path.join(zielOrdner, s.zielName);
      if (fs.existsSync(direkt) && sindGleich(s.von, direkt, methode)) {
        uebersprungen += 1;
        log.push(`schon vorhanden: ${s.von}`);
      } else {
        // Änderungszeit der Quelle vor dem (möglichen) Verschieben merken.
        let quellZeit = null;
        try {
          quellZeit = fs.statSync(s.von).mtime;
        } catch (_) {
          // nicht kritisch
        }
        await fsp.mkdir(zielOrdner, { recursive: true });
        const ziel = await freierName(zielOrdner, s.zielName);
        if (verschieben) await verschiebe(s.von, ziel);
        else await fsp.copyFile(s.von, ziel);
        // Nach dem Kopieren nachsehen, ob wirklich alles angekommen ist. Eine
        // volle Platte oder eine mitten im Lauf abgezogene Karte fällt sonst
        // erst Wochen später auf.
        const soll = fs.statSync(ziel).size;
        const quellGroesse = verschieben ? soll : fs.statSync(s.von).size;
        if (soll !== quellGroesse) {
          throw new Error(`unvollständig kopiert (${soll} statt ${quellGroesse} Byte)`);
        }
        // Die Änderungszeit der Quelle erhalten (wie FreeFileSync) – so erkennt
        // ein späterer Vergleich dieselbe Datei wieder.
        if (quellZeit) {
          try {
            await fsp.utimes(ziel, quellZeit, quellZeit);
          } catch (_) {
            // nicht kritisch
          }
        }
        log.push(`${s.von}  ->  ${ziel}`);
        geschrieben.push(ziel);
        erledigt += 1;
      }
    } catch (err) {
      fehler.push({ von: s.von, grund: err.message });
      log.push(`FEHLER ${s.von}: ${err.message}`);
    }
    if ((erledigt + uebersprungen) % 50 === 0) {
      melde && melde(`${modus}: ${erledigt} · übersprungen: ${uebersprungen} / ${plan.length}`);
    }
  }

  // Metadaten erst nach dem Kopieren, und nur in die Kopien.
  let metaErgebnis = { geschrieben: 0, fehler: [] };
  if (!metadaten.istLeer(metadatenWunsch) && geschrieben.length > 0) {
    melde && melde(`Schreibe Metadaten in ${geschrieben.length} Dateien …`);
    metaErgebnis = await metadaten.schreibe(geschrieben, metadatenWunsch, melde);
    log.push('', `Metadaten geschrieben: ${metaErgebnis.geschrieben} Dateien`);
    for (const f of metaErgebnis.fehler) {
      fehler.push({ von: '', grund: `Metadaten: ${f.grund}` });
      log.push(`FEHLER Metadaten: ${f.grund}`);
    }
  }

  let protokollDatei = '';
  try {
    protokollDatei = await protokoll(zielBasis, log);
  } catch (err) {
    fehler.push({ von: PROTOKOLL_ORDNER, grund: `Protokoll nicht geschrieben: ${err.message}` });
  }

  return {
    erledigt,
    uebersprungen,
    abgebrochen,
    metadaten: metaErgebnis.geschrieben,
    fehler,
    protokoll: protokollDatei,
    modus,
  };
}

module.exports = {
  BILD,
  VIDEO,
  art,
  sammleMedien,
  leseInfos,
  scanImport,
  vergleicheImport,
  runImport,
  freierName,
  sindGleich,
  VERGLEICH_METHODEN,
  PROTOKOLL_ORDNER,
};
