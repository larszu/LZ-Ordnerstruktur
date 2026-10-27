'use strict';

/**
 * Sicherungsaufträge als Hintergrundarbeit.
 *
 * Niemand will neben einem Fortschrittsbalken sitzen. Deshalb ist das Kopieren
 * hier ein Auftrag mit eigenem Leben: Er wandert in eine Warteschlange, läuft
 * weiter, wenn das Fenster zu ist, kopiert jede Karte auf alle Ziele und meldet
 * sich erst fertig, wenn **jedes** Ziel nachgeprüft ist.
 *
 * Reines Modul: Das eigentliche Kopieren wird als Funktion hereingegeben
 * (`arbeite`). So lässt sich die Warteschlange ohne Karte und ohne Platte
 * testen — und der Hauptprozess bleibt frei von Ablauflogik.
 */

const { ROLLEN_KEYS, rolleLabel } = require('./ziele');

/** Zustände eines Auftrags und seiner Ziele. */
const STATUS = {
  WARTET: 'wartet',
  LAEUFT: 'laeuft',
  FERTIG: 'fertig',
  FEHLER: 'fehler',
  ABGEBROCHEN: 'abgebrochen',
};

const ENDZUSTAENDE = new Set([STATUS.FERTIG, STATUS.FEHLER, STATUS.ABGEBROCHEN]);

let zaehler = 0;
const neueId = () => {
  zaehler += 1;
  return `a${Date.now().toString(36)}-${zaehler}`;
};

/** Ein Ziel im Auftrag: Rolle, Stand, Zahlen. */
function zielSatz(ziel) {
  return {
    pfad: ziel.pfad,
    name: ziel.name || ziel.pfad,
    rolle: ROLLEN_KEYS.includes(ziel.rolle) ? ziel.rolle : 'sicherung',
    status: STATUS.WARTET,
    erledigt: 0,
    uebersprungen: 0,
    geprueft: 0,
    fehlend: null,
    fehler: [],
  };
}

/** Liegt die Karte vollständig auf allen Zielen? Nur dann darf sie gelöscht werden. */
function alleGeprueft(auftrag) {
  if (!auftrag || auftrag.ziele.length === 0) return false;
  return auftrag.ziele.every((z) => z.status === STATUS.FERTIG && z.fehlend === 0);
}

/** Die Ziele, die noch nicht vollständig geprüft sind. */
function offeneZiele(auftrag) {
  return auftrag.ziele.filter((z) => z.status !== STATUS.FERTIG || z.fehlend !== 0);
}

/**
 * Der Satz, der am Drehtag wirklich zählt. Keine Prozentzahl, sondern eine
 * Auskunft: darf die Karte formatiert werden oder nicht.
 * @param {object} auftrag
 * @returns {{text: string, art: 'warnung'|'erfolg'|'info'|'fehler', formatieren: boolean}}
 */
function satzFuer(auftrag) {
  if (!auftrag) return { text: '', art: 'info', formatieren: false };
  const name = auftrag.quelleName || 'Karte';
  const gesamt = auftrag.gesamt || 0;
  const offen = offeneZiele(auftrag);
  const namen = offen.map((z) => z.name).join(' und ');

  if (auftrag.status === STATUS.FEHLER) {
    return { text: `${name}: ${auftrag.fehlerText || 'Sicherung fehlgeschlagen'} — nicht formatieren.`, art: 'fehler', formatieren: false };
  }
  if (auftrag.status === STATUS.ABGEBROCHEN) {
    return {
      text: `${name}: abgebrochen. Was geprüft ist, bleibt gültig — ${namen ? `offen bleibt ${namen}` : 'alle Ziele sind durch'}. Nicht formatieren.`,
      art: 'warnung',
      formatieren: false,
    };
  }
  if (alleGeprueft(auftrag)) {
    const zielNamen = auftrag.ziele.map((z) => z.name).join(' und ');
    return {
      text: `${name}: ${gesamt} von ${gesamt} Dateien auf ${zielNamen} geprüft — die Karte kann formatiert werden.`,
      art: 'erfolg',
      formatieren: true,
    };
  }
  if (auftrag.status === STATUS.LAEUFT) {
    const dran = auftrag.ziele.find((z) => z.status === STATUS.LAEUFT);
    return {
      text: `${name}: wird auf ${dran ? dran.name : namen} gesichert — nicht formatieren.`,
      art: 'warnung',
      formatieren: false,
    };
  }
  // Nicht summieren: dieselbe Datei, die auf zwei Zielen fehlt, fehlt einmal.
  // Maßgeblich ist das Ziel, auf dem am meisten fehlt.
  const fehlend = Math.max(0, ...offen.map((z) => (z.fehlend === null ? gesamt : z.fehlend)));
  return {
    text: `${name}: ${fehlend} von ${gesamt} Dateien ${namen ? `noch nicht auf ${namen}` : 'noch nicht gesichert'} — nicht formatieren.`,
    art: 'warnung',
    formatieren: false,
  };
}

