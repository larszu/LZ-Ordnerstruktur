'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  eingebauteVorlagen,
  eingebauteVorlage,
  normalisiereVorlage,
  leereConfig,
  normalisiereConfig,
  baueOrdner,
  importZiele,
  fuelleMuster,
} = require('../src/core/vorlagen');

// --- Platzhalter ------------------------------------------------------------

test('Platzhalter werden ersetzt', () => {
  assert.equal(fuelleMuster('Sola_{jahr}', { jahr: '2026' }), 'Sola_2026');
  assert.equal(fuelleMuster('{jahr}_{name}', { jahr: '2026', name: 'Hochzeit' }), '2026_Hochzeit');
});

test('ein leerer Wert nimmt das Trennzeichen davor mit', () => {
  assert.equal(fuelleMuster('{nr}_Tag_{datum}', { nr: 1, datum: '' }), '1_Tag');
  assert.equal(fuelleMuster('{nr}_Tag_{datum}', { nr: 1, datum: '13-06-2026' }), '1_Tag_13-06-2026');
  assert.equal(fuelleMuster('{jahr}_{name}', { jahr: '', name: 'Urlaub' }), 'Urlaub');
});

// --- Mitgelieferte Vorlagen -------------------------------------------------

test('es gibt fünf mitgelieferte Vorlagen mit eindeutigen Ids', () => {
  const alle = eingebauteVorlagen();
  assert.equal(alle.length, 5);
  assert.equal(new Set(alle.map((v) => v.id)).size, 5);
  for (const v of alle) {
    assert.ok(v.name, `${v.id} hat einen Namen`);
    assert.ok(v.bereiche.length > 0, `${v.id} hat Bereiche`);
    assert.ok(v.projekte.length > 0, `${v.id} hat Projekte`);
    assert.equal(v.eingebaut, true);
  }
});

test('die Originale lassen sich über die Kopien nicht verändern', () => {
  const erste = eingebauteVorlage('sola');
  erste.bereiche[0].label = 'Kaputt';
  assert.equal(eingebauteVorlage('sola').bereiche[0].label, 'Foto');
});

// --- Prüfen und Auffüllen ---------------------------------------------------

test('eine Vorlage mit Lücken wird brauchbar aufgefüllt', () => {
  const v = normalisiereVorlage({ name: 'Test', bereiche: [{ label: 'Bilder' }] });
  assert.equal(v.bereiche[0].key, 'bereich1');
  assert.equal(v.projekte.length, 1);
  assert.deepEqual(v.namenslisten, []);
  assert.equal(v.standardTage, 8);
});

test('ein Verweis auf eine unbekannte Namensliste wird verworfen', () => {
  const v = normalisiereVorlage({
    name: 'Test',
    namenslisten: [{ key: 'foto', label: 'Foto' }],
    bereiche: [{ key: 'a', label: 'A', personenListe: 'gibtsnicht' }],
  });
  assert.equal(v.bereiche[0].personenListe, '');
});

test('Personenordner liegen nur in einem Ordner, den es auch gibt', () => {
  const v = normalisiereVorlage({
    name: 'Test',
    namenslisten: [{ key: 'foto', label: 'Foto' }],
    bereiche: [
      { key: 'a', label: 'A', tage: true, tagUnterordner: ['01_Roh'], personenListe: 'foto', personenIn: '01_Roh' },
      { key: 'b', label: 'B', tage: true, tagUnterordner: ['01_Roh'], personenListe: 'foto', personenIn: 'Nirgendwo' },
    ],
  });
  assert.equal(v.bereiche[0].personenIn, '01_Roh');
  assert.equal(v.bereiche[1].personenIn, '');
});

test('doppelte Projektschlüssel fallen weg', () => {
  const v = normalisiereVorlage({
    name: 'Test',
    projekte: [{ key: 'a', label: 'A' }, { key: 'a', label: 'Nochmal A' }],
    bereiche: [{ key: 'x', label: 'X' }],
  });
  assert.equal(v.projekte.length, 1);
});

// --- Konfiguration ----------------------------------------------------------

