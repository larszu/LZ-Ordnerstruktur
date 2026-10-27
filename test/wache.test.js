'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Kartenwache } = require('../src/main/wache');

/** Keine echten Datenträger: die Liste wird hereingegeben. */
function wacheMit(liste, zusatz = {}) {
  const gemeldet = [];
  const weg = [];
  const wache = new Kartenwache({
    liste: () => liste.wert,
    beiNeu: (g) => gemeldet.push(g.pfad),
    beiWeg: (p) => weg.push(p),
    ...zusatz,
  });
  return { wache, gemeldet, weg };
}

test('der erste Durchgang merkt nur, was schon steckt', () => {
  const liste = { wert: [{ pfad: '/Volumes/KARTE', name: 'KARTE', kamera: true }] };
  const { wache, gemeldet } = wacheMit(liste);
  wache.pruefe();
  assert.deepEqual(gemeldet, [], 'eine beim Start steckende Karte springt nicht an');
});

test('eine neu gesteckte Karte wird gemeldet, eine abgezogene vergessen', () => {
  const liste = { wert: [{ pfad: '/Volumes/A', name: 'A' }] };
  const { wache, gemeldet, weg } = wacheMit(liste);
  wache.pruefe();

  liste.wert = [{ pfad: '/Volumes/A', name: 'A' }, { pfad: '/Volumes/B', name: 'B' }];
  wache.pruefe();
  assert.deepEqual(gemeldet, ['/Volumes/B']);

  liste.wert = [{ pfad: '/Volumes/A', name: 'A' }];
  wache.pruefe();
  assert.deepEqual(weg, ['/Volumes/B']);

  // Dieselbe Karte erneut gesteckt meldet wieder.
  liste.wert = [{ pfad: '/Volumes/A', name: 'A' }, { pfad: '/Volumes/B', name: 'B' }];
  wache.pruefe();
  assert.deepEqual(gemeldet, ['/Volumes/B', '/Volumes/B']);
});

test('ein Fehler beim Lesen der Laufwerke stoppt die Wache nicht', () => {
  let kaputt = true;
  const wache = new Kartenwache({
    liste: () => {
      if (kaputt) throw new Error('kein Zugriff');
      return [{ pfad: '/Volumes/C', name: 'C' }];
    },
    beiNeu: () => {},
  });
  assert.deepEqual(wache.pruefe(), []);
  kaputt = false;
  assert.doesNotThrow(() => wache.pruefe());
});

test('der Takt bleibt in sinnvollen Grenzen', () => {
  const liste = { wert: [] };
  const { wache } = wacheMit(liste, { takt: 1 });
  assert.equal(wache.takt, 2, 'schneller als zwei Sekunden wird nicht nachgesehen');
  wache.setzeTakt(999);
  assert.equal(wache.takt, 60);
  wache.setzeTakt(10);
  assert.equal(wache.takt, 10);
});

test('vergiss lässt einen Pfad wieder melden', () => {
  const liste = { wert: [{ pfad: '/Volumes/A', name: 'A' }] };
  const { wache, gemeldet } = wacheMit(liste);
  wache.pruefe();
  wache.vergiss('/Volumes/A');
  wache.pruefe();
  assert.deepEqual(gemeldet, ['/Volumes/A']);
});
