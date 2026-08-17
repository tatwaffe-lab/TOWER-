import { Room, Client } from "colyseus";
import {
  COMMANDERS,
  CommanderId,
  ENEMIES,
  EffectState,
  EnemyState,
  LANE_EDIT_BASE_COST,
  MSG,
  MatchState,
  NOTICE,
  PERKS,
  PERK_LEVELS,
  PlayerState,
  Rng,
  SEND_UNITS,
  StatusView,
  THREAT_MAX,
  THREAT_PER_WAVE,
  THREAT_REGEN_PER_SEC,
  TOWERS,
  TARGETING_MODES,
  TowerState,
  buildSpawnQueue,
  canSpecialize,
  defenderReward,
  describeWave,
  investedGold,
  levelForXp,
  nextUpgradeCost,
  planWave,
  randomSeed,
  recomputeBuildable,
  resolveTowerStats,
  sendAvailable,
  serializeLaneMap,
  validate,
  validateEdit,
  xpForLevel,
} from "@td/shared";
import { PlayerSim } from "../sim/PlayerSim";

const TICK_MS = 100;
const PATCH_HZ = 15;
const MAX_PLAYERS = 4;
const PREP_TIME_MS = 20000;
const WAVE_GAP_MS = 12000;
const RECONNECT_SECONDS = 60;
const MAX_WAVES = 30;

interface PlayerRuntime {
  sim: PlayerSim;
  spawnQueue: string[];
  spawnTimerMs: number;
  spawnIntervalMs: number;
  waveHpMul: number;
  pendingPerkLevel: number;
}

/**
 * Autoritativer Matchraum.
 *
 * Alle Regeln laufen hier bzw. in PlayerSim; der Client sendet ausschließlich
 * Absichten. Jede eingehende Nachricht wird über `validate` geprüft, bevor
 * sie die Spiellogik erreicht.
 */
export class MatchRoom extends Room<{ state: MatchState }> {
  maxClients = MAX_PLAYERS;

  private runtimes = new Map<string, PlayerRuntime>();
  private rng!: Rng;
  private waveTimerMs = 0;
  private matchOver = false;
  private eliminationOrder: string[] = [];

  onCreate(options: { mode?: string; roomCode?: string } = {}) {
    this.setState(new MatchState());
    this.state.seed = randomSeed();
    this.state.mode = options.mode === "pvp" ? "pvp" : "solo";
    this.state.roomCode = (options.roomCode ?? this.generateRoomCode()).toUpperCase().slice(0, 6);
    this.rng = new Rng(this.state.seed);
    this.setPatchRate(1000 / PATCH_HZ);
    // Schutz gegen Nachrichtenfluten von manipulierten Clients.
    this.maxMessagesPerSecond = 40;

    // Raumcode als Metadatum, damit die /rooms-Liste ihn anzeigen kann.
    this.setMetadata({ roomCode: this.state.roomCode, mode: this.state.mode });

    this.registerHandlers();
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }

  private generateRoomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  // ------------------------------------------------------------- Handlers

