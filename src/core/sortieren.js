'use strict';

/**
 * Die vier Aufräum-Aufgaben — übernommen aus dem LZ Sortierer.
 *
 * Jede läuft in zwei Stufen:
 *   pruefe…    ermittelt, was geschehen WÜRDE (Trockenlauf), verändert nichts
 *   fuehre…Aus setzt genau diesen Plan um
 *
 * Sicherheitsregeln, überall gleich:
 *   - nichts wird je überschrieben (bei Namensgleichheit wird durchnummeriert)
 *   - was entfernt wird, geht in den Papierkorb, wenn die App einen anbietet
 *   - jede Ausführung schreibt ein Protokoll in den Zielordner
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const exif = require('./exif');
const { pdfText } = require('./werkzeuge');
const { normalisiereGruppen, gruppeFuer, UNSORTIERT } = require('./sachgruppen');

const BILD = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.bmp', '.webp', '.dng', '.tif', '.tiff', '.arw', '.sr2', '.raf', '.cr2', '.cr3', '.nef', '.orf', '.rw2']);
const VIDEO = new Set(['.mp4', '.mov', '.3gp', '.mkv', '.m4v', '.avi', '.mts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.flv']);
const DOKUMENT = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods', '.odp']);

const PROTOKOLL_ORDNER = '_Sortier-Protokolle';
/** Eigene Protokollordner nie mitsortieren — auch die des alten LZ Sortierers nicht. */
const AUSGENOMMEN = new Set([PROTOKOLL_ORDNER, '_Import-Protokolle', '_LZ-Sortierer-Protokolle']);

// ---------------------------------------------------------------------------
// Zielschemata für Fotos und Videos
// ---------------------------------------------------------------------------

/**
 * Wohin eine Datei nach ihrem Aufnahmedatum kommt. `{…}` sind Platzhalter:
 * `{j}` Jahr, `{mo}` Monat, `{t}` Tag, `{monatName}` deutscher Monatsname.
 */
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const DATUM_SCHEMATA = [
  {
    key: 'jahr-monat-tag',
    label: 'Jahr / Jahr+Monat / Jahr+Monat+Tag',
    beispiel: '2026 / 202606 / 20260613',
    muster: ['{j}', '{j}{mo}', '{j}{mo}{t}'],
  },
  {
    key: 'jahr-monat',
    label: 'Jahr / Monat',
    beispiel: '2026 / 06 Juni',
    muster: ['{j}', '{mo} {monatName}'],
  },
  {
    key: 'jahr-monat-strich',
    label: 'Jahr / Jahr-Monat-Tag',
    beispiel: '2026 / 2026-06-13',
    muster: ['{j}', '{j}-{mo}-{t}'],
  },
  {
    key: 'nur-jahr',
    label: 'Nur nach Jahr',
    beispiel: '2026',
    muster: ['{j}'],
  },
];

function schemaListe() {
  return DATUM_SCHEMATA.map(({ key, label, beispiel }) => ({ key, label, beispiel }));
}

function ordnerAusSchema(schemaKey, d) {
  const schema = DATUM_SCHEMATA.find((s) => s.key === schemaKey) || DATUM_SCHEMATA[0];
  const werte = { j: d.j, mo: d.mo, t: d.t, monatName: MONATE[Number(d.mo) - 1] || '' };
  return schema.muster.map((m) => m.replace(/\{(\w+)\}/g, (_g, k) => werte[k] || ''));
}

// ---------------------------------------------------------------------------
// Gemeinsame Helfer
// ---------------------------------------------------------------------------

async function* dateienUnter(wurzel, filter) {
  let eintraege;
  try {
    eintraege = await fsp.readdir(wurzel, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of eintraege) {
    const p = path.join(wurzel, e.name);
    if (e.isDirectory()) {
      if (AUSGENOMMEN.has(e.name)) continue;
      yield* dateienUnter(p, filter);
    } else if (e.isFile()) {
      if (e.name === '.DS_Store' || e.name === 'Thumbs.db') continue;
      if (!filter || filter(p, e.name)) yield p;
    }
  }
}

function saeubern(text) {
  if (!text) return '';
  return String(text)
    .replace(/[/\\]/g, '-')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[ .:;,_-]+|[ .:;,_-]+$/g, '')
    .slice(0, 110);
}

