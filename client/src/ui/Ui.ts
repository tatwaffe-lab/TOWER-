import {
  COMMANDERS,
  COMMANDER_IDS,
  CommanderId,
  MSG,
  MatchState,
  NOTICE,
  NoticeMsg,
  PERKS,
  PlayerState,
  SEND_UNITS,
  TARGETING_LABEL,
  TARGETING_MODES,
  THREAT_MAX,
  TOWERS,
  TileKind,
  canSpecialize,
  investedGold,
  nextUpgradeCost,
  resolveTowerStats,
  sendAvailable,
  xpForLevel,
} from "@td/shared";
import { audio } from "../audio/AudioManager";
import { MatchScene } from "../scenes/MatchScene";
import { MatchRoom, createMatch, describeConnectionError, joinByCode, quickJoin, tryReconnect } from "../net";

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as T;
};

/**
 * Gesamtes HTML-UI: Startmenü, Lobby, HUD, Turminspektor, Perk-Wahl,
 * Lane-Editor-Leiste und Ergebnisbildschirm.
 *
 * Das UI sendet ausschließlich Absichten an den Server und rendert danach
 * den bestätigten Zustand. Es rechnet nie selbst Gold ab.
 */
export class Ui {
  private root: HTMLElement;
  private room: MatchRoom | null = null;
  private scene: MatchScene | null = null;
  private state: MatchState | null = null;

  private selectedTowerDef: string | null = null;
  private selectedTowerId: string | null = null;
  private laneEditMode = false;
  private lastPhase = "";
  private lastWave = -1;
  private lastPerkOffer = "";
  private playerName = "";

  constructor(root: HTMLElement) {
    this.root = root;
  }

  attachScene(scene: MatchScene) {
    this.scene = scene;
  }

  // ------------------------------------------------------------- Startmenü

  showMenu(errorText = "") {
    audio.unlock();
    this.root.innerHTML = "";
    const savedName = localStorage.getItem("td_name") ?? "";

    const screen = el(`
      <div class="screen">
        <h1>ARCANE INDUSTRY</h1>
        <div class="sub">Multiplayer Tower Defense · 1–4 Spieler</div>
        <div class="panel col" style="min-width:360px">
          <label class="row"><span style="width:70px;color:var(--dim);font-size:12px">Name</span>
            <input id="name" maxlength="16" placeholder="Dein Name" value="${savedName}" style="flex:1"></label>
          <button id="solo" class="primary">Solo starten</button>
          <button id="host">Mehrspieler-Raum erstellen</button>
          <div class="row">
            <input id="code" maxlength="6" placeholder="RAUMCODE" style="flex:1;text-transform:uppercase">
            <button id="join">Beitreten</button>
          </div>
          <button id="quick">Schnellsuche</button>
          <div class="err" id="err">${errorText}</div>
        </div>
        <div class="hint">
          Klick = bauen/auswählen · 1–9 = Turm wählen · E = Lane-Editor<br>
          Q = Fähigkeit · W = Ultimate · Esc = Abwählen
        </div>
      </div>`);
    this.root.appendChild(screen);

    const nameInput = screen.querySelector<HTMLInputElement>("#name")!;
    const err = screen.querySelector<HTMLElement>("#err")!;
    const getName = () => {
      const value = nameInput.value.trim() || "Spieler";
      localStorage.setItem("td_name", value);
      this.playerName = value;
      return value;
    };

    const connect = async (fn: () => Promise<MatchRoom>) => {
      audio.unlock();
      audio.play("ui-click");
      err.textContent = "Verbinde…";
      try {
        const room = await fn();
        this.bindRoom(room);
      } catch (e) {
        audio.play("ui-error");
        err.textContent = describeConnectionError(e);
      }
    };

    screen.querySelector("#solo")!.addEventListener("click", () => connect(() => createMatch(getName(), "solo")));
    screen.querySelector("#host")!.addEventListener("click", () => connect(() => createMatch(getName(), "pvp")));
    screen.querySelector("#quick")!.addEventListener("click", () => connect(() => quickJoin(getName())));
    screen.querySelector("#join")!.addEventListener("click", () => {
      const code = screen.querySelector<HTMLInputElement>("#code")!.value.trim().toUpperCase();
      if (!code) {
        err.textContent = "Bitte einen Raumcode eingeben.";
        audio.play("ui-error");
        return;
      }
      void connect(() => joinByCode(getName(), code));
    });

    // Angefangenes Match nach Reload fortsetzen.
    void tryReconnect().then((room) => {
      if (room) this.bindRoom(room);
    });
  }

