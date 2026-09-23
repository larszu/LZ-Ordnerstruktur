'use strict';

// Reine Zuordnung: aus Dateiinfos (mit Metadaten) und einem gewählten Zielschema
// entsteht eine Liste geplanter Kopiervorgänge. Kein Datei- oder ExifTool-Zugriff –
// so lässt sich die Zuordnung wie buildPlan ohne Kamera testen, und die Vorschau
// in der Oberfläche zeigt garantiert das, was der Import danach tut.
const path = require('path');
const { zielordnerFuerVorlage } = require('./structure');
const { VORLAGE_SOLA } = require('./vorlagen');
const kameras = require('./kameras');

/** Wert für „Person automatisch aus der Kamera bestimmen". */
const PERSON_AUTOMATISCH = '*auto*';
const { sanitizeSegment } = require('./validate');

const nr = (n) => String(n).padStart(2, '0');

/** Baut das im Projekt genutzte Datumsobjekt inkl. `datum` als `dd-MM-yyyy`. */
function mkDatum(j, mo, t, hh = '00', mi = '00', ss = '00') {
  return { j, mo, t, hh, mi, ss, datum: `${t}-${mo}-${j}` };
}

/** Aufnahmedatum aus den ExifTool-Feldern (Foto: DateTimeOriginal, Video: MediaCreateDate). */
function datumAusExif(exif) {
  const roh = exif && (exif.DateTimeOriginal || exif.CreateDate || exif.MediaCreateDate);
  if (roh && /^(19|20)\d{2}-\d{2}-\d{2}/.test(String(roh))) {
    const [datum, zeit = ''] = String(roh).split(' ');
    const [j, mo, t] = datum.split('-');
    const [hh = '00', mi = '00', ss = '00'] = zeit.split(':');
    return mkDatum(j, mo, t, hh, mi, ss);
  }
  return null;
}

/** Aufnahmedatum aus dem Dateinamen (z.B. `20260613_143012` oder ein ms-Zeitstempel). */
function datumAusName(name) {
  let m = String(name).match(/(20\d{2}|19\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ ]?(\d{2})?(\d{2})?(\d{2})?/);
  if (m) {
    const [, j, mo, t, hh, mi, ss] = m;
    if (mo >= '01' && mo <= '12' && t >= '01' && t <= '31') {
      return mkDatum(j, mo, t, hh || '00', mi || '00', ss || '00');
    }
  }
  m = String(name).match(/\b(1[0-9]{12})\b/);
  if (m) {
    const dt = new Date(parseInt(m[1], 10));
    if (dt.getFullYear() > 2000 && dt.getFullYear() < 2035) return datumAusDate(dt);
  }
  return null;
}

/** Aufnahmedatum aus einem Date (für das Änderungsdatum als letzten Ausweg). */
function datumAusDate(dt) {
  return mkDatum(
    String(dt.getFullYear()),
    nr(dt.getMonth() + 1),
    nr(dt.getDate()),
    nr(dt.getHours()),
    nr(dt.getMinutes()),
    nr(dt.getSeconds()),
  );
}

/**
 * Ermittelt Datum und Herkunft für eine Datei nach der Kaskade
 * EXIF → Dateiname → Änderungsdatum.
 * @param {{exif?: object, name: string, mtime?: Date}} info
 * @returns {{...datum, quelle: 'exif'|'name'|'mtime'}|null}
 */
function bestimmeDatum(info) {
  const ausExif = datumAusExif(info.exif);
  if (ausExif) return { ...ausExif, quelle: 'exif' };
  const ausName = datumAusName(info.name);
  if (ausName) return { ...ausName, quelle: 'name' };
  if (info.mtime instanceof Date && !Number.isNaN(info.mtime.getTime())) {
    return { ...datumAusDate(info.mtime), quelle: 'mtime' };
  }
  return null;
}

