/**
 * Produktions-Smoketest.
 *
 * Startet den echten gebauten Server als eigenen Prozess (wie auf Render),
 * prüft Healthcheck, Auslieferung des Clients, die Raumliste und verbindet
 * dann einen echten WebSocket-Client, der ein Match spielt.
 *
 * Aufruf: npm run build && node server/e2e/smoke-prod.js
 */
const { spawn } = require("child_process");
const path = require("path");
// Dieselbe SDK, die auch der Browser-Client benutzt — der Smoketest geht
// damit exakt denselben Weg wie ein echter Spieler.
const { Client } = require("@colyseus/sdk");

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return await res.json();
    } catch {
      /* Server noch nicht bereit */
    }
    await wait(300);
  }
  throw new Error("Server wurde nicht rechtzeitig gesund");
}

async function main() {
  const serverPath = path.resolve(__dirname, "../dist/index.js");
  const proc = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  proc.stdout.on("data", (d) => (serverLog += d.toString()));
  proc.stderr.on("data", (d) => (serverLog += d.toString()));

  try {
    // 1) Healthcheck (das prüft Render nach jedem Deploy)
    const health = await waitForHealth(20000);
    assert(health.status === "ok", "Healthcheck meldet ok");
    assert(typeof health.protocol === "number", "Protokollversion wird gemeldet");
    console.log(`✓ /healthz erreichbar (Protokoll v${health.protocol})`);

    // 2) Client-Auslieferung
    const page = await fetch(`${BASE}/`);
    assert(page.ok, "Client-Startseite wird ausgeliefert");
    const html = await page.text();
    assert(html.includes("<div id=\"app\">"), "index.html enthält den App-Container");
    const scriptMatch = html.match(/src="([^"]*assets\/[^"]+\.js)"/);
    assert(scriptMatch, "index.html verweist auf ein gebautes Bundle");
    const bundle = await fetch(`${BASE}${scriptMatch[1]}`);
    assert(bundle.ok, "Bundle ist abrufbar");
    const bundleSize = (await bundle.text()).length;
    console.log(`✓ Client wird ausgeliefert (Bundle ${(bundleSize / 1024).toFixed(0)} kB)`);

    // 3) Raumliste
    const rooms = await fetch(`${BASE}/rooms`);
    assert(rooms.ok, "/rooms antwortet");
    console.log("✓ /rooms erreichbar");

    // 4) Echte WebSocket-Verbindung und Match
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const room = await client.create("match", { name: "Smoke", mode: "solo" });
    console.log(`✓ WebSocket-Verbindung, Raum ${room.roomId}`);

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      room.onStateChange.once(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    assert(room.state, "Zustand wird synchronisiert");
    assert(room.state.players.size === 1, "Spieler ist im Raum");

    room.send("ready", {});
    const start = Date.now();
    while (room.state.phase === "lobby" && Date.now() - start < 5000) await wait(150);
    assert(room.state.phase !== "lobby", `Match startet (Phase: ${room.state.phase})`);
    console.log(`✓ Match über echte WebSocket-Verbindung gestartet (Phase: ${room.state.phase})`);

    room.send("place_tower", { defId: "gunner", x: 1, y: 2 });
    const buildStart = Date.now();
    while (room.state.towers.size === 0 && Date.now() - buildStart < 4000) await wait(150);
    assert(room.state.towers.size === 1, "Turm über die Produktionsverbindung gebaut");
    console.log("✓ Spielaktion über die Produktionsverbindung bestätigt");

    await room.leave();
    console.log("\nPRODUKTIONS-SMOKETEST BESTANDEN");
  } catch (err) {
    console.error("\nPRODUKTIONS-SMOKETEST FEHLGESCHLAGEN:", err.message);
    console.error("--- Serverausgabe ---\n" + serverLog);
    process.exitCode = 1;
  } finally {
    proc.kill("SIGTERM");
    await wait(400);
    if (!proc.killed) proc.kill("SIGKILL");
  }
}

main();
