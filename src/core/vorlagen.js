'use strict';

/**
 * Vorlagen beschreiben einen Ordnerbaum als Daten – nicht als Code.
 *
 * Damit lässt sich dieselbe App für das Sola benutzen wie für ein privates
 * Fotoprojekt, einen Urlaub oder einen Auftrag: Wer eine andere Struktur
 * braucht, ändert die Vorlage in der Oberfläche, nicht den Quelltext.
 *
 * Aufbau einer Vorlage:
 *
 *   Wurzel          ein Musterordner, z.B. `Sola_{jahr}` oder `{name}_{jahr}`
 *   Projekte        die Blöcke unterhalb der Wurzel (beim Sola: Teens, Kids …)
 *   Namenslisten    Personenlisten, die die Projekte füllen (Foto, Video …)
 *   Bereiche        was ein Projekt enthalten kann (Foto, Video, Orga …)
 *
 * Ein Bereich kann Tagesordner anlegen, feste Unterordner bekommen und je
 * Person einen eigenen Ordner mit eigenen Unterordnern.
 */

const { berechneWoche, normalisiereTage, SOLA_TAGE } = require('./dates');
const { sanitizeSegment, compactNames } = require('./validate');

/** Wie viele Namen eine Namensliste maximal fasst. */
const ANZAHL_NAMEN = 10;

/** `1` -> `01` */
const nr2 = (n) => String(n).padStart(2, '0');

/**
 * Setzt Platzhalter in einem Ordnermuster ein.
 *
 * Bekannt sind `{jahr}`, `{name}`, `{projekt}`, `{bereich}`, `{nr}`, `{nr2}`,
 * `{tag}`, `{datum}`, `{person}`. Ist ein Wert leer, fällt das Trennzeichen
 * davor mit weg – aus `{nr}_Tag_{datum}` wird ohne Datum schlicht `1_Tag`.
 *
 * @param {string} muster
 * @param {Object<string, string|number>} werte
 * @returns {string}
 */
function fuelleMuster(muster, werte) {
  return String(muster == null ? '' : muster)
    .replace(/([_\-. ])?\{(\w+)\}/g, (_ganz, trenner, schluessel) => {
      const wert = werte[schluessel];
      if (wert === undefined || wert === null || wert === '') return '';
      return `${trenner || ''}${wert}`;
    })
    // Stand der erste Platzhalter am Anfang und blieb leer, hängt sein
    // Trennzeichen sonst vorne: aus `{jahr}_{name}` würde `_Urlaub`.
    .replace(/^[_\-. ]+/, '');
}

/**
 * @typedef {Object} VorlageBereich
 * @property {string}   key
 * @property {string}   label
 * @property {boolean}  [tage]               Tagesordner anlegen?
 * @property {string}   [tagMuster]          Name der Tagesordner
 * @property {string[]} [tagUnterordner]     feste Ordner in jedem Tagesordner
 * @property {string[]} [unterordner]        feste Ordner im Bereich (ohne Tage)
 * @property {string}   [personenListe]      Schlüssel der Namensliste
 * @property {string}   [personenIn]         in welchem Unterordner die Personen liegen
 * @property {string[]} [personenUnterordner]
 * @property {Array<{name: string, personenListe?: string, personenUnterordner?: string[]}>} [festeOrdner]
 *           Ordner, die einmalig neben den Tagesordnern liegen (z.B. `LR Kataloge`)
 */

/**
 * @typedef {Object} Vorlage
 * @property {string}  id
 * @property {string}  name
 * @property {string}  beschreibung
 * @property {string}  wurzel               Muster des Wurzelordners
 * @property {boolean} [jahrNutzen]         Jahr abfragen und aus Startdaten ermitteln
 * @property {boolean} [nameNutzen]         freien Projektnamen abfragen
 * @property {boolean} [nummeriereBereiche] Bereiche als `01_Foto` nummerieren
 * @property {number}  [standardTage]
 * @property {Array<{key: string, label: string}>} namenslisten
 * @property {Array<{key: string, label: string, titel: string, ordner: string}>} projekte
 * @property {VorlageBereich[]} bereiche
 * @property {boolean} [eingebaut]          mitgeliefert (nicht löschbar)
 */