  // ------------------------------------------------------------ Raumbindung

  private bindRoom(room: MatchRoom) {
    this.room = room;
    this.state = room.state;
    audio.startMusic();

    room.onMessage(NOTICE, (msg: NoticeMsg) => this.toast(msg.level, msg.text));
    room.onError((code, message) => this.toast("error", `Serverfehler ${code}: ${message ?? ""}`));
    room.onLeave(() => {
      this.scene?.resetVisuals();
      this.showMenu("Verbindung zum Match beendet.");
    });

    room.onStateChange(() => this.render());
    this.scene?.bind(room.state, room.sessionId, {
      onTileClick: (x, y, tile) => this.handleTileClick(x, y, tile),
      onTowerClick: (id) => this.selectTower(id),
      onHover: () => undefined,
    });

    this.installHotkeys();
    this.render();
  }

  private send(type: string, payload?: unknown) {
    try {
      this.room?.send(type, payload as never);
    } catch {
      this.toast("error", "Nachricht konnte nicht gesendet werden.");
    }
  }

  private get me(): PlayerState | undefined {
    if (!this.state || !this.room) return undefined;
    return this.state.players.get(this.room.sessionId);
  }

  // ----------------------------------------------------------- Hauptrender

  private render() {
    const state = this.state;
    if (!state) return;

    if (state.phase !== this.lastPhase) {
      this.onPhaseChange(state.phase);
      this.lastPhase = state.phase;
    }

    if (state.phase === "lobby") this.renderLobby();
    else if (state.phase === "result") this.renderResult();
    else this.renderHud();
  }

  private onPhaseChange(phase: string) {
    this.root.innerHTML = "";
    this.selectedTowerId = null;
    this.scene?.setSelectedTower(null);
    if (phase === "playing" || phase === "preparing") {
      this.lastWave = -1;
      audio.play("wave-start");
    }
    if (phase === "lobby") this.scene?.resetVisuals();
    if (phase === "result") {
      const me = this.me;
      audio.play(me && !me.defeated ? "victory" : "defeat");
    }
  }

  // ----------------------------------------------------------------- Lobby

