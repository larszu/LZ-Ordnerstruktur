'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Notification } = require('electron');
const fs = require('fs');
const path = require('path');

const { planFuerVorlage } = require('../core/structure');
const { createStructure } = require('../core/createStructure');
const vorlagen = require('../core/vorlagen');
const vorlagenStore = require('../core/vorlagenStore');
const einstellungen = require('../core/einstellungen');
const sortieren = require('../core/sortieren');
const werkzeuge = require('../core/werkzeuge');
const exif = require('../core/exif');
const { vergleicheImport, runImport, scanImport, pruefeZiel, sichereAufZiel, VERGLEICH_METHODEN } = require('../core/importRun');
const { schemaListe, PERSON_AUTOMATISCH } = require('../core/importPlan');
const kameras = require('../core/kameras');
const ziele = require('../core/ziele');
const { listRemovable, listVolumes, volumeStand } = require('../core/devices');
const { Warteschlange } = require('../core/auftraege');
const { Kartenwache } = require('./wache');
const { Menueleiste } = require('./tray');
const { installPresets, lightroomPfade } = require('../core/lightroom');
const presetStore = require('../core/presetStore');
const { SOLA_TAGE, MIN_TAGE, MAX_TAGE } = require('../core/dates');
const { toJson, parseConfig, CONFIG_VERSION } = require('../core/config');
const { STANDARD_GRUPPEN } = require('../core/sachgruppen');

const IST_MAC = process.platform === 'darwin';

/**
 * Die Lightroom-Vorlagen liegen im gepackten Build unter `resources/`, im
 * Entwicklungsbetrieb im Projektordner.
 */
function presetsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'presets')
    : path.join(__dirname, '..', '..', 'resources', 'presets');
}

/**
 * Eigene Dateien (Vorgaben, Vorlagen, Einstellungen) liegen im Benutzer-
 * datenordner und überleben damit ein Update der App.
 * Über LZ_USER_DATA lässt sich der Pfad für Tests umbiegen.
 */
function userDir(unterordner = '') {
  const basis = process.env.LZ_USER_DATA || process.env.SOLA_USER_PRESETS_BASIS || app.getPath('userData');
  return unterordner ? path.join(basis, unterordner) : basis;
}

const userPresetsDir = () => process.env.SOLA_USER_PRESETS || userDir('presets');
const userVorlagenDir = () => userDir('vorlagen');

const presetOrdner = () => ({ bundledDir: presetsDir(), userDir: userPresetsDir() });

/** @type {BrowserWindow|null} */
let fenster = null;

function createWindow() {
  fenster = new BrowserWindow({
    width: 1240,
    height: 920,
    minWidth: 720,
    minHeight: 580,
    title: 'LZ Ordnerstruktur',
    backgroundColor: '#f6f5f0',
    // Auf macOS sitzt die Ampel im eigenen Header, unter Windows bleibt die
    // Systemleiste stehen.
    titleBarStyle: IST_MAC ? 'hiddenInset' : 'default',
    icon: process.platform === 'linux' ? path.join(__dirname, '..', '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Der Preload nutzt nur contextBridge und ipcRenderer – beides läuft im Sandbox-Modus.
      sandbox: true,
    },
  });

  fenster.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  fenster.on('closed', () => {
    fenster = null;
  });

  // Externe Links im Systembrowser öffnen, nicht in einem Electron-Fenster.
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Holt das Hauptfenster nach vorn — oder legt es neu an, wenn es zu war. */
function zeigeFenster(ansicht = '') {
  if (!fenster) createWindow();
  if (fenster.isMinimized()) fenster.restore();
  fenster.show();
  fenster.focus();
  if (ansicht) {
    // Erst wenn die Oberfläche steht, hat der Wechsel einen Platz zum Landen.
    const senden = () => fenster && fenster.webContents.send('ansicht:wechseln', ansicht);
    if (fenster.webContents.isLoading()) fenster.webContents.once('did-finish-load', senden);
    else senden();
  }
}

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(IST_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Einstellungen laden …',
          accelerator: 'CmdOrCtrl+O',
          click: () => fenster && fenster.webContents.send('menu:load'),
        },
        {
          label: 'Einstellungen speichern …',
          accelerator: 'CmdOrCtrl+S',
          click: () => fenster && fenster.webContents.send('menu:save'),
        },
        { type: 'separator' },
        {
          label: 'Fotos importieren …',
          accelerator: 'CmdOrCtrl+I',
          click: () => fenster && fenster.webContents.send('menu:import'),
        },
        {
          label: 'Karte sichern …',
          accelerator: 'CmdOrCtrl+B',
          click: () => zeigeFenster('ziele'),
        },
        { type: 'separator' },
        IST_MAC ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Projekt auf GitHub',
          click: () => shell.openExternal('https://github.com/larszu/LZ-Ordnerstruktur'),
        },
        {
          label: 'Lars Zumpe Medienproduktion',
          click: () => shell.openExternal('https://zumpelars.de'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  starteMenueleiste();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Solange das Symbol in der Menüleiste steht, läuft die App weiter — sonst
  // würde ein geschlossenes Fenster einen laufenden Sicherungsauftrag töten.
  if (!IST_MAC && !menueleiste) app.quit();
});

