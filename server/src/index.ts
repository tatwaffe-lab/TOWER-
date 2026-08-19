import http from "http";
import path from "path";
import fs from "fs";
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
 * Hinweis zu den Typen unten: dieses Modul importiert bewusst NICHT aus
 * "express". Auf Hostern, die mit NODE_ENV=production installieren, fehlt
 * `@types/express` (es ist eine devDependency), und der Build bricht dann mit
 * TS7016 ab. Stattdessen ist hier nur die tatsächlich genutzte Teilmenge der
 * Express-API lokal typisiert — das ist unabhängig davon, ob die Typpakete
 * installiert sind, und immer noch vollständig typsicher.
 */

interface HttpRequest {
  params?: Record<string, string>;
  path?: string;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
  type(contentType: string): HttpResponse;
  send(body: string | Buffer): void;
}

interface HttpApp {
  get(route: string, handler: (req: HttpRequest, res: HttpResponse) => void): void;
}

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "0.0.0.0";

/** Der Vite-Build erzeugt nur index.html und assets/* — mehr braucht es nicht. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendFile(res: HttpResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  res.type(CONTENT_TYPES[ext] ?? "application/octet-stream").send(fs.readFileSync(filePath));
}

const httpServer = http.createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  express: (app: HttpApp) => {
    app.get("/healthz", (_req, res) => {
      res.status(200).json({
        status: "ok",
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round(process.uptime()),
      });
    });

    // Lobby-Endpunkt: listet offene Räume mit ihrem Code, damit der Client
    // eine Raumliste zeigen kann, ohne Colyseus-Interna zu kennen.
    app.get("/rooms", (_req, res) => {
      matchMaker
        .query({ name: "match", locked: false })
        .then((rooms) => {
          res.status(200).json({
            rooms: rooms.map((room) => ({
              roomId: room.roomId,
              clients: room.clients,
              maxClients: room.maxClients,
              roomCode: (room.metadata as { roomCode?: string } | undefined)?.roomCode ?? "",
            })),
          });
        })
        .catch(() => res.status(200).json({ rooms: [] }));
    });

    // Produktionsbetrieb: den gebauten Client mit ausliefern, damit ein
    // einziger Render-Dienst genügt und der Client keine separate Server-URL
    // konfigurieren muss (er leitet sie aus window.location ab).
    // __dirname ist server/dist -> zwei Ebenen hoch ist die Projektwurzel.
    const clientDist = path.resolve(__dirname, "../../client/dist");
    const indexHtml = path.join(clientDist, "index.html");

    if (fs.existsSync(indexHtml)) {
      app.get("/", (_req, res) => sendFile(res, indexHtml));

      app.get("/assets/:name", (req, res) => {
        const name = req.params?.name ?? "";
        // Pfadausbruch verhindern: nur einfache Dateinamen zulassen.
        if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
          res.status(400).json({ error: "ungültiger Pfad" });
          return;
        }
        const filePath = path.join(clientDist, "assets", name);
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: "nicht gefunden" });
          return;
        }
        sendFile(res, filePath);
      });

      // eslint-disable-next-line no-console
      console.log(`[match-server] Client wird ausgeliefert aus ${clientDist}`);
    } else {
      // eslint-disable-next-line no-console
      console.log("[match-server] Kein Client-Build gefunden — es wird nur die API bedient.");
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
