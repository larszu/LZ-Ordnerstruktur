'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ziele = require('../src/core/ziele');

test('das erste Ziel ist das Arbeitslaufwerk, jedes weitere eine Sicherung', () => {
  const erst = ziele.ergaenzeZiel([], { pfad: '/Volumes/T7 Shield' });
  assert.equal(erst.neu, true);
  assert.equal(erst.ziele[0].rolle, 'arbeit');
  assert.equal(erst.ziele[0].name, 'T7 Shield');

  const zweit = ziele.ergaenzeZiel(erst.ziele, { pfad: '/Volumes/Backup' });
  assert.equal(zweit.ziele.length, 2);
  assert.equal(zweit.ziele[1].rolle, 'sicherung');
});

test('ein schon bekannter Pfad wird aktualisiert, nicht verdoppelt', () => {
  const erst = ziele.ergaenzeZiel([], { pfad: '/Volumes/T7' }).ziele;
  const nochmal = ziele.ergaenzeZiel(erst, { pfad: '/Volumes/T7', name: 'Arbeitsplatte' });
  assert.equal(nochmal.neu, false);
  assert.equal(nochmal.ziele.length, 1);
  assert.equal(nochmal.ziele[0].name, 'Arbeitsplatte');
});

test('normalisiereZiele wirft Unbrauchbares weg und sortiert nach Rolle', () => {
  const liste = ziele.normalisiereZiele([
    { pfad: '/arch', rolle: 'archiv' },
    null,
    { pfad: '', rolle: 'arbeit' },
    { pfad: '/sich', rolle: 'quatsch' },
    { pfad: '/arbeit', rolle: 'arbeit' },
    { pfad: '/arch', rolle: 'archiv' },
  ]);
  assert.deepEqual(liste.map((z) => z.pfad), ['/arbeit', '/sich', '/arch']);
  assert.equal(liste[1].rolle, 'sicherung', 'unbekannte Rolle gilt als Sicherung');
});

test('mehr als MAX_ZIELE werden nicht verwaltet', () => {
  let liste = [];
  for (let i = 0; i < ziele.MAX_ZIELE; i += 1) liste = ziele.ergaenzeZiel(liste, { pfad: `/z${i}` }).ziele;
  const zuViel = ziele.ergaenzeZiel(liste, { pfad: '/noch-eins' });
  assert.equal(zuViel.neu, false);
  assert.match(zuViel.fehler, /nicht verwaltet/);
});

test('pruefeAufstellung sagt, ob zwei Kopien möglich sind', () => {
  const liste = ziele.normalisiereZiele([
    { pfad: '/arbeit', name: 'T7', rolle: 'arbeit' },
    { pfad: '/sich', name: 'Sicherung', rolle: 'sicherung' },
  ]);

  const nurEine = ziele.pruefeAufstellung(ziele.mitStand(liste, (p) => ({ vorhanden: p === '/arbeit' })));
  assert.equal(nurEine.bereit.length, 1);
  assert.deepEqual(nurEine.fehlen.map((z) => z.name), ['Sicherung']);
  assert.match(nurEine.hinweis, /Eine Kopie ist keine Sicherung/);

  const beide = ziele.pruefeAufstellung(ziele.mitStand(liste, () => ({ vorhanden: true })));
  assert.equal(beide.bereit.length, 2);
  assert.match(beide.hinweis, /2 Ziele bereit/);

  const keine = ziele.pruefeAufstellung(ziele.mitStand(liste, () => ({ vorhanden: false })));
  assert.equal(keine.bereit.length, 0);
  assert.match(keine.hinweis, /Kein Ziel angeschlossen/);

  assert.match(ziele.pruefeAufstellung([]).hinweis, /kein Ziel eingerichtet/);
});

test('mitStand hängt die Beschriftung der Rolle an', () => {
  const [ziel] = ziele.mitStand([{ pfad: '/arbeit', rolle: 'arbeit' }], () => ({ vorhanden: true, frei: 1024 }));
  assert.equal(ziel.rolleLabel, 'Arbeitslaufwerk');
  assert.equal(ziel.angeschlossen, true);
  assert.equal(ziel.frei, 1024);
});

test('ein abgewähltes Ziel ist nicht einsatzbereit', () => {
  const liste = ziele.setzeZiel(
    ziele.ergaenzeZiel([], { pfad: '/arbeit' }).ziele,
    '/arbeit',
    { aktiv: false },
  );
  const mitStand = ziele.mitStand(liste, () => ({ vorhanden: true }));
  assert.equal(ziele.einsatzbereit(mitStand).length, 0);
});

test('entferneZiel lässt die anderen stehen', () => {
  const liste = ziele.ergaenzeZiel(ziele.ergaenzeZiel([], { pfad: '/a' }).ziele, { pfad: '/b' }).ziele;
  assert.deepEqual(ziele.entferneZiel(liste, '/a').map((z) => z.pfad), ['/b']);
});

test('lesbareGroesse schreibt deutsch und kommt mit Unbekanntem aus', () => {
  assert.equal(ziele.lesbareGroesse(0), '0 B');
  assert.equal(ziele.lesbareGroesse(1024), '1,0 KB');
  assert.equal(ziele.lesbareGroesse(237430083584), '221 GB');
  assert.equal(ziele.lesbareGroesse(null), '—');
});
