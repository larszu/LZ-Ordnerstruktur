'use strict';

/**
 * Kartenwache: sieht im Takt nach, welche Datenträger angesteckt sind, und
 * meldet jeden neuen. Daraus entsteht das Fenster, das beim Einstecken einer
 * Karte von selbst aufgeht.
 *
 * Betriebssystem-Ereignisse fürs Einhängen gibt es in Electron nicht
 * plattformübergreifend, deshalb die Nachschau im Takt — sie liest nur ein
 * Verzeichnis und kostet nichts.
 *
 * Der erste Durchgang merkt sich bloß, was schon da ist: Wer die App startet,
 * während die Karte steckt, soll nicht sofort angesprungen werden.
 */

class Kartenwache {
  /**
   * @param {object} args
   * @param {() => Array<{pfad: string, name: string, kamera: boolean}>} args.liste
   * @param {(geraet: object) => void} args.beiNeu
   * @param {(pfad: string) => void} [args.beiWeg]
   * @param {number} [args.takt=4] Sekunden zwischen zwei Nachschauen
   */
  constructor({ liste, beiNeu, beiWeg, takt = 4 } = {}) {
    this.liste = liste;
    this.beiNeu = beiNeu || (() => {});
    this.beiWeg = beiWeg || (() => {});
    this.takt = Math.min(60, Math.max(2, Number(takt) || 4));
    this.bekannt = new Set();
    this.timer = null;
    this.eingelesen = false;
  }

  /** Startet die Nachschau. Mehrfacher Aufruf schadet nicht. */
  starte() {
    if (this.timer) return;
    this.pruefe(); // erster Durchgang: nur merken
    this.timer = setInterval(() => this.pruefe(), this.takt * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  stoppe() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Setzt den Takt neu (und startet ihn mit dem neuen Wert). */
  setzeTakt(sekunden) {
    this.takt = Math.min(60, Math.max(2, Number(sekunden) || 4));
    if (this.timer) {
      this.stoppe();
      this.timer = setInterval(() => this.pruefe(), this.takt * 1000);
      if (this.timer.unref) this.timer.unref();
    }
  }

  /**
   * Eine Nachschau. Neue Datenträger werden gemeldet, abgezogene vergessen.
   * @param {boolean} [melden=true] false blendet die Meldung aus (Startdurchgang)
   */
  pruefe(melden = true) {
    let geraete = [];
    try {
      geraete = this.liste() || [];
    } catch (_) {
      return [];
    }
    const jetzt = new Set(geraete.map((g) => g.pfad));
    const neue = geraete.filter((g) => !this.bekannt.has(g.pfad));

    for (const pfad of [...this.bekannt]) {
      if (!jetzt.has(pfad)) {
        this.bekannt.delete(pfad);
        this.beiWeg(pfad);
      }
    }
    for (const g of neue) this.bekannt.add(g.pfad);

    if (!this.eingelesen) {
      // Startdurchgang: was schon steckt, ist kein Ereignis.
      this.eingelesen = true;
      return [];
    }
    if (melden) for (const g of neue) this.beiNeu(g);
    return neue;
  }

  /** Vergisst einen Pfad, damit er beim nächsten Stecken wieder meldet. */
  vergiss(pfad) {
    this.bekannt.delete(pfad);
  }
}

module.exports = { Kartenwache };
