import {
  COMMANDERS,
  GAME_MODES,
  GAME_MODE_IDS,
  gameMode,
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
  sendCost,
  sendUnlocked,
  xpForLevel,
  MAPS,
  MAP_DIFFICULTY_ORDER,
  createMap,
  mapPathLength,
  mapBuildableCount,
  Lang,
  LANGS,
  LANG_LABEL,
  isLang,
  t as translate,
  trPath,
  resolveParams,
} from "@td/shared";
import { audio } from "../audio/AudioManager";
import { TILE_SIZE } from "../art/palette";
import { MatchScene } from "../scenes/MatchScene";
import {
  MatchRoom,
  clearReconnectToken,
  createMatch,
  describeConnectionError,
  joinByCode,
  tryReconnect,
} from "../net";

/**
 * Gewählte Sprache. Reihenfolge: gemerkte Wahl, sonst Browsersprache, sonst
 * Deutsch. Die Browsersprache als Vorgabe erspart englischen Spielern den
 * ersten Klick, ohne jemandem etwas aufzuzwingen.
 */
function ladeSprache(): Lang {
  try {
    const gemerkt = localStorage.getItem("td_lang");
    if (isLang(gemerkt)) return gemerkt;
  } catch {
    // Privater Modus o. ä. — dann eben die Browsersprache.
  }
  const browser = (navigator.language || "de").slice(0, 2).toLowerCase();
  return browser === "de" ? "de" : "en";
}

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
  /** Eigener Bereich rechts — liegt NICHT über dem Spielfeld. */
  private side: HTMLElement;
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
  private lang: Lang = ladeSprache();

  constructor(root: HTMLElement, side: HTMLElement) {
    this.root = root;
    this.side = side;
    document.documentElement.lang = this.lang;
  }

  /** Oberflächentext. */
  private T(key: string, params?: Record<string, string | number>): string {
    return translate(key, this.lang, params);
  }

  /** Inhaltstext über seinen Pfad, z. B. `tower.gunner.name`. */
  private C(path: string): string {
    return trPath(path, this.lang);
  }

  /**
   * Sprache umschalten.
   *
   * Baut die Oberfläche komplett neu auf statt einzelne Knoten zu tauschen:
   * fast jeder Teil des HUD zwischenspeichert seinen Zustand in
   * `dataset.sig`, um unnötiges Neuzeichnen zu sparen. Diese Signaturen
   * kennen die Sprache nicht — ohne vollständigen Neuaufbau bliebe die halbe
   * Oberfläche in der alten Sprache stehen, bis sich zufällig ein Wert
   * ändert.
   */
  private setLang(lang: Lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("td_lang", lang);
    } catch {
      // Nicht speicherbar? Dann gilt die Wahl eben nur für diese Sitzung.
    }
    this.root.innerHTML = "";
    this.side.innerHTML = "";
    this.root.dataset.screen = "";
    this.lastPhase = "";
    this.lastWave = -1;
    if (this.state) this.render();
    else this.showMenu();
  }

  /** Der Sprachschalter als fertiges Element. */
  private langSwitch(): HTMLElement {
    const box = el(`<div class="langswitch" role="group" aria-label="${escapeHtml(this.T("menu.language"))}"></div>`);
    for (const l of LANGS) {
      const btn = el<HTMLButtonElement>(
        `<button class="langbtn ${l === this.lang ? "selected" : ""}" data-lang="${l}">${LANG_LABEL[l]}</button>`
      );
      btn.addEventListener("click", () => {
        audio.play("ui-click");
        this.setLang(l);
      });
      box.appendChild(btn);
    }
    return box;
  }

  attachScene(scene: MatchScene) {
    this.scene = scene;
  }

  // ------------------------------------------------------------- Startmenü

  showMenu(errorText = "") {
    audio.unlock();
    this.root.innerHTML = "";
    this.root.dataset.screen = "menu";
    const savedName = localStorage.getItem("td_name") ?? "";

    const screen = el(`
      <div class="screen">
        <h1>${escapeHtml(this.T("menu.title"))}</h1>
        <div class="sub">${escapeHtml(this.T("menu.subtitle"))}</div>
        <div class="panel col" style="min-width:520px">
          <label class="row"><span style="width:70px;color:var(--dim);font-size:12px">${escapeHtml(this.T("menu.nameLabel"))}</span>
            <input id="name" maxlength="16" placeholder="${escapeHtml(this.T("menu.namePlaceholder"))}" value="${savedName}" style="flex:1"></label>

          <div class="modelist">
            ${GAME_MODE_IDS.map(
              (id) => `<button class="modebtn" data-mode="${id}">
                <strong>${escapeHtml(this.C(`mode.${id}.name`))}</strong>
                <span class="tag">${escapeHtml(this.C(`mode.${id}.tagline`))}</span>
                <span class="tag desc">${escapeHtml(this.C(`mode.${id}.desc`))}</span>
              </button>`
            ).join("")}
          </div>

          <div class="row" style="margin-top:4px">
            <input id="code" maxlength="6" placeholder="${escapeHtml(this.T("menu.codePlaceholder"))}" style="flex:1;text-transform:uppercase">
            <button id="join">${escapeHtml(this.T("menu.join"))}</button>
          </div>
          <div class="err" id="err">${errorText}</div>
        </div>
        <div id="langbox"></div>
        <div class="hint">
          ${escapeHtml(this.T("menu.controls1"))}<br>
          ${escapeHtml(this.T("menu.controls2"))}
        </div>
      </div>`);
    this.root.appendChild(screen);
    screen.querySelector("#langbox")!.appendChild(this.langSwitch());

    const nameInput = screen.querySelector<HTMLInputElement>("#name")!;
    const err = screen.querySelector<HTMLElement>("#err")!;
    const getName = () => {
      const value = nameInput.value.trim() || this.T("menu.defaultName");
      localStorage.setItem("td_name", value);
      this.playerName = value;
      return value;
    };

    const connect = async (fn: () => Promise<MatchRoom>) => {
      audio.unlock();
      audio.play("ui-click");
      err.textContent = this.T("menu.connecting");
      try {
        const room = await fn();
        this.bindRoom(room);
      } catch (e) {
        audio.play("ui-error");
        err.textContent = describeConnectionError(e);
      }
    };

    screen.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode!;
        void connect(() => createMatch(getName(), mode));
      });
    });
    screen.querySelector("#join")!.addEventListener("click", () => {
      const code = screen.querySelector<HTMLInputElement>("#code")!.value.trim().toUpperCase();
      if (!code) {
        err.textContent = this.T("menu.needCode");
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

    room.onMessage(NOTICE, (msg: NoticeMsg) =>
      // Der Server schickt Schlüssel und Parameter; Inhaltspfade darin
      // (Turm-, Perk-, Angriffsnamen) werden mitübersetzt.
      this.toast(msg.level, this.T(msg.key, resolveParams(msg.params, this.lang)))
    );
    room.onError((code, message) =>
      this.toast("error", this.T("net.serverError", { code, msg: message ?? "" }))
    );
    room.onLeave(() => {
      // Nur wenn der Austritt NICHT von uns ausgelöst wurde (dann ist
      // this.room bereits null und das Menü steht schon).
      if (this.room === room) this.leaveToMenu(this.T("net.matchEnded"));
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

  /**
   * Verlässt den Raum und kehrt garantiert ins Hauptmenü zurück.
   *
   * Bewusst nicht davon abhängig, dass `room.onLeave` feuert: wenn die
   * Verbindung hakt oder das Ereignis ausbleibt, blieb der Spieler vorher im
   * Ergebnisbildschirm hängen und der Button wirkte kaputt. Jetzt wird das
   * UI sofort umgeschaltet und das Trennen nur noch nebenher versucht.
   */
  private leaveToMenu(reason = "") {
    const room = this.room;
    // Zuerst lokal abkoppeln, damit späte Zustandsupdates das Menü nicht
    // wieder überschreiben.
    this.room = null;
    this.state = null;
    this.lastPhase = "";
    this.lastWave = -1;
    this.lastPerkOffer = "";
    this.selectedTowerId = null;
    this.selectedTowerDef = null;
    this.laneEditMode = false;

    this.side.classList.remove("active");
    this.side.innerHTML = "";
    this.scene?.setLaneEditMode(false);
    this.scene?.resetVisuals();

    clearReconnectToken();
    try {
      void room?.leave();
    } catch {
      // Verbindung war schon weg — für die Rückkehr ins Menü irrelevant.
    }
    this.showMenu(reason);
  }

  private send(type: string, payload?: unknown) {
    try {
      this.room?.send(type, payload as never);
    } catch {
      this.toast("error", this.T("net.sendFailed"));
    }
  }

  private get me(): PlayerState | undefined {
    if (!this.state || !this.room) return undefined;
    return this.state.players.get(this.room.sessionId);
  }

  // ----------------------------------------------------------- Hauptrender

  private render() {
    const state = this.state;
    // Nach dem Verlassen ist kein Zustand mehr gebunden — späte Updates
    // dürfen das Hauptmenü nicht überschreiben.
    if (!state || !this.room) return;

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
    delete this.root.dataset.screen;
    // Seitenleiste gehört nur zum laufenden Match.
    if (phase !== "playing" && phase !== "preparing") {
      this.side.classList.remove("active");
      this.side.innerHTML = "";
    }
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
          <h1>${escapeHtml(this.T("lobby.title"))}</h1>
          <div class="roomcode" id="rc"></div>
          <div class="sub">${escapeHtml(this.T("lobby.shareCode"))}</div>
          <div class="lobbygrid">
            <div class="panel"><h3>${escapeHtml(this.T("lobby.commander"))}</h3><div class="commanderlist" id="cmds"></div></div>
            <div class="panel"><h3>${escapeHtml(this.T("lobby.map"))}</h3><div class="maplist" id="maps"></div>
              <div class="hint" id="maphint" style="margin-top:8px"></div>
            </div>
            <div class="panel"><h3>${escapeHtml(this.T("lobby.players"))}</h3><div class="playerlist" id="pl"></div>
              <div class="col" style="margin-top:12px">
                <button id="ready" class="primary">${escapeHtml(this.T("lobby.ready"))}</button>
                <button id="start">${escapeHtml(this.T("lobby.startHost"))}</button>
                <button id="leave" class="danger">${escapeHtml(this.T("lobby.leave"))}</button>
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
        audio.play("ui-click");
        this.leaveToMenu();
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
          <strong>${escapeHtml(this.C(`cmd.${id}.name`))}</strong>
          <span class="tag">${escapeHtml(this.C(`cmd.${id}.tagline`))}</span>
          <span class="tag">${escapeHtml(this.C(`cmd.${id}.passive`))}</span>
          <span class="tag">Q: ${escapeHtml(this.C(`cmd.${id}.ab.name`))} · W: ${escapeHtml(this.C(`cmd.${id}.ult.name`))}</span>
        </button>`);
      btn.addEventListener("click", () => {
        audio.play("ui-click");
        this.send(MSG.setCommander, { commanderId: id });
      });
      cmds.appendChild(btn);
    }

    // Kartenauswahl. Nur der Host darf umstellen; alle sehen dieselbe Karte,
    // damit im Gefecht niemand die leichteste für sich beanspruchen kann.
    const maps = screen.querySelector<HTMLElement>("#maps")!;
    const mapSig = `${state.mapId}:${me.isHost}:${this.lang}`;
    if (maps.dataset.sig !== mapSig) {
      maps.dataset.sig = mapSig;
      maps.innerHTML = "";
      for (const stufe of MAP_DIFFICULTY_ORDER) {
        const gruppe = MAPS.filter((m) => m.difficulty === stufe);
        if (gruppe.length === 0) continue;
        maps.appendChild(
          el(`<div class="mapgroup">${escapeHtml(this.C(`difficulty.${stufe}`))}</div>`)
        );
        for (const m of gruppe) {
          const aktiv = state.mapId === m.id;
          const laenge = mapPathLength(m.id);
          const bau = mapBuildableCount(m.id);
          const btn = el<HTMLButtonElement>(`
            <button class="mapbtn ${aktiv ? "selected" : ""}" ${me.isHost ? "" : "disabled"}
                    title="${escapeHtml(this.C(`map.${m.id}.desc`))}">
              ${mapPreview(m.id)}
              <span class="mapinfo">
                <strong>${escapeHtml(this.C(`map.${m.id}.name`))}</strong>
                <span class="tag">${escapeHtml(this.T("lobby.mapStats", { tiles: laenge, spots: bau }))}</span>
              </span>
            </button>`);
          btn.addEventListener("click", () => {
            if (!me.isHost) return;
            audio.play("ui-click");
            this.send(MSG.setMap, { mapId: m.id });
          });
          maps.appendChild(btn);
        }
      }
    }
    const aktuelleKarte = MAPS.find((m) => m.id === state.mapId);
    screen.querySelector("#maphint")!.textContent = me.isHost
      ? aktuelleKarte
        ? this.C(`map.${aktuelleKarte.id}.desc`)
        : ""
      : this.T("lobby.hostPicksMap", {
          map: aktuelleKarte ? this.C(`map.${aktuelleKarte.id}.name`) : "—",
        });

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
    readyBtn.textContent = me.ready ? this.T("lobby.notReady") : this.T("lobby.ready");
    readyBtn.className = me.ready ? "" : "primary";

    const startBtn = screen.querySelector<HTMLButtonElement>("#start")!;
    startBtn.style.display = me.isHost ? "" : "none";

    const hint = screen.querySelector<HTMLElement>("#lobbyhint")!;
    hint.textContent =
      state.players.size === 1
        ? this.T("lobby.soloOrWait")
        : this.T("lobby.playersInRoom", { n: state.players.size });
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
    this.setText(hud, "#threat", `${Math.floor(me.threat)}/${THREAT_MAX}`);
    this.setText(hud, "#hpv", `${Math.ceil(me.coreHp)}/${me.maxCoreHp}`);
    this.setText(hud, "#wave", `${state.wave}`);
    this.setText(hud, "#remaining", `${state.enemiesRemaining}`);
    this.setText(
      hud,
      "#cmdname",
      this.T("hud.cmdLevel", {
        name: this.C(`cmd.${me.commanderId}.name`),
        level: me.commanderLevel,
      })
    );
    this.setBar(hud, "#hpbar", hpPct);
    this.setBar(hud, "#threatbar", threatPct);
    this.setBar(hud, "#xpbar", xpPct);

    // ---- Wellenanzeige
    const wavebox = hud.querySelector<HTMLElement>(".wavebox")!;
    const aheadNote =
      me.wavesAhead > 0 ? ` · ${this.T("hud.ahead", { n: me.wavesAhead })}` : "";
    const queueNote =
      me.queuedEnemies > 0 ? ` · ${this.T("hud.queued", { n: me.queuedEnemies })}` : "";
    if (state.waveActive) {
      wavebox.innerHTML =
        `<strong>${escapeHtml(this.T("hud.waveRunning", { wave: me.waveIndex }))}</strong>` +
        ` · ${escapeHtml(this.T("hud.enemiesLeft", { n: state.enemiesRemaining }))}` +
        `${escapeHtml(aheadNote)}${escapeHtml(queueNote)}`;
      wavebox.classList.add("warn");
    } else {
      const secs = Math.ceil(state.nextWaveInMs / 1000);
      wavebox.innerHTML =
        `<strong>${escapeHtml(this.T("hud.waveIn", { wave: state.wave + 1, secs }))}</strong>` +
        `${escapeHtml(aheadNote)}${escapeHtml(queueNote)}` +
        `<div class="next">${escapeHtml(state.nextWavePreview || "—")}</div>`;
      wavebox.classList.remove("warn");
    }

    // Rufknopf: beliebig oft. Nur das Wellenlimit der Kampagne stoppt ihn.
    const callBtn = hud.querySelector<HTMLButtonElement>("#btn-call")!;
    const noMoreWaves = state.maxWaves > 0 && me.waveIndex >= state.maxWaves;
    callBtn.disabled = noMoreWaves;
    callBtn.textContent = noMoreWaves
      ? this.T("hud.noMoreWaves")
      : this.T("hud.callWave", { wave: me.waveIndex + 1 });
    callBtn.title = this.T("hud.callWaveTip");

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
        state.laneEditingOpen
          ? this.T("hud.laneEditorHint")
          : this.T("hud.laneOnlyBetween")
      );
    }
  }

  private buildHudSkeleton(): HTMLElement {
    const hud = el(`
      <div id="hud" class="active">
        <div class="topbar">
          <div class="stat gold"><span class="label">${escapeHtml(this.T("hud.gold"))}</span><span class="value" id="gold">0</span></div>
          <div class="stat threat" title="${escapeHtml(this.T("hud.threatTip"))}"><span class="label">${escapeHtml(this.T("hud.threat"))}</span><span class="value" id="threat">0</span>
            <div class="bar threat"><i id="threatbar"></i></div></div>
          <div class="stat hp"><span class="label">${escapeHtml(this.T("hud.core"))}</span><span class="value" id="hpv">0</span>
            <div class="bar"><i id="hpbar"></i></div></div>
          <div class="stat"><span class="label">${escapeHtml(this.T("hud.wave"))}</span><span class="value" id="wave">0</span></div>
          <div class="stat"><span class="label">${escapeHtml(this.T("hud.remaining"))}</span><span class="value" id="remaining">0</span></div>
          <div class="spacer"></div>
          <div class="stat"><span class="label" id="cmdname"></span>
            <div class="bar xp"><i id="xpbar"></i></div></div>
          <div id="hudlang"></div>
          <button id="btn-edit" style="padding:5px 10px;font-size:11px">Lane (E)</button>
          <button id="btn-audio" style="padding:5px 10px;font-size:11px">${escapeHtml(this.T("hud.sound"))}</button>
          <button id="btn-leave" class="danger" style="padding:5px 10px;font-size:11px">${escapeHtml(this.T("lobby.leave"))}</button>
        </div>

        <div class="wavebox"></div>
        <button id="btn-call" class="callwave"></button>
        <div class="toasts"></div>


        <div class="inspector" id="inspector"></div>
        <div class="editmode">
          <span id="editinfo"></span>
          <button id="editreset" style="padding:5px 10px;font-size:11px">${escapeHtml(this.T("hud.resetLane"))}</button>
          <button id="editdone" style="padding:5px 10px;font-size:11px">${escapeHtml(this.T("hud.editExit"))}</button>
        </div>
        <div class="perkpick" id="perkpick"></div>
      </div>`);

    // Seitenleiste in ihren eigenen Bereich rendern (nicht als Overlay).
    this.side.classList.add("active");
    this.side.innerHTML = `
      <div class="sidebar">
        <div class="section"><h4>${escapeHtml(this.T("hud.towers"))}</h4><div class="towergrid" id="towers"></div></div>
        <div class="section"><h4>${escapeHtml(this.T("lobby.commander"))}</h4><div class="abilitylist" id="abilities"></div></div>
        <div class="section" id="sendsection"><h4>${escapeHtml(this.T("hud.attacks"))}</h4><div class="sendlist" id="sends"></div></div>
        <div class="section"><h4>${escapeHtml(this.T("hud.participants"))}</h4><div class="playerlist" id="players"></div></div>
      </div>`;

    hud.querySelector("#hudlang")!.appendChild(this.langSwitch());
    hud.querySelector("#btn-call")!.addEventListener("click", () => this.callWave());

    hud.querySelector("#btn-edit")!.addEventListener("click", () => this.toggleLaneEdit());
    hud.querySelector("#editdone")!.addEventListener("click", () => this.toggleLaneEdit(false));
    hud.querySelector("#editreset")!.addEventListener("click", () => {
      audio.play("ui-click");
      this.send(MSG.resetLane);
    });
    hud.querySelector("#btn-leave")!.addEventListener("click", () => this.leaveToMenu());
    hud.querySelector("#btn-audio")!.addEventListener("click", (ev) => {
      audio.sfxEnabled = !audio.sfxEnabled;
      audio.setMusicEnabled(audio.sfxEnabled);
      (ev.currentTarget as HTMLElement).textContent = audio.sfxEnabled
        ? this.T("hud.sound")
        : this.T("hud.muted");
    });
    return hud;
  }

  private renderTowerButtons(hud: HTMLElement, me: PlayerState) {
    const container = this.side.querySelector<HTMLElement>("#towers")!;
    const signature = `${Math.floor(me.gold)}:${this.selectedTowerDef}:${this.lang}`;
    if (container.dataset.sig === signature) return;
    container.dataset.sig = signature;
    container.innerHTML = "";

    Object.values(TOWERS).forEach((def, index) => {
      const affordable = me.gold >= def.cost;
      const btn = el<HTMLButtonElement>(`
        <button class="towerbtn ${affordable ? "" : "unaffordable"} ${this.selectedTowerDef === def.id ? "selected" : ""}"
                title="${escapeHtml(this.C(`tower.${def.id}.role`))}">
          <span>${index + 1}. ${escapeHtml(this.C(`tower.${def.id}.name`))}</span>
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
    const container = this.side.querySelector<HTMLElement>("#abilities")!;
    const abilityReady = me.abilityCooldownMs <= 0;
    // Threat wird nicht ausgegeben, nur verlangt.
    const ultReady = me.ultimateCooldownMs <= 0 && me.threat >= commander.ultimate.threatCost;
    const sig = `${abilityReady}:${ultReady}:${Math.ceil(me.abilityCooldownMs / 1000)}:${Math.ceil(me.ultimateCooldownMs / 1000)}:${this.lang}`;
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    container.innerHTML = "";

    const mk = (label: string, name: string, ready: boolean, cd: number, ultimate: boolean, desc: string) => {
      const btn = el<HTMLButtonElement>(`
        <button class="sendbtn" ${ready ? "" : "disabled"} title="${escapeHtml(desc)}">
          <span>${label} ${escapeHtml(name)}</span>
          <span class="cost">${ready ? escapeHtml(this.T("lobby.ready").toUpperCase()) : `${Math.ceil(cd / 1000)}s`}</span>
        </button>`);
      btn.addEventListener("click", () => this.useAbility(ultimate));
      container.appendChild(btn);
    };

    const cid = me.commanderId;
    mk("Q", this.C(`cmd.${cid}.ab.name`), abilityReady, me.abilityCooldownMs, false, this.C(`cmd.${cid}.ab.desc`));
    mk("W", this.C(`cmd.${cid}.ult.name`), ultReady, me.ultimateCooldownMs, true, this.C(`cmd.${cid}.ult.desc`));
  }

  private renderSends(hud: HTMLElement, me: PlayerState, state: MatchState) {
    const section = this.side.querySelector<HTMLElement>("#sendsection")!;
    // Im Solo-Modus wird die Sektion ausgeblendet statt tot anzuzeigen.
    if (state.players.size < 2) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const container = this.side.querySelector<HTMLElement>("#sends")!;
    // Preis und Stärke hängen an der eigenen Wellenstufe, nicht am globalen
    // Zähler — wer vorzieht, schickt teurere und härtere Einheiten.
    const stufe = Math.max(1, me.waveIndex, state.wave);
    const sig = `${Math.floor(me.gold)}:${Math.floor(me.threat)}:${stufe}:${me.sendTargetId}:${this.lang}`;
    if (container.dataset.sig === sig) return;
    container.dataset.sig = sig;
    container.innerHTML = "";

    for (const def of Object.values(SEND_UNITS)) {
      const unlocked = sendUnlocked(def, me.threat);
      const kosten = sendCost(def, stufe);
      const affordable = me.gold >= kosten;
      const enabled = unlocked && affordable && !!me.sendTargetId;
      const beschreibung = this.C(`send.${def.id}.desc`);
      const titel = unlocked
        ? this.T("hud.sendTip", { desc: beschreibung, count: def.count, cost: kosten })
        : this.T("hud.sendLockedTip", {
            desc: beschreibung,
            threat: def.threatUnlock,
            have: Math.floor(me.threat),
          });
      const btn = el<HTMLButtonElement>(`
        <button class="sendbtn ${unlocked ? "" : "locked"}" ${enabled ? "" : "disabled"}
                title="${escapeHtml(titel)}">
          <span>${unlocked ? "" : "&#128274; "}${escapeHtml(this.C(`send.${def.id}.name`))}</span>
          <span class="cost">${unlocked ? `${kosten} G` : `${def.threatUnlock} B`}</span>
        </button>`);
      btn.addEventListener("click", () => {
        audio.play("ui-click");
        this.send(MSG.sendUnits, { sendId: def.id, targetId: me.sendTargetId });
      });
      container.appendChild(btn);
    }
  }

  private renderPlayers(hud: HTMLElement, me: PlayerState, state: MatchState) {
    const container = this.side.querySelector<HTMLElement>("#players")!;
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
          <span class="nm">${escapeHtml(p.name)}${isMe ? ` (${escapeHtml(this.T("hud.you"))})` : ""}</span>
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

    const sig = `${towerId}:${tower.level}:${tower.specializationId}:${tower.targeting}:${Math.floor(me.gold)}:${this.lang}`;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.classList.add("active");

    box.innerHTML = `
      <h4>${escapeHtml(this.C(`tower.${def.id}.name`))}${
        spec ? ` — ${escapeHtml(this.C(`tower.${def.id}.spec.${spec.id}.name`))}` : ""
      }</h4>
      <div class="role">${escapeHtml(
        spec ? this.C(`tower.${def.id}.spec.${spec.id}.desc`) : this.C(`tower.${def.id}.role`)
      )}</div>
      <div class="statline"><span>${escapeHtml(this.T("insp.level"))}</span><span>${tower.level}/${def.upgrades.length}</span></div>
      <div class="statline"><span>${escapeHtml(this.T("insp.damage"))}</span><span>${stats.damage}</span></div>
      <div class="statline"><span>${escapeHtml(this.T("insp.range"))}</span><span>${stats.range}</span></div>
      <div class="statline"><span>${escapeHtml(this.T("insp.rate"))}</span><span>${(1000 / Math.max(1, stats.fireRateMs)).toFixed(2)}/s</span></div>
      <div class="statline"><span>${escapeHtml(this.T("insp.damageType"))}</span><span>${escapeHtml(this.T(`dmg.${stats.damageType}`))}</span></div>
      ${stats.applies?.length ? `<div class="statline"><span>${escapeHtml(this.T("insp.effects"))}</span><span>${stats.applies.map((a) => escapeHtml(this.T(`status.${a.kind}`))).join(", ")}</span></div>` : ""}
      <div class="statline"><span>${escapeHtml(this.T("insp.dealt"))}</span><span>${tower.totalDamage}</span></div>
      <div class="actions">
        <button id="i-up" ${upCost !== null && me.gold >= upCost ? "" : "disabled"}>
          ${upCost !== null ? escapeHtml(this.T("insp.upgradeShort", { cost: upCost })) : escapeHtml(this.T("insp.max"))}
        </button>
        <button id="i-target">${escapeHtml(this.C(`targeting.${tower.targeting}`))}</button>
        <button id="i-sell" class="danger">${escapeHtml(this.T("insp.sellShort", { gold: refund }))}</button>
      </div>
      ${
        canSpec
          ? `<div class="specrow">
               <h4 style="font-size:11px;color:var(--dim)">${escapeHtml(this.T("insp.specFinal"))}</h4>
               ${def.specializations
                 .map(
                   (sp) => `<button class="specbtn" data-spec="${sp.id}" ${me.gold >= sp.cost ? "" : "disabled"}>
                     <strong>${escapeHtml(this.C(`tower.${def.id}.spec.${sp.id}.name`))}</strong> — ${sp.cost}G<br>
                     <span style="color:var(--dim)">${escapeHtml(this.C(`tower.${def.id}.spec.${sp.id}.desc`))}</span>
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
      <h2>${escapeHtml(this.T("perk.levelTitle", { level: me.commanderLevel }))}</h2>
      <div class="perkcards">
        ${offer
          .map((id) => {
            const perk = PERKS[id];
            return `<button class="perkcard" data-perk="${id}">
              <h4>${escapeHtml(perk ? this.C(`perk.${id}.name`) : id)}</h4>
              <p>${escapeHtml(perk ? this.C(`perk.${id}.desc`) : "")}</p>
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

  /**
   * Der Ergebnisgrund kommt als Schlüssel plus JSON-Parameter vom Server.
   * Kaputtes JSON darf den Bildschirm nicht sprengen — im Zweifel steht dort
   * eben nur der Grund ohne eingesetzte Werte.
   */
  private resultReason(state: MatchState): string {
    if (!state.resultKey) return "";
    let params: Record<string, string | number> | undefined;
    if (state.resultParamsJson) {
      try {
        const roh = JSON.parse(state.resultParamsJson);
        if (roh && typeof roh === "object" && !Array.isArray(roh)) params = roh;
      } catch {
        // Unlesbar: Grund ohne Parameter anzeigen statt gar nichts.
      }
    }
    return this.T(state.resultKey, params);
  }

  private renderResult() {
    // Eigener Stempel statt ".screen ist schon da": der alte Guard griff
    // auch dann, wenn ein anderer Bildschirm (z. B. das Menü) im Weg war,
    // und dann wurden die Buttons nie neu verdrahtet.
    if (this.root.dataset.screen === "result") return;
    this.root.dataset.screen = "result";
    this.root.innerHTML = "";
    const state = this.state!;
    const me = this.me;

    const players = [...state.players.values()].sort((a, b) => (a.placement || 99) - (b.placement || 99));
    const won = me && state.winnerId === me.sessionId;

    const screen = el(`
      <div class="screen">
        <h1 style="color:${won ? "var(--gold)" : "var(--danger)"}">${escapeHtml(
          won ? this.T("result.victory") : state.players.size > 1 ? this.T("result.defeat") : this.T("result.over")
        )}</h1>
        <div class="sub">${escapeHtml(
          this.T("result.line", {
            reason: this.resultReason(state),
            wave: state.wave,
            seed: state.seed,
          })
        )}</div>
        <div class="panel" style="min-width:520px">
          <table class="resulttable">
            <tr><th>#</th><th>${escapeHtml(this.T("result.player"))}</th><th>${escapeHtml(this.T("result.waves"))}</th><th>${escapeHtml(this.T("result.kills"))}</th><th>${escapeHtml(this.T("result.leaked"))}</th><th>${escapeHtml(this.T("result.goldEarned"))}</th><th>${escapeHtml(this.T("result.sends"))}</th></tr>
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
          <button id="again" class="primary" ${me?.isHost ? "" : "disabled"}>${escapeHtml(this.T("result.rematch"))}</button>
          <button id="quit">${escapeHtml(this.T("result.toMenu"))}</button>
        </div>
        ${me?.isHost ? "" : `<div class="hint">${escapeHtml(this.T("result.hostRematch"))}</div>`}
      </div>`);
    this.root.appendChild(screen);

    screen.querySelector("#again")!.addEventListener("click", () => {
      audio.play("ui-click");
      if (!me?.isHost) {
        this.toast("warn", this.T("result.hostOnlyRematch"));
        return;
      }
      this.send(MSG.rematch);
    });
    screen.querySelector("#quit")!.addEventListener("click", () => {
      audio.play("ui-click");
      this.leaveToMenu();
    });
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
    const x = pointer ? pointer.worldX / TILE_SIZE : 0;
    const y = pointer ? pointer.worldY / TILE_SIZE : 0;
    audio.play(ultimate ? "ultimate" : "ability");
    this.send(ultimate ? MSG.useUltimate : MSG.useAbility, { x, y });
  }

  /** Zieht die nächste Welle vor — auch während eine läuft. */
  private callWave() {
    audio.play("wave-start");
    this.send(MSG.callWave);
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
      else if (ev.key === " " || ev.code === "Space") {
        ev.preventDefault();
        this.callWave();
      }
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

/**
 * Winzige Kartenvorschau als SVG.
 *
 * Bewusst kein Canvas und kein Bild: 20x12 Rechtecke sind billig genug, um
 * sie bei jedem Lobby-Aufbau neu zu erzeugen, und sie skalieren mit dem
 * Layout mit. Der Weg ist das Einzige, was man wirklich sehen muss — daraus
 * liest man Länge und Windungen sofort ab.
 */
function mapPreview(mapId: string): string {
  const grid = createMap(mapId);
  const w = grid.config.width;
  const h = grid.config.height;
  const c = 4;
  const teile: string[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = grid.tiles[y][x];
      if (t === "empty") continue;
      const farbe =
        t === "spawn" ? "#d94f7a" : t === "core" ? "#f0c04a" : t === "lane" ? "#6b7a99" : "#2a3348";
      teile.push(`<rect x="${x * c}" y="${y * c}" width="${c}" height="${c}" fill="${farbe}"/>`);
    }
  }

  return (
    `<svg class="mappreview" viewBox="0 0 ${w * c} ${h * c}" width="${w * c}" height="${h * c}" ` +
    `shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="${w * c}" height="${h * c}" fill="#10141d"/>${teile.join("")}</svg>`
  );
}