// ---------------------------------------------------------------------------
// Mitgelieferte Vorlagen
// ---------------------------------------------------------------------------

/** Die Sola-Struktur des Multimedia-Teams — unverändert wie bisher. */
const VORLAGE_SOLA = {
  id: 'sola',
  name: 'Sola (Multimedia-Team)',
  beschreibung:
    'Die gewohnte Sola-Struktur: Teens, Kids, SOFA und Sola next mit Tagesordnern, ' +
    'Foto- und Videoordnern je Person und den Lightroom-Katalogen.',
  wurzel: 'Sola_{jahr}',
  jahrNutzen: true,
  nameNutzen: false,
  nummeriereBereiche: true,
  standardTage: SOLA_TAGE,
  eingebaut: true,
  namenslisten: [
    { key: 'fotografen', label: 'Fotograf:innen' },
    { key: 'videografen', label: 'Videograf:innen' },
  ],
  projekte: [
    { key: 'teens', label: 'Teens', titel: 'Teensola', ordner: '01_Teens' },
    { key: 'kids', label: 'Kids', titel: 'Kidssola', ordner: '02_Kids' },
    { key: 'sofa', label: 'SOFA', titel: 'SOFA', ordner: '03_SOFA' },
    { key: 'next', label: 'Sola next', titel: 'Sola next', ordner: '04_Sola_next' },
  ],
  bereiche: [
    {
      key: 'foto',
      label: 'Foto',
      tage: true,
      tagMuster: '{nr}_Tag_{datum}',
      tagUnterordner: [
        '01_Bilder_des_Tages_{nr}_HQ',
        '02_Bilder_des_Tages_{nr}_LQ',
        '03_Auswahl Bilderclip',
        '04_Auswahl Musik',
      ],
      personenListe: 'fotografen',
      personenIn: '',
      personenUnterordner: ['01_ImportRAW', '02_ExportJPEG_HQ', '03_ExportJPEG_LQ', '04_ExportRAW'],
      festeOrdner: [{ name: 'LR Kataloge', personenListe: 'fotografen', personenUnterordner: [] }],
    },
    {
      key: 'video',
      label: 'Video',
      tage: true,
      tagMuster: '{nr}_Tag_{datum}',
      tagUnterordner: ['01_Rohvideos', '02_Projektdatein', '03_Audio-Musik'],
      personenListe: 'videografen',
      personenIn: '01_Rohvideos',
      personenUnterordner: [],
    },
    { key: 'showfiles', label: 'Showfiles', tage: true, tagMuster: '{nr}_Tag_{datum}' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'grafik', label: 'Grafik' },
    { key: 'audio', label: 'Audio', tage: true, tagMuster: '{nr}_Tag_{datum}' },
    { key: 'orga', label: 'Orga' },
    { key: 'allgemein', label: 'Allgemein' },
  ],
};

/** Ein privates Foto- oder Filmprojekt — ein Block, klare Ordner, keine Tage. */
const VORLAGE_PROJEKT = {
  id: 'projekt',
  name: 'Projekt (Foto oder Film)',
  beschreibung:
    'Ein einzelnes Projekt: Aufnahmen, Bearbeitung, fertige Dateien und Unterlagen. ' +
    'Ohne Tagesordner — gut für ein Shooting, einen Dreh oder einen Auftrag.',
  wurzel: '{jahr}_{name}',
  jahrNutzen: true,
  nameNutzen: true,
  nummeriereBereiche: true,
  standardTage: 1,
  eingebaut: true,
  namenslisten: [{ key: 'personen', label: 'Beteiligte' }],
  projekte: [{ key: 'projekt', label: 'Projekt', titel: 'Projekt', ordner: '' }],
  bereiche: [
    {
      key: 'foto',
      label: 'Foto',
      unterordner: ['01_Original', '02_Auswahl', '03_Bearbeitet', '04_Export'],
      personenListe: 'personen',
      personenUnterordner: ['01_Original', '02_Export'],
    },
    { key: 'video', label: 'Video', unterordner: ['01_Rohvideos', '02_Ton', '03_Schnittprojekt', '04_Export'] },
    { key: 'grafik', label: 'Grafik', unterordner: ['01_Vorlagen', '02_Export'] },
    { key: 'unterlagen', label: 'Unterlagen', unterordner: ['01_Vertraege', '02_Freigaben', '03_Rechnungen'] },
    { key: 'allgemein', label: 'Allgemein' },
  ],
};