test('die leere Konfiguration passt zur Vorlage', () => {
  const v = eingebauteVorlage('reise');
  const c = leereConfig(v);
  assert.equal(c.vorlage, 'reise');
  assert.equal(c.reise.tage, 7);
  assert.equal(c.reise.aktiv, false);
  assert.equal(c.reise.personen.length, 10);
});

test('Namenslücken werden geschlossen', () => {
  const v = eingebauteVorlage('sola');
  const c = normalisiereConfig({ teens: { fotografen: ['', 'Lars', '', 'Maja'] } }, v);
  assert.deepEqual(c.teens.fotografen.slice(0, 2), ['Lars', 'Maja']);
  assert.equal(c.teens.fotografen.length, 10);
});

// --- Ordnerbau --------------------------------------------------------------

/** Kurzschreibweise: ein Projekt aktiv, alle genannten Bereiche an. */
function config(vorlage, projektKey, daten) {
  const c = leereConfig(vorlage);
  Object.assign(c, daten.wurzel || {});
  c[projektKey] = { ...c[projektKey], aktiv: true, ...daten };
  if (daten.bereiche) c[projektKey].bereiche = Object.fromEntries(daten.bereiche.map((b) => [b, true]));
  return c;
}

test('das private Projekt baut Jahr und Namen in den Hauptordner', () => {
  const v = eingebauteVorlage('projekt');
  const c = config(v, 'projekt', { bereiche: ['foto'], wurzel: { jahr: '2026', name: 'Hochzeit Meier' } });
  const { ordner, wurzel } = baueOrdner(v, c, { jahr: '2026' });
  assert.equal(wurzel, '2026_Hochzeit Meier');
  assert.ok(ordner.includes('2026_Hochzeit Meier/01_Foto'));
  assert.ok(ordner.includes('2026_Hochzeit Meier/01_Foto/01_Original'));
  assert.ok(ordner.includes('2026_Hochzeit Meier/01_Foto/04_Export'));
});

test('ein Projekt ohne eigenen Ordner legt die Bereiche direkt in die Wurzel', () => {
  const v = eingebauteVorlage('privat');
  const c = config(v, 'archiv', { bereiche: ['fotos', 'dokumente'], wurzel: { name: 'Archiv' } });
  const { ordner } = baueOrdner(v, c);
  assert.ok(ordner.includes('Archiv/Fotos'));
  assert.ok(ordner.includes('Archiv/Dokumente/Rechnungen'));
  assert.ok(!ordner.some((p) => p.includes('/Archiv/Archiv')));
});

test('ohne Nummerierung heißen die Bereiche wie ihr Label', () => {
  const v = eingebauteVorlage('privat');
  const c = config(v, 'archiv', { bereiche: ['fotos'], wurzel: { name: 'Archiv' } });
  const { ordner } = baueOrdner(v, c);
  assert.ok(ordner.includes('Archiv/Fotos'));
  assert.ok(!ordner.includes('Archiv/01_Fotos'));
});

test('die Reisevorlage legt je Tag einen Ordner mit Personenordnern an', () => {
  const v = eingebauteVorlage('reise');
  const c = config(v, 'reise', {
    bereiche: ['tage'],
    start: '2026-07-04',
    tage: 3,
    personen: ['Lars', 'Maja'],
    wurzel: { jahr: '2026', name: 'Norwegen' },
  });
  const { ordner } = baueOrdner(v, c, { jahr: '2026' });
  assert.ok(ordner.includes('2026_Norwegen/Tage/Tag_01_04-07-2026'));
  assert.ok(ordner.includes('2026_Norwegen/Tage/Tag_03_06-07-2026'));
  assert.ok(!ordner.includes('2026_Norwegen/Tage/Tag_04_07-07-2026'));
  // Die Personen liegen in „Fotos" und zählen dort ab 01.
  assert.ok(ordner.includes('2026_Norwegen/Tage/Tag_01_04-07-2026/Fotos/01_Lars'));
  assert.ok(ordner.includes('2026_Norwegen/Tage/Tag_01_04-07-2026/Fotos/02_Maja'));
});

