'use strict';

/* global lz */
// Eigenständiges Importfenster. Ablauf wie bei FreeFileSync: Quelle und Ziel
// wählen, vergleichen, dann nur das Fehlende kopieren.

const $ = (id) => document.getElementById(id);

const KAT_LABEL = { neu: 'neu', gleich: 'vorhanden', anders: 'abweichend' };

const zustand = {
  config: null,
  vorlage: null,
  schemata: [],
  methoden: [],
  quelle: '',
  zielBasis: '',
  bereit: false,
};

/** Bereiche der Vorlage, in die sich importieren lässt: Tagesordner + Namensliste. */
const importBereiche = () => (zustand.vorlage ? zustand.vorlage.bereiche.filter((b) => b.tage && b.personenListe) : []);

/** Kachel mit Kennzahl und Beschriftung. */
function kachel(zahl, etikett, klasse = '') {
  const n = Number(zahl || 0).toLocaleString('de-DE');
  return `<div class="zahlkachel ${klasse}"><span class="zahl">${n}</span><span class="etikett">${etikett}</span></div>`;
}

function meldungen(liste) {
  const ziel = $('meldungen');
  ziel.textContent = '';
  for (const m of liste) {
    const div = document.createElement('div');
    div.className = `meldung meldung-${m.art}`;
    const text = document.createElement('span');
    text.textContent = m.text;
    div.appendChild(text);
    if (m.knopf) {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'knopf knopf-klein knopf-still';
      knopf.textContent = m.knopf.text;
      knopf.addEventListener('click', m.knopf.aktion);
      div.appendChild(knopf);
    }
    ziel.appendChild(div);
  }
}

async function init() {
  const info = await lz.importKontext();
  zustand.config = info.config;
  zustand.schemata = info.schemata;
  zustand.methoden = info.methoden;
  zustand.vorlage = info.vorlage;
  zustand.zielBasis = info.zielordner || '';

  $('werkzeugHinweis').innerHTML = info.exiftool
    ? 'ExifTool gefunden ✓ — Aufnahmedatum kommt aus den Metadaten.'
    : '<span class="warn">ExifTool nicht gefunden</span> — Datum aus Dateiname oder Änderungsdatum. Für zuverlässige Aufnahmedaten ExifTool installieren (exiftool.org).';

  fuelleSelect($('schema'), zustand.schemata.map((s) => ({ value: s.key, text: s.label })), '—');
  fuelleSelect($('methode'), zustand.methoden.map((m) => ({ value: m.key, text: m.label })), '—');

  $('schema').addEventListener('change', () => { setzeBereit(false); aktualisiereFelder(); });
  for (const id of ['sola', 'bereich', 'person', 'umbenennen', 'handy', 'methode']) {
    $(id).addEventListener('change', () => { setzeBereit(false); aktualisiereFelder(); });
  }

  $('btnGeraeteAktualisieren').addEventListener('click', geraeteLaden);
  $('btnQuelleOrdner').addEventListener('click', async () => {
    const pfad = await lz.ordnerWaehlen('Quellordner (Speicherkarte) wählen');
    if (pfad) setzeQuelle(pfad);
  });
  $('btnZielOrdner').addEventListener('click', async () => {
    const pfad = await lz.ordnerWaehlen('Zielordner wählen');
    if (pfad) { zustand.zielBasis = pfad; setzeBereit(false); aktualisiereFelder(); }
  });
  $('btnVergleichen').addEventListener('click', vergleichen);
  $('btnKopieren').addEventListener('click', kopieren);

  lz.aufImportFortschritt((d) => { $('fortschritt').textContent = d.text; });

  await geraeteLaden();
  aktualisiereFelder();
}

// ---- Geräte ----------------------------------------------------------------

