'use strict';

/* global lz */

// ---------------------------------------------------------------------------
// Zustand der Oberfläche
// ---------------------------------------------------------------------------

const zustand = {
  ansicht: 'start',
  info: null,
  vorlagen: [],
  vorlage: null, // die aktive Vorlage für das Anlegen
  config: null,
  pfad: '',
  einstellungen: null,
  letzterPlan: { ordner: [], jahr: '', warnungen: [] },
  vorgaben: [],
  lrPfade: {},
  // Vorlagen-Editor: eigene Arbeitskopie, damit Verwerfen wirklich verwirft
  entwurf: null,
  gruppen: [],
  aufraeumKategorien: {},
};

const $ = (id) => document.getElementById(id);
const $$ = (sel, wurzel = document) => [...wurzel.querySelectorAll(sel)];

// Muss zur Prüfung in src/core/validate.js passen.
const NAME_MUSTER = /^[A-Za-zÀ-ÖØ-öø-ÿẞß]+(?:[ '.-][A-Za-zÀ-ÖØ-öø-ÿẞß]+)*$/;
const KUERZEL_MUSTER = /^(?:[A-Za-zÀ-ÖØ-öø-ÿ]{1,2}\.)+$/;
const nameOk = (wert) => NAME_MUSTER.test(String(wert).trim());

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

async function init() {
  const info = await lz.appInfo();
  zustand.info = info;
  zustand.vorlagen = info.vorlagen;
  zustand.einstellungen = info.einstellungen;
  zustand.gruppen = info.einstellungen.gruppen;
  zustand.aufraeumKategorien = info.einstellungen.aufraeumKategorien;
  zustand.pfad = info.einstellungen.zielordner || '';

  $('version').textContent = `v${info.version}`;
  $('optPapierkorb').checked = info.einstellungen.inPapierkorb !== false;
  $('kuerzel').value = info.einstellungen.kuerzel || '';
  $('presetJahr').value = String(new Date().getFullYear()).slice(-2);

  fuelleSelect($('fotoSchema'), info.datumSchemata.map((s) => ({ value: s.key, text: `${s.label}  —  ${s.beispiel}` })));
  $('fotoSchema').value = info.einstellungen.datumSchema || info.datumSchemata[0].key;

  baueNavigation();
  baueVorlagenAuswahl();
  await waehleVorlage(info.einstellungen.vorlage, { stillSpeichern: true });
  baueKategorien();
  baueGruppenListe();
  verdrahteStruktur();
  verdrahteAufgaben();
  verdrahtePresets();
  verdrahteHilfe();

  await zeigeLightroomPfad();
  zeigeVorgaben(await lz.presetsListe());
  zeigeWerkzeugStand();

  lz.aufSortierFortschritt(({ aufgabe, text }) => {
    const ziel = document.querySelector(`#ansicht-${aufgabe} .fortschritt`);
    if (ziel) {
      ziel.className = 'fortschritt';
      ziel.textContent = text;
    }
  });

  lz.onMenu('menu:save', speichernAlsDatei);
  lz.onMenu('menu:load', ladenAusDatei);
  lz.onMenu('menu:import', importFensterOeffnen);

  for (const link of $$('[data-link]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      lz.linkOeffnen(link.dataset.link);
    });
  }

  await aktualisiereStruktur();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function baueNavigation() {
  for (const knopf of $$('[data-ansicht]')) {
    knopf.addEventListener('click', () => zeigeAnsicht(knopf.dataset.ansicht));
  }
}

function zeigeAnsicht(name) {
  zustand.ansicht = name;
  for (const knopf of $$('.nav-knopf')) knopf.classList.toggle('aktiv', knopf.dataset.ansicht === name);
  for (const ansicht of $$('.ansicht')) ansicht.classList.toggle('aktiv', ansicht.id === `ansicht-${name}`);
  document.querySelector('main').scrollTop = 0;
  if (name === 'vorlagen') oeffneEditor();
}

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function fuelleSelect(select, eintraege, leerText) {
  const vorher = select.value;
  select.textContent = '';
  if (leerText) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = leerText;
    select.appendChild(option);
  }
  for (const eintrag of eintraege) {
    const option = document.createElement('option');
    option.value = eintrag.value;
    option.textContent = eintrag.text;
    select.appendChild(option);
  }
  if (eintraege.some((e) => e.value === vorher)) select.value = vorher;
}

function zeigeMeldungen(zielId, meldungen) {
  const ziel = typeof zielId === 'string' ? $(zielId) : zielId;
  ziel.textContent = '';
  for (const meldung of meldungen) {
    const div = document.createElement('div');
    div.className = `meldung meldung-${meldung.art}`;
    const text = document.createElement('span');
    text.textContent = meldung.text;
    div.appendChild(text);
    if (meldung.knopf) {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'knopf knopf-klein knopf-still';
      knopf.textContent = meldung.knopf.text;
      knopf.addEventListener('click', meldung.knopf.aktion);
      div.appendChild(knopf);
    }
    ziel.appendChild(div);
  }
}

/** Einstellungen merken — gesammelt, damit nicht bei jedem Tastendruck geschrieben wird. */
let merkZeit = null;
function merke(aenderungen) {
  zustand.einstellungen = { ...zustand.einstellungen, ...aenderungen };
  clearTimeout(merkZeit);
  merkZeit = setTimeout(async () => {
    zustand.einstellungen = await lz.einstellungenSchreiben(zustand.einstellungen);
  }, 400);
}

const zahl = (n) => Number(n || 0).toLocaleString('de-DE');

function kachelHtml(wert, etikett) {
  const div = document.createElement('div');
  div.className = 'zahlkachel';
  const z = document.createElement('span');
  z.className = 'zahl';
  z.textContent = wert;
  const e = document.createElement('span');
  e.className = 'etikett';
  e.textContent = etikett;
  div.append(z, e);
  return div;
}

// ---------------------------------------------------------------------------
// Ordnerstruktur: Vorlage wählen und ausfüllen
// ---------------------------------------------------------------------------

function baueVorlagenAuswahl() {
  const eintraege = zustand.vorlagen.map((v) => ({ value: v.id, text: v.eingebaut ? v.name : `${v.name} (eigene)` }));
  fuelleSelect($('vorlageWahl'), eintraege);
  fuelleSelect($('editorWahl'), eintraege);
}

/** Wechselt die aktive Vorlage und holt die zuletzt benutzte Konfiguration dazu. */
async function waehleVorlage(id, { stillSpeichern = false } = {}) {
  const vorlage = zustand.vorlagen.find((v) => v.id === id) || zustand.vorlagen[0];
  zustand.vorlage = vorlage;
  $('vorlageWahl').value = vorlage.id;
  $('vorlageBeschreibung').textContent = vorlage.beschreibung;

  // Die gemerkte Konfiguration kann älter sein als die Vorlage — etwa wenn
  // inzwischen ein Block dazugekommen ist. Deshalb erst auffüllen lassen.
  const gemerkt = (zustand.einstellungen.configs || {})[vorlage.id];
  zustand.config = gemerkt
    ? await lz.configPruefen(gemerkt, vorlage.id)
    : await lz.leereConfig(vorlage.id);
  // Eine neue Vorlage ohne Anwahl wäre leer — der erste Block wird aktiv.
  if (!vorlage.projekte.some((p) => zustand.config[p.key] && zustand.config[p.key].aktiv) && vorlage.projekte.length === 1) {
    zustand.config[vorlage.projekte[0].key].aktiv = true;
  }

  $('feldJahr').hidden = !vorlage.jahrNutzen;
  $('feldName').hidden = !vorlage.nameNutzen;
  $('projektName').value = zustand.config.name || '';
  $('jahr').value = zustand.config.jahr || '';

  // Der Anlass der Lightroom-Vorgaben folgt den Blöcken der Vorlage.
  fuelleSelect($('presetSola'), vorlage.projekte.map((p) => ({ value: p.label, text: p.label })));

  baueProjekte();
  if (!stillSpeichern) merke({ vorlage: vorlage.id });
}

function baueProjekte() {
  const ziel = $('projekte');
  ziel.textContent = '';
  for (const projekt of zustand.vorlage.projekte) {
    ziel.appendChild(baueProjekt(projekt));
  }
  // Ein einzelner Block ohne eigenen Ordner braucht keine Überschrift mit Haken.
  ziel.classList.toggle('einzeln', zustand.vorlage.projekte.length === 1);
}

function baueProjekt(projekt) {
  const knoten = $('projektVorlage').content.cloneNode(true);
  const artikel = knoten.querySelector('.projekt');
  const key = projekt.key;
  artikel.dataset.projekt = key;
  knoten.querySelector('.projekt-titel').textContent = projekt.ordner
    ? `${projekt.titel} (${projekt.ordner})`
    : projekt.titel;

  const aktiv = knoten.querySelector('.projekt-aktiv');
  aktiv.addEventListener('change', () => {
    zustand.config[key].aktiv = aktiv.checked;
    aktualisiereStruktur();
  });

  const start = knoten.querySelector('.projekt-start');
  start.addEventListener('change', () => {
    zustand.config[key].start = start.value;
    aktualisiereStruktur();
  });

  const tage = knoten.querySelector('.projekt-tage');
  tage.min = String(zustand.info.tage.min);
  tage.max = String(zustand.info.tage.max);
  tage.addEventListener('input', () => {
    const n = Number(tage.value);
    const gueltig = Number.isFinite(n) && n >= zustand.info.tage.min && n <= zustand.info.tage.max;
    tage.classList.toggle('ungueltig', !gueltig);
    if (!gueltig) return;
    zustand.config[key].tage = n;
    aktualisiereStruktur({ ohneFelder: true });
  });
  tage.addEventListener('blur', () => {
    tage.value = String(zustand.config[key].tage);
    tage.classList.remove('ungueltig');
  });
  // Braucht kein Bereich Tagesordner, ist der Zeitraum belanglos.
  const brauchtZeitraum = zustand.vorlage.bereiche.some((b) => b.tage);
  knoten.querySelector('.projekt-zeitraum').hidden = !brauchtZeitraum;

  const bereichsListe = knoten.querySelector('.bereiche-liste');
  for (const bereich of zustand.vorlage.bereiche) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.bereich = bereich.key;
    box.addEventListener('change', () => {
      zustand.config[key].bereiche[bereich.key] = box.checked;
      aktualisiereStruktur();
    });
    label.append(box, document.createTextNode(bereich.label));
    bereichsListe.appendChild(label);
  }

  const namen = knoten.querySelector('.namen');
  for (const liste of zustand.vorlage.namenslisten) {
    const spalte = document.createElement('fieldset');
    spalte.className = 'namen-spalte';
    spalte.dataset.liste = liste.key;
    const legende = document.createElement('legend');
    legende.textContent = liste.label;
    spalte.appendChild(legende);
    const felder = document.createElement('div');
    felder.className = 'namen-liste';
    for (let i = 0; i < zustand.info.anzahlNamen; i += 1) {
      const feld = document.createElement('input');
      feld.type = 'text';
      feld.dataset.index = String(i);
      feld.placeholder = `${String(i + 1).padStart(2, '0')} · Name`;
      feld.addEventListener('input', () => {
        zustand.config[key][liste.key][i] = feld.value;
        feld.classList.toggle('ungueltig', feld.value.trim() !== '' && !nameOk(feld.value));
        aktualisiereStruktur({ ohneFelder: true });
      });
      // Beim Verlassen die Lücken schließen, damit die Nummerierung stimmt.
      feld.addEventListener('blur', () => {
        rueckeNamenAuf(key, liste.key);
        aktualisiereStruktur();
      });
      felder.appendChild(feld);
    }
    spalte.appendChild(felder);
    namen.appendChild(spalte);
  }
  namen.hidden = zustand.vorlage.namenslisten.length === 0;

  return knoten;
}

