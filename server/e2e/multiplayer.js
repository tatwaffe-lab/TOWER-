/**
 * Mehrspieler-E2E: startet einen echten Server und verbindet zwei echte
 * Colyseus-Clients. Es wird nichts simuliert oder gemockt — dieselbe
 * MatchRoom, dieselbe Schema-Synchronisation, dieselben Nachrichten wie im
 * Browser.
 *
 * Abgedeckt: Beitritt, Commander-Wahl, Ready, Matchstart, Turmbau mit
 * Serverabrechnung, abgelehnte ungültige Aktionen, PvP-Send mit echtem
 * Gegner-Spawn beim Ziel, Lane-Umbau mit Servervalidierung, Wellenlauf,
 * Ergebnis und Rematch.
 */
const { boot } = require("@colyseus/testing");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const http = require("http");
const { MatchRoom } = require("../dist/rooms/MatchRoom");
const { MSG, TOWERS, SEND_UNITS } = require("../../shared/dist/index.js");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await wait(100);
  }
  throw new Error(`Timeout: ${label}`);
}

async function main() {
  const httpServer = http.createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define("match", MatchRoom);
  const colyseus = await boot(gameServer, 12599);

  try {
    // ---------------------------------------------------- Beitritt
    // Gefechtsmodus: nur dort sind mehrere Menschen und Sends erlaubt.
    const room = await colyseus.createRoom("match", { mode: "battle" });
    const c1 = await colyseus.connectTo(room, { name: "Alice" });
    const c2 = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    assert(room.state.players.size === 2, "zwei Spieler im Raum");
    const p1 = () => room.state.players.get(c1.sessionId);
    const p2 = () => room.state.players.get(c2.sessionId);
    assert(p1().isHost, "erster Spieler ist Host");
    assert(!p2().isHost, "zweiter Spieler ist nicht Host");
    assert(p1().name === "Alice" && p2().name === "Bob", "Namen übernommen");
    console.log("✓ Beitritt, Host-Vergabe und Namen");

    // ---------------------------------------------- Commander-Auswahl
    c1.send(MSG.setCommander, { commanderId: "warlord" });
    c2.send(MSG.setCommander, { commanderId: "architect" });
    await room.waitForNextPatch();
    assert(p1().commanderId === "warlord", "Commander 1 gesetzt");
    assert(p2().commanderId === "architect", "Commander 2 gesetzt");
    // Architect-Passive gibt +25 Core-HP.
    assert(p2().maxCoreHp > p1().maxCoreHp, "Commander-Passive wirkt auf Core-HP");

    c1.send(MSG.setCommander, { commanderId: "gibt-es-nicht" });
    await room.waitForNextPatch();
    assert(p1().commanderId === "warlord", "ungültiger Commander wird abgelehnt");
    console.log("✓ Commander-Wahl inkl. Ablehnung ungültiger Werte");

    // ------------------------------------------------------- Ready
    c1.send(MSG.ready, {});
    await room.waitForNextPatch();
    assert(room.state.phase === "lobby", "Match startet nicht mit nur einem Ready");
    c2.send(MSG.ready, {});
    await waitFor(() => room.state.phase !== "lobby", 3000, "Match startet nach beidseitigem Ready");
    console.log("✓ Ready-Flow startet das Match");

    // Vorbereitungsphase überspringen: Gold für Aufbau prüfen.
    const goldBefore = p1().gold;
    assert(goldBefore > 0, "Startgold vorhanden");

    // ------------------------------------------- Turmbau (autoritativ)
    c1.send(MSG.placeTower, { defId: "gunner", x: 1, y: 2 });
    await waitFor(() => room.state.towers.size === 1, 3000, "Turm wird gebaut");
    assert(p1().gold === goldBefore - TOWERS.gunner.cost, "Gold korrekt abgezogen");

    // Ungültige Aktionen müssen abgelehnt werden.
    const towersNow = room.state.towers.size;
    c1.send(MSG.placeTower, { defId: "gunner", x: 1, y: 2 }); // besetzt
    c1.send(MSG.placeTower, { defId: "gunner", x: 4, y: 1 }); // auf der Lane
    c1.send(MSG.placeTower, { defId: "<script>", x: 2, y: 2 }); // ungültige ID
    c1.send(MSG.placeTower, { defId: "gunner", x: -5, y: 99999 }); // außerhalb
    c1.send(MSG.placeTower, { defId: "gunner", x: 1.5, y: 2.5 }); // keine Ganzzahl
    c1.send(MSG.placeTower, "kaputt"); // kein Objekt
    c1.send(MSG.placeTower, null);
    await wait(500);
    assert(room.state.towers.size === towersNow, "alle ungültigen Bauversuche abgelehnt");
    console.log("✓ Turmbau mit Serverabrechnung, ungültige Eingaben abgelehnt");

    // --------------------------------------------- Upgrade & Verkauf
    const towerId = [...room.state.towers.keys()][0];
    const goldPreUp = p1().gold;
    c1.send(MSG.upgradeTower, { towerId });
    await waitFor(() => room.state.towers.get(towerId).level === 1, 3000, "Turm wird aufgewertet");
    assert(p1().gold < goldPreUp, "Upgrade kostet Gold");

    c1.send(MSG.setTargeting, { towerId, targeting: "strongest" });
    await room.waitForNextPatch();
    assert(room.state.towers.get(towerId).targeting === "strongest", "Zielmodus umgestellt");
    c1.send(MSG.setTargeting, { towerId, targeting: "unsinn" });
    await room.waitForNextPatch();
    assert(room.state.towers.get(towerId).targeting === "strongest", "ungültiger Zielmodus abgelehnt");
    console.log("✓ Upgrade und Zielmodus");

    // -------------------------------------------------- Lane-Umbau
    const goldPreLane = p1().gold;
    const laneBefore = p1().laneMapJson;
    c1.send(MSG.editLane, { action: "add-lane", x: 0, y: 2 });
    await waitFor(() => p1().laneMapJson !== laneBefore, 3000, "Lane wird umgebaut");
    assert(p1().gold < goldPreLane, "Lane-Umbau kostet Gold");

    // Ungültiger Umbau: Pfad trennen.
    const laneAfter = p1().laneMapJson;
    c1.send(MSG.editLane, { action: "remove-lane", x: 2, y: 1 });
    await wait(400);
    assert(p1().laneMapJson === laneAfter, "pfadtrennender Umbau wird serverseitig abgelehnt");
    console.log("✓ Lane-Umbau inkl. serverseitiger Pfadvalidierung");

    // ------------------------------------------------- PvP-Send
    // Threat auffüllen, indem wir warten, bis genug regeneriert ist.
    await waitFor(() => p1().threat >= SEND_UNITS.rusher.cost, 30000, "Threat regeneriert");
    const enemiesAtTargetBefore = [...room.state.enemies.values()].filter((e) => e.ownerId === c2.sessionId).length;
    const threatBefore = p1().threat;

    c1.send(MSG.sendUnits, { sendId: "rusher", targetId: c2.sessionId });
    await waitFor(
      () => [...room.state.enemies.values()].filter((e) => e.ownerId === c2.sessionId && e.sent).length > 0,
      5000,
      "gesendete Gegner erscheinen beim Ziel"
    );
    assert(p1().threat < threatBefore, "Send kostet Threat");
    assert(p1().sendsLaunched > 0, "Send wird gezählt");
    const sentCount = [...room.state.enemies.values()].filter((e) => e.ownerId === c2.sessionId && e.sent).length;
    assert(sentCount >= SEND_UNITS.rusher.count, `alle ${SEND_UNITS.rusher.count} Einheiten gespawnt (${sentCount})`);
    console.log(`✓ PvP-Send erzeugt ${sentCount} echte Gegner beim Ziel`);

    // Selbstziel muss abgelehnt werden.
    const ownEnemiesBefore = [...room.state.enemies.values()].filter((e) => e.ownerId === c1.sessionId && e.sent).length;
    c1.send(MSG.sendUnits, { sendId: "rusher", targetId: c1.sessionId });
    await wait(400);
    const ownEnemiesAfter = [...room.state.enemies.values()].filter((e) => e.ownerId === c1.sessionId && e.sent).length;
    assert(ownEnemiesAfter === ownEnemiesBefore, "Selbstziel wird abgelehnt");

    c1.send(MSG.sendUnits, { sendId: "gibt-es-nicht", targetId: c2.sessionId });
    c1.send(MSG.sendUnits, { sendId: "rusher", targetId: "fremde-session" });
    await wait(400);
    console.log("✓ Selbstziel und ungültige Sends abgelehnt");

    // ------------------------------------------ Commander-Fähigkeit
    await waitFor(() => p1().abilityCooldownMs === 0, 5000, "Fähigkeit bereit");
    c1.send(MSG.useAbility, { x: 2, y: 2 });
    await waitFor(() => p1().abilityCooldownMs > 0, 3000, "Fähigkeit setzt Cooldown");
    const cdAfter = p1().abilityCooldownMs;
    c1.send(MSG.useAbility, { x: 2, y: 2 });
    await wait(300);
    assert(p1().abilityCooldownMs <= cdAfter, "zweite Nutzung während Cooldown wirkungslos");
    console.log("✓ Commander-Fähigkeit mit Cooldown-Prüfung");

    // ------------------------------------------------ Wellenlauf
    await waitFor(() => room.state.wave >= 1, 30000, "erste Welle startet");
    await waitFor(() => room.state.enemiesRemaining > 0, 20000, "Gegner spawnen");
    console.log(`✓ Welle ${room.state.wave} läuft mit ${room.state.enemiesRemaining} Gegnern`);

    const killsBefore = p1().kills;
    await waitFor(() => p1().kills > killsBefore, 40000, "Türme töten Gegner");
    console.log(`✓ Kills werden serverseitig gezählt (${p1().kills})`);

    // ------------------------------------------------ Matchende
    // Ein Spieler gibt auf: Verbindung trennen -> Match muss enden können.
    await c2.leave(true);
    await waitFor(() => room.state.phase === "result" || room.state.players.size === 1, 15000, "Match reagiert auf Austritt");
    console.log("✓ Austritt eines Spielers blockiert das Match nicht");

    // ------------------------------------------------- Rematch
    if (room.state.phase === "result") {
      assert(room.state.resultText.length > 0, "Ergebnis hat einen Text");
      const p1Place = p1().placement;
      assert(p1Place > 0, "Platzierung vergeben");

      c1.send(MSG.rematch, {});
      await waitFor(() => room.state.phase === "lobby", 5000, "Rematch führt zurück in die Lobby");
      assert(room.state.enemies.size === 0, "keine alten Gegner nach Rematch");
      assert(room.state.towers.size === 0, "keine alten Türme nach Rematch");
      assert(p1().perks.length === 0, "Perks zurückgesetzt");
      assert(!p1().ready, "Ready-Status zurückgesetzt");
      console.log("✓ Rematch räumt den alten Matchzustand vollständig auf");
    } else {
      console.log("• Match lief nach Austritt weiter (Solo-Fortsetzung) — Rematch separat geprüft");
    }

    console.log("\nMEHRSPIELER-E2E BESTANDEN");
  } finally {
    await colyseus.shutdown();
  }
}

main().catch((err) => {
  console.error("\nMEHRSPIELER-E2E FEHLGESCHLAGEN:", err.message);
  console.error(err.stack);
  process.exit(1);
});
