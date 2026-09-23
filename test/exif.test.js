'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const exif = require('../src/core/exif');
const mitgeliefert = require('../src/core/mitgeliefert');
const werkzeuge = require('../src/core/werkzeuge');

test('ExifTool wird mitgeliefert und ist aufrufbar', () => {
  const befehl = mitgeliefert.exiftoolBefehl();
  assert.ok(befehl, 'die mitgelieferte Fassung muss gefunden werden');
  const version = execFileSync(befehl.programm, [...befehl.vorArgs, '-ver'], { encoding: 'utf8' }).trim();
  assert.match(version, /^\d+\.\d+/, `unerwartete Versionsausgabe: ${version}`);
});

test('die mitgelieferte Fassung hat Vorrang vor einer selbst installierten', () => {
  // Sonst hinge das Verhalten der App daran, was auf dem Rechner zufällig liegt.
  assert.equal(exif.vorhanden, true);
  assert.equal(exif.quelle, 'mitgeliefert');
});

test('der Lizenztext liegt bei', () => {
  const lizenz = path.join(__dirname, '..', 'resources', 'EXIFTOOL-LIZENZ.txt');
  const text = fs.readFileSync(lizenz, 'utf8');
  assert.match(text, /Phil Harvey/);
  assert.match(text, /Artistic/);
  assert.match(text, /GPL/);
});

test('der Stand der Werkzeuge nennt die Herkunft', () => {
  const stand = werkzeuge.stand();
  assert.equal(stand.exiftool, true);
  assert.equal(stand.exiftoolQuelle, 'mitgeliefert');
  assert.ok(stand.exiftoolPfad.length > 0);
});

test('Aufnahmedaten werden aus einer echten Datei gelesen', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-exif-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Ein echtes JPEG erzeugen und mit ExifTool selbst ein Aufnahmedatum setzen —
  // so braucht der Test keine eingecheckte Binärdatei.
  const jpg = path.join(dir, 'probe.jpg');
  const quelle = path.join(__dirname, '..', 'src', 'renderer', 'signet.png');
  const befehl = mitgeliefert.exiftoolBefehl();
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', quelle, '--out', jpg], { stdio: 'ignore' });
  } catch (_) {
    t.skip('sips gibt es nur auf macOS');
    return;
  }
  execFileSync(
    befehl.programm,
    [...befehl.vorArgs, '-overwrite_original', '-DateTimeOriginal=2026:06:13 14:30:12', jpg],
    { stdio: 'ignore' },
  );

  const daten = await exif.leseMetadaten([jpg]);
  const eintrag = daten[exif.schluessel(jpg)];
  assert.ok(eintrag, 'die Datei muss in der Ausgabe auftauchen');
  assert.equal(eintrag.DateTimeOriginal, '2026-06-13 14:30:12');
});

test('eine leere Liste fragt ExifTool gar nicht erst', async () => {
  assert.deepEqual(await exif.leseMetadaten([]), {});
});

test('unlesbare Dateien werfen nicht, sondern fehlen nur in der Ausgabe', async () => {
  const daten = await exif.leseMetadaten(['/gibt/es/nicht.jpg']);
  assert.equal(typeof daten, 'object');
});