const tsAus = (d) => new Date(Number(d.j), Number(d.mo) - 1, Number(d.t), Number(d.hh), Number(d.mi), Number(d.ss));

/** Neuer Name aus dem Aufnahmezeitpunkt: `JJJJMMDD_HHMMSS.ext`. */
function umbenannt(name, d) {
  return `${d.j}${d.mo}${d.t}_${d.hh}${d.mi}${d.ss}${path.extname(name).toLowerCase()}`;
}

// ---- Zielschemata -----------------------------------------------------------
// Jedes Schema sagt, wohin eine Datei anhand ihres Datums gehört. Neue Schemata
// lassen sich hier ergänzen, ohne den Rest anzufassen.

const SCHEMATA = [
  {
    key: 'sola',
    label: 'In die angelegte Ordnerstruktur',
    beschreibung: 'In die Tages- und Personenordner der gewählten Vorlage – beim Sola also Foto nach 01_ImportRAW, Video nach 01_Rohvideos.',
    braucht: ['sola', 'bereich', 'person'],
    vorbereiten({ ktx, config }) {
      const auswahl = { projektKey: ktx.projektKey || ktx.solaKey, bereich: ktx.bereich };
      // Bei „Person automatisch" wird je Kamera ein eigener Zielsatz gebraucht.
      // Deshalb werden hier alle zugeordneten Personen vorbereitet.
      if (ktx.person === PERSON_AUTOMATISCH) {
        const jeName = {};
        const warnungen = [];
        let jahr = '';
        const namen = [...new Set(kameras.normalisiereKameras(ktx.kameras).map((k) => k.person).filter(Boolean))];
        if (namen.length === 0) {
          return { jahr: '', ziele: {}, warnungen, fehler: 'Keiner Kamera ist eine Person zugeordnet — bitte unter „Kameras" eintragen.' };
        }
        for (const person of namen) {
          const z = zielordnerFuerVorlage(ktx.vorlage || VORLAGE_SOLA, config, { ...auswahl, person });
          jahr = jahr || z.jahr;
          if (Object.keys(z.ziele).length === 0) warnungen.push(...z.warnungen);
          else jeName[person] = z.ziele;
        }
        const leer = Object.keys(jeName).length === 0;
        return {
          jahr,
          ziele: {},
          jeName,
          warnungen,
          fehler: leer ? (warnungen[0] || 'Keine Zielordner ermittelbar.') : null,
        };
      }

      const z = zielordnerFuerVorlage(ktx.vorlage || VORLAGE_SOLA, config, { ...auswahl, person: ktx.person });
      const leer = Object.keys(z.ziele).length === 0;
      return {
        jahr: z.jahr,
        ziele: z.ziele,
        warnungen: z.warnungen,
        fehler: leer ? (z.warnungen[0] || 'Keine Zielordner ermittelbar.') : null,
      };
    },
    ziel(sctx, info, d, ktx) {
      let ziele = sctx.ziele;
      if (sctx.jeName) {
        const kamera = kameras.findeKamera(ktx.kameras, info.exif);
        if (!kamera || !kamera.person) {
          return { skip: true, grund: 'Kamera keiner Person zugeordnet' };
        }
        ziele = sctx.jeName[kamera.person];
        if (!ziele) return { skip: true, grund: `„${kamera.person}" steht nicht in der Namensliste` };
      }
      const rel = ziele[d.datum];
      if (!rel) return { skip: true, grund: `Datum ${d.datum} liegt außerhalb der Tage` };
      return { rel, zielName: ktx.umbenennen ? umbenannt(info.name, d) : info.name };
    },
  },
  {
    key: 'datum',
    label: 'Datumsbaum (JJJJ/JJJJMM/JJJJMMDD)',
    beschreibung: 'Rein nach Aufnahmedatum sortiert – ohne Vorlage, gut für den privaten Gebrauch.',
    braucht: ['umbenennen', 'handy'],
    vorbereiten() {
      return { jahr: '', ziele: null, warnungen: [], fehler: null };
    },
    ziel(_sctx, info, d, ktx) {
      let rel = [d.j, d.j + d.mo, d.j + d.mo + d.t].join('/');
      if (ktx.unterordner) rel = `${sanitizeSegment(ktx.unterordner)}/${rel}`;
      return { rel, zielName: ktx.umbenennen ? umbenannt(info.name, d) : info.name };
    },
  },
];