// Ein laufender Auftrag darf nicht stillschweigend abbrechen.
app.on('before-quit', (e) => {
  if (beendenErlaubt) return;
  const stand = warteschlange.stand();
  if (stand.aktiv.length === 0) return;
  e.preventDefault();
  const antwort = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Weiter sichern', 'Abbrechen und beenden'],
    defaultId: 0,
    cancelId: 0,
    message: 'Es wird noch gesichert.',
    detail: `${stand.aktiv.map((a) => a.kurz).join('\n')}\n\nWird jetzt beendet, bleibt die Karte unvollständig gesichert.`,
  });
  if (antwort === 1) {
    warteschlange.abbrechen();
    beendenErlaubt = true;
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// IPC – alles, was Datei- oder Dialogzugriff braucht, läuft hier im Hauptprozess.
// ---------------------------------------------------------------------------

/** Holt die Vorlage zu einer Id – mitgeliefert oder selbst angelegt. */
const holeVorlage = (id) => vorlagenStore.findeVorlage(userVorlagenDir(), id) || vorlagen.VORLAGE_SOLA;

ipcMain.handle('dialog:ordnerWaehlen', async (_e, titel) => {
  const ergebnis = await dialog.showOpenDialog(fenster, {
    title: titel || 'Ordner wählen',
    message: titel || 'Ordner wählen',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Auswählen',
  });
  return ergebnis.canceled ? '' : ergebnis.filePaths[0];
});

ipcMain.handle('plan:vorschau', (_e, { config, vorlageId }) => {
  const vorlage = holeVorlage(vorlageId);
  const plan = planFuerVorlage(vorlage, config);
  return { ...plan, vorlageId: vorlage.id };
});

ipcMain.handle('struktur:erstellen', (_e, { zielPfad, config, vorlageId }) =>
  createStructure(zielPfad, config, holeVorlage(vorlageId)),
);

ipcMain.handle('struktur:oeffnen', (_e, pfad) => {
  if (pfad && fs.existsSync(pfad)) shell.openPath(pfad);
});

// --- Vorlagen ---------------------------------------------------------------

ipcMain.handle('vorlagen:liste', () => vorlagenStore.listeVorlagen(userVorlagenDir()));

ipcMain.handle('vorlagen:speichern', (_e, { vorlage, neu }) =>
  vorlagenStore.speichereVorlage(userVorlagenDir(), vorlage, { neu: Boolean(neu) }),
);

ipcMain.handle('vorlagen:loeschen', (_e, id) => vorlagenStore.loescheVorlage(userVorlagenDir(), id));

ipcMain.handle('vorlagen:leereConfig', (_e, vorlageId) => vorlagen.leereConfig(holeVorlage(vorlageId)));

// Eine gemerkte Konfiguration kann zu einer Vorlage gehören, die inzwischen
// geändert wurde — neue Blöcke fehlen dann darin. Hier wird sie aufgefüllt.
ipcMain.handle('vorlagen:configPruefen', (_e, { config, vorlageId }) =>
  vorlagen.normalisiereConfig(config, holeVorlage(vorlageId)),
);

// Vorschau für den Vorlagen-Editor: der Baum, den ein Entwurf ergäbe.
ipcMain.handle('vorlagen:probe', (_e, { vorlage, config }) => {
  const v = vorlagen.normalisiereVorlage(vorlage);
  return planFuerVorlage(v, config || beispielConfig(v));
});

/**
 * Baut eine Beispiel-Konfiguration: alle Blöcke und Bereiche an, ein Startdatum
 * und zwei Namen je Liste. So zeigt die Vorschau im Editor, was die Vorlage
 * überhaupt kann — auch bevor irgendetwas ausgefüllt wurde.
 */
function beispielConfig(vorlage) {
  const config = vorlagen.leereConfig(vorlage);
  config.jahr = String(new Date().getFullYear());
  config.name = 'Beispiel';
  for (const projekt of vorlage.projekte) {
    config[projekt.key].aktiv = true;
    config[projekt.key].start = `${config.jahr}-06-13`;
    config[projekt.key].tage = Math.min(vorlage.standardTage, 3);
    for (const bereich of vorlage.bereiche) config[projekt.key].bereiche[bereich.key] = true;
    for (const liste of vorlage.namenslisten) {
      config[projekt.key][liste.key] = ['Anna', 'Ben', ...Array(8).fill('')];
    }
  }
  return config;
}

// --- Einstellungen ----------------------------------------------------------

ipcMain.handle('einstellungen:lesen', () => einstellungen.lade(userDir()));
ipcMain.handle('einstellungen:schreiben', (_e, aenderungen) => einstellungen.speichere(userDir(), aenderungen));
ipcMain.handle('einstellungen:zuruecksetzen', () => einstellungen.zuruecksetzen(userDir()));

// --- Konfiguration als Datei ------------------------------------------------

ipcMain.handle('config:speichern', async (_e, { config, vorlageId }) => {
  const vorlage = holeVorlage(vorlageId);
  const ergebnis = await dialog.showSaveDialog(fenster, {
    title: 'Einstellungen speichern unter',
    defaultPath: `${vorlage.id}_Konfiguration_${config.jahr || new Date().getFullYear()}.json`,
    // JSON ist das einzige Speicherformat. Das CSV des Windows-Originals lässt
    // sich weiterhin öffnen, wird aber nicht mehr geschrieben.
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (ergebnis.canceled || !ergebnis.filePath) return { gespeichert: false };

  const pfad = ergebnis.filePath.replace(/(\.json)?$/i, '.json');
  try {
    fs.writeFileSync(pfad, toJson({ ...config, vorlage: vorlage.id }), 'utf8');
    return { gespeichert: true, pfad };
  } catch (err) {
    return { gespeichert: false, fehler: err.message };
  }
});

ipcMain.handle('config:laden', async () => {
  const ergebnis = await dialog.showOpenDialog(fenster, {
    title: 'Einstellungen wählen',
    properties: ['openFile'],
    filters: [
      { name: 'Konfiguration', extensions: ['json', 'csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'CSV des Windows-Originals', extensions: ['csv'] },
    ],
  });
  if (ergebnis.canceled || ergebnis.filePaths.length === 0) return { geladen: false };

  const pfad = ergebnis.filePaths[0];
  try {
    const text = fs.readFileSync(pfad, 'utf8');
    const roh = /\.json$/i.test(pfad) || text.trim().startsWith('{') ? JSON.parse(text) : null;
    // Die Datei sagt selbst, zu welcher Vorlage sie gehört; fehlt die Angabe,
    // ist es eine alte Sola-Datei (JSON vor der Vorlagen-Zeit oder eine CSV).
    const vorlageId = roh && roh.vorlage ? String(roh.vorlage) : 'sola';
    const vorlage = holeVorlage(vorlageId);
    const { config, format } = parseConfig(text, pfad);
    return {
      geladen: true,
      pfad,
      format,
      vorlageId: vorlage.id,
      config: roh ? vorlagen.normalisiereConfig(config, vorlage) : config,
    };
  } catch (err) {
    return { geladen: false, fehler: err.message };
  }
});

// --- Lightroom --------------------------------------------------------------

ipcMain.handle('lightroom:pfade', () => ({ ...lightroomPfade(), eigene: userPresetsDir() }));

ipcMain.handle('lightroom:installieren', (_e, { jahr, sola, kuerzel }) =>
  installPresets({ vorgaben: presetStore.listPresets(presetOrdner()), jahr, sola, kuerzel }),
);

ipcMain.handle('presets:liste', () => presetStore.listPresets(presetOrdner()));

ipcMain.handle('presets:hinzufuegen', async () => {
  const ergebnis = await dialog.showOpenDialog(fenster, {
    title: 'Lightroom-Vorgabe wählen',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Lightroom-Vorgaben', extensions: ['lrtemplate', 'xmp'] },
      { name: 'Exportvorgabe', extensions: ['lrtemplate'] },
      { name: 'Entwicklungsvorgabe', extensions: ['xmp'] },
    ],
  });
  if (ergebnis.canceled || ergebnis.filePaths.length === 0) return { abgebrochen: true };

  const ordner = presetOrdner();
  const ergebnisse = ergebnis.filePaths.map((quellPfad) => ({
    quelle: path.basename(quellPfad),
    ...presetStore.importPreset({ quellPfad, ...ordner }),
  }));
  return { abgebrochen: false, ergebnisse, vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:entfernen', (_e, datei) => {
  const ordner = presetOrdner();
  return { ...presetStore.removePreset({ datei, ...ordner }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:aktiv', (_e, { datei, aktiv }) => {
  const ordner = presetOrdner();
  return { ...presetStore.setPresetAktiv({ datei, aktiv, userDir: ordner.userDir }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:meta', (_e, { datei, lang, kurz }) => {
  const ordner = presetOrdner();
  return { ...presetStore.setPresetMeta({ datei, lang, kurz, userDir: ordner.userDir }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('presets:zuruecksetzen', () => {
  const ordner = presetOrdner();
  return { ...presetStore.resetPresets({ userDir: ordner.userDir }), vorgaben: presetStore.listPresets(ordner) };
});

ipcMain.handle('shell:oeffnen', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// Direkt aus der package.json statt über app.getVersion(): Letzteres liefert
// die Electron-Version, sobald die App nicht über ihr Projektverzeichnis
// gestartet wird (etwa im Smoke-Lauf).
const { version: APP_VERSION } = require('../../package.json');

ipcMain.handle('app:info', () => ({
  version: APP_VERSION,
  configVersion: CONFIG_VERSION,
  plattform: process.platform,
  vorlagen: vorlagenStore.listeVorlagen(userVorlagenDir()),
  tage: { standard: SOLA_TAGE, min: MIN_TAGE, max: MAX_TAGE },
  anzahlNamen: vorlagen.ANZAHL_NAMEN,
  importSchemata: schemaListe(),
  personAutomatisch: PERSON_AUTOMATISCH,
  maxVersatzMinuten: kameras.MAX_VERSATZ_MINUTEN,
  datumSchemata: sortieren.schemaListe(),
  aufraeumKategorien: sortieren.AUFRAEUM_KATEGORIEN,
  standardGruppen: STANDARD_GRUPPEN,
  werkzeuge: werkzeuge.stand(),
  einstellungen: einstellungen.lade(userDir()),
}));

// ---------------------------------------------------------------------------
// Sortieren und Aufräumen
// ---------------------------------------------------------------------------

// Der zuletzt berechnete Plan je Aufgabe. „Ausführen" setzt genau den um, der
// in der Vorschau stand – es wird nicht heimlich neu eingelesen.
const letztePruefung = {};

// Abbruchwünsche je Aufgabe. Ein laufender Vorgang sieht zwischen zwei Dateien
// nach, ob hier etwas steht — die laufende Datei wird immer fertig bearbeitet.
const abbruch = { import: false };

ipcMain.handle('abbrechen', (_e, was) => {
  abbruch[was] = true;
});

const sortierMelder = (aufgabe) => (text) => {
  if (fenster) fenster.webContents.send('sortieren:fortschritt', { aufgabe, text });
};

/** Entfernt eine Datei – in den Papierkorb, wenn die Oberfläche das will. */
function entferner(inPapierkorb) {
  if (!inPapierkorb) return async (pfad) => fs.promises.unlink(pfad).catch(() => {});
  return async (pfad) => {
    try {
      await shell.trashItem(pfad);
    } catch (_) {
      // Manche Dateisysteme (Netzlaufwerke, externe Platten) kennen keinen
      // Papierkorb. Dann bleibt die Datei liegen, statt still zu verschwinden.
    }
  };
}

const PRUEFER = {
  fotos: sortieren.pruefeFotos,
  dokumente: sortieren.pruefeDokumente,
  duplikate: sortieren.pruefeDuplikate,
  aufraeumen: sortieren.pruefeAufraeumen,
};

const AUSFUEHRER = {
  fotos: sortieren.fuehreFotosAus,
  dokumente: sortieren.fuehreDokumenteAus,
  duplikate: sortieren.fuehreDuplikateAus,
  aufraeumen: sortieren.fuehreAufraeumenAus,
};

ipcMain.handle('sortieren:pruefen', async (_e, { aufgabe, quelle, optionen }) => {
  const pruefe = PRUEFER[aufgabe];
  if (!pruefe) return { ok: false, fehler: 'Unbekannte Aufgabe.' };
  if (!quelle) return { ok: false, fehler: 'Bitte zuerst einen Ordner wählen.' };
  try {
    const ergebnis = await pruefe(quelle, optionen || {}, sortierMelder(aufgabe));
    letztePruefung[aufgabe] = { ergebnis, optionen: optionen || {} };
    return {
      ok: true,
      zusammenfassung: ergebnis.zusammenfassung,
      // Nur eine kompakte Vorschau an die Oberfläche geben, nicht zehntausende Zeilen.
      vorschau: (ergebnis.plan || []).slice(0, 300).map((s) => sortieren.beschreibe(aufgabe, s)),
      gesamt: (ergebnis.plan || []).length,
    };
  } catch (err) {
    return { ok: false, fehler: String(err.message || err) };
  }
});

ipcMain.handle('sortieren:ausfuehren', async (_e, { aufgabe, inPapierkorb }) => {
  const gespeichert = letztePruefung[aufgabe];
  const fuehreAus = AUSFUEHRER[aufgabe];
  if (!gespeichert || !fuehreAus) return { ok: false, fehler: 'Bitte zuerst eine Vorschau erstellen.' };
  try {
    abbruch[aufgabe] = false;
    const optionen = {
      ...gespeichert.optionen,
      entferne: entferner(inPapierkorb !== false),
      sollAbbrechen: () => abbruch[aufgabe] === true,
    };
    const ergebnis = await fuehreAus(gespeichert.ergebnis, optionen, sortierMelder(aufgabe));
    // Nach einem Abbruch bleibt der Rest des Plans stehen, damit sich
    // weitermachen lässt, ohne alles neu einzulesen.
    if (ergebnis.abgebrochen) gespeichert.ergebnis.plan = gespeichert.ergebnis.plan.slice(ergebnis.erledigt);
    else delete letztePruefung[aufgabe];
    return { ok: true, ...ergebnis };
  } catch (err) {
    return { ok: false, fehler: String(err.message || err) };
  }
});

ipcMain.handle('sortieren:verwerfen', (_e, aufgabe) => {
  delete letztePruefung[aufgabe];
});

// ---------------------------------------------------------------------------
// Importfenster: Kamera / Kartenleser / SD-Karte direkt in die richtigen Ordner
// kopieren. Eigenes Fenster mit Vergleich (FreeFileSync-Art) vor dem Kopieren.
// ---------------------------------------------------------------------------

/** @type {BrowserWindow|null} */
let importFenster = null;
// Kontext aus dem Hauptfenster (Vorlage, Konfiguration, Zielordner) und der
// zuletzt berechnete Plan, damit „Kopieren" genau den verglichenen Stand umsetzt.
let importKontext = { config: vorlagen.leereConfig(vorlagen.VORLAGE_SOLA), zielordner: '', vorlageId: 'sola' };
let letzterVergleich = null;

const importMelder = () => (text) => {
  const ziel = importFenster || fenster;
  if (ziel) ziel.webContents.send('import:fortschritt', { text });
};

function oeffneImportFenster() {
  if (importFenster) {
    importFenster.focus();
    return;
  }
  importFenster = new BrowserWindow({
    width: 1040,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    title: 'Fotos und Videos importieren',
    backgroundColor: '#f6f5f0',
    parent: fenster || undefined,
    titleBarStyle: IST_MAC ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  importFenster.loadFile(path.join(__dirname, '..', 'renderer', 'import.html'));
  importFenster.on('closed', () => {
    importFenster = null;
    letzterVergleich = null;
  });
}

ipcMain.handle('import:fensterOeffnen', (_e, kontext) => {
  if (kontext && kontext.config) {
    importKontext = {
      config: kontext.config,
      zielordner: kontext.zielordner || '',
      vorlageId: kontext.vorlageId || 'sola',
    };
  }
  oeffneImportFenster();
});

ipcMain.handle('import:kontext', () => {
  const vorlage = holeVorlage(importKontext.vorlageId);
  return {
    config: importKontext.config,
    zielordner: importKontext.zielordner,
    vorlage,
    schemata: schemaListe(),
    methoden: VERGLEICH_METHODEN,
    exiftool: exif.vorhanden,
    exiftoolQuelle: exif.quelle,
    personAutomatisch: PERSON_AUTOMATISCH,
    einstellungen: einstellungen.lade(userDir()),
    plattform: process.platform,
  };
});

ipcMain.handle('geraete:liste', () => listRemovable());

ipcMain.handle('import:vergleichen', async (_e, { quelle, zielBasis, schema, ktx, config, methode }) => {
  if (!quelle) return { ok: false, fehler: 'Bitte zuerst eine Quelle wählen.' };
  try {
    // Die Vorlage kommt aus dem Hauptprozess, nicht aus dem Fenster – so kann
    // die Oberfläche kein fremdes Ziel unterschieben.
    const gespeichert = einstellungen.lade(userDir());
    const kontext = {
      ...ktx,
      vorlage: holeVorlage(importKontext.vorlageId),
      kameras: gespeichert.kameras,
    };
    const r = await vergleicheImport({ quelle, zielBasis, schema, ktx: kontext, config, methode, melde: importMelder() });
    letzterVergleich = { plan: r.plan, methode };

    // Beim Vergleich gesehene Kameras merken — zuordnen muss man sie einmal
    // von Hand, aber sie sollen von allein in der Liste auftauchen.
    const ergaenzt = kameras.ergaenzeKameras(gespeichert.kameras, r.metadaten || []);
    if (ergaenzt.neu.length > 0) {
      einstellungen.speichere(userDir(), { kameras: ergaenzt.kameras });
      if (fenster) fenster.webContents.send('kameras:neu', ergaenzt.kameras);
    }
    return {
      ok: true,
      gefunden: r.gefunden,
      kategorien: r.kategorien,
      quellen: r.quellen,
      warnungen: r.warnungen,
      jahr: r.jahr,
      zielBekannt: r.zielBekannt,
      uebersprungenDatum: r.uebersprungenDatum.slice(0, 40).map((u) => `${path.basename(u.von)} — ${u.grund}`),
      eintraege: r.eintraege.slice(0, 300),
      kameras: ergaenzt.kameras,
    };
  } catch (err) {
    return { ok: false, fehler: String(err.message || err) };
  }
});

ipcMain.handle('import:kopieren', async (_e, { zielBasis, verschieben, methode, metadatenWunsch }) => {
  if (!letzterVergleich || letzterVergleich.plan.length === 0) {
    return { ok: false, fehler: 'Bitte zuerst vergleichen.' };
  }
  if (!zielBasis) return { ok: false, fehler: 'Kein Zielordner gewählt.' };
  try {
    abbruch.import = false;
    const r = await runImport({
      plan: letzterVergleich.plan,
      zielBasis,
      verschieben,
      methode: methode || letzterVergleich.methode,
      melde: importMelder(),
      sollAbbrechen: () => abbruch.import === true,
      metadatenWunsch,
    });
    // Nach einem Abbruch bleibt der Rest stehen; ein erneuter Vergleich zeigt
    // ohnehin, was noch fehlt.
    if (!r.abgebrochen) letzterVergleich = null;
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, fehler: String(err.message || err) };
  }
});

// ---------------------------------------------------------------------------
// Sichern im Hintergrund: Menüleiste, Kartenwache, Warteschlange
//
// Eine gesteckte Karte soll von allein auffallen, auf alle eingerichteten Ziele
// kopiert und erst dann freigegeben werden, wenn jedes Ziel nachgeprüft ist.
// Das Fenster darf dabei zu sein — gearbeitet wird hier im Hauptprozess.
// ---------------------------------------------------------------------------

/** @type {Menueleiste|null} */
let menueleiste = null;
/** @type {Kartenwache|null} */
let kartenwache = null;
/** @type {Map<string, BrowserWindow>} */
const kartenfenster = new Map();
let beendenErlaubt = false;

const wacheEinstellungen = () => einstellungen.lade(userDir()).wache;

/** Ziele mit ihrem Stand: angeschlossen, freier Platz. */
function zieleMitStand() {
  return ziele.mitStand(einstellungen.lade(userDir()).ziele, volumeStand);
}

/** Gesteckte Karten, die die Wache melden würde. */
function gesteckteKarten() {
  const nurKameras = wacheEinstellungen().nurKameras;
  return listRemovable().filter((g) => !nurKameras || g.kamera);
}

/** Schickt den Stand der Warteschlange an alle offenen Fenster. */
function sendeStand(stand) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('auftraege:stand', stand);
  }
  if (menueleiste) menueleiste.zeichne();
}

/** Kurze Systemmeldung — sie ist der Ersatz für das offene Fortschrittsfenster. */
function benachrichtige(titel, text) {
  try {
    if (Notification.isSupported()) new Notification({ title: titel, body: text }).show();
  } catch (_) {
    // Ohne Benachrichtigungsrecht bleibt der Stand im Menü sichtbar.
  }
}

const warteschlange = new Warteschlange({
  // Ein Ziel je Aufruf: kopieren und danach gegen die Karte nachprüfen.
  arbeite: (auftrag, ziel, { melde, sollAbbrechen }) =>
    sichereAufZiel({
      plan: auftrag.plan,
      zielBasis: ziel.pfad,
      methode: auftrag.methode,
      metadatenWunsch: auftrag.metadatenWunsch,
      melde,
      sollAbbrechen,
    }),
  melde: (ereignis) => {
    sendeStand(ereignis.stand);
    if (ereignis.art === 'auftragFertig') {
      const auftrag = ereignis.stand.alle.find((a) => a.id === ereignis.auftragId);
      if (auftrag) benachrichtige(auftrag.formatieren ? 'Karte gesichert' : 'Sicherung nicht vollständig', auftrag.satz);
    }
  },
});

function starteMenueleiste() {
  const wache = wacheEinstellungen();
  if (!wache.aktiv) return;
  if (!menueleiste) {
    try {
      menueleiste = new Menueleiste({
        stand: () => warteschlange.stand(),
        karten: gesteckteKarten,
        ziele: zieleMitStand,
        sichern: (pfad) => oeffneKartenfenster(pfad),
        abbrechen: (id) => warteschlange.abbrechen(id),
        fenster: () => zeigeFenster(),
        importFenster: () => oeffneImportFenster(),
        ansicht: (name) => zeigeFenster(name),
        wacheAktiv: () => wacheEinstellungen().aktiv,
        setzeWache: (aktiv) => {
          einstellungen.speichere(userDir(), { wache: { ...wacheEinstellungen(), aktiv } });
          if (aktiv) {
            starteMenueleiste();
            return;
          }
          stoppeMenueleiste();
          // Ohne Symbol gibt es keinen Weg zurück über die Menüleiste —
          // also sagen, wo der Schalter sonst noch steht.
          dialog.showMessageBox({
            type: 'info',
            message: 'Das Symbol in der Menüleiste ist aus.',
            detail: 'Gesteckte Karten werden nicht mehr gemeldet. Zurückholen lässt sich das '
              + 'im Fenster unter „Sichern & Ziele".',
            buttons: ['Gut'],
          });
        },
        beenden: () => {
          beendenErlaubt = warteschlange.stand().aktiv.length === 0;
          app.quit();
        },
      });
    } catch (err) {
      // Ohne Benachrichtigungsfeld (manche Linux-Oberflächen, Testläufe ohne
      // Sitzung) läuft die App weiter — nur eben ohne Symbol.
      console.warn(`Menüleiste nicht verfügbar: ${err.message}`);
      menueleiste = null;
    }
  }
  if (!kartenwache) {
    kartenwache = new Kartenwache({
      liste: listRemovable,
      takt: wache.takt,
      beiNeu: (geraet) => karteGesteckt(geraet),
      beiWeg: (pfad) => {
        // Abgezogene Karte: das Fenster dazu hat sich erledigt.
        const w = kartenfenster.get(pfad);
        if (w && !w.isDestroyed()) w.close();
        if (menueleiste) menueleiste.zeichne();
      },
    });
  }
  kartenwache.setzeTakt(wache.takt);
  kartenwache.starte();
}

function stoppeMenueleiste() {
  if (kartenwache) kartenwache.stoppe();
  if (menueleiste) menueleiste.zerstoere();
  menueleiste = null;
}

/** Eine Karte ist gesteckt worden. */
function karteGesteckt(geraet) {
  const wache = wacheEinstellungen();
  if (!wache.aktiv) return;
  if (wache.nurKameras && !geraet.kamera) return;
  if ((wache.ignoriert || []).includes(geraet.pfad)) return;
  if (menueleiste) menueleiste.zeichne();
  if (wache.sofort) {
    sichereKarte({ pfad: geraet.pfad }).then((r) => {
      if (!r.ok) benachrichtige('Karte nicht gesichert', r.fehler);
    });
    return;
  }
  oeffneKartenfenster(geraet.pfad);
}

/**
 * Das kleine Fenster, das beim Einstecken aufgeht: was ist auf der Karte, auf
 * welchen Zielen fehlt sie noch, und ein Knopf zum Sichern.
 */
function oeffneKartenfenster(pfad) {
  const schon = kartenfenster.get(pfad);
  if (schon && !schon.isDestroyed()) {
    schon.show();
    schon.focus();
    return;
  }
  const w = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 460,
    minHeight: 440,
    title: 'Karte gesteckt',
    backgroundColor: '#f6f5f0',
    resizable: true,
    minimizable: false,
    fullscreenable: false,
    titleBarStyle: IST_MAC ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.loadFile(path.join(__dirname, '..', 'renderer', 'karte.html'), { query: { pfad } });
  w.on('closed', () => kartenfenster.delete(pfad));
  kartenfenster.set(pfad, w);
}

/** Baut zu einer Karte den Plan und sagt, was auf welchem Ziel noch fehlt. */
async function karteStand(pfad, { unterordner = '', umbenennen = false } = {}) {
  const gespeichert = einstellungen.lade(userDir());
  const geraet = listRemovable().find((g) => g.pfad === pfad);
  const scan = await scanImport({
    quelle: pfad,
    schema: 'datum',
    ktx: { umbenennen, unterordner },
    melde: (text) => {
      const w = kartenfenster.get(pfad);
      if (w && !w.isDestroyed()) w.webContents.send('karte:fortschritt', { pfad, text });
    },
  });
  const liste = ziele.mitStand(gespeichert.ziele, volumeStand);
  const aufstellung = ziele.pruefeAufstellung(liste);
  const stand = [];
  for (const z of liste) {
    if (!z.angeschlossen) {
      stand.push({ ...z, gesamt: scan.plan.length, fehlend: null, vorhanden: 0 });
      continue;
    }
    // Vorprüfung nach Datum und Größe — schnell genug für den Moment des
    // Einsteckens. Nachgeprüft wird nach dem Kopieren über die Prüfsumme.
    const p = await pruefeZiel({ plan: scan.plan, zielBasis: z.pfad, methode: 'zeitgroesse' });
    stand.push({ ...z, gesamt: p.gesamt, fehlend: p.fehlend, vorhanden: p.vorhanden });
  }
  return {
    ok: true,
    pfad,
    name: geraet ? geraet.name : path.basename(pfad),
    kamera: Boolean(geraet && geraet.kamera),
    gefunden: scan.gefunden,
    geplant: scan.plan.length,
    uebersprungen: scan.uebersprungen.length,
    warnungen: scan.warnungen,
    hinweis: aufstellung.hinweis,
    ziele: stand,
    laufwerke: listVolumes(),
    sicherung: gespeichert.sicherung,
  };
}

/** Stellt die Karte als Hintergrundauftrag ein. */
async function sichereKarte({ pfad, unterordner = '', umbenennen = false, methode = 'zeitgroesse' }) {
  const gespeichert = einstellungen.lade(userDir());
  const liste = ziele.mitStand(gespeichert.ziele, volumeStand);
  const bereit = ziele.einsatzbereit(liste);
  if (bereit.length === 0) {
    return { ok: false, fehler: ziele.pruefeAufstellung(liste).hinweis };
  }
  const scan = await scanImport({ quelle: pfad, schema: 'datum', ktx: { umbenennen, unterordner } });
  if (scan.plan.length === 0) {
    return { ok: false, fehler: 'Auf der Karte ist nichts zu sichern.' };
  }
  einstellungen.speichere(userDir(), { sicherung: { ...gespeichert.sicherung, unterordner, umbenennen, methode } });
  const geraet = listRemovable().find((g) => g.pfad === pfad);
  const auftrag = warteschlange.stelleEin({
    quelle: pfad,
    quelleName: geraet ? geraet.name : path.basename(pfad),
    ziele: bereit.map((z) => ({ pfad: z.pfad, name: z.name, rolle: z.rolle })),
    plan: scan.plan,
    methode,
    schema: 'datum',
    notiz: unterordner,
  });
  return { ok: true, auftrag, zieleAnzahl: bereit.length };
}

// --- IPC: Ziele -------------------------------------------------------------

ipcMain.handle('ziele:stand', () => {
  const liste = zieleMitStand();
  return {
    ziele: liste,
    rollen: ziele.ROLLEN,
    laufwerke: listVolumes(),
    karten: gesteckteKarten(),
    aufstellung: ziele.pruefeAufstellung(liste),
    wache: wacheEinstellungen(),
    sicherung: einstellungen.lade(userDir()).sicherung,
    menueleiste: Boolean(menueleiste),
  };
});

ipcMain.handle('ziele:hinzufuegen', async (_e, vorgabe) => {
  let pfad = vorgabe && vorgabe.pfad;
  if (!pfad) {
    const ergebnis = await dialog.showOpenDialog(fenster, {
      title: 'Laufwerk oder Ordner als Ziel wählen',
      message: 'Laufwerk oder Ordner als Ziel wählen',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Als Ziel übernehmen',
    });
    if (ergebnis.canceled || ergebnis.filePaths.length === 0) return { ok: false, abgebrochen: true };
    pfad = ergebnis.filePaths[0];
  }
  const gespeichert = einstellungen.lade(userDir());
  const r = ziele.ergaenzeZiel(gespeichert.ziele, { pfad, name: vorgabe && vorgabe.name, rolle: vorgabe && vorgabe.rolle });
  if (r.fehler) return { ok: false, fehler: r.fehler };
  einstellungen.speichere(userDir(), { ziele: r.ziele });
  if (menueleiste) menueleiste.zeichne();
  return { ok: true, ziele: zieleMitStand(), neu: r.neu };
});

ipcMain.handle('ziele:aendern', (_e, { pfad, aenderungen }) => {
  const gespeichert = einstellungen.lade(userDir());
  const liste = ziele.setzeZiel(gespeichert.ziele, pfad, aenderungen || {});
  einstellungen.speichere(userDir(), { ziele: liste });
  if (menueleiste) menueleiste.zeichne();
  return { ok: true, ziele: zieleMitStand() };
});

ipcMain.handle('ziele:entfernen', (_e, pfad) => {
  const gespeichert = einstellungen.lade(userDir());
  einstellungen.speichere(userDir(), { ziele: ziele.entferneZiel(gespeichert.ziele, pfad) });
  if (menueleiste) menueleiste.zeichne();
  return { ok: true, ziele: zieleMitStand() };
});

ipcMain.handle('wache:setzen', (_e, aenderungen) => {
  const wache = { ...wacheEinstellungen(), ...(aenderungen || {}) };
  einstellungen.speichere(userDir(), { wache });
  if (wache.aktiv) starteMenueleiste();
  else stoppeMenueleiste();
  if (menueleiste) menueleiste.zeichne();
  return { ok: true, wache: wacheEinstellungen(), menueleiste: Boolean(menueleiste) };
});

// --- IPC: Karte und Aufträge -----------------------------------------------

ipcMain.handle('karte:stand', async (_e, { pfad, unterordner, umbenennen }) => {
  if (!pfad) return { ok: false, fehler: 'Keine Karte angegeben.' };
  try {
    return await karteStand(pfad, { unterordner, umbenennen });
  } catch (err) {
    return { ok: false, fehler: String(err.message || err) };
  }
});

ipcMain.handle('karte:sichern', async (_e, daten) => {
  try {
    const r = await sichereKarte(daten || {});
    if (r.ok) {
      const w = kartenfenster.get(daten.pfad);
      if (w && !w.isDestroyed()) w.close();
    }
    return r;
  } catch (err) {
    return { ok: false, fehler: String(err.message || err) };
  }
});

ipcMain.handle('karte:ignorieren', (_e, { pfad, dauerhaft }) => {
  if (dauerhaft && pfad) {
    const wache = wacheEinstellungen();
    einstellungen.speichere(userDir(), {
      wache: { ...wache, ignoriert: [...new Set([...(wache.ignoriert || []), pfad])] },
    });
  }
  const w = kartenfenster.get(pfad);
  if (w && !w.isDestroyed()) w.close();
  return { ok: true };
});

ipcMain.handle('karte:oeffnen', (_e, pfad) => {
  oeffneKartenfenster(pfad);
  return { ok: true };
});

ipcMain.handle('auftraege:stand', () => warteschlange.stand());

ipcMain.handle('auftraege:abbrechen', (_e, id) => {
  warteschlange.abbrechen(id);
  return warteschlange.stand();
});

ipcMain.handle('auftraege:aufraeumen', () => {
  warteschlange.aufraeumen();
  return warteschlange.stand();
});

ipcMain.handle('laufwerke:liste', () => listVolumes());

ipcMain.handle('fenster:zeigen', (_e, ansicht) => {
  zeigeFenster(typeof ansicht === 'string' ? ansicht : '');
  return { ok: true };
});
