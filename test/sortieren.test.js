'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sortieren = require('../src/core/sortieren');
const { gruppeFuer, normalisiereGruppen, STANDARD_GRUPPEN, UNSORTIERT } = require('../src/core/sachgruppen');

/** Wegwerfordner je Test, damit nichts zwischen den Tests hängen bleibt. */
function ordner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-sort-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const schreibe = (dir, name, inhalt = 'x') => {
  const ziel = path.join(dir, name);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, inhalt);
  return ziel;
};

// --- Datum aus dem Dateinamen ----------------------------------------------

test('das Datum kommt aus gängigen Dateinamen', () => {
  assert.deepEqual(sortieren.datumAusName('20260613_143012.jpg'), {
    j: '2026', mo: '06', t: '13', hh: '14', mi: '30', ss: '12',
  });
  assert.equal(sortieren.datumAusName('IMG_2026-06-13.jpg').t, '13');
  assert.equal(sortieren.datumAusName('ohne Datum.jpg'), null);
});

test('ein unmöglicher Monat wird nicht als Datum gelesen', () => {
  assert.equal(sortieren.datumAusName('20261332_101010.jpg'), null);
});

// --- Zielschemata -----------------------------------------------------------

test('jedes Zielschema liefert einen Pfad', () => {
  const d = { j: '2026', mo: '06', t: '13' };
  assert.deepEqual(sortieren.ordnerAusSchema('jahr-monat-tag', d), ['2026', '202606', '20260613']);
  assert.deepEqual(sortieren.ordnerAusSchema('jahr-monat', d), ['2026', '06 Juni']);
  assert.deepEqual(sortieren.ordnerAusSchema('jahr-monat-strich', d), ['2026', '2026-06-13']);
  assert.deepEqual(sortieren.ordnerAusSchema('nur-jahr', d), ['2026']);
});

test('ein unbekanntes Schema fällt auf den Standard zurück', () => {
  assert.deepEqual(sortieren.ordnerAusSchema('gibtsnicht', { j: '2026', mo: '06', t: '13' }), ['2026', '202606', '20260613']);
});

test('die Schemaliste ist für die Oberfläche vollständig beschriftet', () => {
  for (const s of sortieren.schemaListe()) {
    assert.ok(s.key && s.label && s.beispiel, s.key);
  }
});

// --- Fotos einsortieren -----------------------------------------------------

