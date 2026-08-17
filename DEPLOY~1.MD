# Deployment auf Render

Der Server ist ein normaler Node-Dienst ohne plattformspezifischen Code und
liefert im Produktionsbuild auch den Client aus. Damit genügt **ein einziger
Web Service**.

## Mit Blueprint (empfohlen)

`render.yaml` liegt im Repository. In Render: *New → Blueprint* und das
Repository auswählen. Alles Weitere kommt aus der Datei.

## Manuell

| Einstellung | Wert |
|---|---|
| Typ | Web Service |
| Runtime | Node |
| Root Directory | Repository-Wurzel (leer lassen) |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

## Environment-Variablen

| Variable | Zweck | Pflicht |
|---|---|---|
| `PORT` | Port, auf dem gelauscht wird | setzt Render automatisch |
| `HOST` | Bind-Adresse, Standard `0.0.0.0` | nein |
| `NODE_VERSION` | Node 22 empfohlen | empfohlen |
| `VITE_SERVER_URL` | nur nötig, wenn der Client getrennt gehostet wird | nein |

Es gibt keine Secrets und keine Datenbank. Räume sind flüchtig; ein Neustart
beendet laufende Matches.

## Warum das ohne Konfiguration im Client funktioniert

Der Client leitet die Server-Adresse aus `window.location` ab
(`client/src/net.ts`): auf Render wird daraus automatisch
`wss://<dienst>.onrender.com`, lokal im Vite-Dev-Modus `ws://localhost:2567`.
Nur wenn Client und Server getrennt laufen, muss `VITE_SERVER_URL` beim
**Build** des Clients gesetzt werden.

## WebSockets

Render unterstützt WebSockets auf Web Services ohne Zusatzkonfiguration.
Wichtig ist nur, dass der Dienst an `process.env.PORT` und `0.0.0.0` bindet —
beides tut `server/src/index.ts`.

## Vor dem Deploy lokal prüfen

```bash
npm ci
npm run build
node server/e2e/smoke-prod.js
```

Der Smoketest startet den gebauten Server als eigenen Prozess und prüft
Healthcheck, Client-Auslieferung, Raumliste, WebSocket-Verbindung,
Matchstart und eine bestätigte Spielaktion.

Zuletzt hier ausgeführt: **bestanden** (Protokoll v2, Bundle 1645 kB).

## Tatsächlicher Deployment-Status

**Nicht live deployed.** Die Konfiguration ist vollständig und lokal im
Produktionsmodus verifiziert, aber es liegen keine Render-Zugangsdaten vor.
Der verbleibende Schritt ist ausschließlich extern auszuführen:

1. Repository zu GitHub/GitLab pushen.
2. In Render *New → Blueprint* mit diesem Repository.
3. Nach dem Deploy prüfen: `https://<dienst>.onrender.com/healthz` liefert
   `{"status":"ok",...}`, die Startseite lädt, ein Match lässt sich starten.

Erst nach dieser Prüfung ist ein Live-Status belegt.

## Betriebshinweise

- **Kaltstart:** Auf kleinen Plänen schläft der Dienst ein. Der erste Aufruf
  dauert dann einige Sekunden; laufende Matches überleben das nicht.
- **Skalierung:** Ein Prozess hält alle Räume im Speicher. Für mehrere
  Instanzen bräuchte es Redis-Presence/Driver (Colyseus unterstützt das,
  ist hier bewusst nicht eingerichtet).
- **Last:** Gemessen ~0,14 ms Simulationszeit pro Tick bei 400 Gegnern
  (`npm run balance`), Tickrate 10 Hz. Der Engpass ist eher die Anzahl
  gleichzeitiger Räume als die Gegnerzahl.
