'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  CONFIG_VERSION,
  CSV_HEADER,
  fromCsv,
  toJson,
  fromJson,
  migriere,
  parseConfig,
  parseFlexibleDate,
} = require('../src/core/config');
const { emptyConfig } = require('../src/core/structure');
const config = require('../src/core/config');

function beispiel() {
  const c = emptyConfig();
  c.teens.aktiv = true;
  c.teens.start = '2026-06-13';
  c.teens.bereiche.foto = true;
  c.teens.bereiche.orga = true;
  c.teens.fotografen[0] = 'Lars';
  c.teens.videografen[0] = 'Maja';
  c.kids.aktiv = true;
  c.kids.start = '2026-08-01';
  c.kids.bereiche.video = true;
  c.kids.videografen[0] = 'Jonas';
  return c;
}

/** Baut eine CSV-Zeile im Format des Windows-Originals. */
function alsCsv(werte) {
  const feld = (v) => (/["\r\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `${CSV_HEADER.join(';')}\r\n${werte.map(feld).join(';')}\r\n`;
}

// --- JSON ist das Speicherformat -------------------------------------------

test('JSON überlebt einen Speichern-Laden-Umlauf', () => {
  const original = beispiel();
  assert.deepEqual(fromJson(toJson(original)), original);
});

test('gespeichertes JSON trägt seine Fassung', () => {
  const daten = JSON.parse(toJson(beispiel()));
  assert.equal(daten.version, CONFIG_VERSION);
  // Die Fassung steht vorn, damit sie beim Blick in die Datei auffällt.
  assert.equal(Object.keys(daten)[0], 'version');
});

test('CSV lässt sich nur noch lesen, nicht mehr schreiben', () => {
  assert.equal(typeof config.fromCsv, 'function');
  assert.equal(config.toCsv, undefined, 'toCsv darf es nicht mehr geben');
  assert.equal(config.csvVerlust, undefined, 'csvVerlust hing am Schreiben und ist weg');
});

// --- Versionierung ----------------------------------------------------------

test('eine Datei ohne Fassung gilt als Fassung 1', () => {
  const ohne = { ...beispiel() };
  delete ohne.version;
  assert.deepEqual(migriere(ohne), beispiel());
});

test('eine Datei aus einer neueren App wird nicht stillschweigend verstümmelt', () => {
  assert.throws(
    () => migriere({ ...beispiel(), version: CONFIG_VERSION + 1 }),
    /Fassung .* diese App kennt nur/,
  );
});

// --- CSV-Import (Legacy) ----------------------------------------------------

test('die CSV-Spalten entsprechen dem Windows-Original', () => {
  assert.equal(CSV_HEADER.length, 61);
  assert.equal(CSV_HEADER[0], 'SolaJahr');
  assert.equal(CSV_HEADER[3], 'NameTeenFotograf1');
  assert.equal(CSV_HEADER[43], 'AuswahlTeenFoto');
  assert.equal(CSV_HEADER[51], 'AuswahlKidsFoto');
  assert.equal(CSV_HEADER[59], 'TeenStartDatum');
  assert.equal(CSV_HEADER[60], 'KidsStartDatum');
});

test('eine CSV aus dem Windows-Original wird gelesen', () => {
  // Nachgestellte Zeile, wie das VB-Programm sie schreibt: True/False, dd-MM-yyyy.
  const c = fromCsv(alsCsv([
    '2022',
    'True',
    'False',
    'Lars', ...Array(9).fill(''),
    'Maja', ...Array(9).fill(''),
    ...Array(10).fill(''),
    ...Array(10).fill(''),
    'True', 'True', 'False', 'False', 'False', 'False', 'True', 'False',
    ...Array(8).fill('False'),
    '13-06-2022',
    '',
  ]));

  assert.equal(c.jahr, '2022');
  assert.equal(c.teens.aktiv, true);
  assert.equal(c.kids.aktiv, false);
  assert.equal(c.teens.start, '2022-06-13');
  assert.equal(c.teens.fotografen[0], 'Lars');
  assert.equal(c.teens.videografen[0], 'Maja');
  assert.deepEqual(
    Object.entries(c.teens.bereiche).filter(([, an]) => an).map(([k]) => k),
    ['foto', 'video', 'orga'],
  );
});

test('eine echte Altdatei lässt sich öffnen und als JSON weiterspeichern', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'windows-original.csv'), 'utf8');
  const { config: c, format } = parseConfig(text, 'alte.csv');
  assert.equal(format, 'csv');
  assert.equal(c.jahr, '2026');
  assert.equal(c.teens.fotografen[0], 'Lars');
  assert.equal(c.kids.bereiche.showfiles, true);

  // Der Weg aus dem Issue: alte.csv -> interne Konfiguration -> config.json
  const zurueck = fromJson(toJson(c));
  assert.deepEqual(zurueck, c);
});

test('Namen mit Semikolon zerlegen die CSV nicht', () => {
  const werte = ['2026', 'True', 'False', 'Meier; Lars', ...Array(57).fill('')];
  assert.equal(fromCsv(alsCsv(werte)).teens.fotografen[0], 'Meier; Lars');
});

test('Datumsangaben werden in mehreren Schreibweisen erkannt', () => {
  assert.equal(parseFlexibleDate('13-06-2022'), '2022-06-13');
  assert.equal(parseFlexibleDate('13.06.2022'), '2022-06-13');
  assert.equal(parseFlexibleDate('2022-06-13'), '2022-06-13');
  assert.equal(parseFlexibleDate('06/13/2022'), '2022-06-13');
  assert.equal(parseFlexibleDate('13-06-2022 00:00:00'), '2022-06-13');
  assert.equal(parseFlexibleDate(''), '');
  assert.equal(parseFlexibleDate('Unsinn'), '');
});

// --- Formaterkennung --------------------------------------------------------

test('parseConfig erkennt das Format und sagt es dazu', () => {
  const c = beispiel();
  assert.deepEqual(parseConfig(toJson(c), 'x.json'), { config: c, format: 'json' });
  // Ohne Dateiname entscheidet der Inhalt.
  assert.equal(parseConfig(toJson(c)).format, 'json');
  assert.equal(parseConfig(fs.readFileSync(path.join(__dirname, 'fixtures', 'windows-original.csv'), 'utf8'), 'x.csv').format, 'csv');
});

test('kaputte Dateien melden einen Fehler', () => {
  assert.throws(() => fromCsv('nur eine Kopfzeile'), /Konfigurationszeile/);
  assert.throws(() => fromCsv('a;b\r\n1;2\r\n'), /Spalten/);
});