/** Urlaub, Freizeit, Veranstaltung — alles nach Tagen. */
const VORLAGE_REISE = {
  id: 'reise',
  name: 'Reise oder Veranstaltung (nach Tagen)',
  beschreibung:
    'Für Urlaub, Freizeit oder eine mehrtägige Veranstaltung: je Tag ein Ordner, ' +
    'darin Fotos, Videos und Sonstiges.',
  wurzel: '{jahr}_{name}',
  jahrNutzen: true,
  nameNutzen: true,
  nummeriereBereiche: false,
  standardTage: 7,
  eingebaut: true,
  namenslisten: [{ key: 'personen', label: 'Beteiligte' }],
  projekte: [{ key: 'reise', label: 'Reise', titel: 'Reise', ordner: '' }],
  bereiche: [
    {
      key: 'tage',
      label: 'Tage',
      tage: true,
      tagMuster: 'Tag_{nr2}_{datum}',
      tagUnterordner: ['Fotos', 'Videos', 'Sonstiges'],
      personenListe: 'personen',
      personenIn: 'Fotos',
      personenUnterordner: [],
    },
    { key: 'auswahl', label: 'Auswahl', unterordner: ['Beste Bilder', 'Fuer den Film'] },
    { key: 'unterlagen', label: 'Unterlagen' },
  ],
};

/** Privatarchiv: ein Ort für Fotos, Dokumente und Papierkram. */
const VORLAGE_PRIVAT = {
  id: 'privat',
  name: 'Privates Archiv',
  beschreibung:
    'Eine Grundordnung für den eigenen Rechner: Fotos, Dokumente, Finanzen und ' +
    'Sonstiges. Passt zu den Sachgruppen, die das Einsortieren der Dokumente benutzt.',
  wurzel: '{name}',
  jahrNutzen: false,
  nameNutzen: true,
  nummeriereBereiche: false,
  standardTage: 1,
  eingebaut: true,
  namenslisten: [],
  projekte: [{ key: 'archiv', label: 'Archiv', titel: 'Archiv', ordner: '' }],
  bereiche: [
    { key: 'fotos', label: 'Fotos' },
    { key: 'videos', label: 'Videos' },
    {
      key: 'dokumente',
      label: 'Dokumente',
      unterordner: [
        'Rechnungen',
        'Vertraege und Versicherungen',
        'Steuer und Finanzen',
        'Behoerden und Amtliches',
        'Medizin und Gesundheit',
        'Schule und Ausbildung',
        'Bewerbung',
        'Anleitungen und Handbuecher',
      ],
    },
    { key: 'sonstiges', label: 'Sonstiges' },
  ],
};

/** Leere Vorlage — Ausgangspunkt für eine eigene Struktur. */
const VORLAGE_LEER = {
  id: 'leer',
  name: 'Eigene Struktur',
  beschreibung: 'Leerer Ausgangspunkt. Ordner, Bereiche und Namen komplett selbst festlegen.',
  wurzel: '{name}',
  jahrNutzen: false,
  nameNutzen: true,
  nummeriereBereiche: false,
  standardTage: 1,
  eingebaut: true,
  namenslisten: [],
  projekte: [{ key: 'projekt', label: 'Projekt', titel: 'Projekt', ordner: '' }],
  bereiche: [{ key: 'ordner1', label: 'Neuer Ordner' }],
};

