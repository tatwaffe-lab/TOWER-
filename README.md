# Arcane Industry — Multiplayer Tower Defense

Serverautoritatives Tower Defense für 1–4 Spieler. Node + TypeScript +
Colyseus (Server), Phaser 3 + Vite (Client), `@td/shared` als gemeinsames
Regel- und Datenpaket. Kein Unity, kein FishNet.

## Schnellstart

```bash
npm install
npm run build

npm run dev:server    # Terminal 1 — Match-Server auf :2567
npm run dev:client    # Terminal 2 — Client auf :5173
```

Browser auf `http://localhost:5173` öffnen. Solo startet sofort; für
Mehrspieler einen Raum erstellen und den angezeigten **Raumcode**
weitergeben (bis 4 Spieler).

Im Produktionsbuild liefert der Server den Client gleich mit aus — dann
genügt `npm start` und `http://localhost:2567`.

## Steuerung

| Eingabe | Wirkung |
|---|---|
| Klick auf Bauflächen | gewählten Turm bauen |
| Klick auf eigenen Turm | Inspektor (Ausbauen, Spezialisieren, Verkaufen, Zielmodus) |
| `1`–`9`, `0` | Turm auswählen |
| `Q` / `W` | Commander-Fähigkeit / Ultimate (zielen mit der Maus) |
| `E` | Lane-Editor ein/aus (nur zwischen den Wellen) |
| Klick / Shift+Klick im Editor | Weg hinzufügen / entfernen |
| `Esc` | Auswahl aufheben |

## Was funktioniert

**Kampf und Inhalte**

- 10 Türme, alle funktional, mit je 3 Ausbaustufen und 2 Spezialisierungen,
  die sich mechanisch unterscheiden (nicht nur in Zahlen): Einzelziel,
  Fläche, Kette, Strahl, Kegel, indirektes Feuer, Drohnen, Aura.
- 8 Gegnertypen mit echtem Verhalten: Teiler zerfallen, Schildträger geben
  Rüstung, Saboteure legen Türme lahm, Phasenflieger fliegen die Luftlinie
  und sind zyklisch nicht anvisierbar, Regeneration, Schwärme, Panzer.
- 3 Bosse mit HP-abhängigen Phasen, Verstärkungsrufen und Turmstörung.
- Status-Effekte (Slow, Stun, Brand, Gift, Rüstungsabbau, Leitfähigkeit,
  Schild) mit einheitlicher Stapel- und Auffrischungsregel.
- 4 Schadenstypen mit unterschiedlicher Rüstungswirkung und garantiertem
  Mindestschaden, damit Panzer nie unangreifbar werden.

**Fortschritt**

- 4 Commander mit Passive, aktiver Fähigkeit und Ultimate, alle
  servervalidiert und mit Cooldowns.
- 16 Perks, die echte Regeln verändern; Auswahl 1 aus 3 auf Level 2/4/6/8
  aus dem Pool des jeweiligen Commanders.
- Ökonomie aus Gold (Bau) und Threat (Angriffe), Wellenprämien, Einkommen
  über die Raffinerie-Spezialisierung.

**Multiplayer**

- Lobby mit Raumcode, Commander-Wahl, Ready-Flow, Host-Start.
- 1–4 Spieler; jeder verteidigt eine eigene Lane.
- PvP-Sends: 8 Einheiten, die beim Ziel echte Gegner erzeugen. Abgewehrte
  Sends zahlen dem Verteidiger Gold — ein gescheiterter Angriff finanziert
  den Gegner.
- Reconnect innerhalb von 60 s, Rematch mit vollständigem Reset,
  Platzierung und Ergebnisbildschirm.

**Lane-Editor**

- Wege hinzufügen und entfernen, Kosten in Gold, nur zwischen den Wellen.
- Jede Änderung wird **serverseitig** gegen dieselbe BFS geprüft, die auch
  die Gegner nutzen. Pfadtrennende oder freistehende Änderungen werden
  abgelehnt. Türme, die dadurch auf dem Weg stünden, werden erstattet.
- Karten sind versioniert serialisierbar.

**Präsentation**

- Sprites, Kacheln und Partikel werden komplett programmatisch als Pixel-Art
  erzeugt (`client/src/art/spriteFactory.ts`) — keine externen Assets.
  Jeder Turm hat eigene Silhouetten für Grundbau, Ausbau und beide
  Spezialisierungen.
- VFX: Mündungsfeuer, Rückstoß, Projektile mit Pooling, Explosionsringe,
  Kettenblitze, Trefferblitze, Statusfärbung, Todespartikel, Screenshake.
- Audio komplett per WebAudio synthetisiert, mit Prioritäten und Drosselung
  gegen Klangmatsch. Fehlendes Audio bricht das Spiel nicht ab.
