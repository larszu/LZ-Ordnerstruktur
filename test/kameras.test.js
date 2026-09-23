'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const kameras = require('../src/core/kameras');
const metadaten = require('../src/core/metadaten');
const { buildImportPlan, PERSON_AUTOMATISCH } = require('../src/core/importPlan');
const { emptyConfig } = require('../src/core/structure');

// --- Kameras erkennen -------------------------------------------------------

test('die Seriennummer identifiziert die Kamera', () => {
  assert.equal(kameras.schluessel({ SerialNumber: '12345' }), '12345');
  assert.equal(kameras.schluessel({ InternalSerialNumber: 'ABC' }), 'ABC');
  // Ohne Seriennummer bleibt nur das Modell — gröber, aber besser als nichts.
  assert.equal(kameras.schluessel({ Model: 'ILCE-7M4' }), 'modell:ILCE-7M4');
  assert.equal(kameras.schluessel({}), '');
});

test('neu gesehene Kameras kommen dazu, bekannte bleiben unverändert', () => {
  const vorher = [{ id: '111', modell: 'Alt', person: 'Lars', versatzMinuten: 30 }];
  const { kameras: liste, neu } = kameras.ergaenzeKameras(vorher, [
    { SerialNumber: '111', Model: 'Neuer Name' },
    { SerialNumber: '222', Model: 'ILCE-7M4' },
  ]);
  assert.equal(liste.length, 2);
  assert.equal(neu.length, 1);
  assert.equal(neu[0].id, '222');
  // Die getroffene Zuordnung darf ein Import nicht überschreiben.
  const bekannt = liste.find((k) => k.id === '111');
  assert.equal(bekannt.person, 'Lars');
  assert.equal(bekannt.versatzMinuten, 30);
});

test('dieselbe Kamera wird nicht doppelt aufgenommen', () => {
  const { kameras: liste } = kameras.ergaenzeKameras([], [
    { SerialNumber: '111' }, { SerialNumber: '111' }, { SerialNumber: '111' },
  ]);
  assert.equal(liste.length, 1);
});

test('Dateien ohne Kameraangabe erzeugen keinen Eintrag', () => {
  const { kameras: liste } = kameras.ergaenzeKameras([], [{}, null, { Model: '' }]);
  assert.equal(liste.length, 0);
});

// --- Uhrzeit-Versatz --------------------------------------------------------

test('der Versatz verschiebt den Aufnahmezeitpunkt', () => {
  const d = { j: '2026', mo: '06', t: '13', hh: '10', mi: '00', ss: '00' };
  assert.equal(kameras.wendeVersatzAn(d, 90).hh, '11');
  assert.equal(kameras.wendeVersatzAn(d, -60).hh, '09');
  assert.equal(kameras.wendeVersatzAn(d, 0), d, 'ohne Versatz bleibt alles, wie es ist');
});

test('der Versatz trägt über Mitternacht in den nächsten Tag', () => {
  const d = { j: '2026', mo: '06', t: '13', hh: '23', mi: '30', ss: '00' };
  const neu = kameras.wendeVersatzAn(d, 60);
  assert.equal(neu.t, '14');
  assert.equal(neu.hh, '00');
  assert.equal(neu.datum, '14-06-2026');
});

test('ein unsinniger Versatz wird begrenzt statt übernommen', () => {
  const [k] = kameras.normalisiereKameras([{ id: 'x', versatzMinuten: 999999 }]);
  assert.equal(k.versatzMinuten, kameras.MAX_VERSATZ_MINUTEN);
  const [k2] = kameras.normalisiereKameras([{ id: 'y', versatzMinuten: 'Unsinn' }]);
  assert.equal(k2.versatzMinuten, 0);
});

test('der Versatz wird lesbar angezeigt', () => {
  assert.equal(kameras.versatzText(0), 'keiner');
  assert.equal(kameras.versatzText(90), '+1:30 h');
  assert.equal(kameras.versatzText(-75), '−1:15 h');
});

// --- Zusammenspiel mit dem Importplan --------------------------------------

function solaConfig() {
  const c = emptyConfig();
  c.jahr = '2026';
  c.teens = {
    ...c.teens,
    aktiv: true,
    start: '2026-06-13',
    tage: 8,
    bereiche: { ...c.teens.bereiche, foto: true },
    fotografen: ['Lars', 'Maja', '', '', '', '', '', '', '', ''],
  };
  return c;
}