const EINGEBAUTE_VORLAGEN = [VORLAGE_SOLA, VORLAGE_PROJEKT, VORLAGE_REISE, VORLAGE_PRIVAT, VORLAGE_LEER];

/** @returns {Vorlage[]} tiefe Kopien, damit niemand die Originale verändert */
function eingebauteVorlagen() {
  return EINGEBAUTE_VORLAGEN.map((v) => normalisiereVorlage(v));
}

/** @param {string} id @returns {Vorlage|null} */
function eingebauteVorlage(id) {
  const treffer = EINGEBAUTE_VORLAGEN.find((v) => v.id === id);
  return treffer ? normalisiereVorlage(treffer) : null;
}

// ---------------------------------------------------------------------------
// Vorlagen prüfen und auffüllen
// ---------------------------------------------------------------------------

const alsListe = (wert) => (Array.isArray(wert) ? wert.map((e) => String(e || '').trim()).filter(Boolean) : []);

/** Füllt fehlende Felder einer Vorlage auf und gibt eine eigenständige Kopie zurück. */
function normalisiereVorlage(roh) {
  const v = roh || {};
  const namenslisten = (Array.isArray(v.namenslisten) ? v.namenslisten : [])
    .map((l, i) => ({ key: String(l.key || `liste${i + 1}`), label: String(l.label || `Liste ${i + 1}`) }))
    .filter((l, i, alle) => alle.findIndex((x) => x.key === l.key) === i);
  const listenSchluessel = new Set(namenslisten.map((l) => l.key));

  const bereiche = (Array.isArray(v.bereiche) ? v.bereiche : []).map((b, i) => {
    const key = String(b.key || `bereich${i + 1}`);
    const personenListe = listenSchluessel.has(String(b.personenListe || '')) ? String(b.personenListe) : '';
    const tage = Boolean(b.tage);
    const tagUnterordner = alsListe(b.tagUnterordner);
    const personenIn = String(b.personenIn || '');
    return {
      key,
      label: String(b.label || key),
      tage,
      tagMuster: String(b.tagMuster || '{nr}_Tag_{datum}'),
      tagUnterordner,
      unterordner: alsListe(b.unterordner),
      personenListe,
      // Der Personenordner muss in einem Ordner liegen, den es auch gibt.
      personenIn: tage
        ? (tagUnterordner.includes(personenIn) ? personenIn : '')
        : (alsListe(b.unterordner).includes(personenIn) ? personenIn : ''),
      personenUnterordner: alsListe(b.personenUnterordner),
      festeOrdner: (Array.isArray(b.festeOrdner) ? b.festeOrdner : [])
        .map((f) => ({
          name: String(f.name || '').trim(),
          personenListe: listenSchluessel.has(String(f.personenListe || '')) ? String(f.personenListe) : '',
          personenUnterordner: alsListe(f.personenUnterordner),
        }))
        .filter((f) => f.name),
    };
  });

  const projekte = (Array.isArray(v.projekte) && v.projekte.length ? v.projekte : [{ key: 'projekt', label: 'Projekt' }])
    .map((p, i) => {
      const key = String(p.key || `projekt${i + 1}`);
      return {
        key,
        label: String(p.label || key),
        titel: String(p.titel || p.label || key),
        ordner: String(p.ordner == null ? '' : p.ordner),
      };
    })
    .filter((p, i, alle) => alle.findIndex((x) => x.key === p.key) === i);

  return {
    id: String(v.id || 'eigen'),
    name: String(v.name || 'Ohne Namen'),
    beschreibung: String(v.beschreibung || ''),
    wurzel: String(v.wurzel == null ? '{name}' : v.wurzel),
    jahrNutzen: v.jahrNutzen !== false,
    nameNutzen: Boolean(v.nameNutzen),
    nummeriereBereiche: v.nummeriereBereiche !== false,
    standardTage: normalisiereTage(v.standardTage, SOLA_TAGE),
    eingebaut: Boolean(v.eingebaut),
    namenslisten,
    projekte,
    bereiche,
  };
}

