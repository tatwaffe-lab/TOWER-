import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

/**
 * Replizierter Matchzustand. Alles hier ist serverautoritativ: Clients lesen
 * nur, senden Absichten und stellen den bestätigten Zustand dar.
 *
 * Liegt in @td/shared, damit Client und Server exakt dieselben Klassen
 * benutzen und der Zustand nicht auseinanderlaufen kann.
 */

export type MatchPhase = "lobby" | "preparing" | "playing" | "result";

export class StatusView extends Schema {
  @type("string") kind: string = "";
  @type("number") magnitude: number = 0;
  @type("number") remainingMs: number = 0;
}

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "Spieler";
  @type("number") gold: number = 150;
  @type("number") threat: number = 0;
  @type("number") coreHp: number = 100;
  @type("number") maxCoreHp: number = 100;
  @type("boolean") ready: boolean = false;
  @type("boolean") defeated: boolean = false;
  @type("boolean") connected: boolean = true;
  @type("boolean") isHost: boolean = false;
  /** true = von der KI gesteuert. */
  @type("boolean") isAi: boolean = false;

  @type("string") commanderId: string = "engineer";
  @type("number") commanderXp: number = 0;
  @type("number") commanderLevel: number = 1;
  @type("number") abilityCooldownMs: number = 0;
  @type("number") ultimateCooldownMs: number = 0;
  /** Perks, die dieser Spieler gewählt hat. */
  @type(["string"]) perks = new ArraySchema<string>();
  /** Aktuell offenes Perk-Angebot (3 IDs), leer wenn keine Wahl ansteht. */
  @type(["string"]) perkOffer = new ArraySchema<string>();

  /** Wen dieser Spieler mit Sends angreift. */
  @type("string") sendTargetId: string = "";

  /**
   * Wie viele Wellen dieser Spieler bereits bekommen hat. Kann über
   * `state.wave` hinausgehen, wenn er Wellen vorzeitig ruft — dann bleibt
   * die automatische Freigabe für ihn wirkungslos, bis der globale Zähler
   * aufgeholt hat.
   */
  @type("number") waveIndex: number = 0;
  /** Wie viele Wellen dieser Spieler dem globalen Zähler voraus ist. */
  @type("number") wavesAhead: number = 0;
  /** Noch nicht ausgespuckte Gegner in der eigenen Warteschlange. */
  @type("number") queuedEnemies: number = 0;

  /** Statistik für den Ergebnisbildschirm. */
  @type("number") kills: number = 0;
  @type("number") leaked: number = 0;
  @type("number") goldEarned: number = 0;
  @type("number") sendsLaunched: number = 0;
  @type("number") survivedWaves: number = 0;
  @type("number") placement: number = 0;

  /** Serialisierte eigene Lane-Karte (JSON), damit Clients sie rendern können. */
  @type("string") laneMapJson: string = "";
}

export class TowerState extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("string") defId: string = "gunner";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") level: number = 0;
  @type("string") specializationId: string = "";
  @type("string") targeting: string = "first";
  @type("number") cooldownMs: number = 0;
  /** > 0 = durch Saboteur/Boss deaktiviert. */
  @type("number") disabledMs: number = 0;
  /** Blickrichtung in Radiant, rein kosmetisch für den Client. */
  @type("number") facing: number = 0;
  /** Zählt hoch bei jedem Schuss — Client triggert daraus Mündungsfeuer. */
  @type("number") shotTick: number = 0;
  @type("number") totalDamage: number = 0;
}

export class EnemyState extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("string") defId: string = "grunt";
  @type("number") hp: number = 1;
  @type("number") maxHp: number = 1;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") pathIndex: number = 0;
  @type("number") facing: number = 0;
  /** true = aktuell nicht anvisierbar (Phase). */
  @type("boolean") untargetable: boolean = false;
  /** true = wurde per PvP-Send erzeugt. */
  @type("boolean") sent: boolean = false;
  @type("string") bossPhase: string = "";
  @type([StatusView]) statuses = new ArraySchema<StatusView>();
}

/** Kurzlebige Effekte, die der Client als VFX abspielt. */
export class EffectState extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("string") kind: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") x2: number = 0;
  @type("number") y2: number = 0;
  @type("number") radius: number = 0;
  @type("number") ttlMs: number = 0;
}

export class MatchState extends Schema {
  @type("string") phase: string = "lobby";
  @type("number") wave: number = 0;
  @type("number") matchClockMs: number = 0;
  /** Countdown bis zur nächsten Welle bzw. bis Matchstart. */
  @type("number") nextWaveInMs: number = 0;
  @type("string") nextWavePreview: string = "";
  @type("number") enemiesRemaining: number = 0;
  @type("boolean") waveActive: boolean = false;
  @type("string") mode: string = "campaign";
  /** 0 = unbegrenzt (Endlosmodus). */
  @type("number") maxWaves: number = 30;
  @type("boolean") sendsEnabled: boolean = false;
  /** Gewählte Karte. Gilt für alle Teilnehmer, damit das Gefecht fair bleibt. */
  @type("string") mapId: string = "maeander";
  @type("number") seed: number = 0;
  @type("string") roomCode: string = "";
  @type("string") winnerId: string = "";
  @type("string") resultText: string = "";
  @type("boolean") laneEditingOpen: boolean = true;

  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: TowerState }) towers = new MapSchema<TowerState>();
  @type({ map: EnemyState }) enemies = new MapSchema<EnemyState>();
  @type({ map: EffectState }) effects = new MapSchema<EffectState>();
}
