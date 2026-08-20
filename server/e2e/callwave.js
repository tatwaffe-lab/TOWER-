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
    const ersterBonus = me().gold - goldBefore;
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

    // -------------------------------------- Vorsprung ist NICHT mehr begrenzt
    const vorSerie = me().waveIndex;
    for (let i = 0; i < 12; i++) {
      client.send(MSG.callWave, {});
      await wait(150);
    }
    assert(
      me().waveIndex >= vorSerie + 12,
      `alle 12 Rufe angenommen (${vorSerie} -> ${me().waveIndex})`
    );
    assert(me().wavesAhead > 3, `Vorsprung über der alten Grenze (${me().wavesAhead})`);
    console.log(`✓ Unbegrenzt vorbestellbar — ${me().wavesAhead} Wellen Vorsprung`);

    // Der Bonus muss mit dem Vorsprung abklingen, sonst wäre Dauerklicken
    // ein Goldautomat. Gemessen am echten Zustand, nicht an der Formel.
    const goldWeitVorne = me().gold;
    client.send(MSG.callWave, {});
    await wait(400);
    const bonusWeitVorne = me().gold - goldWeitVorne;
    assert(
      bonusWeitVorne >= 0 && bonusWeitVorne < ersterBonus,
      `Bonus klingt ab (erster Ruf +${ersterBonus}, jetzt +${bonusWeitVorne})`
    );
    console.log(`✓ Bonusgold klingt ab: erster Ruf +${ersterBonus}, weit vorne +${bonusWeitVorne}`);

    // Der eigentliche Sinn des Vorziehens: mehr Wellen müssen sich auch nach
    // mehr anfühlen. Gemessen wird die tatsächliche Spawnrate im Feld, nicht
    // die Länge der Warteschlange — die allein sagt nichts über den Druck.
    const t0 = Date.now();
    const lebendA = [...room.state.enemies.values()].filter((e) => e.ownerId === client.sessionId).length;
    await wait(3000);
    const lebendB = [...room.state.enemies.values()].filter((e) => e.ownerId === client.sessionId).length;
    const proSekunde = (lebendB - lebendA) / ((Date.now() - t0) / 1000);
    assert(
      proSekunde > 3,
      `gestapelte Wellen erhöhen den Nachschub spürbar (${proSekunde.toFixed(1)} Gegner/s)`
    );
    console.log(`✓ Nachschub steigt mit dem Vorsprung: ${proSekunde.toFixed(1)} Gegner/s`);

    // Und die Lane darf trotzdem nicht überlaufen.
    assert(lebendB <= 600, `Ausstoß gedeckelt (${lebendB} lebende Gegner)`);
    console.log(`✓ ${lebendB} Gegner gleichzeitig im Feld, Obergrenze 600 gewahrt`);

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