  private renderLobby() {
    const state = this.state!;
    const me = this.me;
    if (!me) return;

    // Nur neu aufbauen, wenn nötig — sonst verliert man den Fokus.
    let screen = this.root.querySelector<HTMLElement>(".screen");
    if (!screen) {
      screen = el(`
        <div class="screen">
          <h1>LOBBY</h1>
          <div class="roomcode" id="rc"></div>
          <div class="sub">Code weitergeben, damit andere beitreten können</div>
          <div class="lobbygrid">
            <div class="panel"><h3>Commander</h3><div class="commanderlist" id="cmds"></div></div>
            <div class="panel"><h3>Spieler</h3><div class="playerlist" id="pl"></div>
              <div class="col" style="margin-top:12px">
                <button id="ready" class="primary">Bereit</button>
                <button id="start">Jetzt starten (Host)</button>
                <button id="leave" class="danger">Verlassen</button>
              </div>
            </div>
          </div>
          <div class="hint" id="lobbyhint"></div>
        </div>`);
      this.root.appendChild(screen);

      screen.querySelector("#ready")!.addEventListener("click", () => {
        audio.play("ui-click");
        this.send(MSG.ready);
      });
      screen.querySelector("#start")!.addEventListener("click", () => {
        audio.play("ui-click");
        this.send(MSG.startMatch);
      });
      screen.querySelector("#leave")!.addEventListener("click", () => {
        void this.room?.leave();
      });
    }

    screen.querySelector("#rc")!.textContent = state.roomCode;

    // Commander-Auswahl
    const cmds = screen.querySelector<HTMLElement>("#cmds")!;
    cmds.innerHTML = "";
    for (const id of COMMANDER_IDS) {
      const c = COMMANDERS[id];
      const btn = el<HTMLButtonElement>(`
        <button class="cmdbtn ${me.commanderId === id ? "selected" : ""}">
          <strong>${c.name}</strong>
          <span class="tag">${c.tagline}</span>
          <span class="tag">${c.passiveText}</span>
          <span class="tag">Q: ${c.ability.name} · W: ${c.ultimate.name}</span>
        </button>`);
      btn.addEventListener("click", () => {
        audio.play("ui-click");
        this.send(MSG.setCommander, { commanderId: id });
      });
      cmds.appendChild(btn);
    }

    // Spielerliste
    const pl = screen.querySelector<HTMLElement>("#pl")!;
    pl.innerHTML = "";
    for (const [, p] of state.players) {
      const row = el(`
        <div class="playerrow ${p.sessionId === me.sessionId ? "me" : ""}">
          <span class="dot ${p.connected ? "" : "off"}"></span>
          <span class="nm">${escapeHtml(p.name)}${p.isHost ? " (Host)" : ""}</span>
          <span style="color:${p.ready ? "var(--hp)" : "var(--dim)"}">${p.ready ? "BEREIT" : "wartet"}</span>
        </div>`);
      pl.appendChild(row);
    }

    const readyBtn = screen.querySelector<HTMLButtonElement>("#ready")!;
    readyBtn.textContent = me.ready ? "Doch nicht bereit" : "Bereit";
    readyBtn.className = me.ready ? "" : "primary";

    const startBtn = screen.querySelector<HTMLButtonElement>("#start")!;
    startBtn.style.display = me.isHost ? "" : "none";

    const hint = screen.querySelector<HTMLElement>("#lobbyhint")!;
    hint.textContent =
      state.players.size === 1
        ? "Alleine spielbar — oder auf Mitspieler warten (bis 4). Sends brauchen mindestens 2 Spieler."
        : `${state.players.size} Spieler im Raum. Das Match startet, wenn alle bereit sind.`;
  }

  // ------------------------------------------------------------------- HUD

  private renderHud() {
    const state = this.state!;
    const me = this.me;
    if (!me) return;

    let hud = this.root.querySelector<HTMLElement>("#hud");
    if (!hud) {
      hud = this.buildHudSkeleton();
      this.root.appendChild(hud);
    }

    // Wellenwechsel akustisch markieren.
    if (state.wave !== this.lastWave && state.wave > 0) {
      if (this.lastWave >= 0) audio.play(state.waveActive ? "wave-start" : "wave-clear");
      this.lastWave = state.wave;
    }

    // Kartenaktualisierung nach Lane-Umbau
    this.scene?.setLaneMap(me.laneMapJson);

    // ---- Topbar
    const hpPct = Math.max(0, (me.coreHp / Math.max(1, me.maxCoreHp)) * 100);
    const threatPct = (me.threat / THREAT_MAX) * 100;
    const nextLevelXp = xpForLevel(me.commanderLevel + 1);
    const xpPct = Math.min(100, (me.commanderXp / Math.max(1, nextLevelXp)) * 100);
    const commander = COMMANDERS[me.commanderId as CommanderId];

    this.setText(hud, "#gold", `${Math.floor(me.gold)}`);
    this.setText(hud, "#threat", `${Math.floor(me.threat)}`);
    this.setText(hud, "#hpv", `${Math.ceil(me.coreHp)}/${me.maxCoreHp}`);
    this.setText(hud, "#wave", `${state.wave}`);
    this.setText(hud, "#remaining", `${state.enemiesRemaining}`);
    this.setText(hud, "#cmdname", `${commander.name} · Lv ${me.commanderLevel}`);
    this.setBar(hud, "#hpbar", hpPct);
    this.setBar(hud, "#threatbar", threatPct);
    this.setBar(hud, "#xpbar", xpPct);

    // ---- Wellenanzeige
    const wavebox = hud.querySelector<HTMLElement>(".wavebox")!;
    if (state.waveActive) {
      wavebox.innerHTML = `<strong>Welle ${state.wave} läuft</strong> · ${state.enemiesRemaining} Gegner übrig`;
      wavebox.classList.add("warn");
    } else {
      const secs = Math.ceil(state.nextWaveInMs / 1000);
      wavebox.innerHTML =
        `<strong>Welle ${state.wave + 1} in ${secs}s</strong>` +
        `<div class="next">${escapeHtml(state.nextWavePreview || "—")}</div>`;
      wavebox.classList.remove("warn");
    }

    // ---- Turmliste
    this.renderTowerButtons(hud, me);
    this.renderAbilities(hud, me, commander);
    this.renderSends(hud, me, state);
    this.renderPlayers(hud, me, state);
    this.renderInspector(hud);
    this.renderPerkOffer(me);

    // ---- Lane-Editor-Leiste
    const edit = hud.querySelector<HTMLElement>(".editmode")!;
    edit.classList.toggle("active", this.laneEditMode);
    if (this.laneEditMode) {
      this.setText(
        hud,
        "#editinfo",
        state.laneEditingOpen ? "Lane-Editor: Klick fügt Weg hinzu, Shift+Klick entfernt." : "Umbau nur zwischen Wellen."
      );
    }
  }