/** Leere Einträge zwischen Namen entfernen, damit die Nummerierung lückenlos bleibt. */
function rueckeNamenAuf(projektKey, listenKey) {
  const gefuellt = zustand.config[projektKey][listenKey].map((n) => String(n || '').trim()).filter(Boolean);
  while (gefuellt.length < zustand.info.anzahlNamen) gefuellt.push('');
  zustand.config[projektKey][listenKey] = gefuellt;
}

function verdrahteStruktur() {
  $('vorlageWahl').addEventListener('change', async () => {
    await waehleVorlage($('vorlageWahl').value);
    await aktualisiereStruktur();
  });
  $('btnVorlageBearbeiten').addEventListener('click', () => {
    $('editorWahl').value = zustand.vorlage.id;
    zeigeAnsicht('vorlagen');
  });

  $('btnPfad').addEventListener('click', async () => {
    const pfad = await lz.ordnerWaehlen('Zielordner für die Ordnerstruktur wählen');
    if (!pfad) return;
    zustand.pfad = pfad;
    merke({ zielordner: pfad });
    aktualisiereStruktur();
  });

  $('jahr').addEventListener('input', () => {
    zustand.config.jahr = $('jahr').value.trim();
    aktualisiereStruktur({ ohneFelder: true });
  });
  $('projektName').addEventListener('input', () => {
    zustand.config.name = $('projektName').value;
    aktualisiereStruktur({ ohneFelder: true });
  });

  $('btnVorschau').addEventListener('click', () => aktualisiereStruktur());
  $('btnErstellen').addEventListener('click', erstellen);
  $('btnSpeichern').addEventListener('click', speichernAlsDatei);
  $('btnLaden').addEventListener('click', ladenAusDatei);
  $('btnImportFenster').addEventListener('click', importFensterOeffnen);
}

