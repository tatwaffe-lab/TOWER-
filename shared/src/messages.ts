/**
 * Netzwerknachrichten Client -> Server, mit strikter Payload-Validierung.
 *
 * Der Server darf keiner Nachricht trauen: ein manipulierter Client kann
 * beliebige Objekte senden. Jede Nachricht bekommt deshalb hier einen
 * Validator, der Typ, Wertebereich und Länge prüft, bevor die Spiellogik sie
 * sieht. Ungültige Nachrichten werden verworfen, nicht "korrigiert".
 */

export const PROTOCOL_VERSION = 2;

export const MSG = {
  setName: "set_name",
  setCommander: "set_commander",
  ready: "ready",
  startMatch: "start_match",
  placeTower: "place_tower",
  upgradeTower: "upgrade_tower",
  specializeTower: "specialize_tower",
  sellTower: "sell_tower",
  setTargeting: "set_targeting",
  editLane: "edit_lane",
  resetLane: "reset_lane",
  useAbility: "use_ability",
  useUltimate: "use_ultimate",
  pickPerk: "pick_perk",
  sendUnits: "send_units",
  setSendTarget: "set_send_target",
  callWave: "call_wave",
  rematch: "rematch",
} as const;

export interface PlaceTowerMsg {
  defId: string;
  x: number;
  y: number;
}
export interface TowerRefMsg {
  towerId: string;
}
export interface SpecializeMsg {
  towerId: string;
  specializationId: string;
}
export interface TargetingMsg {
  towerId: string;
  targeting: string;
}
export interface EditLaneMsg {
  action: string;
  x: number;
  y: number;
}
export interface AbilityMsg {
  x: number;
  y: number;
}
export interface PerkMsg {
  perkId: string;
}
export interface SendUnitsMsg {
  sendId: string;
  targetId: string;
}
export interface NameMsg {
  name: string;
}
export interface CommanderMsg {
  commanderId: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isSafeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isId(value: unknown, maxLen = 48): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen && /^[a-zA-Z0-9_\-]+$/.test(value);
}

export const validate = {
  name(payload: unknown): NameMsg | null {
    if (!isObject(payload)) return null;
    const raw = payload.name;
    if (typeof raw !== "string") return null;
    const name = raw.trim().slice(0, 16);
    if (name.length === 0) return null;
    // Steuerzeichen entfernen, damit die Lobby-UI nicht zerschossen wird.
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (clean.length === 0) return null;
    return { name: clean };
  },

  commander(payload: unknown): CommanderMsg | null {
    if (!isObject(payload) || !isId(payload.commanderId)) return null;
    return { commanderId: payload.commanderId };
  },

  placeTower(payload: unknown): PlaceTowerMsg | null {
    if (!isObject(payload)) return null;
    if (!isId(payload.defId)) return null;
    if (!isSafeInt(payload.x, 0, 128) || !isSafeInt(payload.y, 0, 128)) return null;
    return { defId: payload.defId, x: payload.x, y: payload.y };
  },

  towerRef(payload: unknown): TowerRefMsg | null {
    if (!isObject(payload) || !isId(payload.towerId, 64)) return null;
    return { towerId: payload.towerId };
  },

  specialize(payload: unknown): SpecializeMsg | null {
    if (!isObject(payload)) return null;
    if (!isId(payload.towerId, 64) || !isId(payload.specializationId)) return null;
    return { towerId: payload.towerId, specializationId: payload.specializationId };
  },

  targeting(payload: unknown): TargetingMsg | null {
    if (!isObject(payload)) return null;
    if (!isId(payload.towerId, 64) || !isId(payload.targeting)) return null;
    return { towerId: payload.towerId, targeting: payload.targeting };
  },

  editLane(payload: unknown): EditLaneMsg | null {
    if (!isObject(payload)) return null;
    if (payload.action !== "add-lane" && payload.action !== "remove-lane") return null;
    if (!isSafeInt(payload.x, 0, 128) || !isSafeInt(payload.y, 0, 128)) return null;
    return { action: payload.action, x: payload.x, y: payload.y };
  },

  ability(payload: unknown): AbilityMsg | null {
    if (!isObject(payload)) return null;
    if (!isSafeNumber(payload.x, -1, 128) || !isSafeNumber(payload.y, -1, 128)) return null;
    return { x: payload.x, y: payload.y };
  },

  perk(payload: unknown): PerkMsg | null {
    if (!isObject(payload) || !isId(payload.perkId)) return null;
    return { perkId: payload.perkId };
  },

  sendUnits(payload: unknown): SendUnitsMsg | null {
    if (!isObject(payload)) return null;
    if (!isId(payload.sendId)) return null;
    const targetId = typeof payload.targetId === "string" ? payload.targetId.slice(0, 64) : "";
    return { sendId: payload.sendId, targetId };
  },
};

/** Server -> Client Hinweise (Toasts). */
export const NOTICE = "notice";
export interface NoticeMsg {
  level: "info" | "warn" | "error";
  text: string;
}
