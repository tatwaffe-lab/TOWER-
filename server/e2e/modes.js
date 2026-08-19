/**
 * E2E für die drei Spielmodi, den KI-Gegner und den Rematch-Pfad.
 *
 * Der Rematch-Weg war bisher nur bedingt abgedeckt — genau dort lag die
 * Beschwerde ("Nochmal spielen geht nicht"). Hier wird er erzwungen: Match
 * beenden, Ergebnis prüfen, Rematch auslösen, Lobby-Zustand kontrollieren.
 */
const { boot } = require("@colyseus/testing");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const http = require("http");
const { MatchRoom } = require("../dist/rooms/MatchRoom");
const { MSG } = require("../../shared/dist/index.js");

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
  const colyseus = await boot(gameServer, 12601);

  try {
    // ------------------------------------------------ Kampagne
    {
      const room = await colyseus.createRoom("match", { mode: "campaign" });
      const client = await colyseus.connectTo(room, { name: "Solo" });
      await room.waitForNextPatch();
      assert(room.state.mode === "campaign", "Modus gesetzt");
      assert(room.state.maxWaves === 30, "Kampagne hat 30 Wellen");
      assert(room.state.sendsEnabled === false, "keine Sends in der Kampagne");

      client.send(MSG.sendUnits, { sendId: "rusher", targetId: "irgendwer" });
      await wait(300);
      assert(room.state.enemies.size === 0, "Send in der Kampagne wirkungslos");
      console.log("✓ Kampagne: 30 Wellen, Sends deaktiviert");
      await client.leave();
    }

    // ------------------------------------------------ Endlos
    {
      const room = await colyseus.createRoom("match", { mode: "endless" });
      const client = await colyseus.connectTo(room, { name: "Endlos" });
      await room.waitForNextPatch();
      assert(room.state.mode === "endless", "Endlosmodus gesetzt");
      assert(room.state.maxWaves === 0, "kein Wellenlimit");

      client.send(MSG.ready, {});
      await waitFor(() => room.state.phase !== "lobby", 3000, "Endlos startet");
      console.log("✓ Endlos: kein Wellenlimit, Match startet");
      await client.leave();
    }

    // ------------------------------------------------ Gefecht mit KI
    {
      const room = await colyseus.createRoom("match", { mode: "battle" });
      const client = await colyseus.connectTo(room, { name: "Mensch" });
      await room.waitForNextPatch();
      assert(room.state.sendsEnabled === true, "Sends im Gefecht erlaubt");

      client.send(MSG.ready, {});
      await waitFor(() => room.state.phase !== "lobby", 4000, "Gefecht startet");

      const ais = [...room.state.players.values()].filter((p) => p.isAi);
      assert(ais.length >= 1, `KI-Gegner wurde erzeugt (${ais.length})`);
      assert(ais[0].name.length > 0, "KI hat einen Namen");
      console.log(`✓ Gefecht: KI-Gegner "${ais[0].name}" sitzt mit am Tisch`);

      // Die KI muss von selbst bauen — ohne dass ein Client etwas schickt.
      await waitFor(
        () => [...room.state.towers.values()].some((t) => t.ownerId === ais[0].sessionId),
        45000,
        "KI baut eigenständig Türme"
      );
      const aiTowers = [...room.state.towers.values()].filter((t) => t.ownerId === ais[0].sessionId);
      console.log(`✓ KI baut selbstständig (${aiTowers.length} Türme)`);

      // Ziel: der Mensch muss die KI angreifen können und umgekehrt.
      const me = room.state.players.get(client.sessionId);
      assert(me.sendTargetId === ais[0].sessionId, "KI ist automatisch das Sendeziel");

      await waitFor(() => me.threat >= 8, 20000, "Threat regeneriert");
      client.send(MSG.sendUnits, { sendId: "rusher", targetId: ais[0].sessionId });
      await waitFor(
        () => [...room.state.enemies.values()].some((e) => e.ownerId === ais[0].sessionId && e.sent),
        6000,
        "Angriff erreicht die KI"
      );
      console.log("✓ Angriff auf die KI erzeugt echte Gegner in ihrer Lane");

      await client.leave();
    }

    // ------------------------------------------------ Rematch
    {
      const room = await colyseus.createRoom("match", { mode: "campaign" });
      const client = await colyseus.connectTo(room, { name: "Rematch" });
      await room.waitForNextPatch();
      const me = () => room.state.players.get(client.sessionId);

      client.send(MSG.ready, {});
      await waitFor(() => room.state.phase !== "lobby", 4000, "Match startet");

      // Aufbau erzeugen, damit der Reset nachweisbar etwas wegräumen muss.
      client.send(MSG.placeTower, { defId: "gunner", x: 3, y: 0 });
      await waitFor(() => room.state.towers.size > 0, 4000, "Turm gebaut");

      // Match hart beenden: Core auf 0 setzen ist von außen nicht möglich,
      // deshalb über den Serverzustand — das ist derselbe Weg, den ein Leak
      // nimmt.
      const roomRef = colyseus.getRoomById(room.roomId);
      roomRef.state.players.get(client.sessionId).coreHp = 0;
      roomRef.state.players.get(client.sessionId).defeated = true;
      roomRef["recordElimination"](client.sessionId);
      roomRef["endMatch"]("Testende");

      await waitFor(() => room.state.phase === "result", 5000, "Ergebnisphase erreicht");
      assert(room.state.resultText.length > 0, "Ergebnis hat einen Text");
      assert(me().placement > 0, "Platzierung vergeben");
      console.log(`✓ Ergebnisbildschirm erreicht (${room.state.resultText}, Platz ${me().placement})`);

      // Jetzt der eigentliche Prüfpunkt: Rematch.
      client.send(MSG.rematch, {});
      await waitFor(() => room.state.phase === "lobby", 5000, "Rematch führt in die Lobby");

      assert(room.state.towers.size === 0, "keine alten Türme");
      assert(room.state.enemies.size === 0, "keine alten Gegner");
      assert(room.state.effects.size === 0, "keine alten Effekte");
      assert(room.state.wave === 0, "Welle zurückgesetzt");
      assert(room.state.winnerId === "", "kein alter Sieger");
      assert(!me().ready, "Ready zurückgesetzt");
      assert(!me().defeated, "Niederlage zurückgesetzt");
      assert(me().placement === 0, "Platzierung zurückgesetzt");
      assert(me().perks.length === 0, "Perks zurückgesetzt");
      assert(me().coreHp === me().maxCoreHp, "Core wieder voll");
      console.log("✓ Rematch räumt den alten Matchzustand vollständig auf");

      // Und das Match muss danach wirklich wieder startbar sein.
      client.send(MSG.ready, {});
      await waitFor(() => room.state.phase !== "lobby", 5000, "zweites Match startet");
      console.log("✓ Nach dem Rematch startet ein neues Match");

      await client.leave();
    }

    console.log("\nMODI- UND REMATCH-E2E BESTANDEN");
  } finally {
    await colyseus.shutdown();
  }
}

main().catch((err) => {
  console.error("\nMODI-E2E FEHLGESCHLAGEN:", err.message);
  console.error(err.stack);
  process.exit(1);
});