/**
 * Leere Konfiguration zu einer Vorlage — Ausgangspunkt der Oberfläche.
 * @param {Vorlage} vorlage
 */
function leereConfig(vorlage) {
  const v = normalisiereVorlage(vorlage);
  const config = { vorlage: v.id, jahr: '', name: '' };
  for (const projekt of v.projekte) {
    const eintrag = {
      aktiv: false,
      start: '',
      tage: v.standardTage,
      bereiche: Object.fromEntries(v.bereiche.map((b) => [b.key, false])),
    };
    for (const liste of v.namenslisten) eintrag[liste.key] = Array(ANZAHL_NAMEN).fill('');
    config[projekt.key] = eintrag;
  }
  return config;
}

/** Füllt fehlende Felder einer Konfiguration auf und räumt die Namenslisten auf. */
function normalisiereConfig(config, vorlage) {
  const v = normalisiereVorlage(vorlage);
  const quelle = config || {};
  const ergebnis = {
    vorlage: String(quelle.vorlage || v.id),
    jahr: String(quelle.jahr || ''),
    name: String(quelle.name || ''),
  };
  for (const projekt of v.projekte) {
    const src = quelle[projekt.key] || {};
    const eintrag = {
      aktiv: Boolean(src.aktiv),
      start: String(src.start || ''),
      tage: normalisiereTage(src.tage, v.standardTage),
      bereiche: Object.fromEntries(v.bereiche.map((b) => [b.key, Boolean((src.bereiche || {})[b.key])])),
    };
    for (const liste of v.namenslisten) eintrag[liste.key] = compactNames(src[liste.key], ANZAHL_NAMEN);
    ergebnis[projekt.key] = eintrag;
  }
  return ergebnis;
}

// ---------------------------------------------------------------------------
// Aus Vorlage + Konfiguration wird der Ordnerbaum
// ---------------------------------------------------------------------------

/**
 * Baut den Ordnerbaum als flache, sortierte Liste relativer Pfade.
 * Rein rechnerisch — es wird nichts auf die Platte geschrieben, damit die
 * Vorschau und das spätere Anlegen garantiert dasselbe Ergebnis haben.
 *
 * @param {Vorlage} vorlage
 * @param {object} config
 * @param {{jahr?: string}} [ermittelt] bereits bestimmtes Jahr (siehe structure.js)
 * @returns {{ordner: string[], wurzel: string, warnungen: string[]}}
 */