/** Kurzfassung für Menüleiste und Tooltip. */
function kurzfassung(auftrag) {
  if (!auftrag) return '';
  const name = auftrag.quelleName || 'Karte';
  if (auftrag.status === STATUS.WARTET) return `${name} — wartet`;
  if (auftrag.status === STATUS.LAEUFT) {
    const dran = auftrag.ziele.find((z) => z.status === STATUS.LAEUFT);
    const fertig = auftrag.ziele.filter((z) => z.status === STATUS.FERTIG).length;
    return `${name} — ${dran ? dran.name : '…'} (${fertig + 1}/${auftrag.ziele.length})`;
  }
  if (auftrag.status === STATUS.FERTIG) return `${name} — gesichert und geprüft`;
  if (auftrag.status === STATUS.ABGEBROCHEN) return `${name} — abgebrochen`;
  return `${name} — Fehler`;
}

/**
 * Warteschlange für Sicherungsaufträge. Mehrere Karten hintereinander, jede auf
 * mehrere Ziele, eins nach dem anderen — das schont die Platte und macht den
 * Fortschritt ehrlich lesbar.
 */
class Warteschlange {
  /**
   * @param {object} args
   * @param {(auftrag: object, ziel: object, hilfen: {melde: Function, sollAbbrechen: Function}) => Promise<object>} args.arbeite
   *   Kopiert den Auftrag auf **ein** Ziel und prüft nach. Erwartete Rückgabe:
   *   `{erledigt, uebersprungen, geprueft, fehlend, fehler}`.
   * @param {(ereignis: object) => void} [args.melde] Bekommt jede Änderung.
   * @param {number} [args.behalten=20] So viele erledigte Aufträge bleiben sichtbar.
   */
  constructor({ arbeite, melde, behalten = 20 } = {}) {
    this.arbeite = arbeite;
    this.melder = melde || (() => {});
    this.behalten = behalten;
    /** @type {object[]} */
    this.auftraege = [];
    this.laeuft = false;
  }

  /** Stellt einen Auftrag ein und startet die Abarbeitung, falls sie ruht. */
  stelleEin({ quelle, quelleName, ziele = [], plan = [], methode = 'zeitgroesse', metadatenWunsch = {}, schema = '', notiz = '' } = {}) {
    const auftrag = {
      id: neueId(),
      quelle,
      quelleName: quelleName || quelle,
      schema,
      notiz,
      methode,
      metadatenWunsch,
      plan,
      gesamt: plan.length,
      ziele: ziele.map(zielSatz),
      status: STATUS.WARTET,
      fehlerText: '',
      abbruch: false,
      begonnen: null,
      beendet: null,
      text: '',
    };
    if (auftrag.ziele.length === 0) {
      auftrag.status = STATUS.FEHLER;
      auftrag.fehlerText = 'Kein Ziel angegeben';
    }
    this.auftraege.push(auftrag);
    this._meldeStand({ art: 'eingestellt', auftragId: auftrag.id });
    this._weiter();
    return this.sicht(auftrag);
  }

  /** Bittet einen Auftrag (oder alle) anzuhalten. Geprüfte Ziele bleiben gültig. */
  abbrechen(id) {
    for (const a of this.auftraege) {
      if (ENDZUSTAENDE.has(a.status)) continue;
      if (!id || a.id === id) {
        a.abbruch = true;
        // Was noch nicht angefangen hat, hört sofort auf.
        if (a.status === STATUS.WARTET) {
          a.status = STATUS.ABGEBROCHEN;
          a.beendet = Date.now();
        }
      }
    }
    this._meldeStand({ art: 'abbruch', auftragId: id || '' });
  }

  /** Entfernt erledigte Aufträge aus der Liste. */
  aufraeumen() {
    this.auftraege = this.auftraege.filter((a) => !ENDZUSTAENDE.has(a.status));
    this._meldeStand({ art: 'aufgeraeumt' });
  }

  /** Nach außen gegebene Sicht auf einen Auftrag — ohne Plan und ohne Funktionen. */
  sicht(auftrag) {
    const satz = satzFuer(auftrag);
    return {
      id: auftrag.id,
      quelle: auftrag.quelle,
      quelleName: auftrag.quelleName,
      status: auftrag.status,
      gesamt: auftrag.gesamt,
      schema: auftrag.schema,
      notiz: auftrag.notiz,
      fehlerText: auftrag.fehlerText,
      text: auftrag.text,
      begonnen: auftrag.begonnen,
      beendet: auftrag.beendet,
      alleGeprueft: alleGeprueft(auftrag),
      satz: satz.text,
      satzArt: satz.art,
      formatieren: satz.formatieren,
      kurz: kurzfassung(auftrag),
      ziele: auftrag.ziele.map((z) => ({ ...z, rolleLabel: rolleLabel(z.rolle) })),
    };
  }