/** @param {{ohneFelder?: boolean}} [optionen] */
async function aktualisiereStruktur(optionen = {}) {
  $('pfadAnzeige').textContent = zustand.pfad || 'Noch kein Ordner gewählt';

  for (const artikel of $$('.projekt')) {
    const key = artikel.dataset.projekt;
    const daten = zustand.config[key];
    if (!daten) continue;
    artikel.dataset.aktiv = String(daten.aktiv);
    artikel.querySelector('.projekt-aktiv').checked = daten.aktiv;

    if (!optionen.ohneFelder) {
      artikel.querySelector('.projekt-start').value = daten.start || '';
      const tageFeld = artikel.querySelector('.projekt-tage');
      if (document.activeElement !== tageFeld) tageFeld.value = String(daten.tage);
      for (const box of artikel.querySelectorAll('[data-bereich]')) {
        box.checked = Boolean(daten.bereiche[box.dataset.bereich]);
      }
      for (const spalte of artikel.querySelectorAll('.namen-spalte')) {
        for (const feld of spalte.querySelectorAll('input')) {
          const wert = daten[spalte.dataset.liste][Number(feld.dataset.index)] || '';
          if (document.activeElement !== feld) feld.value = wert;
          feld.classList.toggle('ungueltig', wert.trim() !== '' && !nameOk(wert));
        }
      }
    }

    // Namensfelder nur freigeben, wenn ein Bereich sie überhaupt benutzt.
    for (const spalte of artikel.querySelectorAll('.namen-spalte')) {
      const frei = daten.aktiv
        && zustand.vorlage.bereiche.some(
          (b) => daten.bereiche[b.key]
            && (b.personenListe === spalte.dataset.liste
              || (b.festeOrdner || []).some((f) => f.personenListe === spalte.dataset.liste)),
        );
      spalte.dataset.frei = String(frei);
      for (const feld of spalte.querySelectorAll('input')) feld.disabled = !frei;
    }
  }

  if (!optionen.ohneFelder) {
    $('jahr').value = zustand.config.jahr || '';
    $('projektName').value = zustand.config.name || '';
  }

  const plan = await lz.vorschau(zustand.config, zustand.vorlage.id);
  zustand.letzterPlan = plan;

  const bereit = Boolean(zustand.pfad) && plan.ordner.length > 1;
  $('btnErstellen').disabled = !bereit;
  $('planInfo').textContent = plan.ordner.length
    ? `${zahl(plan.ordner.length)} Ordner · ${plan.wurzel}`
    : 'Noch nichts anzulegen';
  $('wurzelInfo').textContent = plan.wurzel ? `Hauptordner: ${plan.wurzel}` : '';
  $('vorschauAnzahl').textContent = plan.ordner.length ? `(${zahl(plan.ordner.length)} Ordner)` : '';
  $('vorschauBaum').textContent = baumText(plan.ordner);

  zeigeMeldungen('meldungen', plan.warnungen.map((text) => ({ art: 'warnung', text })));

  const jahr = String(plan.jahr || zustand.config.jahr || '');
  if (jahr.length === 4 && document.activeElement !== $('presetJahr')) $('presetJahr').value = jahr.slice(-2);
  pruefePresetKnopf();

  merke({ configs: { ...(zustand.einstellungen.configs || {}), [zustand.vorlage.id]: zustand.config } });
}

/** Zeichnet die flache Pfadliste als eingerückten Baum. */
function baumText(ordner) {
  if (!ordner.length) return '';
  return ordner
    .map((pfad) => {
      const teile = pfad.split('/');
      return `${'    '.repeat(teile.length - 1)}${teile.length > 1 ? '└─ ' : ''}${teile[teile.length - 1]}`;
    })
    .join('\n');
}

async function erstellen() {
  $('btnErstellen').disabled = true;
  let ergebnis;
  try {
    ergebnis = await lz.strukturErstellen(zustand.pfad, zustand.config, zustand.vorlage.id);
  } catch (err) {
    await aktualisiereStruktur();
    zeigeMeldungen('meldungen', [{ art: 'fehler', text: `Anlegen fehlgeschlagen: ${err.message}` }]);
    return;
  }

  // Erst auffrischen, dann melden – sonst überschreibt die Auffrischung
  // die Erfolgsmeldung sofort wieder.
  await aktualisiereStruktur();

  const meldungen = [
    ...ergebnis.warnungen.map((text) => ({ art: 'warnung', text })),
    ...ergebnis.fehler.map((f) => ({ art: 'fehler', text: `${f.pfad}: ${f.grund}` })),
  ];
  if (ergebnis.erstellt > 0 || ergebnis.vorhanden > 0) {
    meldungen.unshift({
      art: ergebnis.fehler.length ? 'warnung' : 'erfolg',
      text:
        `${zahl(ergebnis.erstellt)} Ordner angelegt`
        + (ergebnis.vorhanden ? `, ${zahl(ergebnis.vorhanden)} waren schon vorhanden` : '')
        + `. Hauptordner: ${ergebnis.wurzel}`,
      knopf: { text: 'Im Finder/Explorer zeigen', aktion: () => lz.ordnerOeffnen(ergebnis.wurzel) },
    });
  }
  zeigeMeldungen('meldungen', meldungen);
}

async function speichernAlsDatei() {
  const ergebnis = await lz.configSpeichern(zustand.config, zustand.vorlage.id);
  if (ergebnis.gespeichert) {
    const meldungen = [{ art: 'erfolg', text: `Gespeichert: ${ergebnis.pfad}` }];
    if (ergebnis.verlust && ergebnis.verlust.length > 0) {
      meldungen.push({
        art: 'warnung',
        text:
          `Das CSV-Format des Windows-Originals kennt nur Teens und Kids mit acht Tagen. Nicht gespeichert wurde: ${ergebnis.verlust.join('; ')}. `
          + 'Für den vollständigen Stand bitte als JSON speichern.',
      });
    }
    zeigeMeldungen('meldungen', meldungen);
  } else if (ergebnis.fehler) {
    zeigeMeldungen('meldungen', [{ art: 'fehler', text: `Speichern fehlgeschlagen: ${ergebnis.fehler}` }]);
  }
}

async function ladenAusDatei() {
  const ergebnis = await lz.configLaden();
  if (ergebnis.geladen) {
    if (ergebnis.vorlageId !== zustand.vorlage.id) await waehleVorlage(ergebnis.vorlageId);
    zustand.config = ergebnis.config;
    baueProjekte();
    await aktualisiereStruktur();
    zeigeMeldungen('meldungen', [{ art: 'erfolg', text: `Geladen: ${ergebnis.pfad}` }]);
  } else if (ergebnis.fehler) {
    zeigeMeldungen('meldungen', [{ art: 'fehler', text: `Laden fehlgeschlagen: ${ergebnis.fehler}` }]);
  }
}

/** Öffnet das eigene Importfenster und gibt ihm den aktuellen Stand mit. */
function importFensterOeffnen() {
  lz.importFensterOeffnen({ config: zustand.config, zielordner: zustand.pfad, vorlageId: zustand.vorlage.id });
}