function baueOrdner(vorlage, config, ermittelt = {}) {
  const v = normalisiereVorlage(vorlage);
  const cfg = normalisiereConfig(config, v);
  const warnungen = [];

  const jahr = String(ermittelt.jahr != null ? ermittelt.jahr : cfg.jahr || '').trim();
  const name = cfg.name.trim();

  const wurzel = sanitizeSegment(fuelleMuster(v.wurzel, { jahr, name, projekt: name }));
  if (!wurzel) {
    warnungen.push(
      v.nameNutzen && !name
        ? 'Bitte einen Namen für den Hauptordner eingeben.'
        : 'Der Hauptordner lässt sich nicht bestimmen — bitte Jahr oder Namen angeben.',
    );
    return { ordner: [], wurzel: '', warnungen };
  }

  /** @type {Set<string>} */
  const ordner = new Set([wurzel]);

  /** Hängt bereinigte Segmente an einen schon bereinigten Pfad an. */
  const add = (eltern, ...segmente) => {
    const pfad = [eltern, ...segmente.map((s) => sanitizeSegment(s))].filter(Boolean).join('/');
    ordner.add(pfad);
    return pfad;
  };

  /**
   * Legt die Personenordner in `elternPfad` an. Die Nummerierung setzt die
   * schon vorhandenen Ordner fort — so stehen beim Sola die Fotograf:innen
   * hinter den vier festen Tagesordnern, im leeren `01_Rohvideos` aber ab 01.
   */
  const personenAnlegen = (elternPfad, namen, unterordner, schonVorhanden, muster) => {
    namen.forEach((person, i) => {
      const ordnerName = muster
        ? fuelleMuster(muster, { nr: i + 1 + schonVorhanden, nr2: nr2(i + 1 + schonVorhanden), person })
        : `${nr2(i + 1 + schonVorhanden)}_${person}`;
      const pfad = add(elternPfad, ordnerName);
      for (const unter of unterordner) add(pfad, unter);
    });
  };

  for (const projekt of v.projekte) {
    const auswahl = cfg[projekt.key];
    if (!auswahl.aktiv) continue;

    const gewaehlt = v.bereiche.filter((b) => auswahl.bereiche[b.key]);
    if (gewaehlt.length === 0) {
      warnungen.push(`${projekt.titel}: kein Bereich angewählt — es wird nur der Projektordner angelegt.`);
    }

    const anzahlTage = auswahl.tage;
    const tage = berechneWoche(auswahl.start, anzahlTage);
    const brauchtTage = gewaehlt.some((b) => b.tage);
    if (brauchtTage && tage.length === 0) {
      warnungen.push(`${projekt.titel}: kein gültiges Startdatum — Tagesordner werden ohne Datum benannt.`);
    }

    const basis = projekt.ordner ? add(wurzel, projekt.ordner) : wurzel;

    gewaehlt.forEach((bereich, index) => {
      const bereichName = v.nummeriereBereiche ? `${nr2(index + 1)}_${bereich.label}` : bereich.label;
      const bereichsPfad = add(basis, bereichName);
      const namen = bereich.personenListe ? auswahl[bereich.personenListe].filter(Boolean) : [];

      if (bereich.tage) {
        for (let tag = 1; tag <= anzahlTage; tag += 1) {
          const werte = { nr: tag, nr2: nr2(tag), tag, datum: tage[tag - 1] || '', bereich: bereich.label };
          const tagPfad = add(bereichsPfad, fuelleMuster(bereich.tagMuster, werte));
          const feste = bereich.tagUnterordner.map((m) => fuelleMuster(m, werte));
          for (const fest of feste) add(tagPfad, fest);

          if (namen.length) {
            const elternPfad = bereich.personenIn
              ? `${tagPfad}/${sanitizeSegment(fuelleMuster(bereich.personenIn, werte))}`
              : tagPfad;
            // Im eigenen Unterordner zählen die Personen ab 1, direkt im
            // Tagesordner hinter den festen Ordnern weiter.
            const schon = bereich.personenIn ? 0 : feste.length;
            personenAnlegen(elternPfad, namen, bereich.personenUnterordner, schon);
          }
        }
      } else {
        const feste = bereich.unterordner.map((m) => fuelleMuster(m, { bereich: bereich.label }));
        for (const fest of feste) add(bereichsPfad, fest);
        if (namen.length) {
          const elternPfad = bereich.personenIn
            ? `${bereichsPfad}/${sanitizeSegment(bereich.personenIn)}`
            : bereichsPfad;
          const schon = bereich.personenIn ? 0 : feste.length;
          personenAnlegen(elternPfad, namen, bereich.personenUnterordner, schon);
        }
      }

      // Ordner, die einmalig neben den Tagesordnern liegen (z.B. LR Kataloge).
      for (const fest of bereich.festeOrdner) {
        const festPfad = add(bereichsPfad, fest.name);
        const festNamen = fest.personenListe ? auswahl[fest.personenListe].filter(Boolean) : [];
        if (festNamen.length) personenAnlegen(festPfad, festNamen, fest.personenUnterordner, 0);
      }
    });
  }

  return { ordner: [...ordner].sort(), wurzel, warnungen };
}