- HUD mit Gold, Threat, Core, Welle, Wellenvorschau, Commander-XP,
  Fähigkeiten, Sends, Spielerliste, Toasts und Turminspektor.

## Tests

```bash
npm test          # Unit + Solo-E2E
npm run test:unit # 46 Unit-Tests (Kampfregeln, Türme, Wellen, Lane-Editor)
npm run test:server   # Solo-E2E gegen echten Server
npm run test:multi    # Mehrspieler-E2E mit zwei echten Clients
npm run balance       # Balance- und Performance-Messung
node server/e2e/smoke-prod.js   # Produktions-Smoketest (nach npm run build)
```

Die E2E-Tests booten eine echte `MatchRoom` über `@colyseus/testing` und
verbinden echte Clients — es wird nichts gemockt.

## Architektur

```
shared/   Regeln und Daten, die Client und Server teilen:
          combat.ts        Schadensformel, Status-Effekte, Zielmodi
          towerData.ts     10 Türme, Upgrades, Spezialisierungen
          enemyData.ts     8 Gegner + 3 Bosse, Wellenbudget
          waveDirector.ts  budgetbasierte Wellenzusammenstellung
          commanderData.ts 4 Commander, 16 Perks, Modifikator-System
          sendData.ts      PvP-Einheiten und Risk/Reward
          laneEditor.ts    Kartenvalidierung und Serialisierung
          pathfinder.ts    BFS (einzige Pfadregel im Projekt)
          schema.ts        replizierter Zustand (Colyseus)
          messages.ts      Nachrichten + strikte Payload-Validierung
          rng.ts           deterministische Zufallsquelle

server/   sim/PlayerSim.ts   die eigentliche Simulation einer Lane
          rooms/MatchRoom.ts Matchflow, Regeln, Autorität, Sync
          index.ts           HTTP, Health, Client-Auslieferung

client/   art/       programmatische Pixel-Art
          audio/     synthetisierte Sounds
          scenes/    Phaser-Rendering
          ui/        HTML-Overlay (Menü, Lobby, HUD, Ergebnis)
```

**Serverautorität:** Der Client sendet nur Absichten (`place_tower`,
`send_units`, …). Kosten, Cooldowns, Platzierung, Schaden, Wellen, Sends,
Fähigkeiten, Perks und Matchausgang entscheidet ausschließlich der Server.
Jede Nachricht durchläuft `validate` in `shared/src/messages.ts`, bevor sie
die Spiellogik erreicht; ungültige Nachrichten werden verworfen.

**Determinismus:** Wellen, Perk-Angebote und Streuung nutzen `Rng` mit einem
Seed pro Raum (im Ergebnisbildschirm sichtbar). Kein `Math.random()` in der
Spiellogik — dadurch sind Tests reproduzierbar.

## Erweitern

- **Neuer Turm:** Eintrag in `shared/src/towerData.ts` (inkl. `attack`-Art
  und zwei Spezialisierungen) plus ein Pixelraster in
  `client/src/art/spriteFactory.ts`. Verhalten nur nötig, wenn eine neue
  `AttackKind` gebraucht wird.
- **Neuer Gegner:** Eintrag in `shared/src/enemyData.ts` mit `budgetCost`
  und `minWave`; der Wave-Director nimmt ihn automatisch auf.
- **Neuer Perk:** Eintrag in `PERKS` und in den `perkPool` eines Commanders.
  Wirkt automatisch, sofern das Feld in `RuleModifiers` existiert.

## Deployment

Siehe `DEPLOYMENT.md`. Kurz: ein einziger Render-Web-Service, Blueprint liegt
als `render.yaml` bei, Healthcheck auf `/healthz`.

## Bekannte Einschränkungen

- **Balance ist gemessen, aber nicht ausgespielt.** `npm run balance` liefert
  reale DPS-, Wellen- und Leak-Zahlen; echtes Playtesting mit Menschen fehlt.
- **Eine Karte.** Der Lane-Editor verändert sie pro Spieler, aber es gibt nur
  ein Grundlayout und ein Biom.
- **Kein Endless/Challenge-Modus**, keine Persistenz, keine Konten,
  keine Ranglisten. Räume sind flüchtig (kein Datenspeicher nötig).
- **Altlasten im Ordner:** In `shared/src` liegen kompilierte `.js`-Dateien
  neben den `.ts`-Quellen, und unter `server/` ein alter `dist`/`node_modules`-
  Stand. Sie stammen aus einer früheren Fehlkonfiguration und ließen sich in
  dieser Umgebung nicht löschen. `client/vite.config.ts` löst deshalb
  `.ts` vor `.js` auf. In einem frischen Checkout können die `.js`-Dateien in
  `shared/src` gelöscht werden.
