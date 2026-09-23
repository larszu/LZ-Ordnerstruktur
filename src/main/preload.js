'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Schmale, klar umrissene Brücke zwischen Oberfläche und Hauptprozess.
 * Die Oberfläche bekommt keinen direkten Node-Zugriff.
 */
const brücke = {
  ordnerWaehlen: (titel) => ipcRenderer.invoke('dialog:ordnerWaehlen', titel),
  ordnerOeffnen: (pfad) => ipcRenderer.invoke('struktur:oeffnen', pfad),
  linkOeffnen: (url) => ipcRenderer.invoke('shell:oeffnen', url),
  appInfo: () => ipcRenderer.invoke('app:info'),

  // Ordnerstruktur
  vorschau: (config, vorlageId) => ipcRenderer.invoke('plan:vorschau', { config, vorlageId }),
  strukturErstellen: (zielPfad, config, vorlageId) =>
    ipcRenderer.invoke('struktur:erstellen', { zielPfad, config, vorlageId }),

  // Vorlagen
  vorlagenListe: () => ipcRenderer.invoke('vorlagen:liste'),
  vorlageSpeichern: (vorlage, neu) => ipcRenderer.invoke('vorlagen:speichern', { vorlage, neu }),
  vorlageLoeschen: (id) => ipcRenderer.invoke('vorlagen:loeschen', id),
  leereConfig: (vorlageId) => ipcRenderer.invoke('vorlagen:leereConfig', vorlageId),
  configPruefen: (config, vorlageId) => ipcRenderer.invoke('vorlagen:configPruefen', { config, vorlageId }),
  vorlageProbe: (vorlage) => ipcRenderer.invoke('vorlagen:probe', { vorlage }),

  // Einstellungen
  einstellungenLesen: () => ipcRenderer.invoke('einstellungen:lesen'),
  einstellungenSchreiben: (aenderungen) => ipcRenderer.invoke('einstellungen:schreiben', aenderungen),
  einstellungenZuruecksetzen: () => ipcRenderer.invoke('einstellungen:zuruecksetzen'),

  // Konfiguration als Datei
  configSpeichern: (config, vorlageId) => ipcRenderer.invoke('config:speichern', { config, vorlageId }),
  configLaden: () => ipcRenderer.invoke('config:laden'),

  // Lightroom-Vorgaben
  lightroomPfade: () => ipcRenderer.invoke('lightroom:pfade'),
  presetsInstallieren: (daten) => ipcRenderer.invoke('lightroom:installieren', daten),
  presetsListe: () => ipcRenderer.invoke('presets:liste'),
  presetHinzufuegen: () => ipcRenderer.invoke('presets:hinzufuegen'),
  presetEntfernen: (datei) => ipcRenderer.invoke('presets:entfernen', datei),
  presetAktiv: (datei, aktiv) => ipcRenderer.invoke('presets:aktiv', { datei, aktiv }),
  presetMeta: (datei, lang, kurz) => ipcRenderer.invoke('presets:meta', { datei, lang, kurz }),
  presetsZuruecksetzen: () => ipcRenderer.invoke('presets:zuruecksetzen'),

  // Sortieren und Aufräumen
  sortierenPruefen: (daten) => ipcRenderer.invoke('sortieren:pruefen', daten),
  sortierenAusfuehren: (daten) => ipcRenderer.invoke('sortieren:ausfuehren', daten),
  sortierenVerwerfen: (aufgabe) => ipcRenderer.invoke('sortieren:verwerfen', aufgabe),
  abbrechen: (was) => ipcRenderer.invoke('abbrechen', was),
  aufSortierFortschritt: (handler) => ipcRenderer.on('sortieren:fortschritt', (_e, d) => handler(d)),
  aufNeueKameras: (handler) => ipcRenderer.on('kameras:neu', (_e, d) => handler(d)),

  // Importfenster
  importFensterOeffnen: (kontext) => ipcRenderer.invoke('import:fensterOeffnen', kontext),
  importKontext: () => ipcRenderer.invoke('import:kontext'),
  geraeteListe: () => ipcRenderer.invoke('geraete:liste'),
  importVergleichen: (daten) => ipcRenderer.invoke('import:vergleichen', daten),
  importKopieren: (daten) => ipcRenderer.invoke('import:kopieren', daten),
  aufImportFortschritt: (handler) => ipcRenderer.on('import:fortschritt', (_e, d) => handler(d)),

  onMenu: (kanal, handler) => {
    const erlaubt = ['menu:load', 'menu:save', 'menu:import'];
    if (!erlaubt.includes(kanal)) return;
    ipcRenderer.on(kanal, () => handler());
  },
};

contextBridge.exposeInMainWorld('lz', brücke);