// ---------------------------------------------------------------------------
// Vorlagen-Editor
// ---------------------------------------------------------------------------

function oeffneEditor(id) {
  const wahl = id || $('editorWahl').value || zustand.vorlage.id;
  $('editorWahl').value = wahl;
  const vorlage = zustand.vorlagen.find((v) => v.id === wahl) || zustand.vorlage;
  zustand.entwurf = JSON.parse(JSON.stringify(vorlage));
  zeichneEditor();
}

/** Zeigt im Editor den Baum, den der Entwurf ergäbe. */
async function zeichneProbe() {
  const plan = await lz.vorlageProbe(zustand.entwurf);
  $('editorProbe').textContent = plan.ordner.length
    ? baumText(plan.ordner)
    : plan.warnungen.join('\n') || 'Noch nichts anzulegen.';
}

function zeichneEditor() {
  const e = zustand.entwurf;
  $('editorName').value = e.name;
  $('editorBeschreibung').value = e.beschreibung;
  $('editorWurzel').value = e.wurzel;
  $('editorTage').value = String(e.standardTage);
  $('editorJahr').checked = e.jahrNutzen;
  $('editorNameNutzen').checked = e.nameNutzen;
  $('editorNummern').checked = e.nummeriereBereiche;
  $('btnVorlageLoeschen').disabled = e.eingebaut;

  zeichneProjektZeilen();
  zeichneListenZeilen();
  zeichneBereichZeilen();
  zeichneProbe();
}

/** Eine beschriftete Eingabezeile im Editor. */
function editorFeld(beschriftung, wert, beiAenderung, { breit = false, platzhalter = '' } = {}) {
  const label = document.createElement('label');
  label.className = `feld ${breit ? 'feld-breit' : ''}`;
  const span = document.createElement('span');
  span.textContent = beschriftung;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = wert || '';
  input.placeholder = platzhalter;
  input.addEventListener('input', () => beiAenderung(input.value));
  label.append(span, input);
  return label;
}

function editorZeile(inhalt, entfernen) {
  const zeile = document.createElement('div');
  zeile.className = 'editorzeile';
  for (const teil of inhalt) zeile.appendChild(teil);
  if (entfernen) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'knopf knopf-klein knopf-still';
    knopf.textContent = 'Entfernen';
    knopf.addEventListener('click', entfernen);
    zeile.appendChild(knopf);
  }
  return zeile;
}

function zeichneProjektZeilen() {
  const ziel = $('editorProjekte');
  ziel.textContent = '';
  zeichneProbe();
  zustand.entwurf.projekte.forEach((projekt, i) => {
    ziel.appendChild(
      editorZeile(
        [
          editorFeld('Bezeichnung', projekt.titel, (v) => {
            projekt.titel = v;
            projekt.label = v;
            zeichneProbe();
          }, { breit: true }),
          editorFeld('Ordnername', projekt.ordner, (v) => {
            projekt.ordner = v;
            zeichneProbe();
          }, { breit: true, platzhalter: 'leer = direkt im Hauptordner' }),
        ],
        zustand.entwurf.projekte.length > 1
          ? () => {
              zustand.entwurf.projekte.splice(i, 1);
              zeichneProjektZeilen();
            }
          : null,
      ),
    );
  });
}

function zeichneListenZeilen() {
  const ziel = $('editorListen');
  ziel.textContent = '';
  zeichneProbe();
  zustand.entwurf.namenslisten.forEach((liste, i) => {
    ziel.appendChild(
      editorZeile(
        [
          editorFeld('Bezeichnung', liste.label, (v) => {
            liste.label = v;
          }, { breit: true }),
        ],
        () => {
          const entfernt = zustand.entwurf.namenslisten.splice(i, 1)[0];
          // Bereiche, die auf die Liste zeigten, verlieren ihre Personenordner.
          for (const b of zustand.entwurf.bereiche) {
            if (b.personenListe === entfernt.key) b.personenListe = '';
            for (const f of b.festeOrdner || []) if (f.personenListe === entfernt.key) f.personenListe = '';
          }
          zeichneListenZeilen();
          zeichneBereichZeilen();
        },
      ),
    );
  });
}

function zeichneBereichZeilen() {
  const ziel = $('editorBereiche');
  ziel.textContent = '';
  zeichneProbe();
  zustand.entwurf.bereiche.forEach((bereich, i) => {
    const block = document.createElement('div');
    block.className = 'editorblock';

    const kopf = document.createElement('div');
    kopf.className = 'editorzeile';
    kopf.appendChild(
      editorFeld('Name des Bereichs', bereich.label, (v) => {
        bereich.label = v;
        zeichneProbe();
      }, { breit: true }),
    );

    const art = document.createElement('label');
    art.className = 'feld feld-breit';
    const artText = document.createElement('span');
    artText.textContent = 'Aufbau';
    const artWahl = document.createElement('select');
    fuelleSelect(artWahl, [
      { value: 'einfach', text: 'Ein Ordner mit festen Unterordnern' },
      { value: 'tage', text: 'Je Tag ein Ordner' },
    ]);
    artWahl.value = bereich.tage ? 'tage' : 'einfach';
    artWahl.addEventListener('change', () => {
      bereich.tage = artWahl.value === 'tage';
      zeichneBereichZeilen();
    });
    art.append(artText, artWahl);
    kopf.appendChild(art);

    const weg = document.createElement('button');
    weg.type = 'button';
    weg.className = 'knopf knopf-klein knopf-still';
    weg.textContent = 'Entfernen';
    weg.addEventListener('click', () => {
      zustand.entwurf.bereiche.splice(i, 1);
      zeichneBereichZeilen();
    });
    kopf.appendChild(weg);
    block.appendChild(kopf);

    if (bereich.tage) {
      block.appendChild(
        editorFeld('Name der Tagesordner', bereich.tagMuster, (v) => {
          bereich.tagMuster = v;
          zeichneProbe();
        }, { breit: true, platzhalter: '{nr}_Tag_{datum}' }),
      );
    }

    const unterSchluessel = bereich.tage ? 'tagUnterordner' : 'unterordner';
    block.appendChild(
      mehrzeilig(
        bereich.tage ? 'Feste Ordner in jedem Tagesordner' : 'Feste Unterordner',
        bereich[unterSchluessel],
        (liste) => {
          bereich[unterSchluessel] = liste;
          fuellePersonenIn();
        },
      ),
    );

    // Personenordner
    const personen = document.createElement('div');
    personen.className = 'editorzeile';
    const listenWahl = document.createElement('label');
    listenWahl.className = 'feld feld-breit';
    const lText = document.createElement('span');
    lText.textContent = 'Eigener Ordner je Person aus';
    const lSel = document.createElement('select');
    fuelleSelect(lSel, zustand.entwurf.namenslisten.map((l) => ({ value: l.key, text: l.label })), 'keine Personenordner');
    lSel.value = bereich.personenListe || '';
    lSel.addEventListener('change', () => {
      bereich.personenListe = lSel.value;
      zeichneBereichZeilen();
    });
    listenWahl.append(lText, lSel);
    personen.appendChild(listenWahl);

    const inWahl = document.createElement('label');
    inWahl.className = 'feld feld-breit';
    const iText = document.createElement('span');
    iText.textContent = 'Die Personenordner liegen in';
    const iSel = document.createElement('select');
    const fuellePersonenIn = () => {
      fuelleSelect(
        iSel,
        (bereich.tage ? bereich.tagUnterordner : bereich.unterordner).map((u) => ({ value: u, text: u })),
        bereich.tage ? 'direkt im Tagesordner' : 'direkt im Bereich',
      );
      iSel.value = bereich.personenIn || '';
    };
    fuellePersonenIn();
    iSel.addEventListener('change', () => {
      bereich.personenIn = iSel.value;
      zeichneProbe();
    });
    inWahl.append(iText, iSel);
    personen.appendChild(inWahl);
    personen.hidden = !bereich.personenListe;
    block.appendChild(personen);

    if (bereich.personenListe) {
      block.appendChild(
        mehrzeilig('Unterordner je Person', bereich.personenUnterordner, (liste) => {
          bereich.personenUnterordner = liste;
        }),
      );
    }

    ziel.appendChild(block);
  });
}