/** Schema-Liste für die Oberfläche – ohne die Funktionen. */
function schemaListe() {
  return SCHEMATA.map(({ key, label, beschreibung, braucht }) => ({ key, label, beschreibung, braucht }));
}

/**
 * Baut den Importplan.
 * @param {object} args
 * @param {Array<{pfad: string, name: string, exif?: object, mtime?: Date, art?: string}>} args.dateien
 * @param {string} args.schema  Schlüssel aus {@link SCHEMATA}
 * @param {object} [args.ktx]   Schema-Kontext (Sola-Auswahl, Optionen …)
 * @param {object} [args.config] Sola-Konfiguration (für das Sola-Schema)
 * @returns {{plan: object[], uebersprungen: object[], zusammenfassung: object,
 *            warnungen: string[], jahr: string}}
 */
function buildImportPlan({ dateien = [], schema, ktx = {}, config } = {}) {
  const def = SCHEMATA.find((s) => s.key === schema);
  const quellen = { exif: 0, name: 0, mtime: 0 };
  if (!def) {
    return { plan: [], uebersprungen: [], zusammenfassung: { anzahl: 0, uebersprungen: 0, quellen }, warnungen: [`Unbekanntes Zielschema: ${schema}`], jahr: '' };
  }

  const sctx = def.vorbereiten({ ktx, config });
  const warnungen = [...(sctx.warnungen || [])];
  if (sctx.fehler) {
    return { plan: [], uebersprungen: [], zusammenfassung: { anzahl: 0, uebersprungen: 0, quellen }, warnungen: [...warnungen, sctx.fehler], jahr: sctx.jahr || '' };
  }

  const plan = [];
  const uebersprungen = [];
  for (const info of dateien) {
    let d = bestimmeDatum(info);
    // Geht die Uhr der Kamera falsch, wird hier gerade gerückt — nur für die
    // Zuordnung, die Datei selbst bleibt unverändert.
    const kamera = kameras.findeKamera(ktx.kameras, info.exif);
    if (d && kamera && kamera.versatzMinuten) d = kameras.wendeVersatzAn(d, kamera.versatzMinuten);
    if (!d) {
      uebersprungen.push({ von: info.pfad, grund: 'kein Aufnahmedatum ermittelbar' });
      continue;
    }
    const ziel = def.ziel(sctx, info, d, ktx);
    if (ziel.skip) {
      uebersprungen.push({ von: info.pfad, grund: ziel.grund, datum: d.datum });
      continue;
    }
    quellen[d.quelle] += 1;
    plan.push({
      von: info.pfad,
      zielRel: ziel.rel,
      zielName: ziel.zielName,
      datum: d.datum,
      quelle: d.quelle,
      ts: tsAus(d),
      art: info.art || '',
      kamera: kamera ? (kamera.person || kamera.modell || kamera.id) : '',
    });
  }

  // Nach Zeit sortieren – so liegen die Dateien im Zielordner chronologisch.
  plan.sort((a, b) => a.ts - b.ts || a.von.localeCompare(b.von));

  return {
    plan,
    uebersprungen,
    zusammenfassung: { anzahl: plan.length, uebersprungen: uebersprungen.length, quellen },
    warnungen,
    jahr: sctx.jahr || '',
  };
}

module.exports = {
  PERSON_AUTOMATISCH,
  SCHEMATA,
  schemaListe,
  buildImportPlan,
  bestimmeDatum,
  datumAusExif,
  datumAusName,
  datumAusDate,
  umbenannt,
};
