'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../src/core/vorlagenStore');
const einstellungen = require('../src/core/einstellungen');
const { STANDARD_GRUPPEN } = require('../src/core/sachgruppen');

function ordner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-store-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// --- Vorlagen ---------------------------------------------------------------

test('ohne eigene Vorlagen stehen nur die mitgelieferten in der Liste', () => {
  const dir = ordner();
  const liste = store.listeVorlagen(dir);
  assert.equal(liste.length, 5);
  assert.ok(liste.every((v) => v.eingebaut));
});

test('eine eigene Vorlage bekommt eine Id aus ihrem Namen', () => {
  const dir = ordner();
  const ergebnis = store.speichereVorlage(dir, { name: 'Meine Größe & Güte', bereiche: [{ label: 'A' }] }, { neu: true });
  assert.ok(ergebnis.ok);
  assert.equal(ergebnis.id, 'meine-groesse-guete');
  assert.equal(store.listeVorlagen(dir).length, 6);
});

test('eine schon vergebene Id wird durchnummeriert', () => {
  const dir = ordner();
  const a = store.speichereVorlage(dir, { name: 'Hochzeit', bereiche: [{ label: 'A' }] }, { neu: true });
  const b = store.speichereVorlage(dir, { name: 'Hochzeit', bereiche: [{ label: 'B' }] }, { neu: true });
  assert.equal(a.id, 'hochzeit');
  assert.equal(b.id, 'hochzeit-2');
});

test('eine eigene Vorlage mit der Id einer mitgelieferten ersetzt diese', () => {
  const dir = ordner();
  store.speichereVorlage(dir, { id: 'sola', name: 'Sola nach meiner Art', bereiche: [{ label: 'Foto' }] });
  const liste = store.listeVorlagen(dir);
  assert.equal(liste.length, 5, 'sie verdrängt die mitgelieferte, statt daneben zu stehen');
  const sola = liste.find((v) => v.id === 'sola');
  assert.equal(sola.name, 'Sola nach meiner Art');
  assert.equal(sola.eingebaut, false);
});

test('nach dem Löschen gilt wieder die mitgelieferte Fassung', () => {
  const dir = ordner();
  store.speichereVorlage(dir, { id: 'sola', name: 'Eigenbau', bereiche: [{ label: 'Foto' }] });
  const ergebnis = store.loescheVorlage(dir, 'sola');
  assert.ok(ergebnis.ok);
  assert.equal(store.findeVorlage(dir, 'sola').name, 'Sola (Multimedia-Team)');
});

test('mitgelieferte Vorlagen lassen sich nicht löschen', () => {
  const dir = ordner();
  const ergebnis = store.loescheVorlage(dir, 'reise');
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.grund, /nicht löschen/);
});

test('eine kaputte Datei sprengt die Liste nicht', () => {
  const dir = ordner();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kaputt.json'), '{ das ist kein JSON');
  assert.equal(store.listeVorlagen(dir).length, 5);
});

test('eine unbekannte Id liefert die erste Vorlage statt nichts', () => {
  const dir = ordner();
  assert.equal(store.findeVorlage(dir, 'gibtsnicht').id, 'sola');
});

// --- Einstellungen ----------------------------------------------------------

test('ohne Datei gelten die Vorgaben', () => {
  const dir = ordner();
  const werte = einstellungen.lade(dir);
  assert.equal(werte.vorlage, 'sola');
  assert.equal(werte.inPapierkorb, true);
  assert.equal(werte.gruppen.length, STANDARD_GRUPPEN.length);
});

test('geänderte Felder überleben einen Neustart', () => {
  const dir = ordner();
  einstellungen.speichere(dir, { vorlage: 'reise', kuerzel: 'L.Z.' });
  const werte = einstellungen.lade(dir);
  assert.equal(werte.vorlage, 'reise');
  assert.equal(werte.kuerzel, 'L.Z.');
  // Alles Übrige bleibt auf dem Stand der Vorgabe.
  assert.equal(werte.datumSchema, 'jahr-monat-tag');
});

test('eine unbrauchbare Gruppenliste wird beim Laden geheilt', () => {
  const dir = ordner();
  einstellungen.speichere(dir, { gruppen: [] });
  assert.equal(einstellungen.lade(dir).gruppen.length, STANDARD_GRUPPEN.length);
});

test('Zurücksetzen stellt den Auslieferungszustand her', () => {
  const dir = ordner();
  einstellungen.speichere(dir, { vorlage: 'privat', zielordner: '/tmp/irgendwo' });
  const werte = einstellungen.zuruecksetzen(dir);
  assert.equal(werte.vorlage, 'sola');
  assert.equal(werte.zielordner, '');
});

test('neue Felder kommen auch zu einer alten Datei dazu', () => {
  const dir = ordner();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, einstellungen.DATEI), JSON.stringify({ vorlage: 'reise' }));
  const werte = einstellungen.lade(dir);
  assert.equal(werte.vorlage, 'reise');
  assert.deepEqual(werte.sortierPfade, {});
  assert.equal(werte.aufraeumKategorien.album, true);
});
