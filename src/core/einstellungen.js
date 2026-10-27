'use strict';

/**
 * Einstellungen der Oberfläche — zuletzt gewählte Vorlage, Ordner, Optionen
 * und die selbst gepflegten Sachgruppen. Liegt als eine JSON-Datei im
 * Benutzerdatenordner und überlebt damit ein Update.
 *
 * Absicht: Wer die App einmal eingerichtet hat, findet beim nächsten Start
 * alles so vor, wie er es verlassen hat.
 */

const fs = require('fs');
const path = require('path');
const { STANDARD_GRUPPEN, normalisiereGruppen } = require('./sachgruppen');
const { normalisiereKameras } = require('./kameras');
const { normalisiereZiele } = require('./ziele');

const DATEI = 'einstellungen.json';

function standard() {
  return {
    version: 1,
    vorlage: 'sola',
    zielordner: '',
    // Je Vorlage die zuletzt ausgefüllte Konfiguration
    configs: {},
    // Sortieren: je Aufgabe der zuletzt gewählte Quell- und Zielordner
    sortierPfade: {},
    datumSchema: 'jahr-monat-tag',
    umbenennen: true,
    getrennt: false,
    kopieren: false,
    unterordner: '',
    dokumenteUmbenennen: true,
    inPapierkorb: true,
    aufraeumKategorien: {
      leer: true,
      album: true,
      icons: true,
      exo: true,
      bruchstuecke: true,
      systemmuell: true,
    },
    gruppen: STANDARD_GRUPPEN.map((g) => ({ name: g.name, worte: [...g.worte] })),
    // Lightroom
    kuerzel: '',
    // Kameras: Seriennummer -> Person und Uhrzeit-Versatz
    kameras: [],
    // Was beim Import in die Kopien geschrieben wird
    metadaten: { urheber: '', rechte: '', stichworte: '', gpsEntfernen: false },
    // Sicherungsziele: wohin eine Karte kopiert wird, mit Rolle
    ziele: [],
    // Menüleiste und Kartenwache
    wache: {
      // Symbol in der Menüleiste zeigen und beim Einstecken fragen
      aktiv: true,
      // Nur Karten mit DCIM-Ordner melden — nicht jeden USB-Stick
      nurKameras: true,
      // Sofort sichern, ohne nachzufragen
      sofort: false,
      // Takt der Nachschau in Sekunden
      takt: 4,
      // Datenträger, bei denen nicht mehr gefragt wird
      ignoriert: [],
    },
    // Womit eine Karte aus der Menüleiste gesichert wird (Schema und Auswahl)
    sicherung: { schema: 'datum', unterordner: '', umbenennen: false, methode: 'zeitgroesse' },
  };
}

/** Liest die Einstellungen; fehlende Felder werden aus dem Standard ergänzt. */
function lade(userDir) {
  const werte = standard();
  try {
    const roh = JSON.parse(fs.readFileSync(path.join(userDir, DATEI), 'utf8'));
    for (const schluessel of Object.keys(werte)) {
      if (roh[schluessel] !== undefined) werte[schluessel] = roh[schluessel];
    }
  } catch (_) {
    // Keine oder kaputte Datei — dann gelten die Vorgaben.
  }
  werte.gruppen = normalisiereGruppen(werte.gruppen);
  werte.kameras = normalisiereKameras(werte.kameras);
  werte.aufraeumKategorien = { ...standard().aufraeumKategorien, ...(werte.aufraeumKategorien || {}) };
  werte.metadaten = { ...standard().metadaten, ...(werte.metadaten || {}) };
  werte.wache = { ...standard().wache, ...(werte.wache || {}) };
  werte.wache.ignoriert = Array.isArray(werte.wache.ignoriert) ? werte.wache.ignoriert.map(String) : [];
  werte.wache.takt = Math.min(60, Math.max(2, Number(werte.wache.takt) || 4));
  werte.sicherung = { ...standard().sicherung, ...(werte.sicherung || {}) };
  werte.ziele = normalisiereZiele(werte.ziele);
  return werte;
}

/** Schreibt geänderte Felder zurück und gibt den vollständigen Stand zurück. */
function speichere(userDir, aenderungen) {
  const werte = { ...lade(userDir), ...(aenderungen || {}) };
  werte.gruppen = normalisiereGruppen(werte.gruppen);
  werte.kameras = normalisiereKameras(werte.kameras);
  werte.ziele = normalisiereZiele(werte.ziele);
  werte.wache = { ...standard().wache, ...(werte.wache || {}) };
  try {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, DATEI), `${JSON.stringify(werte, null, 2)}\n`, 'utf8');
  } catch (_) {
    // Nicht schreibbar: die App läuft weiter, merkt sich nur nichts.
  }
  return werte;
}

/** Setzt alles auf den Auslieferungszustand zurück. */
function zuruecksetzen(userDir) {
  try {
    fs.unlinkSync(path.join(userDir, DATEI));
  } catch (_) {
    // War schon weg.
  }
  return lade(userDir);
}

module.exports = { DATEI, standard, lade, speichere, zuruecksetzen };