  private buildHudSkeleton(): HTMLElement {
    const hud = el(`
      <div id="hud" class="active">
        <div class="topbar">
          <div class="stat gold"><span class="label">Gold</span><span class="value" id="gold">0</span></div>
          <div class="stat threat"><span class="label">Threat</span><span class="value" id="threat">0</span>
            <div class="bar threat"><i id="threatbar"></i></div></div>
          <div class="stat hp"><span class="label">Core</span><span class="value" id="hpv">0</span>
            <div class="bar"><i id="hpbar"></i></div></div>
          <div class="stat"><span class="label">Welle</span><span class="value" id="wave">0</span></div>
          <div class="stat"><span class="label">Gegner</span><span class="value" id="remaining">0</span></div>
          <div class="spacer"></div>
          <div class="stat"><span class="label" id="cmdname"></span>
            <div class="bar xp"><i id="xpbar"></i></div></div>
          <button id="btn-edit" style="padding:5px 10px;font-size:11px">Lane (E)</button>
          <button id="btn-audio" style="padding:5px 10px;font-size:11px">Ton</button>
          <button id="btn-leave" class="danger" style="padding:5px 10px;font-size:11px">Verlassen</button>
        </div>

        <div class="wavebox"></div>
        <div class="toasts"></div>

        <div class="sidebar">
          <div class="section"><h4>Türme</h4><div class="towergrid" id="towers"></div></div>
          <div class="section"><h4>Commander</h4><div class="abilitylist" id="abilities"></div></div>
          <div class="section" id="sendsection"><h4>Angriff senden</h4><div class="sendlist" id="sends"></div></div>
          <div class="section"><h4>Spieler</h4><div class="playerlist" id="players"></div></div>
        </div>

        <div class="inspector" id="inspector"></div>
        <div class="editmode">
          <span id="editinfo"></span>
          <button id="editreset" style="padding:5px 10px;font-size:11px">Zurücksetzen</button>
          <button id="editdone" style="padding:5px 10px;font-size:11px">Fertig</button>
        </div>
        <div class="perkpick" id="perkpick"></div>
      </div>`);

    hud.querySelector("#btn-edit")!.addEventListener("click", () => this.toggleLaneEdit());
    hud.querySelector("#editdone")!.addEventListener("click", () => this.toggleLaneEdit(false));
    hud.querySelector("#editreset")!.addEventListener("click", () => {
      audio.play("ui-click");
      this.send(MSG.resetLane);
    });
    hud.querySelector("#btn-leave")!.addEventListener("click", () => void this.room?.leave());
    hud.querySelector("#btn-audio")!.addEventListener("click", (ev) => {
      audio.sfxEnabled = !audio.sfxEnabled;
      audio.setMusicEnabled(audio.sfxEnabled);
      (ev.currentTarget as HTMLElement).textContent = audio.sfxEnabled ? "Ton" : "Stumm";
    });
    return hud;
  }