/** Findet einen freien Namen, statt eine vorhandene Datei zu überschreiben. */
function freierName(ordner, name) {
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

/** Verschiebt oder kopiert, je nach Modus — und legt den Zielordner an. */
async function bringeHin(quelle, ziel, { kopieren = false, setzeDatum = null } = {}) {
  await fsp.mkdir(path.dirname(ziel), { recursive: true });
  const st = await fsp.stat(quelle);
  if (kopieren) {
    await fsp.copyFile(quelle, ziel);
  } else {
    await fsp.rename(quelle, ziel).catch(async (err) => {
      // Über Plattengrenzen hinweg kann nicht umbenannt werden.
      if (err.code === 'EXDEV') {
        await fsp.copyFile(quelle, ziel);
        await fsp.unlink(quelle);
      } else {
        throw err;
      }
    });
  }
  if (setzeDatum && !Number.isNaN(setzeDatum.getTime())) {
    try {
      await fsp.utimes(ziel, st.atime, setzeDatum);
    } catch (_) {
      // Ein nicht gesetztes Datum ist kein Grund, den Lauf abzubrechen.
    }
  }
}

async function schreibeProtokoll(zielWurzel, name, zeilen) {
  const ordner = path.join(zielWurzel || '.', PROTOKOLL_ORDNER);
  await fsp.mkdir(ordner, { recursive: true });
  const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const datei = path.join(ordner, `${name}_${stempel}.txt`);
  await fsp.writeFile(datei, zeilen.join('\n'), 'utf8');
  return datei;
}

function hashDatei(pfad, limit) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256');
    const strom = fs.createReadStream(pfad, limit ? { end: limit - 1 } : {});
    strom.on('data', (b) => h.update(b));
    strom.on('end', () => resolve(h.digest('hex')));
    strom.on('error', () => resolve(null));
  });
}

/** Aufnahmedatum aus dem Dateinamen (`20260613_143012` oder ein ms-Zeitstempel). */
function datumAusName(name) {
  let m = String(name).match(/(20\d{2}|19\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ ]?(\d{2})?(\d{2})?(\d{2})?/);
  if (m) {
    const [, j, mo, t, hh, mi, ss] = m;
    if (mo >= '01' && mo <= '12' && t >= '01' && t <= '31') {
      return { j, mo, t, hh: hh || '00', mi: mi || '00', ss: ss || '00' };
    }
  }
  m = String(name).match(/\b(1[0-9]{12})\b/);
  if (m) {
    const d = new Date(parseInt(m[1], 10));
    if (d.getFullYear() > 2000 && d.getFullYear() < 2035) return ausDate(d);
  }
  return null;
}

function ausDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    j: String(d.getFullYear()),
    mo: p(d.getMonth() + 1),
    t: p(d.getDate()),
    hh: p(d.getHours()),
    mi: p(d.getMinutes()),
    ss: p(d.getSeconds()),
  };
}

/** Standard-Entfernen: endgültig löschen. Die App reicht den Papierkorb nach. */
const loescheHart = async (pfad) => {
  await fsp.unlink(pfad).catch(() => {});
};

// ---------------------------------------------------------------------------
// 1) Fotos und Videos nach Aufnahmedatum
// ---------------------------------------------------------------------------

/**
 * @param {string} quelle
 * @param {{ziel?: string, schema?: string, umbenennen?: boolean, unterordner?: string,
 *          getrennt?: boolean, kopieren?: boolean}} optionen
 * @param {(text: string) => void} [melde]
 */