async function geraeteLaden() {
  const liste = await lz.geraeteListe();
  const ziel = $('geraeteListe');
  ziel.textContent = '';
  if (!liste.length) {
    const p = document.createElement('p');
    p.className = 'hinweis';
    p.textContent = 'Keine Kamera / SD-Karte erkannt — Datenträger anstecken und „Geräte aktualisieren", oder „Ordner wählen".';
    ziel.appendChild(p);
    return;
  }
  for (const g of liste) {
    const karte = document.createElement('button');
    karte.type = 'button';
    karte.className = 'geraet';
    karte.dataset.pfad = g.pfad;
    const name = document.createElement('span');
    name.className = 'geraet-name';
    name.textContent = g.name;
    const info = document.createElement('span');
    info.className = 'geraet-info';
    info.textContent = g.kamera ? 'Kamera / SD-Karte (DCIM)' : g.pfad;
    karte.append(name, info);
    karte.addEventListener('click', () => setzeQuelle(g.pfad));
    ziel.appendChild(karte);
  }
}

function setzeQuelle(pfad) {
  zustand.quelle = pfad;
  $('quelleAnzeige').textContent = pfad || 'Noch keine Quelle gewählt';
  for (const karte of document.querySelectorAll('.geraet')) {
    karte.classList.toggle('aktiv', karte.dataset.pfad === pfad);
  }
  setzeBereit(false);
  aktualisiereFelder();
}

// ---- Ziel-/Schemafelder ----------------------------------------------------

function aktuellesSchema() {
  const key = $('schema').value;
  return zustand.schemata.find((s) => s.key === key) || zustand.schemata[0] || { key: '', braucht: [] };
}

function aktualisiereFelder() {
  const schema = aktuellesSchema();
  const brauchtSola = schema.braucht.includes('sola');
  $('schemaInfo').textContent = schema.beschreibung || '';
  $('solaFelder').hidden = !brauchtSola;
  $('handyWahl').hidden = !schema.braucht.includes('handy');
  $('zielAnzeige').textContent = zustand.zielBasis || 'Noch kein Zielordner gewählt';
  if (brauchtSola) fuelleSolaFelder();
  $('btnVergleichen').disabled = !kannVergleichen();
}

function fuelleSolaFelder() {
  const projektSel = $('sola');
  const aktive = zustand.vorlage.projekte.filter((p) => zustand.config[p.key] && zustand.config[p.key].aktiv);
  fuelleSelect(projektSel, aktive.map((p) => ({ value: p.key, text: p.titel })), 'Nichts angewählt');

  const daten = projektSel.value ? zustand.config[projektSel.value] : null;
  // Nur Bereiche anbieten, die angewählt sind und überhaupt Personenordner haben.
  const bereiche = daten
    ? importBereiche().filter((b) => daten.bereiche[b.key]).map((b) => ({ value: b.key, text: b.label }))
    : [];
  fuelleSelect($('bereich'), bereiche, 'Kein passender Bereich');

  const bereich = importBereiche().find((b) => b.key === $('bereich').value);
  const namen = daten && bereich
    ? daten[bereich.personenListe].filter(Boolean).map((n) => ({ value: n, text: n }))
    : [];
  fuelleSelect($('person'), namen, 'Keine Namen eingetragen');
}

function fuelleSelect(select, optionen, leerText) {
  const vorher = select.value;
  select.textContent = '';
  if (optionen.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = leerText;
    opt.disabled = true;
    select.appendChild(opt);
    select.value = '';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const o of optionen) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    select.appendChild(opt);
  }
  select.value = optionen.some((o) => o.value === vorher) ? vorher : optionen[0].value;
}

function kannVergleichen() {
  if (!zustand.quelle) return false;
  if (aktuellesSchema().braucht.includes('sola')) {
    return Boolean($('sola').value && $('bereich').value && $('person').value);
  }
  return true;
}

function baueKtx() {
  const schema = aktuellesSchema();
  if (schema.braucht.includes('sola')) {
    return { projektKey: $('sola').value, bereich: $('bereich').value, person: $('person').value, umbenennen: $('umbenennen').checked };
  }
  return { umbenennen: $('umbenennen').checked, unterordner: $('handy').checked ? '_Handy' : '' };
}

function setzeBereit(bereit) {
  zustand.bereit = bereit;
  $('btnKopieren').disabled = !bereit || !zustand.zielBasis;
}

// ---- Vergleichen und Kopieren ----------------------------------------------

