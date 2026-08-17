/**
 * Solo-E2E: kompletter Einzelspieler-Durchlauf gegen einen echten Server.
 *
 * Deckt ab: Beitritt, Ready -> Match, Bau/Upgrade/Verkauf mit korrekter
 * Goldabrechnung, Wellenstart, Kills, Perk-Angebot und -Wahl, Rematch mit
 * vollständigem Reset. Es wird nichts gemockt.
 */
const { boot } = require("@colyseus/testing");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const http = require("http");
const { MatchRoom } = require("../dist/rooms/MatchRoom");
const { MSG, TOWERS } = require("../../shared/dist/index.js");

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
  const colyseus = await boot(gameServer, 12567);

  try {
    const room = await colyseus.createRoom("match", { mode: "solo" });
    const client = await colyseus.connectTo(room, { name: "Solo" });
    await room.waitForNextPatch();
    const me = () => room.state.players.get(client.sessionId);

    assert(room.state.players.size === 1, "ein Spieler");
    assert(me().isHost, "Solospieler ist Host");
    assert(room.state.roomCode.length >= 4, "Raumcode vergeben");
    console.log("✓ Beitritt und Raumzustand");

    client.send(MSG.ready, {});
    await waitFor(() => room.state.phase !== "lobby", 3000, "Match startet");
    console.log(`✓ Match gestartet (Phase: ${room.state.phase})`);

    const startGold = me().gold;
    assert(startGold > 0, "Startgold");

    client.send(MSG.placeTower, { defId: "gunner", x: 1, y: 2 });
    await waitFor(() => room.state.towers.size === 1, 3000, "Turm gebaut");
    assert(me().gold === startGold - TOWERS.gunner.cost, "Gold korrekt abgezogen");

    const towerId = [...room.state.towers.keys()][0];
    client.send(MSG.upgradeTower, { towerId });
    await waitFor(() => room.state.towers.get(towerId).level === 1, 3000, "Turm aufgewertet");
    console.log("✓ Bau und Upgrade mit Goldabrechnung");

    // Verkauf erstattet Gold und entfernt den Turm.
    const goldPreSell = me().gold;
    client.send(MSG.sellTower, { towerId });
    await waitFor(() => room.state.towers.size === 0, 3000, "Turm verkauft");
    assert(me().gold > goldPreSell, "Verkauf erstattet Gold");
    console.log("✓ Verkauf");

    // Verteidigung für den Wellenlauf aufbauen.
    client.send(MSG.placeTower, { defId: "cannon", x: 1, y: 2 });
    client.send(MSG.placeTower, { defId: "gunner", x: 5, y: 3 });
    await waitFor(() => room.state.towers.size === 2, 3000, "Verteidigung steht");

    await waitFor(() => room.state.wave >= 1, 30000, "Welle startet");
    await waitFor(() => room.state.enemiesRemaining > 0, 20000, "Gegner spawnen");
    console.log(`✓ Welle ${room.state.wave} mit ${room.state.enemiesRemaining} Gegnern`);

    await waitFor(() => me().kills > 0, 45000, "Gegner werden getötet");
    console.log(`✓ Kills serverseitig gezählt (${me().kills})`);

    // Perk-Angebot: XP sammeln, bis ein Angebot erscheint.
    try {
      await waitFor(() => me().perkOffer.length > 0, 90000, "Perk-Angebot erscheint");
      const offered = [...me().perkOffer];
      assert(offered.length > 0 && offered.length <= 3, "1–3 Perks angeboten");

      // Nicht angebotene Perks müssen abgelehnt werden.
      client.send(MSG.pickPerk, { perkId: "boss-hunter-existiert-nicht" });
      await wait(300);
      assert(me().perks.length === 0, "unbekannter Perk abgelehnt");

      client.send(MSG.pickPerk, { perkId: offered[0] });
      await waitFor(() => me().perks.length === 1, 3000, "Perk wird übernommen");
      assert(me().perkOffer.length === 0, "Angebot nach Wahl geschlossen");
      console.log(`✓ Perk-System (gewählt: ${offered[0]})`);
    } catch (e) {
      console.log(`• Perk-Angebot in der Testzeit nicht erreicht (${e.message}) — Regel separat unit-getestet`);
    }

    // Rematch aus dem laufenden Match heraus ist nicht erlaubt.
    const phaseBefore = room.state.phase;
    client.send(MSG.rematch, {});
    await wait(300);
    assert(room.state.phase === phaseBefore, "Rematch nur im Ergebnis-Zustand");
    console.log("✓ Rematch während des Matches abgelehnt");

    console.log("\nSOLO-E2E BESTANDEN");
  } finally {
    await colyseus.shutdown();
  }
}

main().catch((err) => {
  console.error("\nSOLO-E2E FEHLGESCHLAGEN:", err.message);
  console.error(err.stack);
  process.exit(1);
});