async function pruefeFotos(quelle, optionen, melde) {
  const dateien = [];
  for await (const p of dateienUnter(quelle, (_p, n) => {
    const e = path.extname(n).toLowerCase();
    return BILD.has(e) || VIDEO.has(e);
  })) {
    dateien.push(p);
  }
  melde && melde(`${dateien.length} Fotos und Videos gefunden, lese Aufnahmedaten …`);

  // ExifTool blockweise aufrufen — sonst wird es bei zehntausenden Dateien zäh.
  const metadaten = {};
  for (let i = 0; i < dateien.length; i += 1500) {
    const teil = dateien.slice(i, i + 1500);
    Object.assign(metadaten, await exif.leseMetadaten(teil));
    melde && melde(`Aufnahmedaten: ${Math.min(i + 1500, dateien.length)} / ${dateien.length}`);
  }

  const ziel = optionen.ziel || quelle;
  const plan = [];
  const quellen = { exif: 0, name: 0, mtime: 0 };

  for (const p of dateien) {
    const name = path.basename(p);
    const e = path.extname(name).toLowerCase();
    const istVideo = VIDEO.has(e);
    let d = null;
    let herkunft = '';

    const meta = metadaten[exif.schluessel(path.resolve(p))] || {};
    const roh = meta.DateTimeOriginal || meta.CreateDate || meta.MediaCreateDate;
    if (roh && /^(19|20)\d{2}-\d{2}-\d{2}/.test(String(roh))) {
      const [datum, zeit = ''] = String(roh).split(' ');
      const [j, mo, t] = datum.split('-');
      const [hh = '00', mi = '00', ss = '00'] = zeit.split(':');
      d = { j, mo, t, hh, mi, ss };
      herkunft = 'exif';
      quellen.exif += 1;
    }
    if (!d) {
      const ausName = datumAusName(name);
      if (ausName) {
        d = ausName;
        herkunft = 'name';
        quellen.name += 1;
      }
    }
    if (!d) {
      try {
        d = ausDate(fs.statSync(p).mtime);
        herkunft = 'mtime';
        quellen.mtime += 1;
      } catch (_) {
        continue;
      }
    }

    const teile = [ziel];
    if (optionen.unterordner) teile.push(optionen.unterordner);
    // Fotos und Videos auf Wunsch in getrennte Bäume.
    if (optionen.getrennt) teile.push(istVideo ? 'Videos' : 'Fotos');
    teile.push(...ordnerAusSchema(optionen.schema, d));

    const zielName = optionen.umbenennen ? `${d.j}${d.mo}${d.t}_${d.hh}${d.mi}${d.ss}${e}` : name;
    plan.push({
      von: p,
      ordner: path.join(...teile),
      zielName,
      datum: `${d.t}.${d.mo}.${d.j}`,
      herkunft,
      ts: new Date(Number(d.j), Number(d.mo) - 1, Number(d.t), Number(d.hh), Number(d.mi), Number(d.ss)),
    });
  }

  return { plan, zusammenfassung: { anzahl: plan.length, quellen } };
}

async function fuehreFotosAus(scan, optionen, melde) {
  const log = [
    `Fotos und Videos einsortiert am ${new Date().toLocaleString('de-DE')}`,
    `Schema: ${(DATUM_SCHEMATA.find((s) => s.key === optionen.schema) || DATUM_SCHEMATA[0]).beispiel}`,
    optionen.kopieren ? 'Modus: kopiert (Originale bleiben liegen)' : 'Modus: verschoben',
    '',
  ];
  let n = 0;
  for (const s of scan.plan) {
    const ziel = freierName(s.ordner, s.zielName);
    await bringeHin(s.von, ziel, { kopieren: Boolean(optionen.kopieren), setzeDatum: s.ts });
    log.push(`${s.von}  ->  ${ziel}`);
    n += 1;
    if (n % 200 === 0) melde && melde(`${optionen.kopieren ? 'kopiert' : 'verschoben'}: ${n} / ${scan.plan.length}`);
  }
  const protokoll = await schreibeProtokoll(optionen.ziel, 'fotos-sortiert', log);
  return { erledigt: n, protokoll };
}

// ---------------------------------------------------------------------------
// 2) Dokumente nach Inhalt
// ---------------------------------------------------------------------------

/** Minimaler ZIP-Leser — DOCX, XLSX, PPTX und ODT sind ZIP-Dateien. */
async function zipText(pfad, praefixe) {
  const zlib = require('zlib');
  const buf = await fsp.readFile(pfad).catch(() => null);
  if (!buf) return '';
  let text = '';

  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) return '';

  const anzahl = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < anzahl && off + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const lokalOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commLen;
    if (!praefixe.some((p) => name.startsWith(p))) continue;
    if (buf.readUInt32LE(lokalOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(lokalOff + 26);
    const lExtraLen = buf.readUInt16LE(lokalOff + 28);
    const datenStart = lokalOff + 30 + lNameLen + lExtraLen;
    const roh = buf.subarray(datenStart, datenStart + compSize);
    try {
      const aus = method === 0 ? roh : zlib.inflateRawSync(roh);
      text += `${aus.toString('utf8').replace(/<[^>]+>/g, ' ')} `;
    } catch (_) {
      // Ein unlesbarer Eintrag macht das restliche Dokument nicht wertlos.
    }
    if (text.length > 60000) break;
  }
  return text;
}

