'use strict';

/**
 * Sachgruppen für das Einsortieren von Dokumenten — Ordnername und die
 * Stichwörter, an denen ein Dokument erkannt wird. Keine KI: gezählt wird,
 * wie oft ein Stichwort im Text vorkommt; die Gruppe mit den meisten
 * Treffern gewinnt. Bei Gleichstand landet das Dokument in `Unsortiert`.
 *
 * Die Liste lässt sich in der Oberfläche ändern und liegt dann im
 * Benutzerdatenordner — diese Fassung ist nur der Ausgangspunkt.
 */

const STANDARD_GRUPPEN = [
  {
    name: 'Rechnungen',
    worte: ['rechnung', 'rechnungsnummer', 'invoice', 'gesamtbetrag', 'nettobetrag', 'mehrwertsteuer', 'umsatzsteuer', 'zahlbar', 'kundennummer', 'bestellnummer', 'einzelpreis'],
  },
  {
    name: 'Vertraege und Versicherungen',
    worte: ['vertrag', 'versicherung', 'police', 'versicherungsschein', 'kuendigung', 'mitgliedschaft', 'vertragsnummer', 'haftpflicht', 'laufzeit'],
  },
  {
    name: 'Steuer und Finanzen',
    worte: ['finanzamt', 'steuernummer', 'einkommensteuer', 'steuerbescheid', 'kontoauszug', 'iban', 'ueberweisung', 'elster', 'buchhaltung'],
  },
  {
    name: 'Schule und Ausbildung',
    worte: ['unterricht', 'schule', 'klausur', 'pruefung', 'ausbildung', 'berufsschule', 'referat', 'lehrplan', 'zeugnis', 'seminar', 'studium', 'arbeitsblatt', 'realschule'],
  },
  {
    name: 'Glaube und Gemeinde',
    worte: ['jesus', 'gottes', 'gebet', 'bibel', 'gemeinde', 'worship', 'predigt', 'andacht', 'psalm', 'gottesdienst', 'lobpreis'],
  },
  {
    name: 'Fotografie und Auftraege',
    worte: ['shooting', 'fotograf', 'model', 'honorar', 'bildrechte', 'nutzungsrecht', 'hochzeit', 'reportage', 'videoproduktion', 'drehbuch', 'kalkulation'],
  },
  {
    name: 'Medizin und Gesundheit',
    worte: ['arztpraxis', 'diagnose', 'befund', 'rezept', 'krankenkasse', 'patient', 'therapie', 'impfung'],
  },
  {
    name: 'Bewerbung',
    worte: ['lebenslauf', 'bewerbung', 'anschreiben', 'motivationsschreiben', 'arbeitszeugnis'],
  },
  {
    name: 'Behoerden und Amtliches',
    worte: ['bescheid', 'antrag', 'behoerde', 'meldebescheinigung', 'gewerbeanmeldung', 'widerspruch', 'aktenzeichen'],
  },
  {
    name: 'Anleitungen und Handbuecher',
    worte: ['bedienungsanleitung', 'handbuch', 'benutzerhandbuch', 'inbetriebnahme', 'garantiebedingungen', 'sicherheitshinweise'],
  },
];

/** Name des Ordners, in dem alles landet, was sich nicht zuordnen lässt. */
const UNSORTIERT = 'Unsortiert';

/** Füllt eine von außen kommende Gruppenliste auf und wirft Unbrauchbares weg. */
function normalisiereGruppen(roh) {
  const liste = Array.isArray(roh) ? roh : [];
  const gruppen = liste
    .map((g) => ({
      name: String((g && g.name) || '').trim(),
      worte: (Array.isArray(g && g.worte) ? g.worte : [])
        .map((w) => String(w || '').trim().toLowerCase())
        .filter(Boolean),
    }))
    .filter((g) => g.name && g.worte.length > 0);
  return gruppen.length ? gruppen : STANDARD_GRUPPEN.map((g) => ({ name: g.name, worte: [...g.worte] }));
}

/**
 * Ordnet einen Text einer Gruppe zu.
 * @param {string} text
 * @param {Array<{name: string, worte: string[]}>} gruppen
 * @returns {string} Gruppenname oder `Unsortiert`
 */
function gruppeFuer(text, gruppen) {
  const t = String(text || '').toLowerCase();
  let beste = UNSORTIERT;
  let punkte = 0;
  let zweit = 0;
  for (const gruppe of gruppen) {
    let s = 0;
    for (const wort of gruppe.worte) {
      let idx = 0;
      while ((idx = t.indexOf(wort, idx)) !== -1) {
        s += 1;
        idx += wort.length;
      }
    }
    if (s > punkte) {
      zweit = punkte;
      punkte = s;
      beste = gruppe.name;
    } else if (s > zweit) {
      zweit = s;
    }
  }
  // Kein Treffer oder Gleichstand: lieber nicht raten.
  if (punkte === 0 || punkte === zweit) return UNSORTIERT;
  return beste;
}

module.exports = { STANDARD_GRUPPEN, UNSORTIERT, normalisiereGruppen, gruppeFuer };
