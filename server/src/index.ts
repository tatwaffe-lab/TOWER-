import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import type { Request, Response, Application } from "express";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { PROTOCOL_VERSION } from "@td/shared";
import { MatchRoom } from "./rooms/MatchRoom";

/**
 * Match-Server-Einstiegspunkt.
 *
 * Konfiguration kommt ausschließlich aus Environment-Variablen, damit lokale
 * Entwicklung und Render-Produktion ohne Quellcodeänderung funktionieren.
 * Es liegen bewusst keine Secrets im Repository.
 *
 * Colyseus besitzt hier den HTTP-Lifecycle: `gameServer.listen()` bindet auch
 * die Matchmaking-Routen; eigene Routen kommen über die `express`-Option
 * dazu.
 */
const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "0.0.0.0";

const httpServer = http.createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  express: (app: Application) => {
    app.get("/healthz", (_req: Request, res: Response) => {
      res.status(200).json({
        status: "ok",
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round(process.uptime()),
      });
    });

    // Kleiner Lobby-Endpunkt: listet offene Räume mit ihrem Code, damit der
    // Client eine Raumliste zeigen kann, ohne Colyseus-Interna zu kennen.
    app.get("/rooms", async (_req: Request, res: Response) => {
      try {
        const rooms = await matchMaker.query({ name: "match", locked: false });
        res.status(200).json({
          rooms: rooms.map((room) => ({
            roomId: room.roomId,
            clients: room.clients,
            maxClients: room.maxClients,
            roomCode: (room.metadata as { roomCode?: string } | undefined)?.roomCode ?? "",
          })),
        });
      } catch {
        res.status(200).json({ rooms: [] });
      }
    });

    // Produktionsbetrieb: den gebauten Client mit ausliefern, damit ein
    // einziger Render-Dienst genügt und der Client keine separate Server-URL
    // konfigurieren muss (er leitet sie aus window.location ab).
    // __dirname ist server/dist -> zwei Ebenen hoch ist die Projektwurzel.
    const clientDist = path.resolve(__dirname, "../../client/dist");
    if (fs.existsSync(path.join(clientDist, "index.html"))) {
      app.use(express.static(clientDist));
      app.get("/", (_req: Request, res: Response) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
      // eslint-disable-next-line no-console
      console.log(`[match-server] Client wird ausgeliefert aus ${clientDist}`);
    }
  },
});

gameServer.define("match", MatchRoom).filterBy(["roomCode"]);

gameServer
  .listen(PORT, HOST)
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`[match-server] lauscht auf ${HOST}:${PORT} (health: /healthz, Protokoll v${PROTOCOL_VERSION})`);
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[match-server] Start fehlgeschlagen:", err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    gameServer.gracefullyShutdown().finally(() => process.exit(0));
  });
}
