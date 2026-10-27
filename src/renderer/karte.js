'use strict';

/* global lz */
// Das Fenster, das beim Einstecken einer Karte aufgeht. Es beantwortet genau
// eine Frage: Liegt alles schon auf den Zielen oder nicht — und bietet den
// einen Knopf an, der das ändert.

const $ = (id) => document.getElementById(id);
const pfad = new URLSearchParams(location.search).get('pfad') || '';

const zustand = { gefunden: 0, geplant: 0, laeuft: false };

function zahl(n) {
  return Number(n || 0).toLocaleString('de-DE');
}

/** Eine Zeile je Ziel: Rolle, Name, was dort fehlt. */
function zeigeZiele(liste) {
  const ziel = $('zielliste');
  ziel.textContent = '';
  if (!liste.length) {
    const li = document.createElement('li');
    li.className = 'zielzeile';
    li.textContent = 'Noch kein Ziel eingerichtet.';
    ziel.appendChild(li);
    return;
  }
  for (const z of liste) {
    const li = document.createElement('li');
    li.className = 'zielzeile';

    const kopf = document.createElement('div');
    kopf.className = 'zielzeile-kopf';
    const name = document.createElement('span');
    name.className = 'zielzeile-name';
    name.textContent = z.name;
    const rolle = document.createElement('span');
    rolle.className = 'rolle';
    rolle.textContent = z.rolleLabel || z.rolle;
    kopf.append(name, rolle);

    const stand = document.createElement('span');
    if (!z.aktiv) {
      stand.className = 'zielzeile-stand';
      stand.textContent = 'abgewählt — wird übersprungen';
    } else if (!z.angeschlossen) {
      stand.className = 'zielzeile-stand warn';
      stand.textContent = 'nicht angeschlossen';
    } else if (z.fehlend === 0) {
      stand.className = 'zielzeile-stand gut';
      stand.textContent = `alle ${zahl(z.gesamt)} Dateien liegen hier`;
    } else {
      stand.className = 'zielzeile-stand warn';
      stand.textContent = `${zahl(z.fehlend)} von ${zahl(z.gesamt)} fehlen noch`;
    }

    li.append(kopf, stand);
    ziel.appendChild(li);
  }
}

/** Der Satz oben: darf die Karte formatiert werden oder nicht. */
function setzeSatz(text, art) {
  const el = $('satz');
  el.textContent = text;
  el.className = `satz satz-${art}`;
}

async function pruefen() {
  if (zustand.laeuft) return;
  zustand.laeuft = true;
  $('btnPruefen').disabled = true;
  $('btnSichern').disabled = true;
  setzeSatz('Karte wird gelesen …', 'info');

  const antwort = await lz.karteStand({
    pfad,
    unterordner: $('unterordner').value.trim(),
    umbenennen: $('umbenennen').checked,
  });

  zustand.laeuft = false;
  $('btnPruefen').disabled = false;
  $('fortschritt').textContent = '';

  if (!antwort.ok) {
    setzeSatz(antwort.fehler, 'fehler');
    return;
  }

  zustand.gefunden = antwort.gefunden;
  zustand.geplant = antwort.geplant;
  $('titel').textContent = antwort.name || 'Karte gesteckt';
  $('untertitel').textContent = antwort.kamera
    ? `${zahl(antwort.gefunden)} Fotos und Videos auf der Karte`
    : `${zahl(antwort.gefunden)} Fotos und Videos auf dem Datenträger`;

  zeigeZiele(antwort.ziele);
  $('zielHinweis').textContent = antwort.hinweis;

  const bereit = antwort.ziele.filter((z) => z.aktiv && z.angeschlossen);
  const offen = bereit.filter((z) => z.fehlend !== 0);
  // Dieselbe Datei auf zwei Zielen fehlt einmal, nicht zweimal.
  const fehlendGesamt = Math.max(0, ...offen.map((z) => z.fehlend || 0));

  if (antwort.geplant === 0) {
    setzeSatz('Hier ist nichts zu sichern — keine Fotos oder Videos gefunden.', 'info');
    $('btnSichern').disabled = true;
    return;
  }
  if (bereit.length === 0) {
    setzeSatz(`${zahl(antwort.geplant)} Dateien warten — es ist kein Ziel angeschlossen. Nicht formatieren.`, 'warnung');
    $('btnSichern').disabled = true;
    return;
  }
  if (offen.length === 0) {
    setzeSatz(
      `Alle ${zahl(antwort.geplant)} Dateien liegen auf ${bereit.map((z) => z.name).join(' und ')} — die Karte kann formatiert werden.`,
      'erfolg',
    );
    $('btnSichern').disabled = false;
    $('btnSichern').textContent = 'Trotzdem erneut sichern';
    return;
  }
  setzeSatz(
    `${zahl(fehlendGesamt)} von ${zahl(antwort.geplant)} Dateien sind noch nicht auf ${offen.map((z) => z.name).join(' und ')} — nicht formatieren.`,
    'warnung',
  );
  $('btnSichern').disabled = false;
  $('btnSichern').textContent = bereit.length > 1 ? `Auf ${bereit.length} Ziele sichern` : `Auf ${bereit[0].name} sichern`;
}

async function sichern() {
  $('btnSichern').disabled = true;
  setzeSatz('Auftrag wird eingestellt …', 'info');
  const antwort = await lz.karteSichern({
    pfad,
    unterordner: $('unterordner').value.trim(),
    umbenennen: $('umbenennen').checked,
  });
  if (!antwort.ok) {
    setzeSatz(antwort.fehler, 'fehler');
    $('btnSichern').disabled = false;
  }
  // Bei Erfolg schließt der Hauptprozess dieses Fenster — gearbeitet wird dort.
}

async function init() {
  await themaStarten();
  $('btnSichern').addEventListener('click', sichern);
  $('btnPruefen').addEventListener('click', pruefen);
  $('btnImport').addEventListener('click', () => lz.importFensterOeffnen(null));
  $('btnSpaeter').addEventListener('click', () => lz.karteIgnorieren({ pfad, dauerhaft: $('nieWieder').checked }));
  $('btnZieleEinrichten').addEventListener('click', () => lz.fensterZeigen('ziele'));
  $('unterordner').addEventListener('change', pruefen);
  $('umbenennen').addEventListener('change', pruefen);
  lz.aufKarteFortschritt((d) => {
    if (d.pfad === pfad) $('fortschritt').textContent = d.text;
  });

  const stand = await lz.zieleStand();
  const s = stand.sicherung || {};
  $('unterordner').value = s.unterordner || '';
  $('umbenennen').checked = Boolean(s.umbenennen);
  await pruefen();
}

init();