test('Fotos werden nach Datum geplant, ohne etwas zu verändern', async () => {
  const dir = ordner();
  schreibe(dir, '20260613_101010.jpg');
  schreibe(dir, 'unten/20251224_180000.mp4');

  const { plan, zusammenfassung } = await sortieren.pruefeFotos(dir, { ziel: path.join(dir, 'ziel'), schema: 'jahr-monat-tag' });
  assert.equal(plan.length, 2);
  assert.equal(zusammenfassung.anzahl, 2);
  // Trockenlauf: die Quelle liegt unangetastet da.
  assert.ok(fs.existsSync(path.join(dir, '20260613_101010.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'ziel')));
});

test('das Einsortieren verschiebt in den Datumsbaum und protokolliert', async () => {
  const dir = ordner();
  const ziel = path.join(dir, 'ziel');
  schreibe(dir, '20260613_101010.jpg');

  const scan = await sortieren.pruefeFotos(dir, { ziel, schema: 'jahr-monat-tag', umbenennen: true });
  const ergebnis = await sortieren.fuehreFotosAus(scan, { ziel, schema: 'jahr-monat-tag' });

  assert.equal(ergebnis.erledigt, 1);
  assert.ok(fs.existsSync(path.join(ziel, '2026', '202606', '20260613', '20260613_101010.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, '20260613_101010.jpg')), 'verschoben, nicht kopiert');
  assert.ok(fs.existsSync(ergebnis.protokoll));
});

test('Kopieren lässt die Originale liegen', async () => {
  const dir = ordner();
  const ziel = path.join(dir, 'ziel');
  schreibe(dir, '20260613_101010.jpg');

  const optionen = { ziel, schema: 'nur-jahr', kopieren: true };
  const scan = await sortieren.pruefeFotos(dir, optionen);
  await sortieren.fuehreFotosAus(scan, optionen);

  assert.ok(fs.existsSync(path.join(ziel, '2026', '20260613_101010.jpg')));
  assert.ok(fs.existsSync(path.join(dir, '20260613_101010.jpg')));
});

test('gleiche Zielnamen werden durchnummeriert statt überschrieben', async () => {
  const dir = ordner();
  const ziel = path.join(dir, 'ziel');
  schreibe(dir, 'a/20260613_101010.jpg', 'erste');
  schreibe(dir, 'b/20260613_101010.jpg', 'zweite');

  const optionen = { ziel, schema: 'nur-jahr', umbenennen: true };
  const scan = await sortieren.pruefeFotos(dir, optionen);
  await sortieren.fuehreFotosAus(scan, optionen);

  const drin = fs.readdirSync(path.join(ziel, '2026')).sort();
  assert.deepEqual(drin, ['20260613_101010.jpg', '20260613_101010_1.jpg']);
});

test('Fotos und Videos lassen sich trennen', async () => {
  const dir = ordner();
  const ziel = path.join(dir, 'ziel');
  schreibe(dir, '20260613_101010.jpg');
  schreibe(dir, '20260613_101011.mp4');

  const optionen = { ziel, schema: 'nur-jahr', getrennt: true };
  const scan = await sortieren.pruefeFotos(dir, optionen);
  await sortieren.fuehreFotosAus(scan, optionen);

  assert.ok(fs.existsSync(path.join(ziel, 'Fotos', '2026', '20260613_101010.jpg')));
  assert.ok(fs.existsSync(path.join(ziel, 'Videos', '2026', '20260613_101011.mp4')));
});

test('der eigene Protokollordner wird nicht mitsortiert', async () => {
  const dir = ordner();
  schreibe(dir, `${sortieren.PROTOKOLL_ORDNER}/20260613_101010.jpg`);
  const { plan } = await sortieren.pruefeFotos(dir, { ziel: dir, schema: 'nur-jahr' });
  assert.equal(plan.length, 0);
});

// --- Sachgruppen ------------------------------------------------------------

test('der Text bestimmt die Sachgruppe', () => {
  const g = normalisiereGruppen(STANDARD_GRUPPEN);
  assert.equal(gruppeFuer('Rechnung Nr. 12 · Gesamtbetrag · Umsatzsteuer · zahlbar', g), 'Rechnungen');
  assert.equal(gruppeFuer('Lebenslauf und Anschreiben zur Bewerbung', g), 'Bewerbung');
});

test('ohne Treffer und bei Gleichstand wird nicht geraten', () => {
  const g = normalisiereGruppen([
    { name: 'A', worte: ['apfel'] },
    { name: 'B', worte: ['birne'] },
  ]);
  assert.equal(gruppeFuer('nichts davon', g), UNSORTIERT);
  assert.equal(gruppeFuer('apfel birne', g), UNSORTIERT);
  assert.equal(gruppeFuer('apfel apfel birne', g), 'A');
});

test('eine unbrauchbare Gruppenliste fällt auf den Standard zurück', () => {
  assert.equal(normalisiereGruppen([]).length, STANDARD_GRUPPEN.length);
  assert.equal(normalisiereGruppen([{ name: '', worte: [] }]).length, STANDARD_GRUPPEN.length);
});

test('eigene Gruppen ersetzen die mitgelieferten vollständig', () => {
  const g = normalisiereGruppen([{ name: 'Hobby', worte: ['Angeln', ' Segeln '] }]);
  assert.deepEqual(g, [{ name: 'Hobby', worte: ['angeln', 'segeln'] }]);
});

// --- Dokumente --------------------------------------------------------------

test('Dokumente ohne lesbaren Inhalt landen in einer eigenen Gruppe', async () => {
  const dir = ordner();
  schreibe(dir, 'kaputt.docx', 'kein gültiges ZIP');
  const { plan } = await sortieren.pruefeDokumente(dir, { ziel: path.join(dir, 'ziel') });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].gruppe, 'Beschaedigt');
});

test('Dokumente behalten auf Wunsch ihren Dateinamen', async () => {
  const dir = ordner();
  schreibe(dir, 'Wichtig.docx', 'kein gültiges ZIP');
  const { plan } = await sortieren.pruefeDokumente(dir, { ziel: dir, umbenennen: false });
  assert.equal(plan[0].zielName, 'Wichtig.docx');
});

// --- Duplikate --------------------------------------------------------------

test('inhaltsgleiche Dateien werden gefunden, eine bleibt', async () => {
  const dir = ordner();
  schreibe(dir, 'brief.txt', 'derselbe Inhalt');
  schreibe(dir, 'unten/brief_kopie.txt', 'derselbe Inhalt');
  schreibe(dir, 'anders.txt', 'etwas anderes');

  const scan = await sortieren.pruefeDuplikate(dir, {});
  assert.equal(scan.plan.length, 1);
  assert.equal(path.basename(scan.plan[0].behalten), 'brief.txt');

  await sortieren.fuehreDuplikateAus(scan, { ziel: dir });
  assert.ok(fs.existsSync(path.join(dir, 'brief.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'unten', 'brief_kopie.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'anders.txt')));
});

test('gleich große, aber verschiedene Dateien gelten nicht als Duplikat', async () => {
  const dir = ordner();
  schreibe(dir, 'a.txt', 'AAAA');
  schreibe(dir, 'b.txt', 'BBBB');
  const scan = await sortieren.pruefeDuplikate(dir, {});
  assert.equal(scan.plan.length, 0);
});

test('leere Dateien zählen nicht als Duplikate', async () => {
  const dir = ordner();
  schreibe(dir, 'leer1.txt', '');
  schreibe(dir, 'leer2.txt', '');
  const scan = await sortieren.pruefeDuplikate(dir, {});
  assert.equal(scan.plan.length, 0);
});

// --- Aufräumen --------------------------------------------------------------

test('Aufräumen erkennt die bekannten Kategorien', async () => {
  const dir = ordner();
  schreibe(dir, 'folder.jpg', 'cover');
  schreibe(dir, 'com.hersteller.app.png', 'icon');
  schreibe(dir, 'video.exo', 'cache');
  schreibe(dir, 'leer.txt', '');
  schreibe(dir, 'bruchstueck.mp4', 'winzig');
  schreibe(dir, 'urlaub.jpg', 'ein echtes Foto');

  const { plan, zusammenfassung } = await sortieren.pruefeAufraeumen(dir, {});
  const wege = plan.map((p) => path.basename(p.weg)).sort();
  assert.deepEqual(wege, ['bruchstueck.mp4', 'com.hersteller.app.png', 'folder.jpg', 'leer.txt', 'video.exo']);
  assert.equal(zusammenfassung.kategorien['Album-Cover'], 1);
  assert.ok(!wege.includes('urlaub.jpg'), 'echte Fotos bleiben unangetastet');
});

test('abgewählte Kategorien werden übersprungen', async () => {
  const dir = ordner();
  schreibe(dir, 'folder.jpg', 'cover');
  schreibe(dir, 'leer.txt', '');
  const { plan } = await sortieren.pruefeAufraeumen(dir, { kategorien: { album: false, leer: true } });
  assert.deepEqual(plan.map((p) => path.basename(p.weg)), ['leer.txt']);
});

test('die Größengrenze für Video-Bruchstücke lässt sich stellen', async () => {
  const dir = ordner();
  schreibe(dir, 'kurz.mp4', 'x'.repeat(200));
  assert.equal((await sortieren.pruefeAufraeumen(dir, { minVideo: 100 })).plan.length, 0);
  assert.equal((await sortieren.pruefeAufraeumen(dir, { minVideo: 500 })).plan.length, 1);
});

test('entfernt wird über den übergebenen Weg — der Papierkorb der App', async () => {
  const dir = ordner();
  schreibe(dir, 'folder.jpg', 'cover');
  const gesehen = [];
  const scan = await sortieren.pruefeAufraeumen(dir, {});
  await sortieren.fuehreAufraeumenAus(scan, { ziel: dir, entferne: async (p) => gesehen.push(p) });
  assert.equal(gesehen.length, 1);
  // Der eigene Weg wurde benutzt, also liegt die Datei noch da.
  assert.ok(fs.existsSync(path.join(dir, 'folder.jpg')));
});

// --- Vorschautexte ----------------------------------------------------------

test('jede Aufgabe beschreibt ihre Planzeilen', () => {
  assert.match(sortieren.beschreibe('fotos', { von: '/a/b.jpg', datum: '13.06.2026', herkunft: 'exif' }), /Aufnahmedatum/);
  assert.match(sortieren.beschreibe('dokumente', { von: '/a/b.pdf', gruppe: 'Rechnungen', zielName: 'x.pdf' }), /Rechnungen/);
  assert.match(sortieren.beschreibe('duplikate', { weg: '/a/x', behalten: '/a/y' }), /bleibt/);
  assert.match(sortieren.beschreibe('aufraeumen', { weg: '/a/x', kategorie: 'Album-Cover' }), /Album-Cover/);
});
