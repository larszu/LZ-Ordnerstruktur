'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanImport, pruefeZiel, sichereAufZiel } = require('../src/core/importRun');
const { Warteschlange } = require('../src/core/auftraege');

function tempOrdner(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Eine Karte mit drei Aufnahmen; das Datum steht im Namen (kein ExifTool nötig). */
function karteMit(ordner, anzahl = 3) {
  fs.mkdirSync(path.join(ordner, 'DCIM'), { recursive: true });
  for (let i = 0; i < anzahl; i += 1) {
    fs.writeFileSync(path.join(ordner, 'DCIM', `20260613_1010${String(i).padStart(2, '0')}.jpg`), `Bild ${i}`);
  }
  return ordner;
}

const planVon = (quelle) => scanImport({ quelle, schema: 'datum', ktx: { umbenennen: false } });

test('pruefeZiel zählt, was am Ziel noch fehlt', async (t) => {
  const karte = karteMit(tempOrdner(t, 'karte-'), 3);
  const ziel = tempOrdner(t, 'ziel-');
  const scan = await planVon(karte);
  assert.equal(scan.plan.length, 3);

  const leer = await pruefeZiel({ plan: scan.plan, zielBasis: ziel });
  assert.equal(leer.gesamt, 3);
  assert.equal(leer.fehlend, 3);
  assert.equal(leer.vorhanden, 0);

  const lauf = await sichereAufZiel({ plan: scan.plan, zielBasis: ziel });
  assert.equal(lauf.erledigt, 3);
  assert.equal(lauf.fehlend, 0, 'nach dem Kopieren fehlt nichts mehr');
  assert.equal(lauf.geprueft, 3);
  assert.deepEqual(lauf.fehler, []);
});

test('pruefeZiel merkt, wenn am Ziel eine andere Datei mit gleichem Namen liegt', async (t) => {
  const karte = karteMit(tempOrdner(t, 'karte2-'), 1);
  const ziel = tempOrdner(t, 'ziel2-');
  const scan = await planVon(karte);
  const [eintrag] = scan.plan;

  const ordner = path.join(ziel, ...eintrag.zielRel.split('/'));
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, eintrag.zielName), 'etwas ganz anderes');

  const vorher = await pruefeZiel({ plan: scan.plan, zielBasis: ziel, methode: 'inhalt' });
  assert.equal(vorher.fehlend, 1, 'gleicher Name, anderer Inhalt zählt nicht als gesichert');

  // Der Import legt sie als Kopie daneben — danach ist sie wirklich da.
  const lauf = await sichereAufZiel({ plan: scan.plan, zielBasis: ziel });
  assert.equal(lauf.fehlend, 0);
  assert.equal(lauf.pruefung.vorhanden, 1);
});

test('ohne Metadaten-Wunsch wird trotzdem kopiert und geprüft', async (t) => {
  // null statt eines Wunsch-Objekts kam beim Sichern aus der Menüleiste vor und
  // hat den ganzen Lauf als „nicht vollständig" gemeldet, obwohl alles lag.
  const karte = karteMit(tempOrdner(t, 'karte-meta-'), 2);
  const ziel = tempOrdner(t, 'ziel-meta-');
  const scan = await planVon(karte);
  const lauf = await sichereAufZiel({ plan: scan.plan, zielBasis: ziel, metadatenWunsch: null });
  assert.equal(lauf.erledigt, 2);
  assert.equal(lauf.fehlend, 0);
  assert.deepEqual(lauf.fehler, []);
});

test('sichern ohne Ziel meldet den Fehler statt zu kopieren', async (t) => {
  const karte = karteMit(tempOrdner(t, 'karte3-'), 1);
  const scan = await planVon(karte);
  const lauf = await sichereAufZiel({ plan: scan.plan, zielBasis: '' });
  assert.equal(lauf.erledigt, 0);
  assert.match(lauf.fehler[0].grund, /Kein Zielordner/);
  assert.equal(lauf.fehlend, 1);
});

test('die Warteschlange sichert eine Karte wirklich auf zwei Platten', async (t) => {
  const karte = karteMit(tempOrdner(t, 'karte4-'), 4);
  const arbeit = tempOrdner(t, 'arbeit-');
  const archiv = tempOrdner(t, 'archiv-');
  const scan = await planVon(karte);

  const fertig = new Promise((aufloesen) => {
    const w = new Warteschlange({
      arbeite: (auftrag, ziel, { melde, sollAbbrechen }) =>
        sichereAufZiel({ plan: auftrag.plan, zielBasis: ziel.pfad, melde, sollAbbrechen }),
      melde: (ereignis) => {
        if (ereignis.art === 'auftragFertig') aufloesen(ereignis.stand.alle[0]);
      },
    });
    w.stelleEin({
      quelle: karte,
      quelleName: 'Karte A',
      plan: scan.plan,
      ziele: [
        { pfad: arbeit, name: 'T7 Shield', rolle: 'arbeit' },
        { pfad: archiv, name: 'Archiv', rolle: 'archiv' },
      ],
    });
  });

  const auftrag = await fertig;
  assert.equal(auftrag.status, 'fertig');
  assert.equal(auftrag.formatieren, true, 'erst jetzt darf die Karte formatiert werden');
  for (const basis of [arbeit, archiv]) {
    const ordner = path.join(basis, '2026', '202606', '20260613');
    assert.equal(fs.readdirSync(ordner).length, 4, `${basis} hat alle vier Dateien`);
  }
  assert.equal(fs.readdirSync(path.join(karte, 'DCIM')).length, 4, 'die Karte bleibt unangetastet');
});
