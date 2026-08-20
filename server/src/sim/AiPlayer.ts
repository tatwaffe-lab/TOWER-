import {
  AiProfile,
  Rng,
  SEND_UNITS,
  TOWERS,
  canSpecialize,
  nextUpgradeCost,
  sendCost,
  sendUnlocked,
} from "@td/shared";
import { PlayerSim } from "./PlayerSim";

/**
 * KI-Gegner für den Gefechtsmodus.
 *
 * Wichtig: die KI ruft dieselben Aktionen auf wie ein Mensch und unterliegt
 * denselben Kosten- und Cooldown-Regeln. Sie hat keinen privilegierten
 * Zugriff und kein Extra-Gold — sie entscheidet nur schneller und nach
 * einfachen Heuristiken. Damit bleibt sie fair und ihr Verhalten ist über
 * die normale Simulation testbar.
 */

export interface AiDecision {
  kind: "build" | "upgrade" | "specialize" | "send";
  towerId?: string;
  defId?: string;
  x?: number;
  y?: number;
  specializationId?: string;
  sendId?: string;
}

/** Türme, die die KI bevorzugt — bewusst eine solide, lesbare Auswahl. */
const OPENING = ["gunner", "cannon", "frost", "tesla", "sniper"];
const LATE = ["mortar", "alchemist", "drone-hub", "flamethrower", "support-beacon"];

export class AiPlayer {
  readonly profile: AiProfile;
  private rng: Rng;
  private thinkTimerMs = 0;

  constructor(profile: AiProfile, rng: Rng) {
    this.profile = profile;
    this.rng = rng;
  }

  /**
   * Wird jeden Tick aufgerufen und liefert höchstens eine Entscheidung —
   * die KI handelt bewusst nicht mehrfach pro Denkintervall.
   */
  think(
    dtMs: number,
    ctx: {
      sim: PlayerSim;
      gold: number;
      threat: number;
      wave: number;
      sendsEnabled: boolean;
      hasTarget: boolean;
    }
  ): AiDecision | null {
    this.thinkTimerMs -= dtMs;
    if (this.thinkTimerMs > 0) return null;
    this.thinkTimerMs = this.profile.thinkIntervalMs;

    // 1) Angreifen, wenn Gold übrig ist und der Modus es erlaubt.
    if (ctx.sendsEnabled && ctx.hasTarget && this.rng.next() < this.profile.aggression) {
      const send = this.pickSend(ctx.gold, ctx.threat, ctx.wave);
      if (send) return { kind: "send", sendId: send };
    }

    // 2) Verteidigung ausbauen. Erst genug Türme, dann aufwerten.
    const towers = [...ctx.sim.towers.values()];
    const wantTowers = Math.min(14, 3 + Math.floor(ctx.wave * 0.7 * this.profile.skill) + 2);

    if (towers.length < wantTowers) {
      const build = this.pickBuildSpot(ctx.sim, ctx.gold, ctx.wave);
      if (build) return build;
    }

    // 3) Spezialisieren, sobald ein Turm voll ausgebaut ist.
    for (const tower of towers) {
      const def = TOWERS[tower.defId];
      if (!def) continue;
      if (canSpecialize(def, tower.level, tower.specializationId)) {
        const spec = def.specializations[this.rng.next() < 0.5 ? 0 : 1];
        if (ctx.gold >= spec.cost) {
          return { kind: "specialize", towerId: tower.id, specializationId: spec.id };
        }
      }
    }

    // 4) Aufwerten — bevorzugt den am wenigsten ausgebauten Turm, damit die
    //    Verteidigung gleichmäßig wächst statt einen Turm zu überhöhen.
    const upgradable = towers
      .filter((t) => nextUpgradeCost(TOWERS[t.defId], t.level) !== null)
      .sort((a, b) => a.level - b.level);
    for (const tower of upgradable) {
      const cost = nextUpgradeCost(TOWERS[tower.defId], tower.level);
      if (cost !== null && ctx.gold >= cost) return { kind: "upgrade", towerId: tower.id };
    }

    // 5) Sonst weiterbauen, falls Gold übrig ist.
    if (towers.length < 18) {
      const build = this.pickBuildSpot(ctx.sim, ctx.gold, ctx.wave);
      if (build) return build;
    }

    return null;
  }

  /**
   * Angriffe kosten jetzt Gold — dasselbe Gold, aus dem die KI ihre Türme
   * baut. Sie darf deshalb nicht alles verpulvern, sonst steht sie in Welle
   * 10 ohne Verteidigung da. `aggression` legt fest, welchen Anteil ihres
   * Goldes sie für einen einzelnen Angriff riskiert.
   */
  private pickSend(gold: number, threat: number, wave: number): string | null {
    const budget = gold * this.profile.aggression;
    const affordable = Object.values(SEND_UNITS).filter(
      (def) => sendUnlocked(def, threat) && sendCost(def, wave) <= budget
    );
    if (affordable.length === 0) return null;
    // Stärkere KI wählt das teuerste bezahlbare Paket, schwächere zufällig.
    if (this.rng.next() < this.profile.skill) {
      return affordable.sort((a, b) => sendCost(b, wave) - sendCost(a, wave))[0].id;
    }
    return this.rng.pick(affordable).id;
  }

  /**
   * Sucht einen Bauplatz. Bevorzugt Felder, die viele Wegabschnitte
   * abdecken — das ist die einfachste Heuristik, die trotzdem sinnvolle
   * Killzonen erzeugt statt Türme am Kartenrand zu verstreuen.
   */
  private pickBuildSpot(sim: PlayerSim, gold: number, wave: number): AiDecision | null {
    const pool = wave < 6 ? OPENING : this.rng.next() < 0.6 ? OPENING : LATE;
    const affordable = pool.filter((id) => TOWERS[id] && TOWERS[id].cost <= gold);
    if (affordable.length === 0) return null;
    const defId = this.rng.pick(affordable);

    const grid = sim.grid;
    const candidates: { x: number; y: number; score: number }[] = [];

    for (let y = 0; y < grid.config.height; y++) {
      for (let x = 0; x < grid.config.width; x++) {
        if (grid.tiles[y][x] !== "buildable") continue;
        if (sim.towerAt(x, y)) continue;

        // Wie viele Wegpunkte liegen in typischer Turmreichweite?
        let covered = 0;
        for (const wp of sim.waypoints) {
          const d = Math.hypot(wp.x - x, wp.y - y);
          if (d <= 3.2) covered++;
        }
        if (covered === 0) continue;
        candidates.push({ x, y, score: covered + this.rng.next() * 3 });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    // Schwächere KI greift nicht immer den besten Platz.
    const index = this.rng.next() < this.profile.skill ? 0 : Math.min(candidates.length - 1, this.rng.int(0, 4));
    const spot = candidates[index];
    return { kind: "build", defId, x: spot.x, y: spot.y };
  }
}
