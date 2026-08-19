/**
 * Spielmodi.
 *
 * Bewusst nur drei, dafür klar unterscheidbar:
 *
 *  - `campaign`  30 Wellen, allein, klares Ende. Der "richtige" Durchlauf.
 *  - `endless`   unendlich viele Wellen, Ziel ist die höchste erreichte
 *                Welle. Die Schwierigkeit läuft über die Kampagnenkurve
 *                hinaus weiter, damit es irgendwann zwangsläufig endet.
 *  - `battle`    2–4 Teilnehmer mit PvP-Sends. Freie Plätze werden von
 *                KI-Gegnern besetzt — dadurch ist "2 Menschen gegen KI"
 *                genauso möglich wie 1v1 oder 4er-FFA, ohne dass es dafür
 *                getrennte Modi bräuchte.
 */

export type GameMode = "campaign" | "endless" | "battle";

export interface GameModeDefinition {
  id: GameMode;
  name: string;
  tagline: string;
  description: string;
  /** 0 = unbegrenzt. */
  maxWaves: number;
  /** Sind PvP-Sends erlaubt? */
  sendsEnabled: boolean;
  /** Höchstzahl menschlicher Spieler. */
  maxHumans: number;
  /** Auf wie viele Teilnehmer wird mit KI aufgefüllt (0 = keine KI). */
  fillWithAiTo: number;
}

export const GAME_MODES: Record<GameMode, GameModeDefinition> = {
  campaign: {
    id: "campaign",
    name: "Kampagne",
    tagline: "30 Wellen, allein",
    description:
      "Der klassische Durchlauf. 30 Wellen mit Bossen alle 5 Wellen. Wer den Core hält, gewinnt.",
    maxWaves: 30,
    sendsEnabled: false,
    maxHumans: 1,
    fillWithAiTo: 0,
  },
  endless: {
    id: "endless",
    name: "Endlos",
    tagline: "Wie weit kommst du?",
    description:
      "Die Wellen hören nie auf und werden immer härter. Es gibt keinen Sieg — nur die Welle, bis zu der du durchgehalten hast.",
    maxWaves: 0,
    sendsEnabled: false,
    maxHumans: 1,
    fillWithAiTo: 0,
  },
  battle: {
    id: "battle",
    name: "Gefecht",
    tagline: "Gegen Menschen oder KI",
    description:
      "2–4 Teilnehmer, jeder verteidigt seine eigene Lane und schickt Angriffe zu den anderen. Freie Plätze übernehmen KI-Gegner — zu zweit gegen die KI funktioniert genauso wie 1 gegen 1.",
    maxWaves: 0,
    sendsEnabled: true,
    maxHumans: 4,
    fillWithAiTo: 2,
  },
};

export const GAME_MODE_IDS = Object.keys(GAME_MODES) as GameMode[];

export function gameMode(id: string): GameModeDefinition {
  return GAME_MODES[id as GameMode] ?? GAME_MODES.campaign;
}

/**
 * Schwierigkeitsgrade der KI-Gegner im Gefechtsmodus.
 *
 * Die KI ist bewusst kein Rechenmonster: sie spielt nach denselben Regeln
 * wie ein Mensch (dieselben Kosten, dieselbe Serverprüfung), nur mit
 * einfachen Heuristiken und einer Reaktionszeit. `skill` skaliert, wie gut
 * sie baut und wie aggressiv sie sendet.
 */
export interface AiProfile {
  name: string;
  /** 0..1 — beeinflusst Bauqualität, Ausbautempo und Sendefrequenz. */
  skill: number;
  /** Wartezeit zwischen zwei KI-Entscheidungen in ms. */
  thinkIntervalMs: number;
  /** Anteil des Einkommens, den die KI in Angriffe statt Verteidigung steckt. */
  aggression: number;
}

export const AI_PROFILES: AiProfile[] = [
  { name: "Rostkommando", skill: 0.55, thinkIntervalMs: 1800, aggression: 0.35 },
  { name: "Eisenzirkel", skill: 0.7, thinkIntervalMs: 1400, aggression: 0.5 },
  { name: "Leerenkult", skill: 0.85, thinkIntervalMs: 1100, aggression: 0.65 },
];

export function aiProfileFor(index: number): AiProfile {
  return AI_PROFILES[index % AI_PROFILES.length];
}

/**
 * Zusätzliche Härte im Endlosmodus jenseits der Kampagnenlänge.
 *
 * Ohne das würde die Kurve zwar weiterlaufen, aber ein sehr guter Aufbau
 * könnte theoretisch ewig halten. Ab Welle 30 zieht die Skalierung deutlich
 * an, damit jeder Lauf ein Ende findet.
 */
export function endlessExtraMultiplier(wave: number): number {
  if (wave <= 30) return 1;
  return Math.pow(1.06, wave - 30);
}
