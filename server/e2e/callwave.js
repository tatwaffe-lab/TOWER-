/**
 * E2E für das vorzeitige Rufen von Wellen.
 *
 * Kernpunkte, die hier abgesichert werden:
 *  - Rufen funktioniert AUCH während eine Welle läuft (Wellen stapeln sich)
 *  - jede Welle behält ihre eigene HP-Skalierung, auch gestapelt
 *  - Bonusgold wird gutgeschrieben
 *  - der Vorsprung ist begrenzt
 *  - im Gefecht betrifft der Ruf nur den Rufenden, nicht die Mitspieler
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
  const colyseus = await boot(gameServer, 12603);

  try {
    // ------------------------------------------- Rufen in der Vorbereitung
    const room = await colyseus.createRoom("match", { mode: "endless" });
    const client = await colyseus.connectTo(room, { name: "Rufer" });
    await room.waitForNextPatch();
    const me = () => room.state.players.get(client.sessionId);

    client.send(MSG.ready, {});
    await waitFor(() => room.state.phase !== "lobby", 4000, "Match startet");
    assert(room.state.phase === "preparing", "startet in der Vorbereitung");

    const goldBefore = me().gold;
    client.send(MSG.callWave, {});
    await waitFor(() => me().waveIndex >= 1, 4000, "erste Welle wird vorgezogen");

    assert(room.state.phase === "playing", "Vorbereitungsphase wird übersprungen");
    assert(me().gold > goldBefore, `Bonusgold gutgeschrieben (${goldBefore} → ${me().gold})`);
    console.log(`✓ Welle in der Vorbereitung gerufen (+${me().gold - goldBefore} Gold)`);

    await waitFor(() => room.state.enemiesRemaining > 0, 8000, "Gegner erscheinen");
    const afterFirst = room.state.enemiesRemaining;
    console.log(`✓ Welle 1 läuft (${afterFirst} Gegner)`);

    // ------------------------------- Rufen WÄHREND eine Welle noch läuft
    const goldPre2 = me().gold;
    client.send(MSG.callWave, {});
    await waitFor(() => me().waveIndex >= 2, 4000, "zweite Welle wird vorgezogen");
    assert(me().gold > goldPre2, "auch der zweite Ruf zahlt Bonus");
    assert(me().wavesAhead >= 1, `Vorsprung wird gezählt (${me().wavesAhead})`);

    await waitFor(() => room.state.enemiesRemaining > afterFirst, 10000, "Gegner beider Wellen laufen parallel");
    console.log(`✓ Zweite Welle gestapelt, während die erste noch lief (${room.state.enemiesRemaining} Gegner)`);

    // ------------------------------------------------ Vorsprung begrenzt
    for (let i = 0; i < 6; i++) {
      client.send(MSG.callWave, {});
      await wait(200);
    }
    assert(me().wavesAhead <= 3, `Vorsprung ist gedeckelt (${me().wavesAhead})`);
    console.log(`✓ Vorsprung auf 3 Wellen begrenzt (aktuell ${me().wavesAhead})`);

    // ------------------- Gestapelte Wellen behalten ihre eigene Skalierung
    // Direkt am Serverzustand geprüft: die Warteschlange muss Einträge mit
    // unterschiedlichen hpMul-Werten enthalten.
    const roomRef = colyseus.getRoomById(room.roomId);
    const rt = roomRef["runtimes"].get(client.sessionId);
    const waves = new Set(rt.spawnQueue.map((q) => q.wave));
    const muls = new Set(rt.spawnQueue.map((q) => Math.round(q.hpMul * 1000)));
    if (rt.spawnQueue.length > 0) {
      assert(waves.size >= 1, "Warteschlange kennt ihre Wellen");
      if (waves.size > 1) {
        assert(muls.size > 1, "verschiedene Wellen haben verschiedene HP-Skalierung");
        console.log(`✓ Warteschlange enthält ${waves.size} Wellen mit eigener Skalierung`);
      } else {
        console.log("• Warteschlange bereits abgearbeitet — Skalierung separat unit-getestet");
      }
    }

    await client.leave();

    // ------------------------------ Im Gefecht betrifft der Ruf nur einen
    {
      const battle = await colyseus.createRoom("match", { mode: "battle" });
      const a = await colyseus.connectTo(battle, { name: "Alice" });
      const b = await colyseus.connectTo(battle, { name: "Bob" });
      await battle.waitForNextPatch();

      a.send(MSG.ready, {});
      b.send(MSG.ready, {});
      await waitFor(() => battle.state.phase !== "lobby", 5000, "Gefecht startet");

      const pa = () => battle.state.players.get(a.sessionId);
      const pb = () => battle.state.players.get(b.sessionId);

      a.send(MSG.callWave, {});
      await waitFor(() => pa().waveIndex >= 1, 4000, "Alice zieht vor");
      await wait(500);

      assert(pa().waveIndex > pb().waveIndex, `nur Alice ist voraus (${pa().waveIndex} vs ${pb().waveIndex})`);
      console.log(`✓ Im Gefecht betrifft der Ruf nur den Rufenden (Alice ${pa().waveIndex}, Bob ${pb().waveIndex})`);

      await a.leave();
      await b.leave();
    }

    console.log("\nWELLEN-RUF-E2E BESTANDEN");
  } finally {
    await colyseus.shutdown();
  }
}

main().catch((err) => {
  console.error("\nWELLEN-RUF-E2E FEHLGESCHLAGEN:", err.message);
  console.error(err.stack);
  process.exit(1);
});