  private renderTowerButtons(hud: HTMLElement, me: PlayerState) {
    const container = hud.querySelector<HTMLElement>("#towers")!;
    const signature = `${Math.floor(me.gold)}:${this.selectedTowerDef}`;
    if (container.dataset.sig === signature) return;
    container.dataset.sig = signature;
    container.innerHTML = "";

    Object.values(TOWERS).forEach((def, index) => {
      const affordable = me.gold >= def.cost;
      const btn = el<HTMLButtonElement>(`
        <button class="towerbtn ${affordable ? "" : "unaffordable"} ${this.selectedTowerDef === def.id ? "selected" : ""}"
                title="${escapeHtml(def.role)}">
          <span>${index + 1}. ${escapeHtml(def.name)}</span>
          <span class="cost">${def.cost} G</span>
        </button>`);
      btn.addEventListener("click", () => {
        audio.play("ui-click");
        this.selectedTowerDef = this.selectedTowerDef === def.id ? null : def.id;
        this.laneEditMode = false;
        this.scene?.setLaneEditMode(false);
        container.dataset.sig = "";
        this.render();
      });
      container.appendChild(btn);
    });
  }

  private renderAbilities(hud: HTMLElement, me: PlayerState, commander: (typeof COMMANDERS)[CommanderId]) {
    const container = hud.querySelector<HTMLElement>("#abilities")!;
    const abilityReady = me.abilityCooldownMs <= 0;
    const ultReady = me.ultimateCooldownMs <= 0 && me.threat >= commander.ultimate.threatCost;
    const sig = `${abilityReady}:${ultReady}:${Math.ceil(me.abilityCooldownMs / 1000)}:${Math.ceil(me.ultimateCooldownMs / 1000)}`;
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    container.innerHTML = "";

    const mk = (label: string, name: string, ready: boolean, cd: number, ultimate: boolean, desc: string) => {
      const btn = el<HTMLButtonElement>(`
        <button class="sendbtn" ${ready ? "" : "disabled"} title="${escapeHtml(desc)}">
          <span>${label} ${escapeHtml(name)}</span>
          <span class="cost">${ready ? "BEREIT" : `${Math.ceil(cd / 1000)}s`}</span>
        </button>`);
      btn.addEventListener("click", () => this.useAbility(ultimate));
      container.appendChild(btn);
    };

    mk("Q", commander.ability.name, abilityReady, me.abilityCooldownMs, false, commander.ability.description);
    mk("W", commander.ultimate.name, ultReady, me.ultimateCooldownMs, true, commander.ultimate.description);
  }

  private renderSends(hud: HTMLElement, me: PlayerState, state: MatchState) {
    const section = hud.querySelector<HTMLElement>("#sendsection")!;
    // Im Solo-Modus wird die Sektion ausgeblendet statt tot anzuzeigen.
    if (state.players.size < 2) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const container = hud.querySelector<HTMLElement>("#sends")!;
    const sig = `${Math.floor(me.threat)}:${state.wave}:${me.sendCooldownMs > 0}:${me.sendTargetId}`;
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    container.innerHTML = "";

    for (const def of Object.values(SEND_UNITS)) {
      const unlocked = sendAvailable(def, state.wave);
      const affordable = me.threat >= def.cost;
      const ready = me.sendCooldownMs <= 0;
      const enabled = unlocked && affordable && ready && !!me.sendTargetId;
      const btn = el<HTMLButtonElement>(`
        <button class="sendbtn" ${enabled ? "" : "disabled"} title="${escapeHtml(def.description)}">
          <span>${escapeHtml(def.name)}</span>
          <span class="cost">${unlocked ? `${def.cost} T` : `W${def.minWave}`}</span>
        </button>`);
      btn.addEventListener("click", () => {
        audio.play("ui-click");
        this.send(MSG.sendUnits, { sendId: def.id, targetId: me.sendTargetId });
      });
      container.appendChild(btn);
    }
  }

