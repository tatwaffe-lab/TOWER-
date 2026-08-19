import { Client, type Room } from "@colyseus/sdk";
import { MatchState } from "@td/shared";

/**
 * Verbindungsschicht zum Match-Server.
 *
 * Die Server-URL kommt aus einer Environment-Variablen, damit derselbe Build
 * lokal und auf Render funktioniert. Fällt sie weg, wird sie aus der
 * aktuellen Seiten-URL abgeleitet — damit funktioniert der Fall "Client und
 * Server auf derselben Render-Instanz" ohne Konfiguration.
 */
function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Im Dev-Modus läuft Vite auf 5173, der Server auf 2567.
    if (window.location.port === "5173") return `${proto}//${window.location.hostname}:2567`;
    return `${proto}//${window.location.host}`;
  }
  return "ws://localhost:2567";
}

export const SERVER_URL = resolveServerUrl();

export type MatchRoom = Room<any, MatchState>;

const RECONNECT_KEY = "td_reconnect_token";

function createClient(): Client {
  return new Client(SERVER_URL);
}

export async function createMatch(name: string, mode: string): Promise<MatchRoom> {
  const client = createClient();
  const room = await client.create<MatchState>("match", { name, mode }, MatchState);
  rememberReconnect(room);
  return room;
}

export async function joinByCode(name: string, roomCode: string): Promise<MatchRoom> {
  const client = createClient();
  const room = await client.joinOrCreate<MatchState>("match", { name, roomCode: roomCode.toUpperCase() }, MatchState);
  rememberReconnect(room);
  return room;
}

export async function quickJoin(name: string): Promise<MatchRoom> {
  const client = createClient();
  const room = await client.joinOrCreate<MatchState>("match", { name, mode: "battle" }, MatchState);
  rememberReconnect(room);
  return room;
}

/**
 * Reconnect-Token merken. Colyseus erlaubt damit die Rückkehr in ein
 * laufendes Match innerhalb des serverseitigen Zeitfensters.
 */
function rememberReconnect(room: MatchRoom): void {
  try {
    const token = (room as unknown as { reconnectionToken?: string }).reconnectionToken;
    if (token) sessionStorage.setItem(RECONNECT_KEY, token);
    room.onLeave(() => sessionStorage.removeItem(RECONNECT_KEY));
  } catch {
    // sessionStorage kann blockiert sein — Reconnect ist dann nur nicht verfügbar.
  }
}

/** Löscht das Reconnect-Token — nötig beim bewussten Verlassen, sonst
 *  würde das Hauptmenü sofort wieder in das alte Match zurückspringen. */
export function clearReconnectToken(): void {
  try {
    sessionStorage.removeItem(RECONNECT_KEY);
  } catch {
    /* sessionStorage kann blockiert sein */
  }
}

export function storedReconnectToken(): string | null {
  try {
    return sessionStorage.getItem(RECONNECT_KEY);
  } catch {
    return null;
  }
}

export async function tryReconnect(): Promise<MatchRoom | null> {
  const token = storedReconnectToken();
  if (!token) return null;
  try {
    const client = createClient();
    const room = await client.reconnect<MatchState>(token, MatchState);
    rememberReconnect(room);
    return room;
  } catch {
    try {
      sessionStorage.removeItem(RECONNECT_KEY);
    } catch {
      /* ignorieren */
    }
    return null;
  }
}

/** Verständliche Fehlermeldungen statt roher Colyseus-Codes. */
export function describeConnectionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number } | undefined)?.code;

  if (code === 4212 || /locked/i.test(message)) return "Der Raum ist voll oder das Match läuft bereits.";
  if (code === 4210 || /not found/i.test(message)) return "Kein Raum mit diesem Code gefunden.";
  if (/ECONNREFUSED|failed to fetch|networkerror/i.test(message)) {
    return `Server nicht erreichbar (${SERVER_URL}). Läuft er?`;
  }
  return `Verbindung fehlgeschlagen: ${message}`;
}