/** Mehrzeiliges Feld: eine Zeile je Ordnername. */
function mehrzeilig(beschriftung, liste, beiAenderung) {
  const label = document.createElement('label');
  label.className = 'feld feld-breit';
  const span = document.createElement('span');
  span.textContent = beschriftung;
  const feld = document.createElement('textarea');
  feld.rows = Math.max(2, (liste || []).length + 1);
  feld.value = (liste || []).join('\n');
  feld.placeholder = 'einen Ordnernamen je Zeile';
  feld.addEventListener('change', () => {
    beiAenderung(feld.value.split('\n').map((z) => z.trim()).filter(Boolean));
    zeichneProbe();
  });
  label.append(span, feld);
  return label;
}

function verdrahteEditor() {
  $('editorWahl').addEventListener('change', () => oeffneEditor($('editorWahl').value));

  const binde = (id, schluessel, alsZahl = false) => {
    $(id).addEventListener('input', () => {
      const feld = $(id);
      zustand.entwurf[schluessel] = feld.type === 'checkbox' ? feld.checked : alsZahl ? Number(feld.value) : feld.value;
      zeichneProbe();
    });
  };
  binde('editorName', 'name');
  binde('editorBeschreibung', 'beschreibung');
  binde('editorWurzel', 'wurzel');
  binde('editorTage', 'standardTage', true);
  $('editorJahr').addEventListener('change', () => {
    zustand.entwurf.jahrNutzen = $('editorJahr').checked;
    zeichneProbe();
  });
  $('editorNameNutzen').addEventListener('change', () => {
    zustand.entwurf.nameNutzen = $('editorNameNutzen').checked;
    zeichneProbe();
  });
  $('editorNummern').addEventListener('change', () => {
    zustand.entwurf.nummeriereBereiche = $('editorNummern').checked;
    zeichneProbe();
  });

  $('btnProjektNeu').addEventListener('click', () => {
    const n = zustand.entwurf.projekte.length + 1;
    zustand.entwurf.projekte.push({ key: `block${n}`, label: `Block ${n}`, titel: `Block ${n}`, ordner: `0${n}_Block` });
    zeichneProjektZeilen();
  });
  $('btnListeNeu').addEventListener('click', () => {
    const n = zustand.entwurf.namenslisten.length + 1;
    zustand.entwurf.namenslisten.push({ key: `liste${n}`, label: `Namensliste ${n}` });
    zeichneListenZeilen();
    zeichneBereichZeilen();
  });
  $('btnBereichNeu').addEventListener('click', () => {
    const n = zustand.entwurf.bereiche.length + 1;
    zustand.entwurf.bereiche.push({
      key: `bereich${n}`,
      label: `Neuer Bereich ${n}`,
      tage: false,
      tagMuster: '{nr}_Tag_{datum}',
      tagUnterordner: [],
      unterordner: [],
      personenListe: '',
      personenIn: '',
      personenUnterordner: [],
      festeOrdner: [],
    });
    zeichneBereichZeilen();
  });

  $('btnVorlageNeu').addEventListener('click', async () => {
    zustand.entwurf = {
      id: 'eigen',
      name: 'Meine Vorlage',
      beschreibung: '',
      wurzel: '{name}',
      jahrNutzen: false,
      nameNutzen: true,
      nummeriereBereiche: false,
      standardTage: 1,
      eingebaut: false,
      namenslisten: [],
      projekte: [{ key: 'projekt', label: 'Projekt', titel: 'Projekt', ordner: '' }],
      bereiche: [{ key: 'ordner1', label: 'Neuer Ordner', tage: false, tagUnterordner: [], unterordner: [], personenListe: '', personenIn: '', personenUnterordner: [], festeOrdner: [] }],
    };
    zeichneEditor();
    await speichereVorlage(true);
  });

  $('btnVorlageSpeichern').addEventListener('click', () => speichereVorlage(zustand.entwurf.eingebaut));
  $('btnVorlageKopie').addEventListener('click', () => speichereVorlage(true));
  $('btnVorlageVerwerfen').addEventListener('click', () => {
    oeffneEditor($('editorWahl').value);
    zeigeMeldungen('vorlagenMeldungen', [{ art: 'erfolg', text: 'Änderungen verworfen.' }]);
  });

  $('btnVorlageLoeschen').addEventListener('click', async () => {
    const ergebnis = await lz.vorlageLoeschen(zustand.entwurf.id);
    if (!ergebnis.ok) {
      zeigeMeldungen('vorlagenMeldungen', [{ art: 'fehler', text: ergebnis.grund }]);
      return;
    }
    zustand.vorlagen = ergebnis.vorlagen;
    baueVorlagenAuswahl();
    await waehleVorlage(zustand.vorlagen[0].id);
    await aktualisiereStruktur();
    oeffneEditor(zustand.vorlagen[0].id);
    zeigeMeldungen('vorlagenMeldungen', [{ art: 'erfolg', text: 'Vorlage gelöscht.' }]);
  });
}

/**
 * Sichert den Entwurf. `alsKopie` legt eine neue Vorlage an — das passiert
 * automatisch, sobald eine mitgelieferte Vorlage geändert wurde.
 */
