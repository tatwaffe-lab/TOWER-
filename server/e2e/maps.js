/**
 * E2E für die Kartenwahl.
 *
 * Geprüft wird gegen einen echten Server, nicht gegen die Datenstruktur:
 *  - der Host darf umstellen, ein Mitspieler nicht
 *  - ungültige und unbekannte IDs werden verworfen, nicht "korrigiert"
 *  - nach dem Matchstart ist die Karte fest
 *  - alle Teilnehmer bekommen dieselbe Karte
 *  - auf jeder der 8 Karten läuft ein Match tatsächlich an und Gegner
 *    erreichen den Core (kein toter Weg, kein Softlock)
 */
const { boot } = require("@colyseus/testing");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const http = require("http");
const { MatchRoom } = require("../dist/rooms/MatchRoom");
const { MSG, MAPS, deserializeLaneMap, mapPathLength } = require("../../shared/dist/index.js");

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
  const colyseus = await boot(gameServer, 12607);

  try {
    // ------------------------------------------------- Rechte und Ablehnung
    {
      const room = await colyseus.createRoom("match", { mode: "battle" });
      const host = await colyseus.connectTo(room, { name: "Host" });
      const gast = await colyseus.connectTo(room, { name: "Gast" });
      await room.waitForNextPatch();

      const start = room.state.mapId;
      assert(MAPS.some((m) => m.id === start), `Startkarte ist gültig (${start})`);

      // Gast darf nicht.
      const andere = MAPS.find((m) => m.id !== start).id;
      gast.send(MSG.setMap, { mapId: andere });
      await wait(400);
      assert(room.state.mapId === start, "Nicht-Host kann die Karte nicht umstellen");
      console.log("✓ Nur der Host darf die Karte wählen");

      // Host darf.
      host.send(MSG.setMap, { mapId: andere });
      await waitFor(() => room.state.mapId === andere, 3000, "Host stellt um");
      console.log(`✓ Host stellt um: ${start} → ${andere}`);

      // Alle sehen dieselbe Karte — geprüft an den ausgelieferten Lane-Daten.
      await room.waitForNextPatch();
      const karten = [...room.state.players.values()].map((p) => {
        const m = deserializeLaneMap(JSON.parse(p.laneMapJson));
        return `${m.spawn.x},${m.spawn.y}->${m.core.x},${m.core.y}`;
      });
      assert(new Set(karten).size === 1, `alle spielen dieselbe Karte (${karten.join(" | ")})`);
      console.log("✓ Alle Teilnehmer bekommen dieselbe Karte");

      // Müll wird verworfen.
      for (const kaputt of [
        { mapId: "gibt-es-nicht" },
        { mapId: "<script>" },
        { mapId: "" },
        { mapId: 42 },
        "kaputt",
        null,
      ]) {
        host.send(MSG.setMap, kaputt);
      }
      await wait(500);
      assert(room.state.mapId === andere, "ungültige Karten-IDs werden verworfen");
      console.log("✓ Ungültige Karten-IDs werden abgelehnt");

      // Nach dem Start ist die Karte fest.
      host.send(MSG.ready, {});
      gast.send(MSG.ready, {});
      await waitFor(() => room.state.phase !== "lobby", 5000, "Match startet");
      const festgelegt = room.state.mapId;
      host.send(MSG.setMap, { mapId: start });
      await wait(400);
      assert(room.state.mapId === festgelegt, "im laufenden Match nicht mehr umstellbar");
      console.log("✓ Karte ist nach dem Matchstart gesperrt");

      await host.leave();
      await gast.leave();
    }

    // ------------------------------- Jede einzelne Karte trägt ein Match
    //
    // Alle acht laufen gleichzeitig in eigenen Räumen. Nacheinander wäre das
    // die Summe der Weglängen (gut sechs Minuten), parallel nur die längste.
    // Und es prüft nebenbei, dass der Server acht Simulationen gleichzeitig
    // aushält.
    const laeufe = MAPS.map(async (def) => {
      const room = await colyseus.createRoom("match", { mode: "endless", mapId: def.id });
      const client = await colyseus.connectTo(room, { name: `T-${def.id}` });
      await room.waitForNextPatch();

      assert(room.state.mapId === def.id, `${def.id}: Karte übernommen`);
      const me = () => room.state.players.get(client.sessionId);

      client.send(MSG.ready, {});
      await waitFor(() => room.state.phase !== "lobby", 8000, `${def.id}: Match startet`);

      // Welle rufen statt auf den Countdown warten.
      client.send(MSG.callWave, {});
      await waitFor(() => room.state.enemiesRemaining > 0, 15000, `${def.id}: Gegner erscheinen`);

      // Ohne Türme muss der Core Schaden nehmen. Das ist der Beweis, dass der
      // Weg wirklich vom Spawn bis zum Core durchläuft — die Weglänge gibt
      // vor, wie lange das dauert, plus Puffer für Spawn-Intervall und
      // langsame Gegnertypen.
      const felder = mapPathLength(def.id);
      const frist = felder * 1600 + 30000;
      const hpVorher = me().coreHp;
      const t0 = Date.now();
      await waitFor(
        () => me().coreHp < hpVorher,
        frist,
        `${def.id}: Gegner erreichen den Core in ${Math.round(frist / 1000)}s (Weg ${felder} Felder)`
      );
      const gebraucht = ((Date.now() - t0) / 1000).toFixed(0);

      await client.leave();
      return `✓ ${def.name.padEnd(15)} ${def.difficulty.padEnd(7)} ${String(felder).padStart(2)} Felder — Core getroffen nach ${gebraucht}s`;
    });

    for (const zeile of await Promise.all(laeufe)) console.log(zeile);

    console.log("\nKARTEN-E2E BESTANDEN");
  } finally {
    await colyseus.shutdown();
  }
}

main().catch((err) => {
  console.error("\nKARTEN-E2E FEHLGESCHLAGEN:", err.message);
  console.error(err.stack);
  process.exit(1);
});