async function leseDokument(pfad) {
  const e = path.extname(pfad).toLowerCase();
  const d = { pfad, typ: e.slice(1), ok: false, text: '' };
  try {
    if (e === '.pdf') {
      d.text = await pdfText(pfad);
      d.ok = d.text.trim().length > 20;
    } else if (e === '.docx') {
      d.text = await zipText(pfad, ['word/document.xml', 'word/header', 'word/footnotes']);
      d.ok = Boolean(d.text);
    } else if (e === '.pptx') {
      d.text = await zipText(pfad, ['ppt/slides/slide']);
      d.ok = Boolean(d.text);
    } else if (e === '.xlsx') {
      d.text = await zipText(pfad, ['xl/sharedStrings.xml', 'xl/worksheets/']);
      d.ok = Boolean(d.text);
    } else if (['.odt', '.ods', '.odp'].includes(e)) {
      d.text = await zipText(pfad, ['content.xml']);
      d.ok = Boolean(d.text);
    } else {
      // Altes .doc/.xls: lesbare Zeichenketten aus der Binärdatei ziehen.
      const buf = await fsp.readFile(pfad).catch(() => null);
      if (buf) {
        const t = (buf.toString('latin1').match(/[\x20-\x7e\xc0-\xff]{5,}/g) || []).join(' ');
        d.text = t.slice(0, 60000);
        d.ok = t.length > 200;
      }
    }
  } catch (_) {
    // Unlesbar bleibt unlesbar — das Dokument landet in „Beschaedigt".
  }
  return d;
}

/** Ein sprechender Dateiname aus der ersten brauchbaren Zeile des Dokuments. */
function dokumentName(d) {
  const ext = `.${d.typ}`;
  const alt = path.basename(d.pfad);
  const m = alt.match(/^f\d+_(.+)$/);
  if (m) return m[1];
  for (const zeile of String(d.text || '').split('\n').slice(0, 30)) {
    const z = zeile.trim();
    if (z.length >= 8 && z.length <= 80 && !/@|www\.|http/.test(z) && (z.match(/[a-zäöüß]/gi) || []).length > 4) {
      return saeubern(z) + ext;
    }
  }
  return alt;
}

/**
 * @param {string} quelle
 * @param {{ziel?: string, gruppen?: Array, umbenennen?: boolean, kopieren?: boolean}} optionen
 */
async function pruefeDokumente(quelle, optionen, melde) {
  const gruppen = normalisiereGruppen(optionen.gruppen);
  const dateien = [];
  for await (const p of dateienUnter(quelle, (_p, n) => DOKUMENT.has(path.extname(n).toLowerCase()))) {
    dateien.push(p);
  }
  melde && melde(`${dateien.length} Dokumente gefunden, lese Inhalte …`);

  const ziel = optionen.ziel || quelle;
  const plan = [];
  const verteilung = {};
  let i = 0;
  for (const p of dateien) {
    const d = await leseDokument(p);
    let gruppe;
    if (!d.ok) gruppe = d.typ === 'pdf' ? 'Scans ohne Textebene' : 'Beschaedigt';
    else gruppe = gruppeFuer(d.text, gruppen);
    verteilung[gruppe] = (verteilung[gruppe] || 0) + 1;
    plan.push({
      von: p,
      ordner: path.join(ziel, gruppe),
      zielName: optionen.umbenennen === false ? path.basename(p) : dokumentName(d),
      gruppe,
    });
    i += 1;
    if (i % 50 === 0) melde && melde(`Inhalte: ${i} / ${dateien.length}`);
  }
  return { plan, zusammenfassung: { anzahl: plan.length, verteilung } };
}

async function fuehreDokumenteAus(scan, optionen, melde) {
  const log = [
    `Dokumente einsortiert am ${new Date().toLocaleString('de-DE')}`,
    optionen.kopieren ? 'Modus: kopiert (Originale bleiben liegen)' : 'Modus: verschoben',
    '',
  ];
  let n = 0;
  for (const s of scan.plan) {
    const ziel = freierName(s.ordner, s.zielName);
    await bringeHin(s.von, ziel, { kopieren: Boolean(optionen.kopieren) });
    log.push(`[${s.gruppe}] ${s.von}  ->  ${path.basename(ziel)}`);
    n += 1;
    if (n % 50 === 0) melde && melde(`einsortiert: ${n} / ${scan.plan.length}`);
  }
  const protokoll = await schreibeProtokoll(optionen.ziel, 'dokumente-sortiert', log);
  return { erledigt: n, protokoll };
}

// ---------------------------------------------------------------------------
// 3) Duplikate
// ---------------------------------------------------------------------------

/**
 * Findet inhaltsgleiche Dateien. Erst nach Größe gruppiert, dann über das
 * erste Megabyte vorgeprüft und erst zum Schluss vollständig gehasht — so
 * wird nur gelesen, was wirklich in Frage kommt.
 */