async function speichereVorlage(alsKopie) {
  const ergebnis = await lz.vorlageSpeichern(zustand.entwurf, alsKopie);
  if (!ergebnis.ok) {
    zeigeMeldungen('vorlagenMeldungen', [{ art: 'fehler', text: `Speichern fehlgeschlagen: ${ergebnis.grund}` }]);
    return;
  }
  zustand.vorlagen = ergebnis.vorlagen;
  baueVorlagenAuswahl();
  $('editorWahl').value = ergebnis.id;
  oeffneEditor(ergebnis.id);
  await waehleVorlage(ergebnis.id);
  await aktualisiereStruktur();
  zeigeMeldungen('vorlagenMeldungen', [
    {
      art: 'erfolg',
      text: alsKopie
        ? 'Als eigene Vorlage gespeichert — die mitgelieferte bleibt unverändert.'
        : 'Vorlage gespeichert.',
      knopf: { text: 'Jetzt anwenden', aktion: () => zeigeAnsicht('struktur') },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Die vier Aufgaben: Fotos, Dokumente, Duplikate, Aufräumen
// ---------------------------------------------------------------------------

const AUFGABEN_TEXTE = {
  fotos: { pruefen: 'Vorschau erstellen', ausfuehren: 'Einsortieren' },
  dokumente: { pruefen: 'Vorschau erstellen', ausfuehren: 'Einsortieren' },
  duplikate: { pruefen: 'Doppelte suchen', ausfuehren: 'Kopien entfernen' },
  aufraeumen: { pruefen: 'Suchen', ausfuehren: 'Entfernen' },
};

function verdrahteAufgaben() {
  verdrahteEditor();

  for (const abschnitt of $$('.aufgabe')) {
    const aufgabe = abschnitt.dataset.aufgabe;
    const pfade = (zustand.einstellungen.sortierPfade || {})[aufgabe] || {};

    for (const feld of $$('[data-rolle]', abschnitt)) {
      if (feld.tagName === 'INPUT') feld.value = pfade[feld.dataset.rolle] || '';
    }

    for (const knopf of $$('.waehlen', abschnitt)) {
      knopf.addEventListener('click', async () => {
        const rolle = knopf.dataset.rolle;
        const pfad = await lz.ordnerWaehlen(rolle === 'quelle' ? 'Ordner mit den Dateien wählen' : 'Zielordner wählen');
        if (!pfad) return;
        abschnitt.querySelector(`input[data-rolle="${rolle}"]`).value = pfad;
        const alle = { ...(zustand.einstellungen.sortierPfade || {}) };
        alle[aufgabe] = { ...(alle[aufgabe] || {}), [rolle]: pfad };
        merke({ sortierPfade: alle });
        setzeBereit(abschnitt, false);
      });
    }

    // Jede Änderung an den Optionen macht die alte Vorschau ungültig.
    for (const feld of $$('[data-opt]', abschnitt)) {
      feld.addEventListener('change', () => {
        setzeBereit(abschnitt, false);
        if (feld.dataset.opt === 'schema') merke({ datumSchema: feld.value });
      });
    }

    abschnitt.querySelector('.pruefen').addEventListener('click', () => pruefe(abschnitt, aufgabe));
    abschnitt.querySelector('.ausfuehren').addEventListener('click', () => fuehreAus(abschnitt, aufgabe));
  }

  $('btnGruppeNeu').addEventListener('click', () => {
    zustand.gruppen = [...zustand.gruppen, { name: 'Neue Gruppe', worte: [] }];
    merke({ gruppen: zustand.gruppen });
    baueGruppenListe();
  });
  $('btnGruppenZurueck').addEventListener('click', () => {
    zustand.gruppen = zustand.info.standardGruppen.map((g) => ({ name: g.name, worte: [...g.worte] }));
    merke({ gruppen: zustand.gruppen });
    baueGruppenListe();
  });
}

function optionenVon(abschnitt, aufgabe) {
  const optionen = {};
  const quelle = abschnitt.querySelector('input[data-rolle="quelle"]');
  const ziel = abschnitt.querySelector('input[data-rolle="ziel"]');
  optionen.ziel = (ziel && ziel.value) || (quelle && quelle.value) || '';
  for (const feld of $$('[data-opt]', abschnitt)) {
    optionen[feld.dataset.opt] = feld.type === 'checkbox' ? feld.checked : feld.value;
  }
  if (aufgabe === 'dokumente') optionen.gruppen = zustand.gruppen;
  if (aufgabe === 'aufraeumen') optionen.kategorien = zustand.aufraeumKategorien;
  return { quelle: (quelle && quelle.value) || '', optionen };
}

function setzeBereit(abschnitt, bereit) {
  abschnitt.querySelector('.ausfuehren').disabled = !bereit;
  if (!bereit) lz.sortierenVerwerfen(abschnitt.dataset.aufgabe);
}

function meldeIn(abschnitt, art, text) {
  const ziel = abschnitt.querySelector('.fortschritt');
  ziel.className = `fortschritt fortschritt-${art}`;
  ziel.textContent = text;
}

async function pruefe(abschnitt, aufgabe) {
  const { quelle, optionen } = optionenVon(abschnitt, aufgabe);
  if (!quelle) {
    meldeIn(abschnitt, 'fehler', 'Bitte zuerst einen Ordner wählen.');
    return;
  }
  const knopf = abschnitt.querySelector('.pruefen');
  abschnitt.querySelector('.zusammenfassung').textContent = '';
  abschnitt.querySelector('.liste').textContent = '';
  setzeBereit(abschnitt, false);
  knopf.disabled = true;
  knopf.textContent = 'Prüfe …';
  meldeIn(abschnitt, '', 'Durchsuche den Ordner …');

  const r = await lz.sortierenPruefen({ aufgabe, quelle, optionen });

  knopf.disabled = false;
  knopf.textContent = AUFGABEN_TEXTE[aufgabe].pruefen;
  if (!r.ok) {
    meldeIn(abschnitt, 'fehler', `Fehler: ${r.fehler}`);
    return;
  }

  zeigeZusammenfassung(abschnitt, aufgabe, r.zusammenfassung);
  const liste = abschnitt.querySelector('.liste');
  liste.textContent = '';
  for (const eintrag of r.vorschau) {
    const li = document.createElement('li');
    li.textContent = eintrag;
    liste.appendChild(li);
  }
  if (r.gesamt > r.vorschau.length) {
    const li = document.createElement('li');
    li.className = 'mehr';
    li.textContent = `… und ${zahl(r.gesamt - r.vorschau.length)} weitere`;
    liste.appendChild(li);
  }

  abschnitt.querySelector('.ausfuehren').disabled = r.gesamt === 0;
  meldeIn(
    abschnitt,
    r.gesamt === 0 ? 'fertig' : '',
    r.gesamt === 0
      ? 'Nichts zu tun — hier ist alles in Ordnung.'
      : `Vorschau fertig: ${zahl(r.gesamt)} Dateien. Liste prüfen, dann ausführen.`,
  );
}

async function fuehreAus(abschnitt, aufgabe) {
  const knopf = abschnitt.querySelector('.ausfuehren');
  knopf.disabled = true;
  knopf.textContent = 'Arbeite …';
  const r = await lz.sortierenAusfuehren({ aufgabe, inPapierkorb: $('optPapierkorb').checked });
  knopf.textContent = AUFGABEN_TEXTE[aufgabe].ausfuehren;

  if (!r.ok) {
    meldeIn(abschnitt, 'fehler', `Fehler: ${r.fehler}`);
    knopf.disabled = false;
    return;
  }
  abschnitt.querySelector('.liste').textContent = '';
  abschnitt.querySelector('.zusammenfassung').textContent = '';
  meldeIn(abschnitt, 'fertig', `Fertig — ${zahl(r.erledigt)} Dateien. Protokoll: ${r.protokoll}`);
}

function zeigeZusammenfassung(abschnitt, aufgabe, z) {
  const ziel = abschnitt.querySelector('.zusammenfassung');
  ziel.textContent = '';
  const wirdEntfernt = aufgabe === 'duplikate' || aufgabe === 'aufraeumen';
  ziel.appendChild(kachelHtml(zahl(z.anzahl), wirdEntfernt ? 'zu entfernen' : 'Dateien'));
  if (z.frei) ziel.appendChild(kachelHtml(`${zahl(Math.round(z.frei / 1e6))} MB`, 'werden frei'));
  if (z.quellen) {
    ziel.appendChild(kachelHtml(zahl(z.quellen.exif), 'aus Aufnahmedaten'));
    ziel.appendChild(kachelHtml(zahl(z.quellen.name), 'aus dem Dateinamen'));
    ziel.appendChild(kachelHtml(zahl(z.quellen.mtime), 'aus dem Änderungsdatum'));
  }
  if (z.verteilung) {
    for (const [name, n] of Object.entries(z.verteilung).sort((a, b) => b[1] - a[1])) {
      ziel.appendChild(kachelHtml(zahl(n), name));
    }
  }
  if (z.kategorien) {
    for (const [name, n] of Object.entries(z.kategorien)) if (n) ziel.appendChild(kachelHtml(zahl(n), name));
  }
}

function baueKategorien() {
  const ziel = $('kategorienListe');
  ziel.textContent = '';
  for (const kategorie of zustand.info.aufraeumKategorien) {
    const label = document.createElement('label');
    label.className = 'schalter';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = zustand.aufraeumKategorien[kategorie.key] !== false;
    box.addEventListener('change', () => {
      zustand.aufraeumKategorien = { ...zustand.aufraeumKategorien, [kategorie.key]: box.checked };
      merke({ aufraeumKategorien: zustand.aufraeumKategorien });
      setzeBereit($('ansicht-aufraeumen'), false);
    });
    const text = document.createElement('span');
    text.innerHTML = '';
    const stark = document.createElement('strong');
    stark.textContent = kategorie.label;
    const erklaerung = document.createElement('em');
    erklaerung.textContent = ` ${kategorie.erklaerung}`;
    text.append(stark, erklaerung);
    label.append(box, text);
    ziel.appendChild(label);
  }
}

function baueGruppenListe() {
  const ziel = $('gruppenListe');
  ziel.textContent = '';
  zustand.gruppen.forEach((gruppe, i) => {
    const zeile = editorZeile(
      [
        editorFeld('Ordnername', gruppe.name, (v) => {
          gruppe.name = v;
          merke({ gruppen: zustand.gruppen });
        }, { breit: true }),
        editorFeld('Stichwörter', gruppe.worte.join(', '), (v) => {
          gruppe.worte = v.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
          merke({ gruppen: zustand.gruppen });
        }, { breit: true, platzhalter: 'rechnung, invoice, gesamtbetrag' }),
      ],
      () => {
        zustand.gruppen.splice(i, 1);
        merke({ gruppen: zustand.gruppen });
        baueGruppenListe();
      },
    );
    ziel.appendChild(zeile);
  });
}

// ---------------------------------------------------------------------------
// Lightroom-Vorgaben
// ---------------------------------------------------------------------------

function verdrahtePresets() {
  $('kuerzel').addEventListener('input', () => {
    merke({ kuerzel: $('kuerzel').value.trim() });
    pruefePresetKnopf();
  });
  $('presetJahr').addEventListener('input', pruefePresetKnopf);

  $('btnPresetAdd').addEventListener('click', async () => {
    const ergebnis = await lz.presetHinzufuegen();
    if (ergebnis.abgebrochen) return;
    zeigeVorgaben(ergebnis.vorgaben);
    zeigeMeldungen(
      'presetMeldungen',
      ergebnis.ergebnisse.map((e) =>
        (e.ok
          ? { art: 'erfolg', text: `${e.datei} übernommen${e.ersetzt ? ' — ersetzt die mitgelieferte Fassung' : ''}.` }
          : { art: 'fehler', text: `${e.quelle}: ${e.grund}` })),
    );
  });

  $('btnPresetReset').addEventListener('click', async () => {
    const ergebnis = await lz.presetsZuruecksetzen();
    zeigeVorgaben(ergebnis.vorgaben);
    zeigeMeldungen('presetMeldungen', [
      ergebnis.ok
        ? { art: 'erfolg', text: 'Eigene Vorgaben verworfen — es gelten wieder die mitgelieferten.' }
        : { art: 'fehler', text: `Zurücksetzen fehlgeschlagen: ${ergebnis.grund}` },
    ]);
  });

  $('btnPresetOrdner').addEventListener('click', () => {
    if (zustand.lrPfade.eigene) lz.ordnerOeffnen(zustand.lrPfade.eigene);
  });

  $('btnPresets').addEventListener('click', async () => {
    const daten = {
      jahr: $('presetJahr').value.trim(),
      sola: $('presetSola').value,
      kuerzel: $('kuerzel').value.trim(),
    };
    const ergebnis = await lz.presetsInstallieren(daten);
    const meldungen = ergebnis.fehler.map((f) => ({ art: 'fehler', text: `${f.datei}: ${f.grund}` }));
    if (ergebnis.installiert.length) {
      meldungen.unshift({
        art: ergebnis.erfolg ? 'erfolg' : 'warnung',
        text: `${ergebnis.installiert.length} Vorgaben installiert. Lightroom bitte neu starten.`,
        knopf: { text: 'Ordner zeigen', aktion: () => lz.ordnerOeffnen(ergebnis.ziele.exportPresets) },
      });
    }
    zeigeMeldungen('presetMeldungen', meldungen);
  });
}

function pruefePresetKnopf() {
  const kuerzel = $('kuerzel');
  const jahrOk = /^\d{2}$/.test($('presetJahr').value.trim());
  const kuerzelOk = KUERZEL_MUSTER.test(kuerzel.value.trim());
  kuerzel.classList.toggle('ungueltig', kuerzel.value.trim() !== '' && !kuerzelOk);
  const hatAktive = zustand.vorgaben.some((v) => v.aktiv);
  $('btnPresets').disabled = !(jahrOk && kuerzelOk && hatAktive);
}

async function zeigeLightroomPfad() {
  zustand.lrPfade = await lz.lightroomPfade();
  $('lrPfad').textContent =
    `Ziel: ${zustand.lrPfade.exportPresets} · ${zustand.lrPfade.developPresets}`
    + `\nEigene Vorgaben: ${zustand.lrPfade.eigene}`;
}

function zeigeVorgaben(vorgaben) {
  zustand.vorgaben = vorgaben || [];
  const ziel = $('vorgabenListe');
  ziel.textContent = '';

  if (zustand.vorgaben.length === 0) {
    const zeile = document.createElement('tr');
    const zelle = document.createElement('td');
    zelle.colSpan = 6;
    zelle.className = 'leer';
    zelle.textContent = 'Keine Vorgaben vorhanden.';
    zeile.appendChild(zelle);
    ziel.appendChild(zeile);
    pruefePresetKnopf();
    return;
  }

  for (const vorgabe of zustand.vorgaben) ziel.appendChild(baueVorgabenZeile(vorgabe));
  pruefePresetKnopf();
}

function baueVorgabenZeile(vorgabe) {
  const zeile = document.createElement('tr');
  zeile.dataset.datei = vorgabe.datei;

  const zelle = (inhalt, klasse) => {
    const td = document.createElement('td');
    if (klasse) td.className = klasse;
    if (inhalt !== undefined) td.append(inhalt);
    zeile.appendChild(td);
    return td;
  };

  const anAus = document.createElement('input');
  anAus.type = 'checkbox';
  anAus.checked = vorgabe.aktiv;
  anAus.title = 'Beim Installieren berücksichtigen';
  anAus.addEventListener('change', async () => {
    const ergebnis = await lz.presetAktiv(vorgabe.datei, anAus.checked);
    zeigeVorgaben(ergebnis.vorgaben);
  });
  zelle(anAus, 'spalte-aktiv');

  const name = document.createElement('span');
  name.className = 'mono';
  name.textContent = vorgabe.datei;
  zelle(name);

  zelle(vorgabe.typ === 'export' ? 'Export' : 'Entwicklung');

  const quelle = document.createElement('span');
  quelle.className = `marke marke-${vorgabe.quelle}`;
  quelle.textContent = vorgabe.quelle === 'eigen' ? (vorgabe.ersetzt ? 'eigen (ersetzt)' : 'eigen') : 'mitgeliefert';
  zelle(quelle);

  // Nur Exportvorgaben tragen Bezeichnung und Kurzform in die Datei ein.
  if (vorgabe.typ === 'export') {
    const box = document.createElement('div');
    box.className = 'meta-felder';
    const lang = document.createElement('input');
    lang.type = 'text';
    lang.value = vorgabe.lang || '';
    lang.placeholder = 'Bezeichnung';
    lang.setAttribute('aria-label', `Bezeichnung für ${vorgabe.datei}`);
    const kurz = document.createElement('input');
    kurz.type = 'text';
    kurz.value = vorgabe.kurz || '';
    kurz.placeholder = 'Kurz';
    kurz.className = 'kurz';
    kurz.setAttribute('aria-label', `Kurzform für ${vorgabe.datei}`);

    const sichern = async () => {
      const ergebnis = await lz.presetMeta(vorgabe.datei, lang.value, kurz.value);
      zustand.vorgaben = ergebnis.vorgaben;
      pruefePresetKnopf();
    };
    lang.addEventListener('change', sichern);
    kurz.addEventListener('change', sichern);
    box.append(lang, kurz);
    zelle(box);
  } else {
    zelle('—', 'gedaempft');
  }

  const aktion = zelle(undefined, 'spalte-aktion');
  if (vorgabe.quelle === 'eigen') {
    const entfernen = document.createElement('button');
    entfernen.type = 'button';
    entfernen.className = 'knopf knopf-klein knopf-still';
    entfernen.textContent = 'Entfernen';
    entfernen.addEventListener('click', async () => {
      const ergebnis = await lz.presetEntfernen(vorgabe.datei);
      zeigeVorgaben(ergebnis.vorgaben);
      zeigeMeldungen('presetMeldungen', [
        ergebnis.ok
          ? {
              art: 'erfolg',
              text: ergebnis.wiederhergestellt
                ? `${vorgabe.datei} entfernt — die mitgelieferte Fassung gilt wieder.`
                : `${vorgabe.datei} entfernt.`,
            }
          : { art: 'fehler', text: `${vorgabe.datei}: ${ergebnis.grund}` },
      ]);
    });
    aktion.appendChild(entfernen);
  }

  return zeile;
}

// ---------------------------------------------------------------------------
// Hilfe und Einstellungen
// ---------------------------------------------------------------------------

function verdrahteHilfe() {
  $('optPapierkorb').addEventListener('change', () => merke({ inPapierkorb: $('optPapierkorb').checked }));

  $('btnEinstellungenZurueck').addEventListener('click', async () => {
    zustand.einstellungen = await lz.einstellungenZuruecksetzen();
    zustand.gruppen = zustand.einstellungen.gruppen;
    zustand.aufraeumKategorien = zustand.einstellungen.aufraeumKategorien;
    zustand.pfad = '';
    baueGruppenListe();
    baueKategorien();
    await waehleVorlage(zustand.einstellungen.vorlage, { stillSpeichern: true });
    await aktualisiereStruktur();
    zeigeMeldungen('hilfeMeldungen', [{ art: 'erfolg', text: 'Einstellungen zurückgesetzt.' }]);
  });
}

function zeigeWerkzeugStand() {
  const w = zustand.info.werkzeuge;
  const meldungen = [
    w.exiftool
      ? { art: 'erfolg', text: `exiftool gefunden (${w.exiftoolPfad}) — Aufnahmedaten werden zuverlässig gelesen.` }
      : {
          art: 'warnung',
          text: 'exiftool fehlt. Das Aufnahmedatum kommt dann nur aus Dateiname oder Änderungsdatum. '
            + 'Nachinstallieren mit „brew install exiftool" (macOS) bzw. von exiftool.org (Windows).',
        },
    w.pdftotext
      ? { art: 'erfolg', text: `pdftotext gefunden (${w.pdftotextPfad}) — PDF-Inhalte werden gelesen.` }
      : {
          art: 'warnung',
          text: 'pdftotext fehlt. PDF-Inhalte werden dann nicht gelesen, die Dateien landen unter „Scans ohne Textebene". '
            + 'Nachinstallieren mit „brew install poppler" (macOS) bzw. poppler-utils (Windows).',
        },
  ];
  zeigeMeldungen('werkzeugStand', meldungen);
  // Auf der Startseite nur melden, was fehlt — und die Kopflinie nur dann zeigen.
  const fehlend = meldungen.filter((m) => m.art === 'warnung');
  zeigeMeldungen('startHinweise', fehlend);
  $('startKopf').classList.toggle('leer', fehlend.length === 0);
}

init();
