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

Browser auf `http://localhost:5173` öffnen und einen der drei Modi wählen.

Im Produktionsbuild liefert der Server den Client gleich mit aus — dann
genügt `npm start` und `http://localhost:2567`.

## Spielmodi

| Modus | Was es ist |
|---|---|
| **Kampagne** | 30 Wellen allein, Bosse alle 5 Wellen. Wer den Core hält, gewinnt. Keine Angriffe auf andere. |
| **Endlos** | Die Wellen hören nie auf. Ab Welle 30 zieht die Härte zusätzlich an, damit jeder Lauf ein Ende findet. Ergebnis ist die erreichte Welle. |
| **Gefecht** | 2–4 Teilnehmer mit PvP-Sends. Freie Plätze übernehmen KI-Gegner — „zwei Menschen gegen die KI" funktioniert damit genauso wie 1 gegen 1 oder 4er-FFA, ohne getrennte Modi. |

Im Gefecht spielt die KI nach **denselben Regeln** wie ein Mensch: gleiche
Kosten, gleiche Cooldowns, gleiche Servervalidierung. Sie hat kein Extra-Gold
und keinen privilegierten Zugriff — sie entscheidet nur schneller und nach
einfachen Heuristiken (Bauplätze nach Wegabdeckung, gleichmäßiges Aufwerten,
Angriff je nach Aggressionsprofil). Drei Stufen von „Rostkommando" bis
„Leerenkult".

## Steuerung

| Eingabe | Wirkung |
|---|---|
| Klick auf Bauflächen | gewählten Turm bauen |
| Klick auf eigenen Turm | Inspektor (Ausbauen, Spezialisieren, Verkaufen, Zielmodus) |
| `1`–`9`, `0` | Turm auswählen |
| `Q` / `W` | Commander-Fähigkeit / Ultimate (zielen mit der Maus) |
| `E` | Lane-Editor ein/aus (nur zwischen den Wellen) |
| Klick / Shift+Klick im Editor | Weg hinzufügen / entfernen |
| `Leertaste` | nächste Welle vorziehen (auch während eine läuft) |
| `Esc` | Auswahl aufheben |

**Wellen vorziehen:** Du musst nicht auf den Countdown warten. Ein Ruf
schickt die nächste Welle sofort los — auch mitten in der laufenden, sodass
sich beide überlagern. Belohnt wird das mit Bonusgold, das mit der
übersprungenen Wartezeit steigt. Maximal drei Wellen Vorsprung.

Im Gefecht gilt der Ruf **nur für dich**: du kannst dein eigenes Tempo
hochdrehen, ohne den Mitspielern Wellen aufzuzwingen. Wer schneller ruft,
verdient mehr, riskiert aber, von zwei Wellen gleichzeitig überrannt zu
werden.

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
npm test              # Unit + Solo-E2E + Modi/Rematch-E2E
npm run test:unit     # 56 Unit-Tests (Kampf, Türme, Wellen, Lane, Modi, KI)
npm run test:server   # Solo-E2E gegen echten Server
npm run test:multi    # Mehrspieler-E2E mit zwei echten Clients
npm run test:modes    # Alle drei Modi, KI-Gegner und Rematch-Pfad
npm run test:callwave # Wellen vorziehen, Stapeln, Vorsprungsgrenze
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

## Änderungen nach dem ersten Playtest

Rückmeldung war: Gegner ab Welle 4 zu schwach, VS-Modus zu zäh, Karte nutzt
den Bildschirm nicht, Menü verdeckt die eigene Basis, Grafik zu leblos.

**Balance neu aufgebaut.** Die Gegner-HP wächst jetzt exponentiell
(`1.135^Welle` mit zusätzlichem Schub ab Welle 10) statt linear. Vorher
erreichte sie bis Welle 25 nur das 3,2-fache, während die Spielerstärke
multiplikativ auf leicht das Fünfzigfache wächst — daher der Zusammenbruch
ab Welle 4. Dazu kommt Rüstung ab Welle 5 und mitwachsendes Kill-Gold.
Gemessen mit `npm run balance`:

| Verteidigung | Welle 15 | Welle 20 | Welle 25 |
|---|---|---|---|
| 5 einfache Türme | Druck | überrannt | überrannt |
| 12 Türme, spezialisiert | knapp | knapp | überrannt |

**VS-Modus deutlich aggressiver.** Threat regeneriert viermal schneller
(6,5/s statt 1,6/s), Obergrenze 200 statt 120, Cooldowns von 5–15 s auf
1,2–4 s gesenkt, Kosten um rund ein Drittel reduziert, Freischaltwellen
halbiert. Dauerdruck auf den Gegner ist damit möglich; das Risk/Reward-System
verhindert weiterhin, dass reiner Spam sich rechnet.

**Karte 20×12 statt 14×10**, Kachel 64 px statt 48. Der Weg ist mit 43
Feldern mehr als doppelt so lang und mäandert durch drei Verteidigungszonen.
Der Core sitzt nicht mehr am rechten Rand. Baubar sind jetzt auch diagonal
angrenzende Felder (83 Bauplätze statt 34).

**Layout getrennt.** Spielfeld und Seitenleiste teilen sich den Platz über
ein CSS-Grid, statt dass die Leiste als Overlay über dem Canvas liegt — sie
kann die eigene Basis nicht mehr verdecken.

**Grafik neu.** Sprites entstehen jetzt über einen prozeduralen Pixel-Zeichner
(`client/src/art/pixelCanvas.ts`) mit automatischer Kontur und Licht-/
Schattenkante. Auflösung verdoppelt (32×32). Türme bestehen aus festem Sockel
und separatem Geschützturm, der sich zum Ziel dreht. Gegner haben
Vier-Frame-Laufanimationen, deren Tempo an die tatsächliche Geschwindigkeit
gekoppelt ist — verlangsamte Gegner laufen sichtbar träger. Dazu Spawn-Portal
und Core als eigene Bauwerke, vier Bodenvarianten gegen Kachelmuster,
treibende Staubpartikel, gezackte Blitze, Mündungsrauch und Rückstoß.

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
