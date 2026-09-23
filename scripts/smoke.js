'use strict';

/**
 * Headless-Durchlauf durch die fertige App.
 *
 * Startet den echten Hauptprozess, klickt sich durch die Oberfläche, legt eine
 * Ordnerstruktur auf der Platte an, importiert von einer nachgebauten
 * Speicherkarte und lässt die vier Aufräum-Aufgaben laufen. Nebenbei entstehen
 * die Screenshots für die README.
 *
 *   npm run smoke              (unter Linux via xvfb-run)
 *   npm run smoke -- --keep    Arbeitsordner nicht aufräumen
 *
 * Beendet sich mit Code 1, sobald eine Prüfung fehlschlägt.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const SCREENSHOTS = path.join(WURZEL, 'docs', 'screenshots');
const BEHALTEN = process.argv.includes('--keep');

// Eigene Dateien in einen Wegwerfordner umleiten, damit ein echter
// Benutzerdatenordner vom Testlauf unberührt bleibt.
const arbeitsordner = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-smoke-'));
process.env.LZ_USER_DATA = path.join(arbeitsordner, 'userdata');
process.env.SOLA_USER_PRESETS = path.join(arbeitsordner, 'userdata', 'presets');

// Auf CI-Runnern gibt es keine GPU. Ohne Software-Rendering liefert
// capturePage() dort nur einen UnknownVizError. Muss vor dem ready-Ereignis
// stehen, also vor dem Laden des Hauptprozesses.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');

require(path.join(WURZEL, 'src', 'main', 'main.js'));

const { buildPlan } = require(path.join(WURZEL, 'src', 'core', 'structure'));
const presetStore = require(path.join(WURZEL, 'src', 'core', 'presetStore'));

const warten = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];

function pruefe(bedingung, beschreibung, detail) {
  if (bedingung) {
    console.log(`  ok   ${beschreibung}`);
  } else {
    console.error(`  FEHL ${beschreibung}${detail ? ` — ${detail}` : ''}`);
    fehler.push(beschreibung);
  }
}

/** Nimmt das Fenster auf, nachdem der Inhalt nach oben gescrollt wurde. */
async function screenshot(win, name, zuAbschnitt) {
  if (zuAbschnitt) {
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(zuAbschnitt)}).scrollIntoView({ block: 'start' })`,
      true,
    );
    await warten(400);
  } else {
    await win.webContents.executeJavaScript(
      "(document.querySelector('main') || document.documentElement).scrollTop = 0",
      true,
    );
    await warten(200);
  }
  // Ein misslungener Screenshot darf die übrigen Prüfungen nicht verschlucken.
  try {
    const bild = await win.webContents.capturePage();
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    fs.writeFileSync(path.join(SCREENSHOTS, name), bild.toPNG());
    console.log(`  bild ${name}`);
  } catch (err) {
    console.error(`  FEHL Screenshot ${name} — ${err.message}`);
    fehler.push(`Screenshot ${name}`);
  }
}

/** Zählt alle Ordner unterhalb eines Pfades. */
function zaehleOrdner(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .reduce((summe, e) => summe + 1 + zaehleOrdner(path.join(dir, e.name)), 0);
}

/** Die Konfiguration, die der Testlauf in der Oberfläche einstellt. */
const TEST_CONFIG = {
  teens: { start: '2026-06-13', tage: 8, bereiche: ['foto', 'video', 'orga'], fotografen: ['Lars', 'Maja'], videografen: ['Jonas'] },
  kids: { start: '2026-08-01', tage: 8, bereiche: ['showfiles'], fotografen: [], videografen: [] },
  // Kürzere Dauer, damit die Einstellung im Durchlauf wirklich geprüft wird.
  sofa: { start: '2026-09-05', tage: 4, bereiche: ['showfiles'], fotografen: [], videografen: [] },
  next: { start: '2026-10-02', tage: 3, bereiche: ['orga'], fotografen: [], videografen: [] },
};

/** Füllt das Formular so, wie es ein Klick durch die Oberfläche täte. */
const FORMULAR_FUELLEN = `(async () => {
  const config = ${JSON.stringify(TEST_CONFIG)};
  const anhaken = (el) => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); };

  for (const [schluessel, daten] of Object.entries(config)) {
    const karte = document.querySelector('.projekt[data-projekt="' + schluessel + '"]');
    anhaken(karte.querySelector('.projekt-aktiv'));

    const start = karte.querySelector('.projekt-start');
    start.value = daten.start;
    start.dispatchEvent(new Event('change', { bubbles: true }));

    const tage = karte.querySelector('.projekt-tage');
    tage.value = String(daten.tage);
    tage.dispatchEvent(new Event('input', { bubbles: true }));

    for (const bereich of daten.bereiche) anhaken(karte.querySelector('[data-bereich="' + bereich + '"]'));

    for (const liste of ['fotografen', 'videografen']) {
      daten[liste].forEach((name, i) => {
        const feld = karte.querySelector('.namen-spalte[data-liste="' + liste + '"] input[data-index="' + i + '"]');
        feld.value = name;
        feld.dispatchEvent(new Event('input', { bubbles: true }));
        feld.dispatchEvent(new Event('blur', { bubbles: true }));
      });
    }
  }

  const kuerzel = document.getElementById('kuerzel');
  kuerzel.value = 'L.Z.';
  kuerzel.dispatchEvent(new Event('input', { bubbles: true }));

  await new Promise((r) => setTimeout(r, 600));
  document.getElementById('vorschauBox').open = true;
  await new Promise((r) => setTimeout(r, 300));

  return {
    planInfo: document.getElementById('planInfo').textContent,
    vorschauZeilen: document.getElementById('vorschauBaum').textContent.split('\\n').filter(Boolean).length,
    presetsAktiv: !document.getElementById('btnPresets').disabled,
    projektKarten: document.querySelectorAll('.projekt').length,
    presetAnlaesse: [...document.querySelectorAll('#presetSola option')].map((o) => o.value),
    teensNamenFrei: [...document.querySelectorAll('.projekt[data-projekt="teens"] .namen-spalte input')].filter((i) => !i.disabled).length,
    kidsNamenFrei: [...document.querySelectorAll('.projekt[data-projekt="kids"] .namen-spalte input')].filter((i) => !i.disabled).length,
  };
})()`;

/** Misst, ob der Seiteninhalt in die Fensterbreite passt. */
const LAYOUT_MESSEN = `(() => ({
  breite: document.documentElement.clientWidth,
  inhaltsbreite: document.documentElement.scrollWidth,
  tabelleScrollt: (() => {
    const box = document.querySelector('.tabelle-scroll');
    return box ? box.scrollWidth > box.clientWidth : false;
  })(),
  projektSpalten: getComputedStyle(document.getElementById('projekte')).gridTemplateColumns.split(' ').length,
}))()`;

/** Wartet, bis eine Aufgabe ihre Vorschau bzw. ihren Lauf beendet hat. */
const aufgabeLaufen = (aufgabe, knopf) => `(async () => {
  const abschnitt = document.getElementById('ansicht-${aufgabe}');
  abschnitt.querySelector('.${knopf}').click();
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const knopfAn = abschnitt.querySelector('.${knopf}');
    const text = abschnitt.querySelector('.fortschritt').textContent;
    if (!/Prüfe|Arbeite|Durchsuche/.test(knopfAn.textContent + text) && text) break;
  }
  return {
    fortschritt: abschnitt.querySelector('.fortschritt').textContent,
    zusammenfassung: abschnitt.querySelector('.zusammenfassung').textContent,
    zeilen: abschnitt.querySelectorAll('.liste li').length,
    kannAusfuehren: !abschnitt.querySelector('.ausfuehren').disabled,
  };
})()`;

app.whenReady().then(async () => {
  const ziel = path.join(arbeitsordner, 'ziel');
  try {
    await warten(2500);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('Es wurde kein Fenster geöffnet.');

    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) {
        console.error(`  FEHL Renderer-Fehler: ${e.message}`);
        fehler.push('Renderer-Fehler');
      }
    });
    const imFenster = (js) => win.webContents.executeJavaScript(js, true);
    const geheZu = async (ansicht) => {
      await imFenster(`zeigeAnsicht(${JSON.stringify(ansicht)})`);
      await warten(250);
    };

    console.log('\n· Startseite');
    await screenshot(win, '01-start.png');
    const vorlagenNamen = await imFenster('zustand.vorlagen.map((v) => v.id).join(", ")');
    pruefe(
      vorlagenNamen === 'sola, projekt, reise, privat, leer',
      'die fünf mitgelieferten Vorlagen stehen zur Auswahl',
      vorlagenNamen,
    );
    const startVorgaben = await imFenster('zustand.vorgaben.length');
    pruefe(startVorgaben === 5, 'die fünf mitgelieferten Lightroom-Vorgaben sind gelistet', `gelistet: ${startVorgaben}`);

    const werkzeuge = await imFenster('JSON.stringify(zustand.info.werkzeuge)').then(JSON.parse);
    pruefe(werkzeuge.exiftool === true, 'ExifTool steht bereit');
    pruefe(
      werkzeuge.exiftoolQuelle === 'mitgeliefert',
      'ExifTool kommt aus dem Paket, nicht vom Rechner',
      werkzeuge.exiftoolQuelle,
    );

    console.log('\n· Ordnerstruktur ausfüllen');
    await geheZu('struktur');
    const zustand = await imFenster(FORMULAR_FUELLEN);
    const plan = buildPlan(
      Object.fromEntries(
        Object.entries(TEST_CONFIG).map(([key, daten]) => [
          key,
          {
            aktiv: true,
            start: daten.start,
            tage: daten.tage,
            bereiche: Object.fromEntries(daten.bereiche.map((b) => [b, true])),
            fotografen: daten.fotografen,
            videografen: daten.videografen,
          },
        ]),
      ),
    );
    pruefe(
      zustand.vorschauZeilen === plan.ordner.length,
      'die Vorschau zeigt genau den geplanten Baum',
      `Vorschau ${zustand.vorschauZeilen}, Plan ${plan.ordner.length}`,
    );
    pruefe(zustand.planInfo.includes('Sola_2026'), 'das Jahr kommt aus dem Startdatum', zustand.planInfo);
    pruefe(zustand.projektKarten === 4, 'alle vier Solas stehen zur Auswahl', `${zustand.projektKarten} Karten`);
    pruefe(
      zustand.presetAnlaesse.join(', ') === 'Teens, Kids, SOFA, Sola next',
      'die Lightroom-Vorgaben lassen sich für jeden Block erzeugen',
      zustand.presetAnlaesse.join(', '),
    );
    pruefe(zustand.teensNamenFrei === 20, 'Foto und Video geben je zehn Namensfelder frei', String(zustand.teensNamenFrei));
    pruefe(zustand.kidsNamenFrei === 0, 'ohne Foto/Video bleiben die Namensfelder gesperrt', String(zustand.kidsNamenFrei));
    await screenshot(win, '02-ausgefuellt.png');

    console.log('\n· Ordnerstruktur anlegen');
    fs.mkdirSync(ziel, { recursive: true });
    const meldung = await imFenster(`(async () => {
      zustand.pfad = ${JSON.stringify(ziel)};
      await aktualisiereStruktur();
      document.getElementById('btnErstellen').click();
      await new Promise((r) => setTimeout(r, 1500));
      return document.getElementById('meldungen').textContent;
    })()`);
    const aufPlatte = zaehleOrdner(ziel);
    pruefe(aufPlatte === plan.ordner.length, 'jeder geplante Ordner liegt auf der Platte', `${aufPlatte} von ${plan.ordner.length}`);
    pruefe(/angelegt/.test(meldung), 'die Erfolgsmeldung bleibt stehen', meldung.slice(0, 80));

    const tagesordner = fs
      .readdirSync(path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto'))
      .sort((a, b) => a.localeCompare(b, 'de'));
    pruefe(
      tagesordner[0] === '1_Tag_13-06-2026' && tagesordner[7] === '8_Tag_20-06-2026',
      'die Tagesordner sortieren nach Tag',
      tagesordner.join(', '),
    );
    pruefe(tagesordner[8] === 'LR Kataloge', '"LR Kataloge" steht hinter den Tagesordnern', tagesordner[8]);
    const solaOrdner = fs.readdirSync(path.join(ziel, 'Sola_2026')).sort();
    pruefe(
      solaOrdner.join(', ') === '01_Teens, 02_Kids, 03_SOFA, 04_Sola_next',
      'jedes Sola bekommt seinen festen Ordner',
      solaOrdner.join(', '),
    );
    const sofaTage = fs.readdirSync(path.join(ziel, 'Sola_2026', '03_SOFA', '01_Showfiles'));
    pruefe(sofaTage.length === 4, 'die eingestellte Dauer schlägt auf die Tagesordner durch', `${sofaTage.length} statt 4`);
    await screenshot(win, '03-erstellt.png');

    console.log('\n· Vorlage wechseln und anpassen');
    const privatZiel = path.join(arbeitsordner, 'privat');
    fs.mkdirSync(privatZiel, { recursive: true });
    const privat = await imFenster(`(async () => {
      const wahl = document.getElementById('vorlageWahl');
      wahl.value = 'projekt';
      wahl.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const name = document.getElementById('projektName');
      name.value = 'Hochzeit Meier';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const jahr = document.getElementById('jahr');
      jahr.value = '2026';
      jahr.dispatchEvent(new Event('input', { bubbles: true }));
      const karte = document.querySelector('.projekt');
      karte.querySelector('.projekt-aktiv').checked = true;
      karte.querySelector('.projekt-aktiv').dispatchEvent(new Event('change', { bubbles: true }));
      for (const b of ['foto', 'video', 'unterlagen']) {
        const box = karte.querySelector('[data-bereich="' + b + '"]');
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 400));
      zustand.pfad = ${JSON.stringify(privatZiel)};
      await aktualisiereStruktur();
      document.getElementById('btnErstellen').click();
      await new Promise((r) => setTimeout(r, 1200));
      return { wurzel: zustand.letzterPlan.wurzel, jahrSichtbar: !document.getElementById('feldJahr').hidden, nameSichtbar: !document.getElementById('feldName').hidden };
    })()`);
    pruefe(privat.wurzel === '2026_Hochzeit Meier', 'die private Vorlage baut den Hauptordner aus Jahr und Namen', privat.wurzel);
    pruefe(privat.nameSichtbar, 'das Namensfeld erscheint nur, wenn die Vorlage es braucht');
    pruefe(
      fs.existsSync(path.join(privatZiel, '2026_Hochzeit Meier', '01_Foto', '01_Original')),
      'die Bereiche der privaten Vorlage liegen auf der Platte',
    );
    pruefe(
      !fs.existsSync(path.join(privatZiel, '2026_Hochzeit Meier', '03_Grafik')),
      'nicht angewählte Bereiche entstehen nicht',
    );

    await geheZu('vorlagen');
    const eigene = await imFenster(`(async () => {
      document.getElementById('editorWahl').value = 'projekt';
      oeffneEditor('projekt');
      const name = document.getElementById('editorName');
      name.value = 'Meine Hochzeitsvorlage';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      // Über den Knopf anlegen und dann füllen — genau der Weg der Oberfläche.
      document.getElementById('btnBereichNeu').click();
      const neu = zustand.entwurf.bereiche[zustand.entwurf.bereiche.length - 1];
      neu.label = 'Gastgeschenke';
      neu.unterordner = ['01_Ideen'];
      zeichneBereichZeilen();
      await new Promise((r) => setTimeout(r, 500));
      const probeVorher = document.getElementById('editorProbe').textContent;
      document.getElementById('btnVorlageKopie').click();
      await new Promise((r) => setTimeout(r, 900));
      return {
        ids: zustand.vorlagen.map((v) => v.id),
        aktiv: zustand.vorlage.id,
        bereiche: zustand.vorlage.bereiche.map((b) => b.label),
        probe: probeVorher,
      };
    })()`);
    pruefe(eigene.ids.includes('meine-hochzeitsvorlage'), 'eine eigene Vorlage lässt sich speichern', eigene.ids.join(', '));
    pruefe(eigene.bereiche.includes('Gastgeschenke'), 'der neue Bereich steht in der eigenen Vorlage', eigene.bereiche.join(', '));
    pruefe(eigene.ids.includes('projekt'), 'die mitgelieferte Vorlage bleibt unverändert erhalten');
    pruefe(
      eigene.probe.includes('Gastgeschenke') && eigene.probe.includes('01_Ideen'),
      'der Editor zeigt den Baum, den der Entwurf ergäbe',
      eigene.probe.split('\n').slice(0, 3).join(' / '),
    );
    await screenshot(win, '07-vorlage.png');
    await screenshot(win, '10-vorlage-probe.png', '#editorProbe');

    // Zurück auf Sola, damit Import und Screenshots darauf aufsetzen.
    await geheZu('struktur');
    await imFenster(`(async () => {
      const wahl = document.getElementById('vorlageWahl');
      wahl.value = 'sola';
      wahl.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      zustand.pfad = ${JSON.stringify(ziel)};
      await aktualisiereStruktur();
    })()`);

    console.log('\n· Lightroom-Vorgaben verwalten');
    await geheZu('lightroom');
    // Den Dateidialog überspringen und stattdessen direkt einlesen; alles
    // Weitere läuft danach über die echten IPC-Aufrufe der Oberfläche.
    const eigeneQuelle = path.join(arbeitsordner, 'Sonnenuntergang.xmp');
    fs.copyFileSync(path.join(WURZEL, 'resources', 'presets', 'SOLA_Draussen.xmp'), eigeneQuelle);
    const importiert = presetStore.importPreset({
      quellPfad: eigeneQuelle,
      userDir: process.env.SOLA_USER_PRESETS,
      bundledDir: path.join(WURZEL, 'resources', 'presets'),
    });
    pruefe(importiert.ok, 'eine eigene Vorgabe lässt sich einlesen', importiert.grund);

    const nachImport = await imFenster(`(async () => {
      zeigeVorgaben(await lz.presetsListe());
      await new Promise((r) => setTimeout(r, 200));
      const zeilen = [...document.querySelectorAll('#vorgabenListe tr')];
      return {
        anzahl: zeilen.length,
        eigene: zeilen.filter((z) => z.textContent.includes('eigen')).length,
        entfernenKnoepfe: document.querySelectorAll('#vorgabenListe .knopf-klein').length,
      };
    })()`);
    pruefe(nachImport.anzahl === 6, 'die eigene Vorgabe erscheint in der Tabelle', `Zeilen: ${nachImport.anzahl}`);
    pruefe(nachImport.eigene === 1, 'sie ist als "eigen" gekennzeichnet', String(nachImport.eigene));
    pruefe(nachImport.entfernenKnoepfe === 1, 'nur eigene Vorgaben lassen sich entfernen', String(nachImport.entfernenKnoepfe));
    await screenshot(win, '04-vorgaben.png');

    // Abwählen über die Oberfläche, inklusive Rückweg über das Manifest.
    const nachAbwahl = await imFenster(`(async () => {
      const zeile = [...document.querySelectorAll('#vorgabenListe tr')].find((z) => z.dataset.datei === 'RAW.lrtemplate');
      const box = zeile.querySelector('input[type=checkbox]');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return zustand.vorgaben.filter((v) => v.aktiv).length;
    })()`);
    pruefe(nachAbwahl === 5, 'eine abgewählte Vorgabe zählt nicht mehr mit', String(nachAbwahl));

    const nachEntfernen = await imFenster(`(async () => {
      const zeile = [...document.querySelectorAll('#vorgabenListe tr')].find((z) => z.dataset.datei === 'Sonnenuntergang.xmp');
      zeile.querySelector('.knopf-klein').click();
      await new Promise((r) => setTimeout(r, 500));
      return document.querySelectorAll('#vorgabenListe tr').length;
    })()`);
    pruefe(nachEntfernen === 5, 'nach dem Entfernen bleiben die mitgelieferten übrig', String(nachEntfernen));

    console.log('\n· Importfenster');
    // Quelle mit datierten Dateinamen, damit der Import auch ohne ExifTool
    // (auf dem CI-Runner ist keines installiert) das Datum bestimmen kann.
    const importQuelle = path.join(arbeitsordner, 'karte');
    fs.mkdirSync(path.join(importQuelle, 'DCIM'), { recursive: true });
    fs.writeFileSync(path.join(importQuelle, '20260613_101010_a.jpg'), 'AAA'); // Tag 1
    fs.writeFileSync(path.join(importQuelle, 'DCIM', '20260615_120000_b.jpg'), 'BBBB'); // Tag 3, rekursiv
    fs.writeFileSync(path.join(importQuelle, '20260501_090000_c.jpg'), 'CC'); // außerhalb der Sola-Woche

    await geheZu('import');
    await imFenster("document.getElementById('btnImportFenster').click()");
    await warten(1200);
    const importWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('import.html'));
    pruefe(Boolean(importWin), 'das Importfenster öffnet sich als eigenes Fenster');

    if (importWin) {
      importWin.webContents.on('console-message', (e) => {
        if (e.level === 'error' || e.level === 3) {
          console.error(`  FEHL Importfenster-Fehler: ${e.message}`);
          fehler.push('Importfenster-Fehler');
        }
      });
      await warten(600); // Kontext + Geräteliste laden lassen
      const imImport = (js) => importWin.webContents.executeJavaScript(js, true);

      const importErg = await imImport(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const setSel = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
        setSel('schema', 'sola'); await sleep(100);
        setSel('sola', 'teens'); await sleep(50);
        setSel('bereich', 'foto'); await sleep(50);
        setSel('person', 'Lars'); await sleep(50);
        setzeQuelle(${JSON.stringify(importQuelle)});
        await sleep(50);
        document.getElementById('btnVergleichen').click();
        await sleep(900);
        const kacheln = document.getElementById('kacheln').textContent;
        const zeilen = document.querySelectorAll('#ergebnisListe tr').length;
        const kannKopieren = !document.getElementById('btnKopieren').disabled;
        document.getElementById('btnKopieren').click();
        await sleep(1400);
        return { kacheln, zeilen, kannKopieren, fortschritt: document.getElementById('fortschritt').textContent };
      })()`);

      pruefe(/2/.test(importErg.kacheln), 'der Vergleich zählt die neuen Dateien', importErg.kacheln.replace(/\s+/g, ' '));
      pruefe(importErg.zeilen >= 2, 'das Vergleichsergebnis listet die Dateien', `Zeilen: ${importErg.zeilen}`);
      pruefe(importErg.kannKopieren, 'nach dem Vergleich lässt sich kopieren', importErg.fortschritt);
      await screenshot(importWin, '06-import.png');

      const importRaw1 = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '1_Tag_13-06-2026', '05_Lars', '01_ImportRAW');
      const importRaw3 = path.join(ziel, 'Sola_2026', '01_Teens', '01_Foto', '3_Tag_15-06-2026', '05_Lars', '01_ImportRAW');
      pruefe(fs.existsSync(path.join(importRaw1, '20260613_101010_a.jpg')), 'das Tag-1-Foto landet im ImportRAW-Ordner');
      pruefe(fs.existsSync(path.join(importRaw3, '20260615_120000_b.jpg')), 'das Datum trifft den Tag-3-Ordner (auch aus einem Unterordner)');
      pruefe(fs.existsSync(path.join(importQuelle, '20260613_101010_a.jpg')), 'die Quelldatei bleibt erhalten (kopiert, nicht verschoben)');
      pruefe(fs.existsSync(path.join(ziel, '_Import-Protokolle')), 'der Import schreibt ein Protokoll');

      // Ein zweiter Vergleich muss alles als „schon vorhanden" erkennen.
      const zweit = await imImport(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.getElementById('btnVergleichen').click();
        await sleep(900);
        return document.getElementById('kacheln').textContent;
      })()`);
      pruefe(/vorhanden/.test(zweit), 'der zweite Vergleich erkennt die Dateien als schon vorhanden', zweit.replace(/\s+/g, ' '));

      importWin.close();
      await warten(300);
    }

    // ---------------------------------------------------------------------
    console.log('\n· Fotos einsortieren');
    const chaos = path.join(arbeitsordner, 'chaos');
    fs.mkdirSync(path.join(chaos, 'kram'), { recursive: true });
    fs.writeFileSync(path.join(chaos, '20240712_140000.jpg'), 'foto-a');
    fs.writeFileSync(path.join(chaos, 'kram', '20240712_150000.jpg'), 'foto-b');
    fs.writeFileSync(path.join(chaos, '20251224_180000.mp4'), 'video-c');
    const fotoZiel = path.join(arbeitsordner, 'fotos-sortiert');

    await geheZu('fotos');
    const fotoVorschau = await imFenster(`(async () => {
      const a = document.getElementById('ansicht-fotos');
      a.querySelector('input[data-rolle="quelle"]').value = ${JSON.stringify(chaos)};
      a.querySelector('input[data-rolle="ziel"]').value = ${JSON.stringify(fotoZiel)};
      a.querySelector('[data-opt="schema"]').value = 'jahr-monat-tag';
      return true;
    })()`);
    pruefe(fotoVorschau === true, 'die Felder der Aufgabe lassen sich setzen');

    const fotoGeprueft = await imFenster(aufgabeLaufen('fotos', 'pruefen'));
    pruefe(/3/.test(fotoGeprueft.zusammenfassung), 'die Vorschau findet alle drei Dateien', fotoGeprueft.zusammenfassung.replace(/\s+/g, ' '));
    pruefe(fotoGeprueft.zeilen === 3, 'jede Datei steht einzeln in der Liste', String(fotoGeprueft.zeilen));
    pruefe(fotoGeprueft.kannAusfuehren, 'nach der Vorschau lässt sich einsortieren', fotoGeprueft.fortschritt);
    await screenshot(win, '08-fotos.png');

    const fotoFertig = await imFenster(aufgabeLaufen('fotos', 'ausfuehren'));
    pruefe(/Fertig/.test(fotoFertig.fortschritt), 'das Einsortieren meldet sich fertig', fotoFertig.fortschritt);
    pruefe(
      fs.existsSync(path.join(fotoZiel, '2024', '202407', '20240712', '20240712_140000.jpg')),
      'das Foto liegt im Datumsbaum JJJJ/JJJJMM/JJJJMMDD',
    );
    pruefe(
      fs.existsSync(path.join(fotoZiel, '2024', '202407', '20240712', '20240712_150000.jpg')),
      'auch die Datei aus dem Unterordner ist einsortiert',
    );
    pruefe(
      fs.existsSync(path.join(fotoZiel, '2025', '202512', '20251224', '20251224_180000.mp4')),
      'Videos landen im selben Baum',
    );
    pruefe(!fs.existsSync(path.join(chaos, '20240712_140000.jpg')), 'die Quelldatei wurde verschoben, nicht kopiert');
    pruefe(fs.existsSync(path.join(fotoZiel, '_Sortier-Protokolle')), 'das Einsortieren schreibt ein Protokoll');

    console.log('\n· Abbrechen');
    const abbruchKnoepfe = await imFenster(
      "[...document.querySelectorAll('.aufgabe .abbrechen')].length",
    );
    pruefe(abbruchKnoepfe === 4, 'jede Aufgabe hat einen Abbrechen-Knopf', String(abbruchKnoepfe));
    const abbruchVersteckt = await imFenster(
      "[...document.querySelectorAll('.aufgabe .abbrechen')].every((k) => k.hidden)",
    );
    pruefe(abbruchVersteckt, 'er taucht erst auf, wenn wirklich etwas läuft');

    console.log('\n· Kameras und Metadaten');
    await geheZu('kameras');
    const kameraStand = await imFenster(`(async () => {
      const setzen = (id, wert) => {
        const el = document.getElementById(id);
        el.value = wert;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setzen('metaUrheber', 'Lars Zumpe');
      setzen('metaStichworte', 'Sola 2026, Teens');
      const gps = document.getElementById('metaGps');
      gps.checked = true;
      gps.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      const frisch = await lz.einstellungenLesen();
      return { metadaten: frisch.metadaten, leerText: document.getElementById('kameraListe').textContent };
    })()`);
    pruefe(kameraStand.metadaten.urheber === 'Lars Zumpe', 'der Urheber wird gemerkt', kameraStand.metadaten.urheber);
    pruefe(kameraStand.metadaten.gpsEntfernen === true, 'das GPS-Häkchen wird gemerkt');
    pruefe(
      /Noch keine Kamera gesehen/.test(kameraStand.leerText),
      'ohne gesehene Kamera steht dort, was zu tun ist',
      kameraStand.leerText.slice(0, 60),
    );
    await screenshot(win, '11-kameras.png');

    console.log('\n· Doppelte Dateien');
    const doppelt = path.join(arbeitsordner, 'doppelt');
    fs.mkdirSync(path.join(doppelt, 'unten'), { recursive: true });
    fs.writeFileSync(path.join(doppelt, 'brief.txt'), 'derselbe Inhalt');
    fs.writeFileSync(path.join(doppelt, 'unten', 'brief_kopie.txt'), 'derselbe Inhalt');
    fs.writeFileSync(path.join(doppelt, 'anders.txt'), 'etwas anderes');

    await geheZu('duplikate');
    await imFenster(`document.querySelector('#ansicht-duplikate input[data-rolle="quelle"]').value = ${JSON.stringify(doppelt)}`);
    const dupGeprueft = await imFenster(aufgabeLaufen('duplikate', 'pruefen'));
    pruefe(dupGeprueft.zeilen === 1, 'genau ein Doppelgänger wird gefunden', String(dupGeprueft.zeilen));
    await imFenster(aufgabeLaufen('duplikate', 'ausfuehren'));
    const uebrig = [
      fs.existsSync(path.join(doppelt, 'brief.txt')),
      fs.existsSync(path.join(doppelt, 'unten', 'brief_kopie.txt')),
    ];
    pruefe(uebrig[0] && !uebrig[1], 'die kürzer benannte Fassung bleibt erhalten', uebrig.join('/'));
    pruefe(fs.existsSync(path.join(doppelt, 'anders.txt')), 'eine inhaltlich andere Datei bleibt unberührt');

    console.log('\n· Aufräumen');
    const muell = path.join(arbeitsordner, 'muell');
    fs.mkdirSync(muell, { recursive: true });
    fs.writeFileSync(path.join(muell, 'folder.jpg'), 'cover');
    fs.writeFileSync(path.join(muell, 'com.hersteller.app.png'), 'icon');
    fs.writeFileSync(path.join(muell, 'leer.txt'), '');
    fs.writeFileSync(path.join(muell, 'urlaub.jpg'), 'ein echtes Foto, das bleiben muss');

    await geheZu('aufraeumen');
    await imFenster(`document.querySelector('#ansicht-aufraeumen input[data-rolle="quelle"]').value = ${JSON.stringify(muell)}`);
    const muellGeprueft = await imFenster(aufgabeLaufen('aufraeumen', 'pruefen'));
    pruefe(muellGeprueft.zeilen === 3, 'Cover, Icon und leere Datei werden erkannt', String(muellGeprueft.zeilen));
    await screenshot(win, '09-aufraeumen.png');
    await imFenster(aufgabeLaufen('aufraeumen', 'ausfuehren'));
    pruefe(fs.existsSync(path.join(muell, 'urlaub.jpg')), 'das echte Foto bleibt liegen');
    pruefe(!fs.existsSync(path.join(muell, 'folder.jpg')), 'das Album-Cover ist weg');

    console.log('\n· Layout');
    for (const [breite, hoehe, name] of [[1240, 920, null], [900, 900, null], [620, 900, '05-schmal.png']]) {
      win.setSize(breite, hoehe);
      await warten(500);
      const layout = await imFenster(LAYOUT_MESSEN);
      pruefe(
        layout.inhaltsbreite <= layout.breite + 1,
        `bei ${breite} px scrollt die Seite nicht seitlich`,
        `Inhalt ${layout.inhaltsbreite} px, Fenster ${layout.breite} px`,
      );
      if (breite <= 900) {
        pruefe(layout.projektSpalten === 1, `bei ${breite} px stehen die Blöcke untereinander`, `${layout.projektSpalten} Spalten`);
      }
      if (name) {
        await geheZu('struktur');
        await screenshot(win, name);
      }
    }
  } catch (err) {
    console.error('\nAbbruch:', err && err.stack ? err.stack : err);
    fehler.push(String(err));
  }

  if (BEHALTEN) {
    console.log(`\nArbeitsordner behalten: ${arbeitsordner}`);
  } else {
    fs.rmSync(arbeitsordner, { recursive: true, force: true });
  }

  console.log(fehler.length === 0 ? '\nAlle Prüfungen bestanden.' : `\n${fehler.length} Prüfung(en) fehlgeschlagen.`);
  app.exit(fehler.length === 0 ? 0 : 1);
});