  /** Der ganze Stand: läuft etwas, was wartet, was ist durch. */
  stand() {
    const alle = this.auftraege.map((a) => this.sicht(a));
    return {
      laeuft: this.laeuft,
      aktiv: alle.filter((a) => a.status === STATUS.LAEUFT || a.status === STATUS.WARTET),
      erledigt: alle.filter((a) => ENDZUSTAENDE.has(a.status)),
      alle,
      offeneKarten: alle.filter((a) => !a.formatieren && a.status !== STATUS.FEHLER).length,
    };
  }

  _meldeStand(zusatz = {}) {
    try {
      this.melder({ ...zusatz, stand: this.stand() });
    } catch (_) {
      // Eine kaputte Oberfläche darf keinen Kopiervorgang stoppen.
    }
  }

  _weiter() {
    if (this.laeuft) return;
    const naechster = this.auftraege.find((a) => a.status === STATUS.WARTET && !a.abbruch);
    if (!naechster) return;
    this.laeuft = true;
    this._fuehreAus(naechster)
      .catch((err) => {
        naechster.status = STATUS.FEHLER;
        naechster.fehlerText = String(err && err.message ? err.message : err);
      })
      .then(() => {
        this.laeuft = false;
        this._meldeStand({ art: 'auftragFertig', auftragId: naechster.id });
        this._weiter();
      });
  }

  async _fuehreAus(auftrag) {
    auftrag.status = STATUS.LAEUFT;
    auftrag.begonnen = Date.now();
    this._meldeStand({ art: 'auftragBegonnen', auftragId: auftrag.id });

    for (const ziel of auftrag.ziele) {
      if (auftrag.abbruch) break;
      ziel.status = STATUS.LAEUFT;
      auftrag.text = `${ziel.name}: Kopieren beginnt …`;
      this._meldeStand({ art: 'fortschritt', auftragId: auftrag.id });

      const melde = (text) => {
        auftrag.text = `${ziel.name}: ${text}`;
        this._meldeStand({ art: 'fortschritt', auftragId: auftrag.id });
      };
      try {
        const r = await this.arbeite(auftrag, ziel, { melde, sollAbbrechen: () => auftrag.abbruch });
        ziel.erledigt = Number(r.erledigt || 0);
        ziel.uebersprungen = Number(r.uebersprungen || 0);
        ziel.geprueft = Number(r.geprueft || 0);
        ziel.fehlend = r.fehlend === null || r.fehlend === undefined ? null : Number(r.fehlend);
        ziel.fehler = Array.isArray(r.fehler) ? r.fehler : [];
        // „fertig" heißt: kopiert **und** nachgeprüft, nichts fehlt mehr.
        ziel.status = ziel.fehlend === 0 && ziel.fehler.length === 0 ? STATUS.FERTIG : STATUS.FEHLER;
      } catch (err) {
        ziel.fehler = [{ von: '', grund: String(err && err.message ? err.message : err) }];
        ziel.status = STATUS.FEHLER;
      }
      this._meldeStand({ art: 'zielFertig', auftragId: auftrag.id });
    }

    auftrag.beendet = Date.now();
    if (auftrag.abbruch && !alleGeprueft(auftrag)) {
      auftrag.status = STATUS.ABGEBROCHEN;
    } else if (alleGeprueft(auftrag)) {
      auftrag.status = STATUS.FERTIG;
      auftrag.text = '';
    } else {
      auftrag.status = STATUS.FEHLER;
      const schlecht = auftrag.ziele.filter((z) => z.status !== STATUS.FERTIG);
      auftrag.fehlerText = schlecht.length
        ? `${schlecht.map((z) => z.name).join(', ')} nicht vollständig`
        : 'Sicherung nicht vollständig';
    }
    // Der Plan hat seinen Zweck getan — er kann groß sein, also weg damit.
    if (auftrag.status === STATUS.FERTIG) auftrag.plan = [];

    const zuViel = this.auftraege.filter((a) => ENDZUSTAENDE.has(a.status)).length - this.behalten;
    if (zuViel > 0) {
      let weg = zuViel;
      this.auftraege = this.auftraege.filter((a) => {
        if (weg > 0 && ENDZUSTAENDE.has(a.status)) {
          weg -= 1;
          return false;
        }
        return true;
      });
    }
  }
}

module.exports = { STATUS, ENDZUSTAENDE, Warteschlange, satzFuer, kurzfassung, alleGeprueft, offeneZiele };
