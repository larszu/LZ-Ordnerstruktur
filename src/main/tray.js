'use strict';

/**
 * Das Symbol in der Menüleiste (macOS oben neben der Uhr, unter Windows im
 * Infobereich).
 *
 * Es hat zwei Aufgaben: Es zeigt, dass die App noch arbeitet, auch wenn kein
 * Fenster offen ist, und es ist der kürzeste Weg zu einer gesteckten Karte.
 * Der Fortschritt steht im Menü, nicht in einem Fenster, das offen bleiben muss.
 */

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

const IST_MAC = process.platform === 'darwin';

/** Das Symbol: auf macOS ein Template-Bild, das das System selbst einfärbt. */
function symbol() {
  const datei = IST_MAC ? 'trayTemplate.png' : 'tray.png';
  const bild = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', datei));
  if (IST_MAC) bild.setTemplateImage(true);
  return bild;
}

class Menueleiste {
  /**
   * @param {object} haken Alles, was das Menü auslösen kann.
   * @param {() => object} haken.stand        Stand der Warteschlange
   * @param {() => Array} haken.karten        Gesteckte Karten (Pfad, Name)
   * @param {() => Array} haken.ziele         Ziele mit Stand
   * @param {(pfad: string) => void} haken.sichern
   * @param {(id: string) => void} haken.abbrechen
   * @param {() => void} haken.fenster        Hauptfenster zeigen
   * @param {() => void} haken.importFenster
   * @param {(ansicht: string) => void} haken.ansicht
   * @param {() => boolean} haken.wacheAktiv
   * @param {(aktiv: boolean) => void} haken.setzeWache
   * @param {() => void} haken.beenden
   */
  constructor(haken) {
    this.haken = haken;
    this.tray = new Tray(symbol());
    this.tray.setToolTip('LZ Ordnerstruktur');
    // Klick auf das Symbol öffnet das Menü — auch unter Windows, wo ein
    // Linksklick sonst nichts täte.
    this.tray.on('click', () => this.tray.popUpContextMenu());
    this.zeichne();
  }

  /** Baut Menü, Beschriftung und Tooltip neu — nach jeder Änderung am Stand. */
  zeichne() {
    const stand = this.haken.stand() || { aktiv: [], erledigt: [] };
    const karten = this.haken.karten() || [];
    const ziele = this.haken.ziele() || [];

    /** @type {Electron.MenuItemConstructorOptions[]} */
    const eintraege = [];

    if (stand.aktiv.length > 0) {
      eintraege.push({ label: 'Läuft', enabled: false });
      for (const a of stand.aktiv) {
        eintraege.push({ label: `  ${a.kurz}`, enabled: false });
        if (a.text) eintraege.push({ label: `  ${a.text}`, enabled: false });
        eintraege.push({ label: '  Diesen Auftrag abbrechen', click: () => this.haken.abbrechen(a.id) });
      }
      eintraege.push({ type: 'separator' });
    }

    const nichtFertig = (stand.erledigt || []).filter((a) => !a.formatieren);
    const fertig = (stand.erledigt || []).filter((a) => a.formatieren);
    if (fertig.length > 0 || nichtFertig.length > 0) {
      eintraege.push({ label: 'Zuletzt', enabled: false });
      for (const a of [...nichtFertig, ...fertig].slice(0, 6)) {
        eintraege.push({ label: `  ${a.satz}`, enabled: false });
      }
      eintraege.push({ type: 'separator' });
    }

    if (karten.length > 0) {
      eintraege.push({ label: 'Gesteckt', enabled: false });
      for (const k of karten) {
        eintraege.push({
          label: `  ${k.name} sichern …`,
          click: () => this.haken.sichern(k.pfad),
        });
      }
      eintraege.push({ type: 'separator' });
    }

    const bereit = ziele.filter((z) => z.aktiv && z.angeschlossen);
    eintraege.push({
      label: ziele.length === 0
        ? 'Noch kein Ziel eingerichtet'
        : `Ziele: ${bereit.length} von ${ziele.filter((z) => z.aktiv).length} angeschlossen`,
      enabled: false,
    });
    eintraege.push({ label: 'Ziele einrichten …', click: () => this.haken.ansicht('ziele') });
    eintraege.push({ type: 'separator' });
    eintraege.push({ label: 'Fenster zeigen', click: () => this.haken.fenster() });
    eintraege.push({ label: 'Importfenster öffnen …', click: () => this.haken.importFenster() });
    eintraege.push({ type: 'separator' });
    eintraege.push({
      label: 'Beim Einstecken fragen',
      type: 'checkbox',
      checked: Boolean(this.haken.wacheAktiv()),
      click: (item) => this.haken.setzeWache(item.checked),
    });
    eintraege.push({ type: 'separator' });
    eintraege.push({ label: 'LZ Ordnerstruktur beenden', click: () => this.haken.beenden() });

    this.tray.setContextMenu(Menu.buildFromTemplate(eintraege));

    // Kurzfassung direkt neben dem Symbol: nur solange etwas läuft, sonst
    // nimmt die App ohne Grund Platz in der Menüleiste weg.
    const laufend = stand.aktiv.find((a) => a.status === 'laeuft');
    if (IST_MAC) this.tray.setTitle(laufend ? ` ${laufend.quelleName}` : '');
    const offen = (stand.aktiv.length || 0) + nichtFertig.length;
    this.tray.setToolTip(
      laufend
        ? `LZ Ordnerstruktur — ${laufend.kurz}`
        : (offen > 0 ? `LZ Ordnerstruktur — ${offen} Karte(n) nicht fertig gesichert` : 'LZ Ordnerstruktur'),
    );
  }

  zerstoere() {
    if (this.tray) this.tray.destroy();
    this.tray = null;
  }
}

module.exports = { Menueleiste };