  private registerHandlers() {
    this.onMessage(MSG.setName, (client, payload) => {
      const msg = validate.name(payload);
      const player = this.state.players.get(client.sessionId);
      if (!msg || !player || this.state.phase !== "lobby") return;
      player.name = msg.name;
    });

    this.onMessage(MSG.setCommander, (client, payload) => {
      const msg = validate.commander(payload);
      const player = this.state.players.get(client.sessionId);
      if (!msg || !player || this.state.phase !== "lobby") return;
      if (!COMMANDERS[msg.commanderId as CommanderId]) return;
      player.commanderId = msg.commanderId;
      const rt = this.runtimes.get(client.sessionId);
      if (rt) rt.sim.commanderId = msg.commanderId as CommanderId;
      this.applyCommanderBase(player);
    });

    this.onMessage(MSG.ready, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== "lobby") return;
      player.ready = !player.ready;
      this.maybeStartMatch();
    });

    this.onMessage(MSG.startMatch, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isHost || this.state.phase !== "lobby") return;
      // Host kann erzwingen, sobald mindestens er selbst bereit ist.
      player.ready = true;
      this.startMatch();
    });

    this.onMessage(MSG.placeTower, (client, payload) => {
      const msg = validate.placeTower(payload);
      if (msg) this.handlePlaceTower(client, msg.defId, msg.x, msg.y);
    });

    this.onMessage(MSG.upgradeTower, (client, payload) => {
      const msg = validate.towerRef(payload);
      if (msg) this.handleUpgrade(client, msg.towerId);
    });

    this.onMessage(MSG.specializeTower, (client, payload) => {
      const msg = validate.specialize(payload);
      if (msg) this.handleSpecialize(client, msg.towerId, msg.specializationId);
    });

    this.onMessage(MSG.sellTower, (client, payload) => {
      const msg = validate.towerRef(payload);
      if (msg) this.handleSell(client, msg.towerId);
    });

    this.onMessage(MSG.setTargeting, (client, payload) => {
      const msg = validate.targeting(payload);
      if (!msg) return;
      const rt = this.runtimes.get(client.sessionId);
      const tower = rt?.sim.towers.get(msg.towerId);
      if (!tower || !TARGETING_MODES.includes(msg.targeting as never)) return;
      tower.targeting = msg.targeting;
      const view = this.state.towers.get(msg.towerId);
      if (view) view.targeting = msg.targeting;
    });

    this.onMessage(MSG.editLane, (client, payload) => {
      const msg = validate.editLane(payload);
      if (msg) this.handleLaneEdit(client, msg.action, msg.x, msg.y);
    });

    this.onMessage(MSG.resetLane, (client) => this.handleLaneReset(client));

    this.onMessage(MSG.useAbility, (client, payload) => {
      const msg = validate.ability(payload);
      if (msg) this.handleAbility(client, msg.x, msg.y, false);
    });

    this.onMessage(MSG.useUltimate, (client, payload) => {
      const msg = validate.ability(payload);
      if (msg) this.handleAbility(client, msg.x, msg.y, true);
    });

    this.onMessage(MSG.pickPerk, (client, payload) => {
      const msg = validate.perk(payload);
      if (msg) this.handlePickPerk(client, msg.perkId);
    });

    this.onMessage(MSG.sendUnits, (client, payload) => {
      const msg = validate.sendUnits(payload);
      if (msg) this.handleSend(client, msg.sendId, msg.targetId);
    });

    this.onMessage(MSG.setSendTarget, (client, payload) => {
      const msg = validate.sendUnits(payload);
      const player = this.state.players.get(client.sessionId);
      if (!msg || !player) return;
      if (msg.targetId && this.state.players.has(msg.targetId) && msg.targetId !== client.sessionId) {
        player.sendTargetId = msg.targetId;
      }
    });

    this.onMessage(MSG.rematch, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== "result") return;
      if (!player.isHost) return;
      this.resetToLobby();
    });
  }

  private notify(client: Client, level: "info" | "warn" | "error", text: string) {
    client.send(NOTICE, { level, text });
  }

  // --------------------------------------------------------- Join / Leave

  onJoin(client: Client, options: { name?: string } = {}) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    const requested = validate.name({ name: options?.name ?? "" });
    player.name = requested?.name ?? `Spieler ${this.state.players.size + 1}`;
    player.isHost = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);

    const sim = new PlayerSim(new Rng(this.state.seed + this.state.players.size * 7919));
    this.runtimes.set(client.sessionId, {
      sim,
      spawnQueue: [],
      spawnTimerMs: 0,
      spawnIntervalMs: 800,
      waveHpMul: 1,
      pendingPerkLevel: 0,
    });

    player.laneMapJson = JSON.stringify(serializeLaneMap(sim.grid));
    this.applyCommanderBase(player);
    this.refreshSendTargets();

    if (this.state.players.size > 1) this.state.mode = "pvp";
  }

  /**
   * Unfreiwilliger Verbindungsabbruch. In Colyseus 0.17 ist das der Ort für
   * `allowReconnection` — der Sitz wird für ein realistisches Zeitfenster
   * gehalten, statt den Spieler sofort aus dem laufenden Match zu werfen.
   */
  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;

    if (this.state.phase === "playing" && !player.defeated) {
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        return; // onReconnect übernimmt
      } catch {
        // Zeitfenster abgelaufen: regulär entfernen.
      }
    }
    this.removePlayer(client.sessionId);
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = true;
      this.notify(client, "info", "Wieder verbunden.");
    }
  }

  /** Regulärer Austritt (Client hat selbst verlassen). */
  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.removePlayer(client.sessionId);
  }

  private removePlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (player && this.state.phase === "playing" && !player.defeated) {
      player.defeated = true;
      this.recordElimination(sessionId);
    }

    this.state.players.delete(sessionId);
    this.runtimes.delete(sessionId);

    for (const [id, tower] of this.state.towers) if (tower.ownerId === sessionId) this.state.towers.delete(id);
    for (const [id, enemy] of this.state.enemies) if (enemy.ownerId === sessionId) this.state.enemies.delete(id);
    for (const [id, fx] of this.state.effects) if (fx.ownerId === sessionId) this.state.effects.delete(id);

    // Host neu bestimmen, damit die Lobby nicht blockiert.
    if (!this.hasHost()) {
      const first = this.state.players.values().next().value as PlayerState | undefined;
      if (first) first.isHost = true;
    }
    this.refreshSendTargets();
    if (this.state.phase === "playing") this.checkMatchEnd();
    if (this.state.phase === "lobby") this.maybeStartMatch();
  }

  private hasHost(): boolean {
    for (const p of this.state.players.values()) if (p.isHost) return true;
    return false;
  }

  /** Sorgt dafür, dass jeder ein gültiges Send-Ziel hat. */
  private refreshSendTargets() {
    for (const player of this.state.players.values()) {
      const target = player.sendTargetId ? this.state.players.get(player.sendTargetId) : undefined;
      if (!target || player.sendTargetId === player.sessionId || target.defeated) {
        player.sendTargetId = this.pickDefaultTarget(player.sessionId);
      }
    }
  }

  /** Standardziel: der stärkste noch lebende Gegenspieler (höchste Core-HP). */
  private pickDefaultTarget(sessionId: string): string {
    let best = "";
    let bestHp = -1;
    for (const other of this.state.players.values()) {
      if (other.sessionId === sessionId || other.defeated) continue;
      if (other.coreHp > bestHp) {
        bestHp = other.coreHp;
        best = other.sessionId;
      }
    }
    return best;
  }

  private applyCommanderBase(player: PlayerState) {
    const rt = this.runtimes.get(player.sessionId);
    if (!rt) return;
    rt.sim.commanderId = player.commanderId as CommanderId;
    rt.sim.perks = [...player.perks];
    const mods = rt.sim.modifiers();
    player.maxCoreHp = 100 + mods.coreHpAdd;
    if (this.state.phase === "lobby") {
      player.coreHp = player.maxCoreHp;
      player.gold = 150 + mods.startGoldAdd;
    }
  }

  // ------------------------------------------------------------ Matchstart

  private maybeStartMatch() {
    if (this.state.phase !== "lobby" || this.state.players.size === 0) return;
    for (const player of this.state.players.values()) {
      if (!player.ready) return;
    }
    this.startMatch();
  }

  private startMatch() {
    if (this.state.phase !== "lobby") return;
    this.state.phase = "preparing";
    this.state.wave = 0;
    this.state.laneEditingOpen = true;
    this.waveTimerMs = PREP_TIME_MS;
    this.matchOver = false;
    this.eliminationOrder = [];

    for (const player of this.state.players.values()) {
      const mods = this.runtimes.get(player.sessionId)?.sim.modifiers();
      player.maxCoreHp = 100 + (mods?.coreHpAdd ?? 0);
      player.coreHp = player.maxCoreHp;
      player.gold = 150 + (mods?.startGoldAdd ?? 0);
      player.threat = 0;
      player.defeated = false;
      player.kills = 0;
      player.leaked = 0;
      player.goldEarned = 0;
      player.sendsLaunched = 0;
      player.survivedWaves = 0;
      player.placement = 0;
      player.commanderXp = 0;
      player.commanderLevel = 1;
      player.perks.clear();
      player.perkOffer.clear();
    }
    this.previewNextWave();
    this.refreshSendTargets();
  }

  private previewNextWave() {
    const plan = planWave(this.state.wave + 1, this.state.players.size, new Rng(this.state.seed + this.state.wave + 1));
    this.state.nextWavePreview = describeWave(plan);
  }

  private startWave() {
    this.state.wave += 1;
    this.state.waveActive = true;
    this.state.laneEditingOpen = false;

    for (const [sessionId, rt] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player || player.defeated) continue;
      // Jeder Spieler bekommt dieselbe Wellenzusammensetzung (Fairness),
      // aber eine eigene Spawn-Reihenfolge.
      const plan = planWave(this.state.wave, this.state.players.size, new Rng(this.state.seed + this.state.wave));
      rt.spawnQueue = buildSpawnQueue(plan, new Rng(this.state.seed + this.state.wave + sessionId.length));
      rt.spawnIntervalMs = plan.spawnIntervalMs;
      rt.spawnTimerMs = 0;
      rt.waveHpMul = plan.hpMultiplier;
    }
    this.state.phase = "playing";
  }

  private finishWave() {
    this.state.waveActive = false;
    this.state.laneEditingOpen = true;
    this.waveTimerMs = WAVE_GAP_MS;

    for (const [sessionId, rt] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player || player.defeated) continue;

      player.survivedWaves = this.state.wave;
      const mods = rt.sim.modifiers();

      // Wellenprämie + Einkommen aus Raffinerie-Baken und Perks.
      let income = 40 + this.state.wave * 8 + mods.incomePerWaveAdd;
      for (const tower of rt.sim.towers.values()) {
        const stats = resolveTowerStats(TOWERS[tower.defId], tower.level, tower.specializationId);
        if (stats.incomePerWave) income += stats.incomePerWave;
      }
      this.grantGold(player, income);
      player.threat = Math.min(THREAT_MAX, player.threat + THREAT_PER_WAVE);
      this.grantXp(player, 60 + this.state.wave * 10);
    }

    this.previewNextWave();

    if (this.state.wave >= MAX_WAVES) {
      this.endMatch("Alle Wellen überstanden");
    }
  }

  private grantGold(player: PlayerState, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    player.gold += Math.round(amount);
    player.goldEarned += Math.round(amount);
  }

  private grantXp(player: PlayerState, amount: number) {
    player.commanderXp += Math.max(0, Math.round(amount));
    const newLevel = levelForXp(player.commanderXp);
    if (newLevel > player.commanderLevel) {
      player.commanderLevel = newLevel;
      this.maybeOfferPerk(player);
    }
  }

  /** Bietet auf definierten Leveln 3 Perks aus dem Commander-Pool an. */
  private maybeOfferPerk(player: PlayerState) {
    if (!PERK_LEVELS.includes(player.commanderLevel)) return;
    if (player.perkOffer.length > 0) return;

    const commander = COMMANDERS[player.commanderId as CommanderId];
    const taken = new Set(player.perks);
    const available = commander.perkPool.filter((id) => !taken.has(id) && PERKS[id]);
    if (available.length === 0) return;

    const rng = new Rng(this.state.seed + player.commanderLevel * 31 + player.sessionId.length);
    for (const id of rng.sample(available, Math.min(3, available.length))) {
      player.perkOffer.push(id);
    }
  }

  private handlePickPerk(client: Client, perkId: string) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt) return;
    // Nur aus dem tatsächlich angebotenen Set — verhindert freie Perk-Wahl.
    if (!player.perkOffer.includes(perkId)) {
      this.notify(client, "warn", "Dieser Perk steht gerade nicht zur Wahl.");
      return;
    }
    if (player.perks.includes(perkId)) return;

    player.perks.push(perkId);
    player.perkOffer.clear();
    rt.sim.perks = [...player.perks];

    // Core-HP-Perks wirken sofort auf das Maximum.
    const mods = rt.sim.modifiers();
    const newMax = 100 + mods.coreHpAdd;
    const delta = newMax - player.maxCoreHp;
    player.maxCoreHp = newMax;
    if (delta > 0) player.coreHp = Math.min(newMax, player.coreHp + delta);

    this.notify(client, "info", `Perk gewählt: ${PERKS[perkId]?.name ?? perkId}`);
  }

  // --------------------------------------------------------- Turmaktionen

  private handlePlaceTower(client: Client, defId: string, x: number, y: number) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt || player.defeated) return;
    if (this.state.phase !== "playing" && this.state.phase !== "preparing") return;

    const def = TOWERS[defId];
    if (!def) return;

    if (rt.sim.grid.tiles[y]?.[x] !== "buildable") {
      this.notify(client, "warn", "Hier kann nicht gebaut werden.");
      return;
    }
    if (rt.sim.towerAt(x, y)) {
      this.notify(client, "warn", "Feld ist bereits belegt.");
      return;
    }

    const cost = Math.round(def.cost * rt.sim.modifiers().buildCostMul * rt.sim.activeBuildCostMul());
    if (player.gold < cost) {
      this.notify(client, "warn", `Nicht genug Gold (${cost} nötig).`);
      return;
    }

    player.gold -= cost;
    const tower = rt.sim.addTower(defId, x, y, def.defaultTargeting);

    const view = new TowerState();
    view.id = tower.id;
    view.ownerId = client.sessionId;
    view.defId = defId;
    view.x = x;
    view.y = y;
    view.targeting = tower.targeting;
    this.state.towers.set(tower.id, view);
  }

  private handleUpgrade(client: Client, towerId: string) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    const tower = rt?.sim.towers.get(towerId);
    if (!player || !rt || !tower || player.defeated) return;

    const def = TOWERS[tower.defId];
    const baseCost = nextUpgradeCost(def, tower.level);
    if (baseCost === null) {
      this.notify(client, "warn", "Turm ist voll ausgebaut — jetzt spezialisieren.");
      return;
    }
    const cost = Math.round(baseCost * rt.sim.modifiers().upgradeCostMul * rt.sim.activeBuildCostMul());
    if (player.gold < cost) {
      this.notify(client, "warn", `Nicht genug Gold (${cost} nötig).`);
      return;
    }

    player.gold -= cost;
    tower.level += 1;
    const view = this.state.towers.get(towerId);
    if (view) view.level = tower.level;
  }

  private handleSpecialize(client: Client, towerId: string, specializationId: string) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    const tower = rt?.sim.towers.get(towerId);
    if (!player || !rt || !tower || player.defeated) return;

    const def = TOWERS[tower.defId];
    if (!canSpecialize(def, tower.level, tower.specializationId)) {
      this.notify(client, "warn", "Erst voll ausbauen, dann spezialisieren.");
      return;
    }
    const spec = def.specializations.find((s) => s.id === specializationId);
    if (!spec) return;

    const cost = Math.round(spec.cost * rt.sim.modifiers().upgradeCostMul * rt.sim.activeBuildCostMul());
    if (player.gold < cost) {
      this.notify(client, "warn", `Nicht genug Gold (${cost} nötig).`);
      return;
    }

    player.gold -= cost;
    tower.specializationId = specializationId;
    const view = this.state.towers.get(towerId);
    if (view) view.specializationId = specializationId;
    this.notify(client, "info", `${def.name}: ${spec.name} freigeschaltet.`);
  }

  private handleSell(client: Client, towerId: string) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    const tower = rt?.sim.towers.get(towerId);
    if (!player || !rt || !tower || player.defeated) return;

    const def = TOWERS[tower.defId];
    const mods = rt.sim.modifiers();
    const ratio = Math.min(1, 0.6 + mods.sellRefundAdd);
    const refund = Math.floor(investedGold(def, tower.level, tower.specializationId) * ratio);

    this.grantGold(player, refund);
    player.goldEarned -= refund; // Verkauf ist kein Verdienst
    rt.sim.towers.delete(towerId);
    this.state.towers.delete(towerId);
  }

  // ---------------------------------------------------------- Lane-Editor

  private handleLaneEdit(client: Client, action: string, x: number, y: number) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt || player.defeated) return;

    if (!this.state.laneEditingOpen) {
      this.notify(client, "warn", "Lane-Umbau nur zwischen den Wellen.");
      return;
    }

    const cost = Math.round(LANE_EDIT_BASE_COST * rt.sim.modifiers().laneCostMul);
    if (player.gold < cost) {
      this.notify(client, "warn", `Nicht genug Gold (${cost} nötig).`);
      return;
    }

    // Serverseitige Neuprüfung — die Client-Vorschau ist nie die Wahrheit.
    const result = validateEdit(rt.sim.grid, { action: action as "add-lane" | "remove-lane", x, y });
    if (!result.valid || !result.grid) {
      this.notify(client, "warn", result.reason ?? "Umbau nicht möglich.");
      return;
    }

    // Türme, die durch den Umbau auf Lane-Feldern stünden, werden erstattet.
    const newGrid = result.grid;
    for (const [id, tower] of [...rt.sim.towers]) {
      const tile = newGrid.tiles[tower.y]?.[tower.x];
      if (tile !== "buildable") {
        const def = TOWERS[tower.defId];
        this.grantGold(player, investedGold(def, tower.level, tower.specializationId));
        player.goldEarned -= investedGold(def, tower.level, tower.specializationId);
        rt.sim.towers.delete(id);
        this.state.towers.delete(id);
      }
    }

    player.gold -= cost;
    rt.sim.grid = newGrid;
    rt.sim.rebuildPath();
    player.laneMapJson = JSON.stringify(serializeLaneMap(newGrid));
  }

  private handleLaneReset(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt || !this.state.laneEditingOpen) return;

    const fresh = new PlayerSim(new Rng(this.state.seed)).grid;
    recomputeBuildable(fresh);
    for (const [id, tower] of [...rt.sim.towers]) {
      if (fresh.tiles[tower.y]?.[tower.x] !== "buildable") {
        const def = TOWERS[tower.defId];
        this.grantGold(player, investedGold(def, tower.level, tower.specializationId));
        rt.sim.towers.delete(id);
        this.state.towers.delete(id);
      }
    }
    rt.sim.grid = fresh;
    rt.sim.rebuildPath();
    player.laneMapJson = JSON.stringify(serializeLaneMap(fresh));
    this.notify(client, "info", "Lane auf Standard zurückgesetzt.");
  }

  // ------------------------------------------------------ Commander-Skills

  private handleAbility(client: Client, x: number, y: number, ultimate: boolean) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt || player.defeated || this.state.phase !== "playing") return;

    const commander = COMMANDERS[player.commanderId as CommanderId];
    const ability = ultimate ? commander.ultimate : commander.ability;
    const cdField = ultimate ? "ultimateCooldownMs" : "abilityCooldownMs";

    if (player[cdField] > 0) {
      this.notify(client, "warn", "Fähigkeit lädt noch.");
      return;
    }
    if (player.threat < ability.threatCost) {
      this.notify(client, "warn", `Nicht genug Threat (${ability.threatCost} nötig).`);
      return;
    }

    player.threat -= ability.threatCost;
    const mods = rt.sim.modifiers();
    player[cdField] = Math.round(ability.cooldownMs * mods.abilityCooldownMul);

    this.applyAbilityEffect(client, player, rt, ability.kind, x, y, ability.durationMs, ability.radius);
    this.notify(client, "info", `${ability.name} aktiviert.`);
  }

  private applyAbilityEffect(
    client: Client,
    player: PlayerState,
    rt: PlayerRuntime,
    kind: string,
    x: number,
    y: number,
    durationMs: number,
    radius: number
  ) {
    const sim = rt.sim;
    const neutral = {
      damageMul: 1,
      fireRateMul: 1,
      slowMagnitude: 0,
      buildCostMul: 1,
      sendCostMul: 1,
      sendHpMul: 1,
      sendSpeedMul: 1,
    };

    switch (kind) {
      case "overclock":
        sim.buffs.push({ kind, remainingMs: durationMs, x, y, radius, ...neutral, fireRateMul: 0.5 });
        sim.addEffect("ability-overclock", x, y, x, y, radius, 700);
        break;

      case "emergency-grid":
        sim.buffs.push({ kind, remainingMs: durationMs, x: 0, y: 0, radius: 0, ...neutral, damageMul: 1.6, fireRateMul: 0.5 });
        sim.addEffect("ability-grid", sim.grid.core.x, sim.grid.core.y, sim.grid.core.x, sim.grid.core.y, 4, 900);
        break;

      case "war-march":
        sim.buffs.push({ kind, remainingMs: durationMs, x: 0, y: 0, radius: 0, ...neutral, sendCostMul: 0.6, sendSpeedMul: 1.3 });
        break;

      case "full-assault": {
        // Sofortige kostenlose Salve auf das aktuelle Ziel.
        const targetRt = this.runtimes.get(player.sendTargetId);
        if (!targetRt) {
          this.notify(client, "warn", "Kein gültiges Ziel für den Angriff.");
          break;
        }
        const def = SEND_UNITS["rusher"];
        for (let i = 0; i < 8; i++) {
          targetRt.sim.spawnEnemy(def.spawns, {
            hpMul: def.hpMul * 1.4,
            speedMul: def.speedMul,
            sent: true,
            bountyGold: defenderReward(def),
          });
        }
        player.sendsLaunched += 8;
        break;
      }

      case "rapid-construction":
        sim.buffs.push({ kind, remainingMs: durationMs, x: 0, y: 0, radius: 0, ...neutral, buildCostMul: 0.5 });
        break;

      case "fortress-protocol":
        player.coreHp = Math.min(player.maxCoreHp, player.coreHp + 30);
        sim.buffs.push({ kind, remainingMs: durationMs, x: 0, y: 0, radius: 0, ...neutral, slowMagnitude: 0.55 });
        sim.addEffect("ability-fortress", sim.grid.core.x, sim.grid.core.y, sim.grid.core.x, sim.grid.core.y, 5, 900);
        break;

      case "time-field":
        sim.buffs.push({ kind, remainingMs: durationMs, x, y, radius, ...neutral, slowMagnitude: 0.6 });
        sim.addEffect("ability-timefield", x, y, x, y, radius, durationMs);
        break;

      case "temporal-rewind":
        sim.rewindEnemies(6);
        sim.addEffect("ability-rewind", sim.grid.core.x, sim.grid.core.y, sim.grid.core.x, sim.grid.core.y, 6, 800);
        break;
    }
  }

  // ------------------------------------------------------------ PvP-Sends

  private handleSend(client: Client, sendId: string, targetId: string) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt || player.defeated || this.state.phase !== "playing") return;

    const def = SEND_UNITS[sendId];
    if (!def) return;

    if (this.state.players.size < 2) {
      this.notify(client, "warn", "Sends brauchen mindestens zwei Spieler.");
      return;
    }
    if (!sendAvailable(def, this.state.wave)) {
      this.notify(client, "warn", `${def.name} ist erst ab Welle ${def.minWave} verfügbar.`);
      return;
    }
    if (player.sendCooldownMs > 0) {
      this.notify(client, "warn", "Send lädt noch.");
      return;
    }

    const chosen = targetId || player.sendTargetId;
    // Selbstziel und ungültige/besiegte Ziele werden hart abgelehnt.
    if (!chosen || chosen === client.sessionId) {
      this.notify(client, "warn", "Ungültiges Ziel.");
      return;
    }
    const targetPlayer = this.state.players.get(chosen);
    const targetRt = this.runtimes.get(chosen);
    if (!targetPlayer || !targetRt || targetPlayer.defeated) {
      this.notify(client, "warn", "Ziel ist nicht mehr im Spiel.");
      return;
    }

    const mods = rt.sim.modifiers();
    const cost = Math.max(1, Math.round(def.cost * mods.sendCostMul * rt.sim.activeSendCostMul()));
    if (player.threat < cost) {
      this.notify(client, "warn", `Nicht genug Threat (${cost} nötig).`);
      return;
    }

    player.threat -= cost;
    player.sendCooldownMs = def.cooldownMs;
    player.sendsLaunched += def.count;
    player.sendTargetId = chosen;

    const hpMul = def.hpMul * mods.sendHpMul * rt.sim.activeSendHpMul();
    const speedMul = def.speedMul * mods.sendSpeedMul * rt.sim.activeSendSpeedMul();
    // Der Verteidiger verdient an abgewehrten Sends — gescheiterte Angriffe
    // finanzieren also den Gegner (Master Prompt §11).
    const bounty = defenderReward(def);

    for (let i = 0; i < def.count; i++) {
      targetRt.sim.spawnEnemy(def.spawns, { hpMul, speedMul, sent: true, bountyGold: bounty });
    }

    this.notify(client, "info", `${def.name} an ${targetPlayer.name} geschickt.`);
    const targetClient = this.clients.find((c) => c.sessionId === chosen);
    if (targetClient) this.notify(targetClient, "warn", `${player.name} greift an: ${def.name}!`);
  }

  // ----------------------------------------------------------------- Tick

  private tick() {
    const dt = TICK_MS;

    if (this.state.phase === "preparing") {
      this.waveTimerMs -= dt;
      this.state.nextWaveInMs = Math.max(0, this.waveTimerMs);
      if (this.waveTimerMs <= 0) this.startWave();
      this.syncAll();
      return;
    }

    if (this.state.phase !== "playing") return;

    this.state.matchClockMs += dt;

    // Wellenpause: Countdown bis zur nächsten Welle.
    if (!this.state.waveActive) {
      this.waveTimerMs -= dt;
      this.state.nextWaveInMs = Math.max(0, this.waveTimerMs);
      if (this.waveTimerMs <= 0 && !this.matchOver) this.startWave();
    }

    let totalRemaining = 0;

    for (const [sessionId, rt] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player) continue;

      // Cooldowns laufen auch für besiegte Spieler ab (harmlos, verhindert
      // aber Sonderfälle beim Rematch).
      player.abilityCooldownMs = Math.max(0, player.abilityCooldownMs - dt);
      player.ultimateCooldownMs = Math.max(0, player.ultimateCooldownMs - dt);
      player.sendCooldownMs = Math.max(0, player.sendCooldownMs - dt);

      if (player.defeated) continue;

      // Threat-Regeneration
      const mods = rt.sim.modifiers();
      player.threat = Math.min(
        THREAT_MAX,
        player.threat + (THREAT_REGEN_PER_SEC * mods.threatRegenMul * dt) / 1000
      );

      // Spawns der laufenden Welle
      if (rt.spawnQueue.length > 0) {
        rt.spawnTimerMs -= dt;
        while (rt.spawnTimerMs <= 0 && rt.spawnQueue.length > 0) {
          const defId = rt.spawnQueue.shift()!;
          rt.sim.spawnEnemy(defId, { hpMul: rt.waveHpMul });
          rt.spawnTimerMs += rt.spawnIntervalMs;
        }
      }

      rt.sim.tickBuffs(dt);
      rt.sim.applyFieldSlows(dt);

      const leaks = rt.sim.moveEnemies(dt);
      const statusKills = rt.sim.tickEnemies(dt);
      const towerKills = rt.sim.tickTowers(dt);
      rt.sim.tickEffects(dt);

      for (const kill of [...statusKills, ...towerKills]) {
        this.grantGold(player, kill.gold);
        this.grantXp(player, kill.xp);
        player.kills += 1;
      }

      for (const leak of leaks) {
        player.leaked += 1;
        player.coreHp = Math.max(0, player.coreHp - leak.coreDamage);
        if (player.coreHp <= 0) {
          player.defeated = true;
          this.recordElimination(sessionId);
          break;
        }
      }

      totalRemaining += rt.sim.enemies.size + rt.spawnQueue.length;
    }

    this.state.enemiesRemaining = totalRemaining;

    // Welle endet, wenn niemand mehr Gegner oder offene Spawns hat.
    if (this.state.waveActive && totalRemaining === 0) {
      this.finishWave();
    }

    this.syncAll();
    this.checkMatchEnd();
  }

  private recordElimination(sessionId: string) {
    if (!this.eliminationOrder.includes(sessionId)) this.eliminationOrder.push(sessionId);
  }

  private checkMatchEnd() {
    if (this.matchOver || this.state.phase !== "playing") return;
    const alive = [...this.state.players.values()].filter((p) => !p.defeated);

    if (this.state.players.size <= 1) {
      // Solo: Match endet erst mit dem Tod des einzigen Spielers.
      if (alive.length === 0) this.endMatch("Der Core ist gefallen");
      return;
    }
    if (alive.length <= 1) {
      this.endMatch(alive.length === 1 ? `${alive[0].name} gewinnt` : "Unentschieden");
    }
  }

  private endMatch(reason: string) {
    this.matchOver = true;
    this.state.phase = "result";
    this.state.waveActive = false;
    this.state.resultText = reason;

    // Platzierung: Überlebende zuerst (nach Core-HP), dann in umgekehrter
    // Ausscheidungsreihenfolge.
    const alive = [...this.state.players.values()].filter((p) => !p.defeated).sort((a, b) => b.coreHp - a.coreHp);
    const dead = this.eliminationOrder
      .slice()
      .reverse()
      .map((id) => this.state.players.get(id))
      .filter((p): p is PlayerState => !!p);

    let place = 1;
    for (const player of [...alive, ...dead]) {
      if (player.placement === 0) player.placement = place++;
    }
    this.state.winnerId = alive[0]?.sessionId ?? "";
  }

  private resetToLobby() {
    this.state.phase = "lobby";
    this.state.wave = 0;
    this.state.waveActive = false;
    this.state.matchClockMs = 0;
    this.state.winnerId = "";
    this.state.resultText = "";
    this.state.enemiesRemaining = 0;
    this.state.laneEditingOpen = true;
    this.state.seed = randomSeed();
    this.rng = new Rng(this.state.seed);
    this.matchOver = false;
    this.eliminationOrder = [];

    this.state.towers.clear();
    this.state.enemies.clear();
    this.state.effects.clear();

    // Frische Simulation pro Spieler — kein alter Matchzustand bleibt hängen.
    for (const [sessionId, rt] of this.runtimes) {
      rt.sim.clear();
      rt.sim = new PlayerSim(new Rng(this.state.seed + sessionId.length * 7919));
      rt.spawnQueue = [];
      rt.spawnTimerMs = 0;
      rt.waveHpMul = 1;
      const player = this.state.players.get(sessionId);
      if (player) {
        player.ready = false;
        player.defeated = false;
        player.perks.clear();
        player.perkOffer.clear();
        player.laneMapJson = JSON.stringify(serializeLaneMap(rt.sim.grid));
        rt.sim.commanderId = player.commanderId as CommanderId;
        rt.sim.perks = [];
        this.applyCommanderBase(player);
      }
    }
    this.previewNextWave();
  }

  // ------------------------------------------------------------ Sync-Layer

  /** Spiegelt die Simulation in den replizierten Zustand. */
  private syncAll() {
    const seenEnemies = new Set<string>();
    const seenEffects = new Set<string>();

    for (const [sessionId, rt] of this.runtimes) {
      for (const enemy of rt.sim.enemies.values()) {
        seenEnemies.add(enemy.id);
        let view = this.state.enemies.get(enemy.id);
        if (!view) {
          view = new EnemyState();
          view.id = enemy.id;
          view.ownerId = sessionId;
          view.defId = enemy.defId;
          view.maxHp = enemy.maxHp;
          view.sent = enemy.sent;
          this.state.enemies.set(enemy.id, view);
        }
        view.hp = Math.round(enemy.hp * 10) / 10;
        view.x = Math.round(enemy.x * 100) / 100;
        view.y = Math.round(enemy.y * 100) / 100;
        view.pathIndex = enemy.pathIndex;
        view.facing = Math.round(enemy.facing * 100) / 100;
        view.untargetable = enemy.untargetable;
        view.bossPhase = enemy.bossPhaseName;
        this.syncStatuses(view, enemy.statuses);
      }

      for (const tower of rt.sim.towers.values()) {
        const view = this.state.towers.get(tower.id);
        if (!view) continue;
        view.level = tower.level;
        view.specializationId = tower.specializationId ?? "";
        view.cooldownMs = Math.round(tower.cooldownMs);
        view.disabledMs = Math.round(tower.disabledMs);
        view.facing = Math.round(tower.facing * 100) / 100;
        view.shotTick = tower.shotTick;
        view.totalDamage = Math.round(tower.totalDamage);
      }

      for (const fx of rt.sim.effects) {
        seenEffects.add(fx.id);
        if (this.state.effects.has(fx.id)) continue;
        const view = new EffectState();
        view.id = fx.id;
        view.ownerId = sessionId;
        view.kind = fx.kind;
        view.x = Math.round(fx.x * 100) / 100;
        view.y = Math.round(fx.y * 100) / 100;
        view.x2 = Math.round(fx.x2 * 100) / 100;
        view.y2 = Math.round(fx.y2 * 100) / 100;
        view.radius = fx.radius;
        view.ttlMs = fx.ttlMs;
        this.state.effects.set(fx.id, view);
      }
    }

    for (const [id] of this.state.enemies) if (!seenEnemies.has(id)) this.state.enemies.delete(id);
    for (const [id] of this.state.effects) if (!seenEffects.has(id)) this.state.effects.delete(id);
  }

  private syncStatuses(view: EnemyState, statuses: { kind: string; magnitude: number; remainingMs: number }[]) {
    // Nur die für die Darstellung relevanten Effekte replizieren.
    const relevant = statuses.filter((s) =>
      ["slow", "burn", "poison", "shred", "stun", "shielded", "conductive"].includes(s.kind)
    );
    if (view.statuses.length !== relevant.length) {
      view.statuses.clear();
      for (const s of relevant) {
        const sv = new StatusView();
        sv.kind = s.kind;
        sv.magnitude = Math.round(s.magnitude * 100) / 100;
        sv.remainingMs = Math.round(s.remainingMs);
        view.statuses.push(sv);
      }
      return;
    }
    for (let i = 0; i < relevant.length; i++) {
      view.statuses[i].kind = relevant[i].kind;
      view.statuses[i].magnitude = Math.round(relevant[i].magnitude * 100) / 100;
      view.statuses[i].remainingMs = Math.round(relevant[i].remainingMs);
    }
  }

  onDispose() {
    this.runtimes.clear();
  }
}