test('ohne Namen oder Jahr sagt die Vorlage, was fehlt', () => {
  const v = eingebauteVorlage('privat');
  const { ordner, warnungen } = baueOrdner(v, leereConfig(v));
  assert.equal(ordner.length, 0);
  assert.match(warnungen[0], /Namen/);
});

test('ein Projekt ohne Bereich wird benannt', () => {
  const v = eingebauteVorlage('privat');
  const c = config(v, 'archiv', { bereiche: [], wurzel: { name: 'Archiv' } });
  const { warnungen } = baueOrdner(v, c);
  assert.match(warnungen.join(' '), /kein Bereich/);
});

test('der Plan ist sortiert und frei von Dubletten', () => {
  const v = eingebauteVorlage('reise');
  const c = config(v, 'reise', {
    bereiche: ['tage', 'auswahl', 'unterlagen'],
    start: '2026-07-04',
    tage: 5,
    personen: ['Lars'],
    wurzel: { jahr: '2026', name: 'Norwegen' },
  });
  const { ordner } = baueOrdner(v, c, { jahr: '2026' });
  assert.equal(new Set(ordner).size, ordner.length);
  assert.deepEqual([...ordner].sort(), ordner);
});

test('Ordnernamen mit Pfadtrennern werden entschärft', () => {
  const v = eingebauteVorlage('privat');
  const c = config(v, 'archiv', { bereiche: ['fotos'], wurzel: { name: 'A/B:C' } });
  const { wurzel } = baueOrdner(v, c);
  assert.equal(wurzel, 'A_B_C');
});

// --- Importziele ------------------------------------------------------------

test('Importziele entstehen nur für Bereiche mit Tagen und Namensliste', () => {
  const v = eingebauteVorlage('reise');
  const c = config(v, 'reise', {
    bereiche: ['tage', 'auswahl'],
    start: '2026-07-04',
    tage: 2,
    personen: ['Lars'],
    wurzel: { jahr: '2026', name: 'Norwegen' },
  });

  const ok = importZiele(v, c, { projektKey: 'reise', bereich: 'tage', person: 'Lars', jahr: '2026' });
  assert.deepEqual(Object.keys(ok.ziele), ['04-07-2026', '05-07-2026']);
  assert.equal(ok.ziele['04-07-2026'], '2026_Norwegen/Tage/Tag_01_04-07-2026/Fotos/01_Lars');

  const nein = importZiele(v, c, { projektKey: 'reise', bereich: 'auswahl', person: 'Lars', jahr: '2026' });
  assert.equal(Object.keys(nein.ziele).length, 0);
  assert.match(nein.warnungen[0], /Tagesordnern/);
});

test('ein unbekannter Name führt zu einer klaren Meldung', () => {
  const v = eingebauteVorlage('reise');
  const c = config(v, 'reise', {
    bereiche: ['tage'],
    start: '2026-07-04',
    tage: 2,
    personen: ['Lars'],
    wurzel: { jahr: '2026', name: 'Norwegen' },
  });
  const r = importZiele(v, c, { projektKey: 'reise', bereich: 'tage', person: 'Niemand', jahr: '2026' });
  assert.match(r.warnungen[0], /Niemand/);
});

// --- Gleichstand mit der Sola-Sicht ----------------------------------------

test('die Sola-Vorlage baut denselben Baum wie buildPlan', () => {
  const { buildPlan, emptyConfig } = require('../src/core/structure');
  const c = emptyConfig();
  c.teens = {
    ...c.teens,
    aktiv: true,
    start: '2026-06-13',
    tage: 8,
    bereiche: { ...c.teens.bereiche, foto: true, video: true },
    fotografen: ['Lars', 'Maja', '', '', '', '', '', '', '', ''],
    videografen: ['Jonas', '', '', '', '', '', '', '', '', ''],
  };
  const ausSola = buildPlan(c);
  const ausVorlage = baueOrdner(eingebauteVorlage('sola'), c, { jahr: '2026' });
  assert.deepEqual(ausVorlage.ordner, ausSola.ordner);
});
