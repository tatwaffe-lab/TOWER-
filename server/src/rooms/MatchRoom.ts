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
  THREAT_PER_KILL,
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
  sendCost,
  sendUnlocked,
  sendArmorBonus,
  sendPowerMultiplier,
  serializeLaneMap,
  validate,
  validateEdit,
  waveGoldMultiplier,
  xpForLevel,
  gameMode,
  aiProfileFor,
  endlessExtraMultiplier,
  GameModeDefinition,
  createMap,
  isMapId,
  mapDefinition,
  DEFAULT_MAP_ID,
} from "@td/shared";
import { AiPlayer } from "../sim/AiPlayer";
import { PlayerSim } from "../sim/PlayerSim";

const TICK_MS = 100;
const PATCH_HZ = 15;
const MAX_PLAYERS = 4;
const PREP_TIME_MS = 20000;
const WAVE_GAP_MS = 12000;
const RECONNECT_SECONDS = 60;
/**
 * Wellen darf man beliebig viele vorbestellen. Was dabei nicht beliebig sein
 * kann, ist die Zahl gleichzeitig *lebender* Gegner pro Lane — irgendwo hört
 * die Rechenleistung auf, und im Gefecht würde das auch die Mitspieler
 * ausbremsen.
 *
 * Deshalb wird nicht die Bestellung begrenzt, sondern der Ausstoß: die
 * Warteschlange nimmt alles an, spuckt aber nur nach, solange unter dieser
 * Grenze Platz ist. Der Spieler verliert dadurch nichts — die Gegner kommen
 * trotzdem alle, nur eben nachrückend statt auf einen Schlag.
 *
 * Gemessen (`npm run balance`) kostet ein Tick mit 400 Gegnern 0,15 ms bei
 * 100 ms Budget — die Simulation selbst ist also weit von der Kante entfernt.
 * Die Grenze bremst deshalb nicht die Rechenzeit, sondern die Zustands-
 * synchronisation: jeder lebende Gegner ist ein Eintrag, der 15-mal pro
 * Sekunde zu jedem Client repliziert wird, und *das* wird bei vier Lanes
 * teuer. 600 pro Lane ist bewusst großzügig gesetzt; im normalen Spiel
 * begrenzt ohnehin die Spawnrate, nicht dieser Wert.
 */
const MAX_ALIVE_PER_LANE = 600;

/** Ein wartender Spawn — trägt seine eigene Wellenskalierung mit sich. */
interface QueuedSpawn {
  defId: string;
  hpMul: number;
  wave: number;
}

interface PlayerRuntime {
  sim: PlayerSim;
  /**
   * Kann mehrere Wellen gleichzeitig enthalten: wer vorzeitig ruft, stapelt
   * die nächste Welle auf die laufende. Deshalb trägt jeder Eintrag seine
   * eigene HP-Skalierung — sonst bekäme eine vorgezogene Welle die Werte
   * der alten.
   */
  spawnQueue: QueuedSpawn[];
  spawnTimerMs: number;
  spawnIntervalMs: number;
  waveHpMul: number;
  pendingPerkLevel: number;
  /** Gesetzt, wenn dieser Teilnehmer von der KI gesteuert wird. */
  ai?: AiPlayer;
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

  private mode: GameModeDefinition = gameMode("campaign");

