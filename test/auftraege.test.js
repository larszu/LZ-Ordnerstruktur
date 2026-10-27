'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Warteschlange, STATUS, satzFuer, alleGeprueft } = require('../src/core/auftraege');

const ZIELE = [
  { pfad: '/arbeit', name: 'T7 Shield', rolle: 'arbeit' },
  { pfad: '/archiv', name: 'Archiv', rolle: 'archiv' },
];

const planMit = (n) => Array.from({ length: n }, (_, i) => ({ von: `/karte/IMG_${i}.jpg`, zielRel: '2026', zielName: `IMG_${i}.jpg` }));

/** Wartet, bis die Warteschlange nichts mehr zu tun hat. */
async function ruhe(w) {
  for (let i = 0; i < 400; i += 1) {
    if (!w.laeuft && !w.auftraege.some((a) => a.status === STATUS.WARTET)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Warteschlange kommt nicht zur Ruhe');
}

test('fertig gemeldet wird erst, wenn alle Ziele geprüft sind', async () => {
  const bearbeitet = [];
  const w = new Warteschlange({
    arbeite: async (auftrag, ziel) => {
      bearbeitet.push(ziel.pfad);
      return { erledigt: auftrag.gesamt, uebersprungen: 0, geprueft: auftrag.gesamt, fehlend: 0, fehler: [] };
    },
  });

  w.stelleEin({ quelle: '/karte', quelleName: 'Karte A', ziele: ZIELE, plan: planMit(148) });
  await ruhe(w);

  const [auftrag] = w.stand().alle;
  assert.deepEqual(bearbeitet, ['/arbeit', '/archiv'], 'ein Ziel nach dem anderen');
  assert.equal(auftrag.status, STATUS.FERTIG);
  assert.equal(auftrag.formatieren, true);
  assert.match(auftrag.satz, /148 von 148 Dateien auf T7 Shield und Archiv geprüft/);
  assert.match(auftrag.satz, /kann formatiert werden/);
});

test('fehlt auf einem Ziel etwas, bleibt die Karte gesperrt', async () => {
  const w = new Warteschlange({
    arbeite: async (auftrag, ziel) => (ziel.pfad === '/archiv'
      ? { erledigt: 140, uebersprungen: 0, geprueft: 140, fehlend: 8, fehler: [] }
      : { erledigt: auftrag.gesamt, uebersprungen: 0, geprueft: auftrag.gesamt, fehlend: 0, fehler: [] }),
  });

  w.stelleEin({ quelle: '/karte', quelleName: 'Karte A', ziele: ZIELE, plan: planMit(148) });
  await ruhe(w);

  const [auftrag] = w.stand().alle;
  assert.equal(auftrag.status, STATUS.FEHLER);
  assert.equal(auftrag.formatieren, false);
  assert.match(auftrag.satz, /nicht formatieren/);
  assert.match(auftrag.fehlerText, /Archiv nicht vollständig/);
  assert.equal(auftrag.ziele[0].status, STATUS.FERTIG, 'das geprüfte Ziel bleibt gültig');
});

test('mehrere Karten laufen hintereinander durch', async () => {
  const reihenfolge = [];
  const w = new Warteschlange({
    arbeite: async (auftrag, ziel) => {
      reihenfolge.push(`${auftrag.quelleName}/${ziel.name}`);
      await new Promise((r) => setTimeout(r, 2));
      return { erledigt: auftrag.gesamt, uebersprungen: 0, geprueft: auftrag.gesamt, fehlend: 0, fehler: [] };
    },
  });

  w.stelleEin({ quelle: '/a', quelleName: 'Karte A', ziele: ZIELE, plan: planMit(2) });
  w.stelleEin({ quelle: '/b', quelleName: 'Karte B', ziele: ZIELE, plan: planMit(3) });
  const stand = w.stand();
  assert.equal(stand.aktiv.length, 2, 'die zweite Karte wartet');
  await ruhe(w);

  assert.deepEqual(reihenfolge, [
    'Karte A/T7 Shield', 'Karte A/Archiv',
    'Karte B/T7 Shield', 'Karte B/Archiv',
  ]);
  assert.equal(w.stand().erledigt.length, 2);
  assert.equal(w.stand().offeneKarten, 0);
});

test('Abbruch hält an, geprüfte Ziele bleiben gültig', async () => {
  const w = new Warteschlange({
    arbeite: async (auftrag, ziel, { sollAbbrechen }) => {
      if (ziel.pfad === '/arbeit') {
        const r = { erledigt: auftrag.gesamt, uebersprungen: 0, geprueft: auftrag.gesamt, fehlend: 0, fehler: [] };
        w.abbrechen(); // mitten im Lauf
        return r;
      }
      assert.ok(sollAbbrechen(), 'das zweite Ziel würde den Abbruch sehen');
      return { erledigt: 0, uebersprungen: 0, geprueft: 0, fehlend: auftrag.gesamt, fehler: [] };
    },
  });

  w.stelleEin({ quelle: '/karte', quelleName: 'Karte A', ziele: ZIELE, plan: planMit(10) });
  await ruhe(w);

  const [auftrag] = w.stand().alle;
  assert.equal(auftrag.status, STATUS.ABGEBROCHEN);
  assert.equal(auftrag.ziele[0].status, STATUS.FERTIG);
  assert.equal(auftrag.ziele[1].status, STATUS.WARTET, 'das zweite Ziel wurde nicht angefasst');
  assert.match(auftrag.satz, /abgebrochen/);
  assert.match(auftrag.satz, /Nicht formatieren/);
});

test('ein Fehler im Kopieren wirft die Warteschlange nicht aus der Bahn', async () => {
  const w = new Warteschlange({
    arbeite: async (_auftrag, ziel) => {
      if (ziel.pfad === '/arbeit') throw new Error('Platte voll');
      return { erledigt: 5, uebersprungen: 0, geprueft: 5, fehlend: 0, fehler: [] };
    },
  });

  w.stelleEin({ quelle: '/karte', quelleName: 'Karte A', ziele: ZIELE, plan: planMit(5) });
  await ruhe(w);

  const [auftrag] = w.stand().alle;
  assert.equal(auftrag.ziele[0].status, STATUS.FEHLER);
  assert.equal(auftrag.ziele[0].fehler[0].grund, 'Platte voll');
  assert.equal(auftrag.ziele[1].status, STATUS.FERTIG, 'das zweite Ziel wird trotzdem bedient');
  assert.equal(auftrag.formatieren, false);
});

test('ohne Ziel gibt es keinen Auftrag', () => {
  const w = new Warteschlange({ arbeite: async () => ({}) });
  const auftrag = w.stelleEin({ quelle: '/karte', quelleName: 'Karte A', ziele: [], plan: planMit(3) });
  assert.equal(auftrag.status, STATUS.FEHLER);
  assert.match(auftrag.fehlerText, /Kein Ziel/);
});

test('satzFuer nennt die Dateien, die noch irgendwo fehlen', () => {
  const auftrag = {
    quelleName: 'Karte A',
    gesamt: 148,
    status: STATUS.WARTET,
    ziele: [
      { name: 'T7 Shield', status: STATUS.FERTIG, fehlend: 0 },
      { name: 'Archiv', status: STATUS.WARTET, fehlend: null },
    ],
  };
  assert.equal(alleGeprueft(auftrag), false);
  const satz = satzFuer(auftrag);
  assert.match(satz.text, /148 von 148 Dateien noch nicht auf Archiv/);
  assert.equal(satz.formatieren, false);
});

test('eine Datei, die auf zwei Zielen fehlt, wird nicht doppelt gezählt', () => {
  const satz = satzFuer({
    quelleName: 'Karte A',
    gesamt: 5,
    status: STATUS.WARTET,
    ziele: [
      { name: 'T7 Shield', status: STATUS.WARTET, fehlend: 5 },
      { name: 'Archiv', status: STATUS.WARTET, fehlend: 5 },
    ],
  });
  assert.match(satz.text, /5 von 5 Dateien noch nicht auf T7 Shield und Archiv/);
  assert.doesNotMatch(satz.text, /10 von 5/);
});

test('aufraeumen entfernt nur Erledigtes', async () => {
  const w = new Warteschlange({
    arbeite: async (auftrag) => ({ erledigt: auftrag.gesamt, uebersprungen: 0, geprueft: auftrag.gesamt, fehlend: 0, fehler: [] }),
  });
  w.stelleEin({ quelle: '/a', quelleName: 'Karte A', ziele: ZIELE, plan: planMit(1) });
  await ruhe(w);
  assert.equal(w.stand().erledigt.length, 1);
  w.aufraeumen();
  assert.equal(w.stand().alle.length, 0);
});