async function pruefeDuplikate(quelle, optionen, melde) {
  const nachGroesse = new Map();
  for await (const p of dateienUnter(quelle)) {
    let st;
    try {
      st = fs.statSync(p);
    } catch (_) {
      continue;
    }
    if (st.size === 0) continue;
    if (!nachGroesse.has(st.size)) nachGroesse.set(st.size, []);
    nachGroesse.get(st.size).push(p);
  }

  const gruppen = [...nachGroesse.values()].filter((v) => v.length > 1);
  melde && melde(`${gruppen.length} Größengruppen mit möglichen Doppelgängern, prüfe Prüfsummen …`);

  const paare = [];
  let frei = 0;
  let geprueft = 0;
  for (const gruppe of gruppen) {
    const nachKurz = new Map();
    for (const p of gruppe) {
      const kurz = await hashDatei(p, 1 << 20);
      if (!kurz) continue;
      if (!nachKurz.has(kurz)) nachKurz.set(kurz, []);
      nachKurz.get(kurz).push(p);
    }
    for (const kandidaten of nachKurz.values()) {
      if (kandidaten.length < 2) continue;
      const voll = new Map();
      for (const p of kandidaten) {
        const h = await hashDatei(p);
        if (!voll.has(h)) voll.set(h, []);
        voll.get(h).push(p);
      }
      for (const gleich of voll.values()) {
        if (gleich.length < 2) continue;
        // Behalten wird der kürzeste Name — meist das Original ohne „_1".
        gleich.sort((a, b) => path.basename(a).length - path.basename(b).length);
        const behalten = gleich[0];
        for (const weg of gleich.slice(1)) {
          paare.push({ weg, behalten });
          frei += fs.statSync(weg).size;
        }
      }
    }
    geprueft += 1;
    if (geprueft % 200 === 0) melde && melde(`geprüft: ${geprueft} / ${gruppen.length}`);
  }
  return { plan: paare, zusammenfassung: { anzahl: paare.length, frei } };
}

async function fuehreDuplikateAus(scan, optionen, melde) {
  const entferne = optionen.entferne || loescheHart;
  const log = [
    `Doppelte Dateien entfernt am ${new Date().toLocaleString('de-DE')}`,
    'Gleichheit durch vollständige Prüfsumme belegt; je Gruppe blieb eine Datei.',
    '',
  ];
  let n = 0;
  for (const s of scan.plan) {
    log.push(`entfernt: ${s.weg}\n  bleibt:  ${s.behalten}`);
    await entferne(s.weg);
    n += 1;
    if (n % 100 === 0) melde && melde(`entfernt: ${n} / ${scan.plan.length}`);
  }
  const wurzel = optionen.ziel || path.dirname((scan.plan[0] || {}).behalten || '.');
  const protokoll = await schreibeProtokoll(wurzel, 'duplikate-entfernt', log);
  return { erledigt: n, protokoll };
}

// ---------------------------------------------------------------------------
// 4) Aufräumen
// ---------------------------------------------------------------------------

const ICON_MUSTER = /^[a-z][a-z0-9]*(\.[a-z0-9]+){2,}\.png$/i; // App-Icons: com.x.y.png
const ALBUM_NAMEN = /^(folder|albumart|albumartsmall|cover|albumthumb|thumb|default)(_\d+)?\.(jpg|jpeg|png|bmp)$/i;
const ALBUM_GUID = /^albumart_\{[0-9a-f-]+\}_(small|large)\.(jpg|jpeg|png)$/i;

/** Was die App als „kann weg" erkennt — einzeln an- und abwählbar. */
const AUFRAEUM_KATEGORIEN = [
  { key: 'leer', label: 'Leere Dateien', erklaerung: '0 Byte groß — enthalten nichts.' },
  { key: 'album', label: 'Album-Cover', erklaerung: 'folder.jpg, AlbumArt…, cover.jpg aus Musikordnern.' },
  { key: 'icons', label: 'App-Icons', erklaerung: 'Dateien wie com.hersteller.app.png aus Handy-Sicherungen.' },
  { key: 'exo', label: 'YouTube-Zwischenspeicher', erklaerung: '.exo-Dateien von heruntergeladenen Videos.' },
  { key: 'bruchstuecke', label: 'Video-Bruchstücke', erklaerung: 'Videodateien unter 100 KB — abgebrochene Aufnahmen.' },
  { key: 'systemmuell', label: 'System-Reste', erklaerung: '.DS_Store und Thumbs.db von macOS und Windows.' },
];