/**
 * Ermittelt je Tag den Zielordner, in den die Dateien einer Person importiert
 * werden. Benutzt dieselben Bausteine wie {@link baueOrdner} — der Import
 * landet damit garantiert in den Ordnern, die die App auch anlegt.
 *
 * @param {Vorlage} vorlage
 * @param {object} config
 * @param {{projektKey: string, bereich: string, person: string, jahr?: string}} auswahl
 * @returns {{projekt: string, person: string|null, ziele: Object<string, string>, warnungen: string[]}}
 */
function importZiele(vorlage, config, auswahl) {
  const v = normalisiereVorlage(vorlage);
  const cfg = normalisiereConfig(config, v);
  const warnungen = [];
  const leer = { projekt: '', person: null, ziele: {}, warnungen };

  const projekt = v.projekte.find((p) => p.key === auswahl.projektKey);
  if (!projekt) {
    warnungen.push('Unbekanntes Projekt gewählt.');
    return leer;
  }
  leer.projekt = projekt.titel;
  const a = cfg[projekt.key];

  const jahr = String(auswahl.jahr != null ? auswahl.jahr : cfg.jahr || '').trim();
  const wurzel = sanitizeSegment(fuelleMuster(v.wurzel, { jahr, name: cfg.name.trim(), projekt: cfg.name.trim() }));
  if (!wurzel) {
    warnungen.push('Der Hauptordner lässt sich nicht bestimmen — bitte Jahr oder Namen angeben.');
    return leer;
  }

  const bereich = v.bereiche.find((b) => b.key === auswahl.bereich);
  const gewaehlt = v.bereiche.filter((b) => a.bereiche[b.key]);
  const bereichIndex = gewaehlt.findIndex((b) => b.key === auswahl.bereich);
  if (!bereich || !bereich.tage || !bereich.personenListe) {
    warnungen.push('Import gibt es nur für Bereiche mit Tagesordnern und Namensliste.');
    return leer;
  }
  if (bereichIndex === -1) {
    warnungen.push(`${projekt.titel}: Bereich ${bereich.label} ist nicht angewählt — bitte oben aktivieren.`);
    return leer;
  }
  const bereichName = v.nummeriereBereiche ? `${nr2(bereichIndex + 1)}_${bereich.label}` : bereich.label;

  const liste = a[bereich.personenListe].filter(Boolean);
  const personIndex = liste.indexOf(String(auswahl.person || '').trim());
  if (personIndex === -1) {
    warnungen.push(`${projekt.titel}: „${auswahl.person}“ steht nicht in der ${bereich.label}-Namensliste.`);
    return leer;
  }
  const person = liste[personIndex];

  const tage = berechneWoche(a.start, a.tage);
  if (tage.length === 0) {
    warnungen.push(`${projekt.titel}: kein gültiges Startdatum — Tage lassen sich nicht bestimmen.`);
    return { ...leer, person };
  }

  const seg = (...teile) => teile.map((t) => sanitizeSegment(t)).filter(Boolean).join('/');
  const ziele = {};
  tage.forEach((datum, i) => {
    const werte = { nr: i + 1, nr2: nr2(i + 1), tag: i + 1, datum, bereich: bereich.label };
    const schon = bereich.personenIn ? 0 : bereich.tagUnterordner.length;
    const personOrdner = `${nr2(personIndex + 1 + schon)}_${person}`;
    ziele[datum] = seg(
      wurzel,
      projekt.ordner,
      bereichName,
      fuelleMuster(bereich.tagMuster, werte),
      bereich.personenIn ? fuelleMuster(bereich.personenIn, werte) : '',
      personOrdner,
      bereich.personenUnterordner[0] || '',
    );
  });

  return { projekt: projekt.titel, person, ziele, warnungen };
}

module.exports = {
  ANZAHL_NAMEN,
  VORLAGE_SOLA,
  EINGEBAUTE_VORLAGEN,
  eingebauteVorlagen,
  eingebauteVorlage,
  normalisiereVorlage,
  leereConfig,
  normalisiereConfig,
  baueOrdner,
  importZiele,
  fuelleMuster,
};