  private renderPlayers(hud: HTMLElement, me: PlayerState, state: MatchState) {
    const container = hud.querySelector<HTMLElement>("#players")!;
    const sig = [...state.players.values()]
      .map((p) => `${p.sessionId}:${Math.ceil(p.coreHp)}:${p.defeated}:${p.connected}`)
      .join("|") + me.sendTargetId;
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    container.innerHTML = "";

    for (const [, p] of state.players) {
      const isMe = p.sessionId === me.sessionId;
      const isTarget = me.sendTargetId === p.sessionId;
      const row = el(`
        <div class="playerrow ${isMe ? "me" : ""} ${p.defeated ? "dead" : ""} ${isTarget ? "target" : ""}">
          <span class="dot ${p.connected ? "" : "off"}"></span>
          <span class="nm">${escapeHtml(p.name)}${isMe ? " (du)" : ""}</span>
          <span style="color:var(--hp)">${Math.ceil(p.coreHp)}</span>
        </div>`);
      if (!isMe && !p.defeated) {
        row.addEventListener("click", () => {
          audio.play("ui-click");
          this.send(MSG.setSendTarget, { sendId: "rusher", targetId: p.sessionId });
        });
      }
      container.appendChild(row);
    }
  }

  private renderInspector(hud: HTMLElement) {
    const box = hud.querySelector<HTMLElement>("#inspector")!;
    const towerId = this.selectedTowerId;
    if (!towerId || !this.state) {
      box.classList.remove("active");
      return;
    }
    const tower = this.state.towers.get(towerId);
    const me = this.me;
    if (!tower || !me) {
      box.classList.remove("active");
      return;
    }

    const def = TOWERS[tower.defId];
    const stats = resolveTowerStats(def, tower.level, tower.specializationId || null);
    const upCost = nextUpgradeCost(def, tower.level);
    const canSpec = canSpecialize(def, tower.level, tower.specializationId || null);
    const refund = Math.floor(investedGold(def, tower.level, tower.specializationId || null) * 0.6);
    const spec = tower.specializationId
      ? def.specializations.find((s) => s.id === tower.specializationId)
      : null;

    const sig = `${towerId}:${tower.level}:${tower.specializationId}:${tower.targeting}:${Math.floor(me.gold)}`;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.classList.add("active");

    box.innerHTML = `
      <h4>${escapeHtml(def.name)}${spec ? ` — ${escapeHtml(spec.name)}` : ""}</h4>
      <div class="role">${escapeHtml(spec ? spec.description : def.role)}</div>
      <div class="statline"><span>Stufe</span><span>${tower.level}/${def.upgrades.length}</span></div>
      <div class="statline"><span>Schaden</span><span>${stats.damage}</span></div>
      <div class="statline"><span>Reichweite</span><span>${stats.range}</span></div>
      <div class="statline"><span>Feuerrate</span><span>${(1000 / Math.max(1, stats.fireRateMs)).toFixed(2)}/s</span></div>
      <div class="statline"><span>Schadenstyp</span><span>${stats.damageType}</span></div>
      ${stats.applies?.length ? `<div class="statline"><span>Effekte</span><span>${stats.applies.map((a) => a.kind).join(", ")}</span></div>` : ""}
      <div class="statline"><span>Verursacht</span><span>${tower.totalDamage}</span></div>
      <div class="actions">
        <button id="i-up" ${upCost !== null && me.gold >= upCost ? "" : "disabled"}>
          ${upCost !== null ? `Ausbauen ${upCost}G` : "Max"}
        </button>
        <button id="i-target">${TARGETING_LABEL[tower.targeting as keyof typeof TARGETING_LABEL] ?? tower.targeting}</button>
        <button id="i-sell" class="danger">Verkaufen ${refund}G</button>
      </div>
      ${
        canSpec
          ? `<div class="specrow">
               <h4 style="font-size:11px;color:var(--dim)">Spezialisierung (endgültig)</h4>
               ${def.specializations
                 .map(
                   (s) => `<button class="specbtn" data-spec="${s.id}" ${me.gold >= s.cost ? "" : "disabled"}>
                     <strong>${escapeHtml(s.name)}</strong> — ${s.cost}G<br>
                     <span style="color:var(--dim)">${escapeHtml(s.description)}</span>
                   </button>`
                 )
                 .join("")}
             </div>`
          : ""
      }`;

    box.querySelector("#i-up")?.addEventListener("click", () => {
      audio.play("ui-click");
      this.send(MSG.upgradeTower, { towerId });
    });
    box.querySelector("#i-sell")?.addEventListener("click", () => {
      audio.play("sell");
      this.send(MSG.sellTower, { towerId });
      this.selectTower(null);
    });
    box.querySelector("#i-target")?.addEventListener("click", () => {
      const current = TARGETING_MODES.indexOf(tower.targeting as never);
      const next = TARGETING_MODES[(current + 1) % TARGETING_MODES.length];
      audio.play("ui-click");
      this.send(MSG.setTargeting, { towerId, targeting: next });
    });
    box.querySelectorAll<HTMLButtonElement>("[data-spec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        audio.play("upgrade");
        this.send(MSG.specializeTower, { towerId, specializationId: btn.dataset.spec! });
      });
    });
  }

  private renderPerkOffer(me: PlayerState) {
    const box = this.root.querySelector<HTMLElement>("#perkpick");
    if (!box) return;
    const offer = [...me.perkOffer];
    const key = offer.join(",");

    if (offer.length === 0) {
      box.classList.remove("active");
      this.lastPerkOffer = "";
      return;
    }
    if (key === this.lastPerkOffer) return;
    this.lastPerkOffer = key;
    audio.play("perk");

    box.classList.add("active");
    box.innerHTML = `
      <h2>Level ${me.commanderLevel} — Perk wählen</h2>
      <div class="perkcards">
        ${offer
          .map((id) => {
            const perk = PERKS[id];
            return `<button class="perkcard" data-perk="${id}">
              <h4>${escapeHtml(perk?.name ?? id)}</h4>
              <p>${escapeHtml(perk?.description ?? "")}</p>
            </button>`;
          })
          .join("")}
      </div>`;
    box.querySelectorAll<HTMLButtonElement>("[data-perk]").forEach((btn) => {
      btn.addEventListener("click", () => {
        audio.play("upgrade");
        this.send(MSG.pickPerk, { perkId: btn.dataset.perk! });
      });
    });
  }

  // -------------------------------------------------------------- Ergebnis

  private renderResult() {
    if (this.root.querySelector(".screen")) return;
    const state = this.state!;
    const me = this.me;

    const players = [...state.players.values()].sort((a, b) => (a.placement || 99) - (b.placement || 99));
    const won = me && state.winnerId === me.sessionId;

    const screen = el(`
      <div class="screen">
        <h1 style="color:${won ? "var(--gold)" : "var(--danger)"}">${won ? "SIEG" : state.players.size > 1 ? "NIEDERLAGE" : "MATCH ENDE"}</h1>
        <div class="sub">${escapeHtml(state.resultText)} · Welle ${state.wave} · Seed ${state.seed}</div>
        <div class="panel" style="min-width:520px">
          <table class="resulttable">
            <tr><th>#</th><th>Spieler</th><th>Wellen</th><th>Kills</th><th>Leaks</th><th>Gold</th><th>Sends</th></tr>
            ${players
              .map(
                (p) => `<tr class="${state.winnerId === p.sessionId ? "winner" : ""}">
                  <td>${p.placement || "-"}</td>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${p.survivedWaves}</td>
                  <td>${p.kills}</td>
                  <td>${p.leaked}</td>
                  <td>${p.goldEarned}</td>
                  <td>${p.sendsLaunched}</td>
                </tr>`
              )
              .join("")}
          </table>
        </div>
        <div class="row">
          <button id="again" class="primary" ${me?.isHost ? "" : "disabled"}>Nochmal (Host)</button>
          <button id="quit">Zum Hauptmenü</button>
        </div>
        ${me?.isHost ? "" : '<div class="hint">Der Host startet das Rematch.</div>'}
      </div>`);
    this.root.appendChild(screen);

    screen.querySelector("#again")!.addEventListener("click", () => {
      audio.play("ui-click");
      this.send(MSG.rematch);
    });
    screen.querySelector("#quit")!.addEventListener("click", () => void this.room?.leave());
  }

  // --------------------------------------------------------------- Eingabe

  private handleTileClick(x: number, y: number, tile: TileKind) {
    if (this.laneEditMode) {
      const action = (window.event as MouseEvent | undefined)?.shiftKey ? "remove-lane" : "add-lane";
      this.send(MSG.editLane, { action, x, y });
      audio.play("build");
      return;
    }
    if (this.selectedTowerDef && tile === "buildable") {
      this.send(MSG.placeTower, { defId: this.selectedTowerDef, x, y });
      return;
    }
    this.selectTower(null);
  }

  private selectTower(towerId: string | null) {
    this.selectedTowerId = towerId;
    this.selectedTowerDef = null;
    this.scene?.setSelectedTower(towerId);
    const box = this.root.querySelector<HTMLElement>("#inspector");
    if (box) box.dataset.sig = "";
    this.render();
  }

  private useAbility(ultimate: boolean) {
    // Fähigkeiten mit Radius zielen auf die Mausposition, globale ignorieren sie.
    const pointer = this.scene?.input.activePointer;
    const x = pointer ? pointer.worldX / 48 : 0;
    const y = pointer ? pointer.worldY / 48 : 0;
    audio.play(ultimate ? "ultimate" : "ability");
    this.send(ultimate ? MSG.useUltimate : MSG.useAbility, { x, y });
  }

  private toggleLaneEdit(force?: boolean) {
    this.laneEditMode = force ?? !this.laneEditMode;
    if (this.laneEditMode) this.selectedTowerDef = null;
    this.scene?.setLaneEditMode(this.laneEditMode);
    audio.play("ui-click");
    this.render();
  }

  private installHotkeys() {
    if ((window as unknown as { __tdKeys?: boolean }).__tdKeys) return;
    (window as unknown as { __tdKeys?: boolean }).__tdKeys = true;

    window.addEventListener("keydown", (ev) => {
      if (ev.target instanceof HTMLInputElement) return;
      const towerIds = Object.keys(TOWERS);

      if (ev.key >= "1" && ev.key <= "9") {
        const index = Number(ev.key) - 1;
        if (towerIds[index]) {
          this.selectedTowerDef = towerIds[index];
          this.laneEditMode = false;
          this.scene?.setLaneEditMode(false);
          const container = this.root.querySelector<HTMLElement>("#towers");
          if (container) container.dataset.sig = "";
          audio.play("ui-click");
          this.render();
        }
      } else if (ev.key === "0" && towerIds[9]) {
        this.selectedTowerDef = towerIds[9];
        const container = this.root.querySelector<HTMLElement>("#towers");
        if (container) container.dataset.sig = "";
        this.render();
      } else if (ev.key.toLowerCase() === "q") this.useAbility(false);
      else if (ev.key.toLowerCase() === "w") this.useAbility(true);
      else if (ev.key.toLowerCase() === "e") this.toggleLaneEdit();
      else if (ev.key === "Escape") {
        this.selectedTowerDef = null;
        this.laneEditMode = false;
        this.scene?.setLaneEditMode(false);
        this.selectTower(null);
      }
    });
  }

  // ---------------------------------------------------------------- Helfer

  private toast(level: "info" | "warn" | "error", text: string) {
    const host = this.root.querySelector<HTMLElement>(".toasts");
    if (!host) return;
    if (level !== "info") audio.play("ui-error");
    const node = el(`<div class="toast ${level}">${escapeHtml(text)}</div>`);
    host.appendChild(node);
    setTimeout(() => node.remove(), 3200);
    while (host.children.length > 5) host.firstElementChild?.remove();
  }

  private setText(root: HTMLElement, selector: string, text: string) {
    const node = root.querySelector(selector);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private setBar(root: HTMLElement, selector: string, percent: number) {
    const node = root.querySelector<HTMLElement>(selector);
    if (node) node.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
