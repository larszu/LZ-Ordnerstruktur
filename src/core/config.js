'use strict';

// Konfigurationsdateien.
//
// **JSON ist das einzige Speicherformat.** Das CSV-Format des Windows-Originals
// lässt sich weiterhin *lesen*, damit alte Dateien nicht verloren gehen — es
// wird aber nicht mehr geschrieben. Wer eine CSV öffnet, speichert danach als
// JSON weiter.
//
// Jede JSON-Datei trägt eine `version`. Sie ist der Haken, an dem eine spätere
// Formatänderung migriert werden kann, ohne alte Dateien unlesbar zu machen.
const { BEREICHE, emptyConfig, normalizeConfig } = require('./structure');
const { parseIsoDate, toIsoDate } = require('./dates');

/** Fassung des JSON-Formats, die diese App schreibt. */
const CONFIG_VERSION = 1;

const DL = ';';

/** Die beiden Solas, die im CSV-Format des Originals vorkommen. */
const CSV_SOLAS = ['teens', 'kids'];

/**
 * Spaltenreihenfolge der CSV – identisch zum Windows-Original (Alpha-v0.2.x).
 *
 * Das Format kennt nur Teens und Kids und geht von acht Tagen aus. Es bleibt
 * erhalten, damit alte Dateien weiter *gelesen* werden können; geschrieben
 * wird es nicht mehr. Alles darüber hinaus (SOFA, Sola next, abweichende
 * Dauer, andere Vorlagen) passt ohnehin nur ins JSON-Format.
 */
const CSV_HEADER = [
  'SolaJahr',
  'Teens',
  'Kids',
  ...Array.from({ length: 10 }, (_, i) => `NameTeenFotograf${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NameTeenVideograf${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NameKidsFotograf${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `NameKidsVideograf${i + 1}`),
  ...BEREICHE.map((b) => `AuswahlTeen${b.label}`),
  ...BEREICHE.map((b) => `AuswahlKids${b.label}`),
  'TeenStartDatum',
  'KidsStartDatum',
];

/**
 * Liest ein Datum in einem der Formate, die in den alten CSV-Dateien vorkommen:
 * `dd-MM-yyyy`, `dd.MM.yyyy`, `MM/dd/yyyy` oder ISO `yyyy-MM-dd`.
 * @param {string} value
 * @returns {string} ISO-Datum `yyyy-MM-dd` oder Leerstring
 */
function parseFlexibleDate(value) {
  const s = String(value || '').trim();
  if (!s) return '';

  const iso = parseIsoDate(s);
  if (iso) return toIsoDate(iso);

  // Datumsanteil vor einer eventuellen Uhrzeit abtrennen ("13-06-2022 00:00:00").
  const datumsteil = s.split(/[ T]/)[0];

  let m = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(datumsteil);
  if (m) return bauen(m[3], m[2], m[1]);

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datumsteil);
  // US-Schreibweise: Monat zuerst.
  if (m) return bauen(m[3], m[1], m[2]);

  return '';

  function bauen(jahr, monat, tag) {
    const d = new Date(Number(jahr), Number(monat) - 1, Number(tag));
    return Number.isNaN(d.getTime()) ? '' : toIsoDate(d);
  }
}

const toBool = (v) => /^(true|wahr|ja|yes|1|-1)$/i.test(String(v || '').trim());

/** Eine CSV-Zeile in Felder zerlegen (mit Unterstützung für "…"-Maskierung). */
function csvZeile(zeile) {
  const felder = [];
  let feld = '';
  let inQuotes = false;
  for (let i = 0; i < zeile.length; i += 1) {
    const c = zeile[i];
    if (inQuotes) {
      if (c === '"') {
        if (zeile[i + 1] === '"') {
          feld += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        feld += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === DL) {
      felder.push(feld);
      feld = '';
    } else {
      feld += c;
    }
  }
  felder.push(feld);
  return felder;
}

/**
 * Liest eine CSV-Konfiguration – sowohl die dieser App als auch die des
 * Windows-Originals.
 * @param {string} text
 * @returns {import('./structure').Config}
 */
function fromCsv(text) {
  const zeilen = String(text || '')
    .split(/\r?\n/)
    .filter((z) => z.trim().length > 0);
  if (zeilen.length < 2) throw new Error('Die CSV-Datei enthält keine Konfigurationszeile.');

  const felder = csvZeile(zeilen[1]);
  if (felder.length < CSV_HEADER.length) {
    throw new Error(`Unerwartetes CSV-Format: ${felder.length} statt ${CSV_HEADER.length} Spalten.`);
  }

  const config = emptyConfig();
  config.jahr = String(felder[0] || '').trim();
  config.teens.aktiv = toBool(felder[1]);
  config.kids.aktiv = toBool(felder[2]);

  const namen = (offset) => Array.from({ length: 10 }, (_, i) => String(felder[offset + i] || '').trim());
  config.teens.fotografen = namen(3);
  config.teens.videografen = namen(13);
  config.kids.fotografen = namen(23);
  config.kids.videografen = namen(33);

  BEREICHE.forEach((b, i) => {
    config.teens.bereiche[b.key] = toBool(felder[43 + i]);
    config.kids.bereiche[b.key] = toBool(felder[51 + i]);
  });

  config.teens.start = parseFlexibleDate(felder[59]);
  config.kids.start = parseFlexibleDate(felder[60]);

  return normalizeConfig(config);
}

/**
 * JSON – das Speicherformat dieser App. Die `version` steht bewusst vorn,
 * damit sie beim Blick in die Datei sofort ins Auge fällt.
 */
function toJson(config) {
  return `${JSON.stringify({ version: CONFIG_VERSION, ...normalizeConfig(config) }, null, 2)}\n`;
}

/**
 * Liest eine JSON-Konfiguration und bringt sie auf die aktuelle Fassung.
 * @returns {import('./structure').Config}
 */
function fromJson(text) {
  return migriere(JSON.parse(text));
}

/**
 * Hebt eine Konfiguration auf {@link CONFIG_VERSION}.
 *
 * Dateien ohne `version` stammen aus der Zeit vor dieser Zählung und gelten als
 * Fassung 1. Eine Datei aus einer *neueren* App lässt sich nicht rückwärts
 * übersetzen — dann ist ein klarer Fehler besser als stilles Datenverlieren.
 */
function migriere(daten) {
  const version = Number(daten && daten.version) || 1;
  if (version > CONFIG_VERSION) {
    throw new Error(
      `Diese Datei ist in Fassung ${version} gespeichert, diese App kennt nur ${CONFIG_VERSION}. `
      + 'Bitte die App aktualisieren.',
    );
  }
  // Künftige Migrationen kommen hier hin, Fassung für Fassung.
  return normalizeConfig(daten);
}

/**
 * Wählt anhand der Dateiendung bzw. des Inhalts das passende Format.
 * @returns {{config: object, format: 'json'|'csv'}}
 */
function parseConfig(text, dateiname = '') {
  if (/\.json$/i.test(dateiname) || String(text).trim().startsWith('{')) {
    return { config: fromJson(text), format: 'json' };
  }
  return { config: fromCsv(text), format: 'csv' };
}

module.exports = {
  CONFIG_VERSION,
  CSV_HEADER,
  CSV_SOLAS,
  fromCsv,
  toJson,
  fromJson,
  migriere,
  parseConfig,
  parseFlexibleDate,
};