  onCreate(options: { mode?: string; roomCode?: string; mapId?: string } = {}) {
    this.setState(new MatchState());
    this.state.seed = randomSeed();
    const mode = gameMode(options.mode ?? "campaign");
    this.mode = mode;
    this.state.mode = mode.id;
    this.state.maxWaves = mode.maxWaves;
    this.state.sendsEnabled = mode.sendsEnabled;
    this.maxClients = mode.maxHumans;
    this.state.mapId =
      options.mapId && isMapId(options.mapId) ? options.mapId : DEFAULT_MAP_ID;
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

    this.onMessage(MSG.callWave, (client) => this.handleCallWave(client));

    this.onMessage(MSG.setMap, (client, payload) => {
      const msg = validate.map(payload);
      const player = this.state.players.get(client.sessionId);
      // Nur der Host, nur in der Lobby, nur existierende Karten. Alles
      // andere wird verworfen, nicht korrigiert.
      if (!msg || !player?.isHost || this.state.phase !== "lobby") return;
      if (!isMapId(msg.mapId)) return;
      if (msg.mapId === this.state.mapId) return;
      this.state.mapId = msg.mapId;
      this.applyMapToAll();
      this.setMetadata({
        roomCode: this.state.roomCode,
        mode: this.state.mode,
        mapId: this.state.mapId,
      });
    });

    this.onMessage(MSG.rematch, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== "result") return;
      if (!player.isHost) return;
      this.resetToLobby();
    });
  }

  /**
   * Schickt eine Meldung als Schlüssel plus Parameter, nicht als fertigen
   * Satz. Der Server kennt die Spracheinstellung des Empfängers nicht — und
   * im Gefecht können zwei Spieler unterschiedliche gewählt haben. Übersetzt
   * wird deshalb erst im Client.
   *
   * Parameter, die auf Inhalte zeigen (Türme, Perks, Angriffe), reisen als
   * Pfad wie `tower.gunner.name` und werden dort ebenfalls übersetzt.
   */
  private notify(
    client: Client,
    level: "info" | "warn" | "error",
    key: string,
    params?: Record<string, string | number>
  ) {
    client.send(NOTICE, { level, key, params });
  }

  // --------------------------------------------------------- Join / Leave

  onJoin(client: Client, options: { name?: string } = {}) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    const requested = validate.name({ name: options?.name ?? "" });
    player.name = requested?.name ?? `Spieler ${this.state.players.size + 1}`;
    player.isHost = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);

    const sim = new PlayerSim(
      new Rng(this.state.seed + this.state.players.size * 7919),
      this.freshGrid()
    );
    // IDs müssen über alle Lanes hinweg eindeutig sein — sonst überschreiben
    // sich Gegner verschiedener Spieler im gemeinsamen Zustand.
    sim.idPrefix = client.sessionId;
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
      this.notify(client, "info", "notice.reconnected");
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
  /** Ein frisches Gitter der aktuell gewählten Karte. */
  private freshGrid() {
    return createMap(this.state.mapId);
  }

  /**
   * Setzt die gewählte Karte für alle Teilnehmer.
   *
   * Alle spielen dieselbe Karte — sonst könnte sich im Gefecht jemand die
   * leichteste aussuchen und hätte mehr Gold für Angriffe übrig, ohne dafür
   * etwas zu leisten.
   */
  private applyMapToAll() {
    for (const [sessionId, rt] of this.runtimes) {
      rt.sim.clear();
      rt.sim.grid = this.freshGrid();
      rt.sim.rebuildPath();
      const player = this.state.players.get(sessionId);
      if (player) player.laneMapJson = JSON.stringify(serializeLaneMap(rt.sim.grid));
    }
    // Türme stünden sonst auf Feldern, die es auf der neuen Karte nicht gibt.
    this.state.towers.clear();
    this.state.enemies.clear();
    this.state.effects.clear();
  }

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
      player.waveIndex = 0;
      player.wavesAhead = 0;
      player.queuedEnemies = 0;
      player.placement = 0;
      player.commanderXp = 0;
      player.commanderLevel = 1;
      player.perks.clear();
      player.perkOffer.clear();
    }
    this.spawnAiOpponents();
    this.previewNextWave();
    this.refreshSendTargets();
  }

  /**
   * Füllt den Gefechtsmodus mit KI-Gegnern auf. Sie bekommen einen eigenen
   * Eintrag in der Spielerliste und eine eigene Lane — für den Rest des
   * Servers sind sie ganz normale Teilnehmer.
   */
  private spawnAiOpponents() {
    if (this.mode.fillWithAiTo <= 0) return;
    const humans = [...this.state.players.values()].filter((p) => !p.isAi).length;
    const needed = Math.max(0, this.mode.fillWithAiTo - humans);

    for (let i = 0; i < needed; i++) {
      const profile = aiProfileFor(i);
      const id = `ai_${i + 1}`;
      if (this.state.players.has(id)) continue;

      const player = new PlayerState();
      player.sessionId = id;
      player.name = profile.name;
      player.isAi = true;
      player.ready = true;
      player.commanderId = i % 2 === 0 ? "warlord" : "engineer";
      this.state.players.set(id, player);

      const sim = new PlayerSim(new Rng(this.state.seed + 4801 * (i + 1)), this.freshGrid());
      sim.idPrefix = id;
      sim.commanderId = player.commanderId as CommanderId;
      this.runtimes.set(id, {
        sim,
        spawnQueue: [],
        spawnTimerMs: 0,
        spawnIntervalMs: 800,
        waveHpMul: 1,
        pendingPerkLevel: 0,
        ai: new AiPlayer(profile, new Rng(this.state.seed + 991 * (i + 1))),
      });

      player.laneMapJson = JSON.stringify(serializeLaneMap(sim.grid));
      this.applyCommanderBase(player);
    }
  }

  /** Führt eine KI-Entscheidung aus — über dieselben Wege wie ein Mensch. */
  private tickAi(sessionId: string, rt: PlayerRuntime, dtMs: number) {
    const player = this.state.players.get(sessionId);
    if (!player || !rt.ai || player.defeated) return;

    const decision = rt.ai.think(dtMs, {
      sim: rt.sim,
      gold: player.gold,
      threat: player.threat,
      wave: this.state.wave,
      sendsEnabled: this.state.sendsEnabled,
      hasTarget: !!player.sendTargetId,
    });
    if (!decision) return;

    switch (decision.kind) {
      case "build":
        this.placeTowerFor(sessionId, decision.defId!, decision.x!, decision.y!);
        break;
      case "upgrade":
        this.upgradeTowerFor(sessionId, decision.towerId!);
        break;
      case "specialize":
        this.specializeTowerFor(sessionId, decision.towerId!, decision.specializationId!);
        break;
      case "send":
        this.sendUnitsFor(sessionId, decision.sendId!, player.sendTargetId);
        break;
    }
  }

  private previewNextWave() {
    const plan = planWave(this.state.wave + 1, this.state.players.size, new Rng(this.state.seed + this.state.wave + 1));
    this.state.nextWavePreview = describeWave(plan);
  }

  /** Globale Wellenfreigabe: jeder, der noch nicht so weit ist, bekommt sie. */
  private startWave() {
    this.state.wave += 1;
    this.state.laneEditingOpen = false;
    this.state.phase = "playing";

    for (const [sessionId] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player || player.defeated) continue;
      // Wer vorgezogen hat, ist schon weiter — für den passiert hier nichts.
      if (player.waveIndex >= this.state.wave) continue;
      this.releaseWaveTo(sessionId, this.state.wave);
    }
    this.state.waveActive = true;
  }

  /**
   * Hängt eine konkrete Welle an die Warteschlange eines Spielers an.
   *
   * Bewusst anhängend statt ersetzend: läuft noch eine Welle, spawnen beide
   * parallel. Genau das macht das vorzeitige Rufen zum Risiko.
   */
  private releaseWaveTo(sessionId: string, wave: number) {
    const rt = this.runtimes.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!rt || !player) return;

    const plan = planWave(wave, this.state.players.size, new Rng(this.state.seed + wave));
    const order = buildSpawnQueue(plan, new Rng(this.state.seed + wave + sessionId.length));
    const hpMul =
      plan.hpMultiplier * (this.state.mode === "endless" ? endlessExtraMultiplier(wave) : 1);

    for (const defId of order) rt.spawnQueue.push({ defId, hpMul, wave });

    // Kürzestes Intervall gewinnt, damit gestapelte Wellen nicht zäh wirken.
    rt.spawnIntervalMs = Math.min(rt.spawnIntervalMs || plan.spawnIntervalMs, plan.spawnIntervalMs);
    rt.sim.currentWave = Math.max(rt.sim.currentWave, wave);

    player.waveIndex = Math.max(player.waveIndex, wave);
    player.wavesAhead = Math.max(0, player.waveIndex - this.state.wave);
    player.survivedWaves = Math.max(player.survivedWaves, wave - 1);
  }

  /**
   * Spieler ruft die nächste Welle vorzeitig — auch mitten in einer
   * laufenden. Belohnt wird die verbleibende Vorbereitungszeit: je früher
   * gerufen, desto mehr Bonusgold.
   */
  private handleCallWave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const rt = this.runtimes.get(client.sessionId);
    if (!player || !rt || player.defeated) return;
    if (this.state.phase !== "playing" && this.state.phase !== "preparing") return;

    if (this.state.maxWaves > 0 && player.waveIndex >= this.state.maxWaves) {
      this.notify(client, "warn", "notice.noMoreWaves");
      return;
    }

    const nextWave = player.waveIndex + 1;

    /**
     * Bonus: Grundprämie plus Anteil der übersprungenen Wartezeit.
     *
     * Der Bonus klingt mit dem Vorsprung ab. Ohne das wäre Dauerklicken ein
     * Goldautomat: 20 Wellen rufen brächte 20 volle Prämien, und das Gold
     * käme sofort, während die Gegner noch in der Warteschlange stehen. Mit
     * der Dämpfung bleibt der erste Ruf lohnend und der zwanzigste ist fast
     * nur noch Risiko — genau die Kurve, die die Entscheidung interessant
     * hält.
     */
    const ahead = Math.max(0, player.waveIndex - this.state.wave);
    const daempfung = 1 / (1 + ahead * 0.6);
    const skipped = Math.max(0, this.waveTimerMs);
    const timeBonus = Math.round((skipped / 1000) * 4);
    const bonus = Math.max(5, Math.round((30 + nextWave * 6 + timeBonus) * daempfung));

    this.releaseWaveTo(client.sessionId, nextWave);
    this.grantGold(player, bonus);
    player.threat = Math.min(THREAT_MAX, player.threat + 10);

    // Erste Phase überspringen, wenn noch niemand gestartet ist.
    if (this.state.phase === "preparing") {
      this.state.phase = "playing";
      this.state.laneEditingOpen = false;
    }
    this.state.waveActive = true;

    this.notify(client, "info", "notice.wavePulled", { wave: nextWave, bonus });
  }

  private finishWave() {
    this.state.waveActive = false;
    this.state.laneEditingOpen = true;
    this.waveTimerMs = WAVE_GAP_MS;

    for (const [sessionId, rt] of this.runtimes) {
      const player = this.state.players.get(sessionId);
      if (!player || player.defeated) continue;

      player.survivedWaves = Math.max(player.survivedWaves, player.waveIndex);
      const mods = rt.sim.modifiers();

      // Wellenprämie + Einkommen aus Raffinerie-Baken und Perks.
      let income = 40 + this.state.wave * 8 + mods.incomePerWaveAdd;
      for (const tower of rt.sim.towers.values()) {
        const stats = resolveTowerStats(TOWERS[tower.defId], tower.level, tower.specializationId);
        if (stats.incomePerWave) income += stats.incomePerWave;
      }
      this.grantGold(player, income);
      // threatRegenMul wirkt jetzt auf den Zuwachs. Seit Bedrohung nicht mehr
      // pro Sekunde nachläuft, wäre der Modifikator sonst wirkungslos — und
      // der Perk "Aggressionsschub" täte schlicht nichts.
      player.threat = Math.min(
        THREAT_MAX,
        player.threat + THREAT_PER_WAVE * mods.threatRegenMul
      );
      this.grantXp(player, 60 + this.state.wave * 10);
    }

    this.previewNextWave();

    // Nur die Kampagne hat ein Wellenlimit; Endlos und Gefecht laufen
    // weiter, bis jemand fällt.
    if (this.state.maxWaves > 0 && this.state.wave >= this.state.maxWaves) {
      this.endMatch("result.reason.allWaves");
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
      this.notify(client, "warn", "notice.perkNotOffered");
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

    this.notify(client, "info", "notice.perkChosen", { perk: `perk.${perkId}.name` });
  }

  // --------------------------------------------------------- Turmaktionen

  private handlePlaceTower(client: Client, defId: string, x: number, y: number) {
    this.placeTowerFor(client.sessionId, defId, x, y, (level, key, params) => this.notify(client, level, key, params));
  }

  /**
   * Turmbau — gemeinsamer Weg für Menschen und KI. Die KI übergibt keinen
   * `notify`-Rückruf, bekommt also keine Hinweistexte, unterliegt aber
   * exakt denselben Prüfungen.
   */
  private placeTowerFor(
    sessionId: string,
    defId: string,
    x: number,
    y: number,
    notify?: (
      level: "info" | "warn" | "error",
      key: string,
      params?: Record<string, string | number>
    ) => void
  ) {
    const player = this.state.players.get(sessionId);
    const rt = this.runtimes.get(sessionId);
    if (!player || !rt || player.defeated) return;
    if (this.state.phase !== "playing" && this.state.phase !== "preparing") return;

    const def = TOWERS[defId];
    if (!def) return;

    if (rt.sim.grid.tiles[y]?.[x] !== "buildable") {
      notify?.("warn", "notice.cantBuildHere");
      return;
    }
    if (rt.sim.towerAt(x, y)) {
      notify?.("warn", "notice.tileOccupied");
      return;
    }

    const cost = Math.round(def.cost * rt.sim.modifiers().buildCostMul * rt.sim.activeBuildCostMul());
    if (player.gold < cost) {
      notify?.("warn", "notice.notEnoughGold", { cost });
      return;
    }

    player.gold -= cost;
    const tower = rt.sim.addTower(defId, x, y, def.defaultTargeting);

    const view = new TowerState();
    view.id = tower.id;
    view.ownerId = sessionId;
    view.defId = defId;
    view.x = x;
    view.y = y;
    view.targeting = tower.targeting;
    this.state.towers.set(tower.id, view);
  }

  private handleUpgrade(client: Client, towerId: string) {
    this.upgradeTowerFor(client.sessionId, towerId, (level, key, params) => this.notify(client, level, key, params));
  }

  private upgradeTowerFor(
    sessionId: string,
    towerId: string,
    notify?: (
      level: "info" | "warn" | "error",
      key: string,
      params?: Record<string, string | number>
    ) => void
  ) {
    const player = this.state.players.get(sessionId);
    const rt = this.runtimes.get(sessionId);
    const tower = rt?.sim.towers.get(towerId);
    if (!player || !rt || !tower || player.defeated) return;

    const def = TOWERS[tower.defId];
    const baseCost = nextUpgradeCost(def, tower.level);
    if (baseCost === null) {
      notify?.("warn", "notice.fullyUpgraded");
      return;
    }
    const cost = Math.round(baseCost * rt.sim.modifiers().upgradeCostMul * rt.sim.activeBuildCostMul());
    if (player.gold < cost) {
      notify?.("warn", "notice.notEnoughGold", { cost });
      return;
    }

    player.gold -= cost;
    tower.level += 1;
    const view = this.state.towers.get(towerId);
    if (view) view.level = tower.level;
  }

  private handleSpecialize(client: Client, towerId: string, specializationId: string) {
    this.specializeTowerFor(client.sessionId, towerId, specializationId, (level, key, params) =>
      this.notify(client, level, key, params)
    );
  }

  private specializeTowerFor(
    sessionId: string,
    towerId: string,
    specializationId: string,
    notify?: (
      level: "info" | "warn" | "error",
      key: string,
      params?: Record<string, string | number>
    ) => void
  ) {
    const player = this.state.players.get(sessionId);
    const rt = this.runtimes.get(sessionId);
    const tower = rt?.sim.towers.get(towerId);
    if (!player || !rt || !tower || player.defeated) return;

    const def = TOWERS[tower.defId];
    if (!canSpecialize(def, tower.level, tower.specializationId)) {
      notify?.("warn", "notice.upgradeFirst");
      return;
    }
    const spec = def.specializations.find((s) => s.id === specializationId);
    if (!spec) return;

    const cost = Math.round(spec.cost * rt.sim.modifiers().upgradeCostMul * rt.sim.activeBuildCostMul());
    if (player.gold < cost) {
      notify?.("warn", "notice.notEnoughGold", { cost });
      return;
    }

    player.gold -= cost;
    tower.specializationId = specializationId;
    const view = this.state.towers.get(towerId);
    if (view) view.specializationId = specializationId;
    notify?.("info", "notice.specUnlocked", {
      tower: `tower.${def.id}.name`,
      spec: `tower.${def.id}.spec.${spec.id}.name`,
    });
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
      this.notify(client, "warn", "notice.laneBetweenWaves");
      return;
    }

    const cost = Math.round(LANE_EDIT_BASE_COST * rt.sim.modifiers().laneCostMul);
    if (player.gold < cost) {
      this.notify(client, "warn", "notice.notEnoughGold", { cost });
      return;
    }

    // Serverseitige Neuprüfung — die Client-Vorschau ist nie die Wahrheit.
    const result = validateEdit(rt.sim.grid, { action: action as "add-lane" | "remove-lane", x, y });
    if (!result.valid || !result.grid) {
      this.notify(client, "warn", result.reasonKey ?? "lane.rejected");
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

    const fresh = this.freshGrid();
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
    this.notify(client, "info", "notice.laneReset");
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
      this.notify(client, "warn", "notice.abilityCooling");
      return;
    }
    // Threat wird auch hier nur *verlangt*, nicht ausgegeben. Sonst würde
    // eine Ultimate den Freischaltstand für Angriffe wieder senken — der
    // Spieler verlöre Optionen, die er sich erspielt hat.
    if (player.threat < ability.threatCost) {
      this.notify(client, "warn", "notice.needThreat", { threat: ability.threatCost });
      return;
    }

    const mods = rt.sim.modifiers();
    player[cdField] = Math.round(ability.cooldownMs * mods.abilityCooldownMul);

    this.applyAbilityEffect(client, player, rt, ability.kind, x, y, ability.durationMs, ability.radius);
    this.notify(client, "info", "notice.abilityUsed", {
      ability: `cmd.${player.commanderId}.${ultimate ? "ult" : "ab"}.name`,
    });
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
          this.notify(client, "warn", "notice.noAttackTarget");
          break;
        }
        const def = SEND_UNITS["rusher"];
        const stufe = Math.max(1, player.waveIndex, this.state.wave);
        for (let i = 0; i < 8; i++) {
          targetRt.sim.spawnEnemy(def.spawns, {
            hpMul: def.hpMul * 1.4 * sendPowerMultiplier(stufe),
            speedMul: def.speedMul,
            armorAdd: sendArmorBonus(def, stufe),
            sent: true,
            bountyGold: defenderReward(def, stufe),
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
    this.sendUnitsFor(client.sessionId, sendId, targetId, (level, key, params) => this.notify(client, level, key, params));
  }

  private sendUnitsFor(
    sessionId: string,
    sendId: string,
    targetId: string,
    notify?: (
      level: "info" | "warn" | "error",
      key: string,
      params?: Record<string, string | number>
    ) => void
  ) {
    const player = this.state.players.get(sessionId);
    const rt = this.runtimes.get(sessionId);
    if (!player || !rt || player.defeated || this.state.phase !== "playing") return;

    const def = SEND_UNITS[sendId];
    if (!def) return;

    if (!this.state.sendsEnabled) {
      notify?.("warn", "notice.sendsDisabled");
      return;
    }
    if (this.state.players.size < 2) {
      notify?.("warn", "notice.needTwoPlayers");
      return;
    }
    // Threat wird nicht ausgegeben, sondern schaltet frei.
    if (!sendUnlocked(def, player.threat)) {
      notify?.("warn", "notice.sendLocked", {
        unit: `send.${def.id}.name`,
        threat: def.threatUnlock,
      });
      return;
    }

    const chosen = targetId || player.sendTargetId;
    // Selbstziel und ungültige/besiegte Ziele werden hart abgelehnt.
    if (!chosen || chosen === sessionId) {
      notify?.("warn", "notice.invalidTarget");
      return;
    }
    const targetPlayer = this.state.players.get(chosen);
    const targetRt = this.runtimes.get(chosen);
    if (!targetPlayer || !targetRt || targetPlayer.defeated) {
      notify?.("warn", "notice.targetGone");
      return;
    }

    /**
     * Gold ist die Kosten. Die Wellenstufe des *Absenders* bestimmt Preis und
     * Stärke — wer weit vorne ist, schickt teurere und härtere Einheiten.
     * Bewusst nicht die Stufe des Ziels: sonst könnte man sich durch eigenes
     * Zurückbleiben billige Angriffe erschleichen.
     */
    const stufe = Math.max(1, player.waveIndex, this.state.wave);
    const mods = rt.sim.modifiers();
    const cost = Math.max(
      1,
      Math.round(sendCost(def, stufe) * mods.sendCostMul * rt.sim.activeSendCostMul())
    );
    if (player.gold < cost) {
      notify?.("warn", "notice.notEnoughGold", { cost });
      return;
    }

    player.gold -= cost;
    player.sendsLaunched += def.count;
    player.sendTargetId = chosen;

    const hpMul =
      def.hpMul * sendPowerMultiplier(stufe) * mods.sendHpMul * rt.sim.activeSendHpMul();
    const speedMul = def.speedMul * mods.sendSpeedMul * rt.sim.activeSendSpeedMul();
    const armorAdd = sendArmorBonus(def, stufe);
    // Der Verteidiger verdient an abgewehrten Sends — gescheiterte Angriffe
    // finanzieren also den Gegner (Master Prompt §11).
    const bounty = defenderReward(def, stufe);

    for (let i = 0; i < def.count; i++) {
      targetRt.sim.spawnEnemy(def.spawns, { hpMul, speedMul, armorAdd, sent: true, bountyGold: bounty });
    }

    notify?.("info", "notice.sendLaunched", {
      unit: `send.${def.id}.name`,
      target: targetPlayer.name,
    });
    const targetClient = this.clients.find((c) => c.sessionId === chosen);
    if (targetClient) this.notify(targetClient, "warn", "notice.underAttack", {
        attacker: player.name,
        unit: `send.${def.id}.name`,
      });
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

      if (player.defeated) continue;

      // KI-Teilnehmer treffen ihre Entscheidungen im selben Tick.
      if (rt.ai) this.tickAi(sessionId, rt, dt);

      // Spawns der laufenden Welle.
      //
      // Die Warteschlange kann beliebig lang sein (Wellen sind unbegrenzt
      // vorbestellbar). Damit die Lane nicht in einem Tick mit tausend
      // Gegnern geflutet wird, wird pro Tick nur nachgespuckt, solange unter
      // MAX_ALIVE_PER_LANE Platz ist. Nichts geht verloren — es rückt nach.
      if (rt.spawnQueue.length > 0) {
        /**
         * Mehrere gerufene Wellen müssen sich auch mehrfach anfühlen.
         *
         * Bis hierher liefen gestapelte Wellen durch dieselbe Warteschlange
         * mit demselben Intervall — fünf Wellen zu rufen streckte den
         * Nachschub also nur in die Länge, statt den Druck zu erhöhen. Das
         * ist genau das Gegenteil von dem, wofür man vorzieht.
         *
         * Deshalb spuckt jede wartende Welle ihren eigenen Strom aus: das
         * Intervall wird durch die Zahl der Wellen in der Warteschlange
         * geteilt. Fünf Wellen heißt fünffache Spawnrate, und es rollt
         * wirklich alles gleichzeitig heran.
         */
        const wellenInQueue = new Set(rt.spawnQueue.map((q) => q.wave)).size;
        const intervall = Math.max(40, rt.spawnIntervalMs / Math.max(1, wellenInQueue));

        rt.spawnTimerMs -= dt;
        while (
          rt.spawnTimerMs <= 0 &&
          rt.spawnQueue.length > 0 &&
          rt.sim.enemies.size < MAX_ALIVE_PER_LANE
        ) {
          const next = rt.spawnQueue.shift()!;
          // Jeder Eintrag bringt seine eigene Skalierung mit — wichtig, wenn
          // mehrere Wellen gleichzeitig laufen.
          rt.sim.currentWave = next.wave;
          rt.sim.spawnEnemy(next.defId, { hpMul: next.hpMul });
          rt.spawnTimerMs += intervall;
        }
        // Bei erreichter Grenze den Timer nicht ins Minus laufen lassen,
        // sonst käme beim Freiwerden alles auf einen Schlag nach.
        if (rt.spawnTimerMs < 0) rt.spawnTimerMs = 0;
      }
      player.queuedEnemies = rt.spawnQueue.length;

      rt.sim.tickBuffs(dt);
      rt.sim.applyFieldSlows(dt);

      const leaks = rt.sim.moveEnemies(dt);
      const statusKills = rt.sim.tickEnemies(dt);
      const towerKills = rt.sim.tickTowers(dt);
      rt.sim.tickEffects(dt);

      const goldScale = waveGoldMultiplier(this.state.wave);
      for (const kill of [...statusKills, ...towerKills]) {
        // Kill-Gold wächst mit der Welle mit, sonst kann der Spieler die
        // exponentiell härteren Gegner wirtschaftlich nicht beantworten.
        this.grantGold(player, kill.wasSent ? kill.gold : kill.gold * goldScale);
        this.grantXp(player, kill.xp);
        player.kills += 1;
        // Threat wird nie ausgegeben — es ist der Freischaltfortschritt.
        // Kills zählen mit, damit gutes Verteidigen die stärkeren Angriffe
        // schneller öffnet als blosses Abwarten.
        player.threat = Math.min(
          THREAT_MAX,
          player.threat + THREAT_PER_KILL * rt.sim.modifiers().threatRegenMul
        );
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

    for (const player of this.state.players.values()) {
      player.wavesAhead = Math.max(0, player.waveIndex - this.state.wave);
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
    const all = [...this.state.players.values()];
    const alive = all.filter((p) => !p.defeated);
    const humansAlive = alive.filter((p) => !p.isAi);

    // Einzelspielermodi: das Match endet mit dem Tod des Spielers.
    if (all.filter((p) => !p.isAi).length <= 1 && all.every((p) => !p.isAi)) {
      if (alive.length === 0) {
        if (this.state.mode === "endless") {
          this.endMatch("result.reason.reachedWave", { wave: this.state.wave });
        } else {
          this.endMatch("result.reason.coreLost");
        }
      }
      return;
    }

    // Gefecht: vorbei, wenn nur noch einer steht — oder wenn kein Mensch
    // mehr lebt (sonst würden die KIs endlos weiterspielen).
    if (alive.length <= 1) {
      if (alive.length === 1) {
        this.endMatch("result.reason.winner", { name: alive[0].name });
      } else {
        this.endMatch("result.reason.draw");
      }
      return;
    }
    if (humansAlive.length === 0) {
      this.endMatch("result.reason.aiWins");
    }
  }

  private endMatch(reasonKey: string, params?: Record<string, string | number>) {
    this.matchOver = true;
    this.state.phase = "result";
    this.state.waveActive = false;
    this.state.resultKey = reasonKey;
    this.state.resultParamsJson = params ? JSON.stringify(params) : "";

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
    // KI-Teilnehmer entfernen; startMatch() legt sie frisch an. Ohne das
    // würde sich das Feld mit jedem Rematch mit KIs auffüllen.
    for (const [id, player] of [...this.state.players]) {
      if (player.isAi) {
        this.state.players.delete(id);
        this.runtimes.delete(id);
      }
    }

    this.state.phase = "lobby";
    this.state.wave = 0;
    this.state.waveActive = false;
    this.state.matchClockMs = 0;
    this.state.winnerId = "";
    this.state.resultKey = "";
    this.state.resultParamsJson = "";
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
      rt.sim = new PlayerSim(new Rng(this.state.seed + sessionId.length * 7919), this.freshGrid());
      rt.sim.idPrefix = sessionId;
      rt.spawnQueue = [];
      rt.spawnTimerMs = 0;
      rt.waveHpMul = 1;
      const player = this.state.players.get(sessionId);
      if (player) {
        player.ready = false;
        player.defeated = false;
        // Vollständig zurücksetzen: alles, was der Ergebnisbildschirm zeigt,
        // muss weg — sonst schleppt das nächste Match alte Platzierungen und
        // Statistiken mit und das Rematch wirkt kaputt.
        player.placement = 0;
        player.kills = 0;
        player.leaked = 0;
        player.goldEarned = 0;
        player.sendsLaunched = 0;
        player.survivedWaves = 0;
        player.waveIndex = 0;
        player.wavesAhead = 0;
        player.queuedEnemies = 0;
        player.commanderXp = 0;
        player.commanderLevel = 1;
        player.threat = 0;
        player.abilityCooldownMs = 0;
        player.ultimateCooldownMs = 0;
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
