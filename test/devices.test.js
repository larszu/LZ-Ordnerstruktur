'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listRemovable, listVolumes, volumeStand, hatDcim } = require('../src/core/devices');

test('hatDcim erkennt einen DCIM-Ordner (auch klein geschrieben)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(hatDcim(dir), false);
  fs.mkdirSync(path.join(dir, 'dcim'));
  assert.equal(hatDcim(dir), true);
  assert.equal(hatDcim(path.join(dir, 'gibtsnicht')), false);
});

test('listRemovable liefert ohne Fehler eine Liste passender Form', () => {
  const liste = listRemovable();
  assert.ok(Array.isArray(liste));
  for (const g of liste) {
    assert.equal(typeof g.pfad, 'string');
    assert.equal(typeof g.name, 'string');
    assert.equal(typeof g.kamera, 'boolean');
  }
});

test('listVolumes liefert angeschlossene Laufwerke mit Platzangabe', () => {
  const liste = listVolumes();
  assert.ok(Array.isArray(liste));
  for (const l of liste) {
    assert.equal(typeof l.pfad, 'string');
    assert.equal(typeof l.name, 'string');
    assert.equal(typeof l.kamera, 'boolean');
    assert.equal(typeof l.wechsel, 'boolean');
    assert.equal(typeof l.start, 'boolean');
    assert.ok(l.frei === null || typeof l.frei === 'number');
    assert.ok(l.gesamt === null || typeof l.gesamt === 'number');
  }
});

test('volumeStand sagt, ob ein Ziel noch angeschlossen ist', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stand-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const da = volumeStand(dir);
  assert.equal(da.vorhanden, true);
  assert.equal(typeof da.frei, 'number');

  const weg = volumeStand(path.join(dir, 'abgezogen'));
  assert.equal(weg.vorhanden, false);
  assert.equal(weg.frei, null);

  assert.equal(volumeStand('').vorhanden, false);
});