test('eine falsch gehende Kamera landet trotzdem im richtigen Tagesordner', () => {
  const config = solaConfig();
  // Aufnahme um 00:30 am 14. — die Kamera geht eine Stunde vor, echt war es
  // der 13. um 23:30. Ohne Versatz landete das Bild im falschen Tag.
  const datei = {
    pfad: '/karte/IMG_1.jpg',
    name: 'IMG_1.jpg',
    exif: { DateTimeOriginal: '2026-06-14 00:30:00', SerialNumber: '111' },
  };
  const ktx = { projektKey: 'teens', bereich: 'foto', person: 'Lars', kameras: [] };

  const ohne = buildImportPlan({ dateien: [datei], schema: 'sola', ktx, config });
  assert.match(ohne.plan[0].zielRel, /2_Tag_14-06-2026/);

  const mit = buildImportPlan({
    dateien: [datei],
    schema: 'sola',
    ktx: { ...ktx, kameras: [{ id: '111', person: 'Lars', versatzMinuten: -60 }] },
    config,
  });
  assert.match(mit.plan[0].zielRel, /1_Tag_13-06-2026/);
});

test('„Person automatisch" sortiert eine gemischte Karte auseinander', () => {
  const config = solaConfig();
  const dateien = [
    { pfad: '/karte/a.jpg', name: 'a.jpg', exif: { DateTimeOriginal: '2026-06-13 10:00:00', SerialNumber: '111' } },
    { pfad: '/karte/b.jpg', name: 'b.jpg', exif: { DateTimeOriginal: '2026-06-13 11:00:00', SerialNumber: '222' } },
  ];
  const { plan } = buildImportPlan({
    dateien,
    schema: 'sola',
    ktx: {
      projektKey: 'teens',
      bereich: 'foto',
      person: PERSON_AUTOMATISCH,
      kameras: [
        { id: '111', person: 'Lars', versatzMinuten: 0 },
        { id: '222', person: 'Maja', versatzMinuten: 0 },
      ],
    },
    config,
  });
  assert.equal(plan.length, 2);
  assert.match(plan.find((p) => p.von.endsWith('a.jpg')).zielRel, /05_Lars/);
  assert.match(plan.find((p) => p.von.endsWith('b.jpg')).zielRel, /06_Maja/);
});

test('eine nicht zugeordnete Kamera wird übersprungen, nicht geraten', () => {
  const { plan, uebersprungen } = buildImportPlan({
    dateien: [{ pfad: '/karte/c.jpg', name: 'c.jpg', exif: { DateTimeOriginal: '2026-06-13 10:00:00', SerialNumber: '999' } }],
    schema: 'sola',
    ktx: {
      projektKey: 'teens',
      bereich: 'foto',
      person: PERSON_AUTOMATISCH,
      kameras: [{ id: '111', person: 'Lars', versatzMinuten: 0 }],
    },
    config: solaConfig(),
  });
  assert.equal(plan.length, 0);
  assert.match(uebersprungen[0].grund, /keiner Person zugeordnet/);
});

test('ohne jede Zuordnung sagt der Plan, was zu tun ist', () => {
  const { warnungen } = buildImportPlan({
    dateien: [],
    schema: 'sola',
    ktx: { projektKey: 'teens', bereich: 'foto', person: PERSON_AUTOMATISCH, kameras: [] },
    config: solaConfig(),
  });
  assert.match(warnungen.join(' '), /Kameras/);
});

// --- Metadaten --------------------------------------------------------------

test('aus den Wünschen werden ExifTool-Argumente', () => {
  const args = metadaten.argumenteFuer({ urheber: 'Lars', rechte: '© 2026', stichworte: ['Sola'], gpsEntfernen: true });
  assert.ok(args.includes('-Artist=Lars'));
  assert.ok(args.includes('-Copyright=© 2026'));
  // Anhängen statt ersetzen, damit vorhandene Stichwörter erhalten bleiben.
  assert.ok(args.includes('-Keywords+=Sola'));
  assert.ok(args.includes('-gps:all='));
});

test('leere Wünsche erzeugen keinen Aufruf', () => {
  assert.equal(metadaten.istLeer({}), true);
  assert.equal(metadaten.istLeer({ urheber: '   ', stichworte: ['', ' '] }), true);
  assert.equal(metadaten.istLeer({ gpsEntfernen: true }), false);
});

test('ohne etwas zu tun wird ExifTool gar nicht erst gestartet', async () => {
  assert.deepEqual(await metadaten.schreibe(['/egal.jpg'], {}), { geschrieben: 0, fehler: [] });
  assert.deepEqual(await metadaten.schreibe([], { urheber: 'Lars' }), { geschrieben: 0, fehler: [] });
});