async function vergleichen() {
  if (!kannVergleichen()) return;
  setzeBereit(false);
  $('kacheln').innerHTML = '';
  $('ergebnisBox').hidden = true;
  $('uebersprungenBox').hidden = true;
  $('fortschritt').textContent = 'Lese Quelle …';
  $('btnVergleichen').disabled = true;

  const antwort = await lz.importVergleichen({
    quelle: zustand.quelle,
    zielBasis: zustand.zielBasis,
    schema: aktuellesSchema().key,
    ktx: baueKtx(),
    config: zustand.config,
    methode: $('methode').value,
  });

  $('btnVergleichen').disabled = !kannVergleichen();
  if (!antwort.ok) {
    $('fortschritt').textContent = '';
    meldungen([{ art: 'fehler', text: antwort.fehler }]);
    return;
  }

  meldungen((antwort.warnungen || []).map((text) => ({ art: 'warnung', text })));

  const k = antwort.kategorien;
  $('kacheln').innerHTML =
    kachel(antwort.gefunden, 'gefunden') +
    kachel(k.neu, 'neu → kopieren', 'zahlkachel-neu') +
    kachel(k.gleich, 'schon vorhanden', 'zahlkachel-gleich') +
    kachel(k.anders, 'abweichend', 'zahlkachel-anders');

  zeigeErgebnis(antwort.eintraege || []);

  const usp = antwort.uebersprungenDatum || [];
  $('uebersprungenBox').hidden = usp.length === 0;
  $('uebersprungenAnzahl').textContent = usp.length ? `(${usp.length})` : '';
  $('uebersprungenListe').textContent = usp.join('\n');

  if (!antwort.zielBekannt) {
    $('fortschritt').textContent = 'Bitte noch einen Zielordner wählen, dann lässt sich kopieren.';
  } else if (k.neu + k.anders === 0) {
    $('fortschritt').textContent = antwort.gefunden ? 'Alles schon vorhanden — nichts zu kopieren.' : 'Nichts gefunden.';
  } else {
    setzeBereit(true);
    $('fortschritt').textContent = `Bereit: ${k.neu + k.anders} Dateien zu kopieren.`;
  }
}

function zeigeErgebnis(eintraege) {
  const koerper = $('ergebnisListe');
  koerper.textContent = '';
  for (const e of eintraege) {
    const tr = document.createElement('tr');
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `kat kat-${e.kategorie}`;
    badge.textContent = KAT_LABEL[e.kategorie] || e.kategorie;
    status.appendChild(badge);
    const datei = document.createElement('td');
    datei.className = 'mono';
    datei.textContent = e.name;
    const datum = document.createElement('td');
    datum.textContent = `${e.datum} (${e.quelle})`;
    const ziel = document.createElement('td');
    ziel.className = 'mono';
    ziel.textContent = e.ziel;
    tr.append(status, datei, datum, ziel);
    koerper.appendChild(tr);
  }
  $('ergebnisBox').hidden = eintraege.length === 0;
}

async function kopieren() {
  if (!zustand.bereit || !zustand.zielBasis) return;
  $('btnKopieren').disabled = true;
  $('btnVergleichen').disabled = true;
  $('fortschritt').textContent = 'Kopiere …';

  const antwort = await lz.importKopieren({
    zielBasis: zustand.zielBasis,
    verschieben: $('verschieben').checked,
    methode: $('methode').value,
  });

  $('btnVergleichen').disabled = !kannVergleichen();
  zustand.bereit = false;
  if (!antwort.ok) {
    $('fortschritt').textContent = '';
    meldungen([{ art: 'fehler', text: antwort.fehler }]);
    return;
  }

  const liste = antwort.fehler.map((f) => ({ art: 'fehler', text: `${f.von || ''}: ${f.grund}` }));
  liste.unshift({
    art: antwort.fehler.length ? 'warnung' : 'erfolg',
    text: `${antwort.erledigt} Dateien ${antwort.modus}` + (antwort.uebersprungen ? `, ${antwort.uebersprungen} schon vorhanden` : '') + '.',
    knopf: { text: 'Zielordner zeigen', aktion: () => lz.ordnerOeffnen(zustand.zielBasis) },
  });
  meldungen(liste);
  $('fortschritt').textContent = antwort.protokoll ? `Fertig — Protokoll: ${antwort.protokoll}` : 'Fertig.';
  $('ergebnisBox').hidden = true;
}

init();