const SYSTEM_MUELL = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/**
 * @param {string} quelle
 * @param {{kategorien?: Object<string, boolean>, minVideo?: number}} optionen
 */
async function pruefeAufraeumen(quelle, optionen, melde) {
  const an = (key) => !optionen.kategorien || optionen.kategorien[key] !== false;
  const minVideo = Number(optionen.minVideo) > 0 ? Number(optionen.minVideo) : 102400;
  const treffer = Object.fromEntries(AUFRAEUM_KATEGORIEN.map((k) => [k.label, 0]));
  const plan = [];
  let frei = 0;
  let gesehen = 0;

  for await (const p of dateienUnter(quelle, () => true)) {
    const n = path.basename(p);
    const e = path.extname(n).toLowerCase();
    let st;
    try {
      st = fs.statSync(p);
    } catch (_) {
      continue;
    }
    gesehen += 1;
    if (gesehen % 2000 === 0) melde && melde(`geprüft: ${gesehen} Dateien`);

    let kategorie = '';
    if (an('systemmuell') && SYSTEM_MUELL.has(n.toLowerCase())) kategorie = 'System-Reste';
    else if (an('leer') && st.size === 0) kategorie = 'Leere Dateien';
    else if (an('album') && (ALBUM_NAMEN.test(n) || ALBUM_GUID.test(n))) kategorie = 'Album-Cover';
    else if (an('icons') && ICON_MUSTER.test(n)) kategorie = 'App-Icons';
    else if (an('exo') && e === '.exo') kategorie = 'YouTube-Zwischenspeicher';
    else if (an('bruchstuecke') && VIDEO.has(e) && st.size < minVideo) kategorie = 'Video-Bruchstücke';
    if (!kategorie) continue;

    treffer[kategorie] += 1;
    frei += st.size;
    plan.push({ weg: p, kategorie });
  }

  // Nach Kategorie sortieren, damit die Vorschau lesbar bleibt.
  plan.sort((a, b) => a.kategorie.localeCompare(b.kategorie) || a.weg.localeCompare(b.weg));
  return { plan, zusammenfassung: { anzahl: plan.length, frei, kategorien: treffer } };
}

async function fuehreAufraeumenAus(scan, optionen, melde) {
  const entferne = optionen.entferne || loescheHart;
  const log = [`Aufgeräumt am ${new Date().toLocaleString('de-DE')}`, ''];
  let n = 0;
  for (const s of scan.plan) {
    log.push(`[${s.kategorie}] ${s.weg}`);
    await entferne(s.weg);
    n += 1;
    if (n % 200 === 0) melde && melde(`entfernt: ${n} / ${scan.plan.length}`);
  }
  const wurzel = optionen.ziel || path.dirname((scan.plan[0] || {}).weg || '.');
  const protokoll = await schreibeProtokoll(wurzel, 'aufgeraeumt', log);
  return { erledigt: n, protokoll };
}

// ---------------------------------------------------------------------------

/** Eine Zeile Vorschautext je Planeintrag — für die Liste in der Oberfläche. */
function beschreibe(aufgabe, s) {
  if (aufgabe === 'fotos') {
    const herkunft = { exif: 'Aufnahmedatum', name: 'Dateiname', mtime: 'Änderungsdatum' }[s.herkunft] || s.herkunft;
    return `${path.basename(s.von)}   →   ${s.datum}   (${herkunft})`;
  }
  if (aufgabe === 'dokumente') return `[${s.gruppe}]   ${path.basename(s.von)}   →   ${s.zielName}`;
  if (aufgabe === 'duplikate') return `entfernen: ${s.weg}\n  bleibt:  ${s.behalten}`;
  if (aufgabe === 'aufraeumen') return `[${s.kategorie}]   ${s.weg}`;
  return '';
}

module.exports = {
  BILD,
  VIDEO,
  DOKUMENT,
  PROTOKOLL_ORDNER,
  DATUM_SCHEMATA,
  AUFRAEUM_KATEGORIEN,
  schemaListe,
  ordnerAusSchema,
  datumAusName,
  dokumentName,
  zipText,
  leseDokument,
  beschreibe,
  pruefeFotos,
  fuehreFotosAus,
  pruefeDokumente,
  fuehreDokumenteAus,
  pruefeDuplikate,
  fuehreDuplikateAus,
  pruefeAufraeumen,
  fuehreAufraeumenAus,
  UNSORTIERT,
};
