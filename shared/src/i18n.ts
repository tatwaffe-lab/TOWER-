/**
 * Zweisprachigkeit: Deutsch und Englisch.
 *
 * Zwei getrennte Mechanismen, weil es zwei verschiedene Fälle sind:
 *
 * **Inhalte** (Turmnamen, Gegner, Perks, Karten) stehen weiterhin auf Deutsch
 * in den Datendateien — dort gehören sie hin, dort werden sie gepflegt.
 * `tr()` schlägt für Englisch in der Tabelle unten nach und fällt sonst auf
 * das Deutsche zurück. Vorteil: eine neue Turmdefinition funktioniert sofort,
 * auch bevor jemand sie übersetzt hat. Damit das nicht schleichend verrottet,
 * verlangt `server/test/i18n.test.js` für **jede** ID einen englischen
 * Eintrag und meckert umgekehrt über verwaiste Einträge.
 *
 * **Oberflächentexte und Servermeldungen** haben kein "Original" — sie stehen
 * in `UI` mit beiden Sprachen nebeneinander und werden über `t()` geholt.
 * Servermeldungen reisen als Schlüssel plus Parameter durchs Netz, nicht als
 * fertiger Satz: sonst bekäme ein englischer Spieler deutsche Toasts, weil
 * der Server die Sprache des Empfängers nicht kennt.
 */

export type Lang = "de" | "en";

export const LANGS: Lang[] = ["de", "en"];
export const DEFAULT_LANG: Lang = "de";

export const LANG_LABEL: Record<Lang, string> = {
  de: "Deutsch",
  en: "English",
};

export function isLang(value: unknown): value is Lang {
  return value === "de" || value === "en";
}

/** Setzt Platzhalter der Form {name} ein. */
function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (ganz, schluessel) =>
    Object.prototype.hasOwnProperty.call(params, schluessel) ? String(params[schluessel]) : ganz
  );
}

// ---------------------------------------------------------------- Inhalte

/**
 * Englische Entsprechungen der Inhalte, nach Pfad.
 *
 * Pfadschema: `<bereich>.<id>[.<feld>]`, z. B. `tower.gunner.role`.
 */
export const CONTENT_EN: Record<string, string> = {
  // ------------------------------------------------------------- Türme
  "tower.gunner.name": "Gunner",
  "tower.gunner.role": "Cheap sustained damage, armor shredding",
  "tower.gunner.spec.minigun.name": "Minigun",
  "tower.gunner.spec.minigun.desc":
    "Extreme fire rate, shreds the target's armor. Low damage per shot.",
  "tower.gunner.spec.railgun.name": "Railgun",
  "tower.gunner.spec.railgun.desc":
    "Slow energy shot that punches through up to 3 enemies and ignores half their armor.",

  "tower.cannon.name": "Cannon",
  "tower.cannon.role": "Splash damage against groups",
  "tower.cannon.spec.siege.name": "Siege",
  "tower.cannon.spec.siege.desc": "Huge blasts and heavy single hits, but sluggish.",
  "tower.cannon.spec.cluster.name": "Cluster Bomb",
  "tower.cannon.spec.cluster.desc":
    "Smaller blast, but double the fire rate and scattered damage across the whole group.",

  "tower.frost.name": "Frost Tower",
  "tower.frost.role": "Slowing and crowd control",
  "tower.frost.spec.deepfreeze.name": "Deep Freeze",
  "tower.frost.spec.deepfreeze.desc":
    "Briefly freezes single targets solid (stun) instead of merely slowing them.",
  "tower.frost.spec.frostfield.name": "Frost Field",
  "tower.frost.spec.frostfield.desc":
    "Hits every enemy in range at once with a permanent slow.",

  "tower.tesla.name": "Tesla Coil",
  "tower.tesla.role": "Chain lightning against swarms",
  "tower.tesla.spec.arcchain.name": "Arc Chain",
  "tower.tesla.spec.arcchain.desc":
    "Jumps to up to 8 targets with little falloff — mows swarms down.",
  "tower.tesla.spec.overcharge.name": "Overcharge",
  "tower.tesla.spec.overcharge.desc":
    "Only 2 jumps, but a heavy hit and a conductive debuff (+35 % energy damage).",

  "tower.sniper.name": "Sniper",
  "tower.sniper.role": "Long range, elite and boss killer",
  "tower.sniper.spec.executioner.name": "Executioner",
  "tower.sniper.spec.executioner.desc":
    "Massive single-target damage against large enemies, extremely slow.",
  "tower.sniper.spec.piercer.name": "Piercer",
  "tower.sniper.spec.piercer.desc":
    "Energy beam punches through the entire line and ignores half their armor.",

  "tower.flamethrower.name": "Flamethrower",
  "tower.flamethrower.role": "Short range, burn damage against crowds",
  "tower.flamethrower.spec.inferno.name": "Inferno",
  "tower.flamethrower.spec.inferno.desc":
    "Very strong, long-lasting burn — melts tough groups over time.",
  "tower.flamethrower.spec.detonator.name": "Detonator",
  "tower.flamethrower.spec.detonator.desc":
    "Burning enemies explode on death and set their neighbours alight.",

  "tower.mortar.name": "Mortar",
  "tower.mortar.role": "Indirect fire across the whole map",
  "tower.mortar.spec.bombardment.name": "Bombardment",
  "tower.mortar.spec.bombardment.desc": "Enormous impact radius, hits entire sections of a wave.",
  "tower.mortar.spec.napalmshell.name": "Napalm Shell",
  "tower.mortar.spec.napalmshell.desc":
    "Less impact damage, but leaves a heavy burn across the target area.",

  "tower.support-beacon.name": "Support Beacon",
  "tower.support-beacon.role": "Boosts adjacent towers, deals no damage itself",
  "tower.support-beacon.spec.warhorn.name": "War Horn",
  "tower.support-beacon.spec.warhorn.desc":
    "Strong offensive buff: +45 % damage and +30 % fire rate for every tower in range.",
  "tower.support-beacon.spec.refinery.name": "Refinery",
  "tower.support-beacon.spec.refinery.desc":
    "Weak combat buff, but 25 gold of income every wave.",

  "tower.alchemist.name": "Alchemist",
  "tower.alchemist.role": "Poison and armor corrosion",
  "tower.alchemist.spec.corrosion.name": "Corrosion",
  "tower.alchemist.spec.corrosion.desc":
    "Extreme armor shredding — softens tanks up for every other tower.",
  "tower.alchemist.spec.plague.name": "Plague",
  "tower.alchemist.spec.plague.desc":
    "Very strong poison with a wide radius, ignores armor entirely.",

  "tower.drone-hub.name": "Drone Hub",
  "tower.drone-hub.role": "Mobile drones, flexible coverage",
  "tower.drone-hub.spec.swarm.name": "Swarm",
  "tower.drone-hub.spec.swarm.desc": "6 small drones cover a large area simultaneously.",
  "tower.drone-hub.spec.gunship.name": "Gunship",
  "tower.drone-hub.spec.gunship.desc":
    "A single heavy drone that hunts elite and boss targets specifically.",

  // ------------------------------------------------------------ Gegner
  "enemy.grunt.name": "Grunt",
  "enemy.runner.name": "Runner",
  "enemy.swarm.name": "Swarm",
  "enemy.tank.name": "Tank",
  "enemy.shield-carrier.name": "Shield Bearer",
  "enemy.splitter.name": "Splitter",
  "enemy.saboteur.name": "Saboteur",
  "enemy.phase-flyer.name": "Phase Flyer",
  "enemy.siege-golem.name": "Siege Golem",
  "enemy.hive-queen.name": "Hive Queen",
  "enemy.void-serpent.name": "Void Serpent",

  // --------------------------------------------------------- Commander
  "cmd.engineer.name": "Engineer",
  "cmd.engineer.tagline": "Towers, upgrades, economy",
  "cmd.engineer.passive": "Upgrades cost 15 % less, starting gold +50.",
  "cmd.engineer.ab.name": "Overclock",
  "cmd.engineer.ab.desc": "Every tower in the area fires twice as fast for 8 s.",
  "cmd.engineer.ult.name": "Emergency Grid",
  "cmd.engineer.ult.desc": "+60 % damage and +50 % fire rate for all your towers for 10 s.",

  "cmd.warlord.name": "Warlord",
  "cmd.warlord.tagline": "Aggressive PvP through attack units",
  "cmd.warlord.passive": "Sent units have +25 % HP, threat builds 30 % faster.",
  "cmd.warlord.ab.name": "War March",
  "cmd.warlord.ab.desc": "For 12 s, attacks cost 40 % less and move 30 % faster.",
  "cmd.warlord.ult.name": "Full Assault",
  "cmd.warlord.ult.desc": "Immediately launches a free attack wave at your current target.",

  "cmd.architect.name": "Architect",
  "cmd.architect.tagline": "Lane reshaping and defensive planning",
  "cmd.architect.passive": "Lane edits cost 40 % less, core +25 HP.",
  "cmd.architect.ab.name": "Rapid Construction",
  "cmd.architect.ab.desc": "For 10 s, building and upgrading cost 50 % less.",
  "cmd.architect.ult.name": "Fortress Protocol",
  "cmd.architect.ult.desc": "Restores 30 core HP and heavily slows every enemy for 8 s.",

  "cmd.chronomancer.name": "Chronomancer",
  "cmd.chronomancer.tagline": "Time, control, slowing",
  "cmd.chronomancer.passive": "All slow effects are 25 % stronger, abilities recharge 15 % faster.",
  "cmd.chronomancer.ab.name": "Time Field",
  "cmd.chronomancer.ab.desc": "Slows every enemy in the area by 60 % for 8 s.",
  "cmd.chronomancer.ult.name": "Temporal Rewind",
  "cmd.chronomancer.ult.desc": "Throws every enemy in your lane far back towards the spawn.",

  // -------------------------------------------------------------- Perks
  "perk.cheap-upgrades.name": "Mass Production",
  "perk.cheap-upgrades.desc": "Upgrades cost 25 % less.",
  "perk.rich-kills.name": "Salvage Rights",
  "perk.rich-kills.desc": "Kills pay 35 % more gold.",
  "perk.long-barrels.name": "Long Barrels",
  "perk.long-barrels.desc": "Every tower gains +0.75 range.",
  "perk.splash-master.name": "Demolitions Expert",
  "perk.splash-master.desc": "Blast radii +35 %, damage +10 %.",
  "perk.income-boost.name": "Trade Route",
  "perk.income-boost.desc": "+30 gold per completed wave.",
  "perk.sell-value.name": "Reclamation",
  "perk.sell-value.desc": "Selling refunds 25 percentage points more.",
  "perk.cheap-sends.name": "War Economy",
  "perk.cheap-sends.desc": "Attack units cost 30 % less gold.",
  "perk.tough-sends.name": "Assault Plating",
  "perk.tough-sends.desc": "Sent units have +50 % HP.",
  "perk.fast-sends.name": "Lightning Strike",
  "perk.fast-sends.desc": "Sent units move 40 % faster.",
  "perk.threat-surge.name": "Aggression Surge",
  "perk.threat-surge.desc": "Threat builds 50 % faster — attack tiers unlock sooner.",
  "perk.cheap-lanes.name": "Prefabricated Parts",
  "perk.cheap-lanes.desc": "Lane edits cost 50 % less.",
  "perk.fortified-core.name": "Bunker Core",
  "perk.fortified-core.desc": "+40 core HP.",
  "perk.slow-master.name": "Cryomaster",
  "perk.slow-master.desc": "Slow effects are 40 % stronger.",
  "perk.burn-master.name": "Firebrand",
  "perk.burn-master.desc": "Burn damage is 60 % stronger.",
  "perk.chain-master.name": "Conductivity",
  "perk.chain-master.desc": "Chain lightning jumps 2 more times.",
  "perk.boss-hunter.name": "Boss Hunter",
  "perk.boss-hunter.desc": "+45 % damage against bosses.",

  // -------------------------------------------------------------- Sends
  "send.rusher.name": "Rusher",
  "send.rusher.desc":
    "Cheap and fast. Probes a leaky defence — and you can keep them coming forever.",
  "send.swarm-pack.name": "Swarm Pack",
  "send.swarm-pack.desc":
    "Sixteen tiny units at once. Without splash damage, targeting buckles.",
  "send.splitters.name": "Splitter Cell",
  "send.splitters.desc": "Breaks apart on death. Five quickly become fifteen.",
  "send.brute.name": "Armor Breaker",
  "send.brute.desc": "Heavily armored and fast. Rapid-fire towers bounce right off.",
  "send.shield-escort.name": "Shield Escort",
  "send.shield-escort.desc":
    "Armors up your opponent's entire running wave. Strongest right after they call one.",
  "send.disruptor.name": "Jammer",
  "send.disruptor.desc":
    "Disables towers in droves. Hits concentrated defences harder than spread ones.",
  "send.phantom.name": "Phantom",
  "send.phantom.desc":
    "Flies straight over everything and is periodically untargetable. Bypasses any maze.",
  "send.siege-beast.name": "Siege Beast",
  "send.siege-beast.desc":
    "The hammer. Expensive enough that a failed attack noticeably funds your opponent.",

  // ------------------------------------------------------------- Karten
  "map.weite-ebene.name": "Open Plain",
  "map.weite-ebene.desc":
    "Three long straights with plenty of space around them. The longest path in the game and the most building room — you're allowed mistakes here.",
  "map.doppelschleife.name": "Double Loop",
  "map.doppelschleife.desc":
    "Two stacked loops. A single well-placed cluster in the middle covers three corridors at once.",
  "map.maeander.name": "Meander",
  "map.maeander.desc":
    "The standard map. An early chamber, a long central corridor, a final stretch before the core — three separate defensive zones.",
  "map.zickzack.name": "Zigzag",
  "map.zickzack.desc":
    "Four vertical corridors in alternation. Towers between two corridors fire on both — place them right and you double their value.",
  "map.kesselgang.name": "Cauldron Run",
  "map.kesselgang.desc":
    "Tight cauldrons with sharp turns. Splash damage at the corners catches the whole column at once.",
  "map.randlauf.name": "Wall Run",
  "map.randlauf.desc":
    "The path hugs the outer wall. Long, but every tower only fires to one side — half its range is wasted on nothing.",
  "map.enge-gasse.name": "Narrow Alley",
  "map.enge-gasse.desc":
    "A short sprint along the bottom edge, then up to the core. Barely any time, barely any room, no second chances.",
  "map.blitzschneise.name": "Lightning Cut",
  "map.blitzschneise.desc":
    "The shortest path in the game: 21 tiles from gate to core. Space is plentiful — time is not.",

  "difficulty.leicht": "easy",
  "difficulty.mittel": "medium",
  "difficulty.schwer": "hard",

  // -------------------------------------------------------------- Modi
  "mode.campaign.name": "Campaign",
  "mode.campaign.tagline": "30 waves, solo",
  "mode.campaign.desc":
    "The classic run. 30 waves with a boss every 5. Hold the core and you win.",
  "mode.endless.name": "Endless",
  "mode.endless.tagline": "How far can you get?",
  "mode.endless.desc":
    "The waves never stop and never stop getting harder. There is no victory — only the wave you held out to.",
  "mode.battle.name": "Battle",
  "mode.battle.tagline": "Against humans or AI",
  "mode.battle.desc":
    "2–4 participants, each defending their own lane and sending attacks at the others. Empty seats are taken by AI opponents — two players against the AI works exactly like one on one.",

  // --------------------------------------------------------- Zielmodi
  "targeting.first": "First",
  "targeting.last": "Last",
  "targeting.strongest": "Strongest",
  "targeting.weakest": "Weakest",
  "targeting.closest": "Closest",

  // ------------------------------------------------------ KI-Profile
  "ai.Rostkommando": "Rust Command",
  "ai.Eisenzirkel": "Iron Circle",
  "ai.Leerenkult": "Void Cult",
};

/**
 * Holt einen Inhaltstext.
 *
 * Auf Deutsch kommt schlicht das Original aus der Datendatei zurück. Auf
 * Englisch wird nachgeschlagen — fehlt der Eintrag, gewinnt der deutsche
 * Text gegen eine leere Stelle in der Oberfläche.
 */
export function tr(path: string, lang: Lang, german: string): string {
  if (lang === "de") return german;
  return CONTENT_EN[path] ?? german;
}

// ------------------------------------------------- Oberfläche und Meldungen

export const UI: Record<string, { de: string; en: string }> = {
  // ------------------------------------------------------------ Menü
  "menu.title": { de: "ARCANE INDUSTRY", en: "ARCANE INDUSTRY" },
  "menu.subtitle": {
    de: "Serverautoritatives Tower Defense für 1–4 Spieler",
    en: "Server-authoritative tower defense for 1–4 players",
  },
  "menu.yourName": { de: "Dein Name", en: "Your name" },
  "menu.pickMode": { de: "Modus wählen", en: "Choose a mode" },
  "menu.join": { de: "Beitreten", en: "Join" },
  "menu.joinCode": { de: "Raumcode", en: "Room code" },
  "menu.joinHint": {
    de: "Code eines Mitspielers eingeben, um seinem Gefecht beizutreten.",
    en: "Enter a friend's code to join their battle.",
  },
  "menu.connecting": { de: "Verbinde …", en: "Connecting …" },
  "menu.language": { de: "Sprache", en: "Language" },

  "menu.namePlaceholder": { de: "Dein Name", en: "Your name" },
  "menu.nameLabel": { de: "Name", en: "Name" },
  "menu.defaultName": { de: "Spieler", en: "Player" },
  "menu.codePlaceholder": { de: "RAUMCODE", en: "ROOM CODE" },
  "menu.needCode": { de: "Bitte einen Raumcode eingeben.", en: "Please enter a room code." },
  "menu.controls1": {
    de: "Klick = bauen/auswählen · 1–9 = Turm wählen · E = Lane-Editor",
    en: "Click = build/select · 1–9 = pick tower · E = lane editor",
  },
  "menu.controls2": {
    de: "Q = Fähigkeit · W = Ultimate · Leertaste = Welle rufen · Esc = Abwählen",
    en: "Q = ability · W = ultimate · Space = call wave · Esc = deselect",
  },

  // ----------------------------------------------------------- Lobby
  "lobby.title": { de: "LOBBY", en: "LOBBY" },
  "lobby.shareCode": {
    de: "Code weitergeben, damit andere beitreten können",
    en: "Share this code so others can join",
  },
  "lobby.commander": { de: "Commander", en: "Commander" },
  "lobby.map": { de: "Karte", en: "Map" },
  "lobby.players": { de: "Spieler", en: "Players" },
  "lobby.ready": { de: "Bereit", en: "Ready" },
  "lobby.startHost": { de: "Jetzt starten (Host)", en: "Start now (host)" },
  "lobby.leave": { de: "Verlassen", en: "Leave" },
  "lobby.hostPicksMap": {
    de: "Der Host wählt die Karte. Aktuell: {map}",
    en: "The host picks the map. Currently: {map}",
  },
  "lobby.mapStats": {
    de: "{tiles} Felder Weg · {spots} Bauplätze",
    en: "{tiles}-tile path · {spots} building spots",
  },
  "lobby.waitingFor": {
    de: "Warte auf weitere Spieler …",
    en: "Waiting for more players …",
  },
  "lobby.soloHint": {
    de: "Alleine spielen: einfach auf Bereit klicken.",
    en: "Playing solo: just hit Ready.",
  },

  "lobby.notReady": { de: "Doch nicht bereit", en: "Not ready after all" },
  "lobby.soloOrWait": {
    de: "Alleine spielbar — oder auf Mitspieler warten (bis 4). Angriffe brauchen mindestens 2 Spieler.",
    en: "Playable solo — or wait for others (up to 4). Attacks need at least 2 players.",
  },
  "lobby.playersInRoom": {
    de: "{n} Spieler im Raum. Das Match startet, wenn alle bereit sind.",
    en: "{n} players in the room. The match starts once everyone is ready.",
  },

  // ------------------------------------------------------------- HUD
  "hud.gold": { de: "Gold", en: "Gold" },
  "hud.threat": { de: "Bedrohung", en: "Threat" },
  "hud.threatTip": {
    de: "Bedrohung wird nie ausgegeben. Sie wächst über Wellen und Kills und schaltet stärkere Angriffe frei.",
    en: "Threat is never spent. It builds through waves and kills and unlocks stronger attacks.",
  },
  "hud.core": { de: "Core", en: "Core" },
  "hud.wave": { de: "Welle", en: "Wave" },
  "hud.remaining": { de: "Gegner", en: "Enemies" },
  "hud.towers": { de: "Türme", en: "Towers" },
  "hud.abilities": { de: "Fähigkeiten", en: "Abilities" },
  "hud.attacks": { de: "Angriffe", en: "Attacks" },
  "hud.participants": { de: "Teilnehmer", en: "Participants" },
  "hud.waveRunning": {
    de: "Welle {wave} läuft",
    en: "Wave {wave} in progress",
  },
  "hud.enemiesLeft": { de: "{n} Gegner übrig", en: "{n} enemies left" },
  "hud.waveIn": { de: "Welle {wave} in {secs}s", en: "Wave {wave} in {secs}s" },
  "hud.ahead": { de: "{n} vorgezogen", en: "{n} called early" },
  "hud.queued": { de: "{n} in der Warteschlange", en: "{n} queued" },
  "hud.callWave": {
    de: "Welle {wave} rufen (Leertaste)",
    en: "Call wave {wave} (space)",
  },
  "hud.callWaveTip": {
    de: "Beliebig oft. Jeder Ruf bringt Bonusgold, das mit dem Vorsprung abnimmt — das Risiko dagegen nicht.",
    en: "As often as you like. Every call pays bonus gold that shrinks as you get further ahead — the risk does not.",
  },
  "hud.noMoreWaves": { de: "Letzte Welle erreicht", en: "Final wave reached" },
  "hud.editMode": {
    de: "Lane-Editor: Klick legt Weg, Shift+Klick entfernt",
    en: "Lane editor: click to lay path, shift+click to remove",
  },
  "hud.editExit": { de: "Fertig (E)", en: "Done (E)" },
  "hud.resetLane": { de: "Zurücksetzen", en: "Reset" },

  "hud.sound": { de: "Ton", en: "Sound" },
  "hud.muted": { de: "Stumm", en: "Muted" },
  "hud.laneEditorHint": {
    de: "Lane-Editor: Klick fügt Weg hinzu, Shift+Klick entfernt.",
    en: "Lane editor: click adds path, shift+click removes it.",
  },
  "hud.laneOnlyBetween": {
    de: "Umbau nur zwischen Wellen.",
    en: "Edits only between waves.",
  },
  "hud.cmdLevel": { de: "{name} · Lv {level}", en: "{name} · Lv {level}" },
  "hud.sendTip": {
    de: "{desc}\n{count}x · {cost} Gold · kein Cooldown",
    en: "{desc}\n{count}x · {cost} gold · no cooldown",
  },
  "hud.sendLockedTip": {
    de: "{desc}\nFreigeschaltet ab {threat} Bedrohung (aktuell {have})",
    en: "{desc}\nUnlocks at {threat} threat (currently {have})",
  },

  // ------------------------------------------------------- Inspektor
  "insp.level": { de: "Stufe", en: "Level" },
  "insp.damage": { de: "Schaden", en: "Damage" },
  "insp.range": { de: "Reichweite", en: "Range" },
  "insp.rate": { de: "Feuerrate", en: "Fire rate" },
  "insp.dealt": { de: "Verursacht", en: "Damage dealt" },
  "insp.upgrade": { de: "Ausbauen ({cost} G)", en: "Upgrade ({cost} G)" },
  "insp.maxLevel": { de: "Voll ausgebaut", en: "Fully upgraded" },
  "insp.sell": { de: "Verkaufen (+{gold} G)", en: "Sell (+{gold} G)" },
  "insp.targeting": { de: "Ziel: {mode}", en: "Target: {mode}" },
  "insp.specialize": { de: "Spezialisieren", en: "Specialize" },

  "hud.you": { de: "du", en: "you" },
  "insp.damageType": { de: "Schadenstyp", en: "Damage type" },
  "insp.effects": { de: "Effekte", en: "Effects" },
  "dmg.kinetic": { de: "kinetisch", en: "kinetic" },
  "dmg.explosive": { de: "explosiv", en: "explosive" },
  "dmg.energy": { de: "Energie", en: "energy" },
  "dmg.chemical": { de: "chemisch", en: "chemical" },
  "status.slow": { de: "Verlangsamung", en: "slow" },
  "status.stun": { de: "Betäubung", en: "stun" },
  "status.burn": { de: "Brand", en: "burn" },
  "status.poison": { de: "Gift", en: "poison" },
  "status.shred": { de: "Rüstungsabbau", en: "armor shred" },
  "status.conductive": { de: "Leitfähig", en: "conductive" },
  "status.shielded": { de: "Geschildet", en: "shielded" },
  "insp.upgradeShort": { de: "Ausbauen {cost}G", en: "Upgrade {cost}G" },
  "insp.max": { de: "Max", en: "Max" },
  "insp.sellShort": { de: "Verkaufen +{gold}G", en: "Sell +{gold}G" },
  "insp.specFinal": {
    de: "Spezialisierung (endgültig)",
    en: "Specialization (permanent)",
  },

  // ------------------------------------------------------------ Perks
  "perk.choose": { de: "Perk wählen", en: "Choose a perk" },
  "perk.chooseHint": {
    de: "Eine von drei Karten — die Wahl gilt für dieses Match.",
    en: "One of three — your pick lasts for this match.",
  },

  // --------------------------------------------------------- Ergebnis
  "result.victory": { de: "SIEG", en: "VICTORY" },
  "result.defeat": { de: "NIEDERLAGE", en: "DEFEAT" },
  "result.over": { de: "MATCH BEENDET", en: "MATCH OVER" },
  "result.line": {
    de: "{reason} · Welle {wave} · Seed {seed}",
    en: "{reason} · wave {wave} · seed {seed}",
  },
  "result.place": { de: "Platz", en: "Place" },
  "result.player": { de: "Spieler", en: "Player" },
  "result.waves": { de: "Wellen", en: "Waves" },
  "result.kills": { de: "Kills", en: "Kills" },
  "result.leaked": { de: "Durchgelassen", en: "Leaked" },
  "result.goldEarned": { de: "Gold verdient", en: "Gold earned" },
  "result.sends": { de: "Angriffe", en: "Attacks" },
  "perk.levelTitle": {
    de: "Level {level} — Perk wählen",
    en: "Level {level} — choose a perk",
  },
  "result.rematch": { de: "Nochmal spielen", en: "Play again" },
  "result.toMenu": { de: "Zum Hauptmenü", en: "Back to menu" },
  "result.hostRematch": {
    de: "Nur der Host kann ein neues Match starten.",
    en: "Only the host can start a new match.",
  },

  // ------------------------------------------------- Servermeldungen
  "result.hostOnlyRematch": {
    de: "Nur der Host kann ein Rematch starten.",
    en: "Only the host can start a rematch.",
  },
  "net.serverError": { de: "Serverfehler {code}: {msg}", en: "Server error {code}: {msg}" },
  "net.matchEnded": {
    de: "Verbindung zum Match beendet.",
    en: "Disconnected from the match.",
  },
  "net.sendFailed": {
    de: "Nachricht konnte nicht gesendet werden.",
    en: "Message could not be sent.",
  },

  "notice.reconnected": { de: "Wieder verbunden.", en: "Reconnected." },
  "notice.noMoreWaves": {
    de: "Es gibt keine weitere Welle mehr.",
    en: "There is no next wave.",
  },
  "notice.wavePulled": {
    de: "Welle {wave} vorgezogen: +{bonus} Gold",
    en: "Wave {wave} called early: +{bonus} gold",
  },
  "notice.perkNotOffered": {
    de: "Dieser Perk steht gerade nicht zur Wahl.",
    en: "That perk isn't on offer right now.",
  },
  "notice.perkChosen": { de: "Perk gewählt: {perk}", en: "Perk chosen: {perk}" },
  "notice.cantBuildHere": {
    de: "Hier kann nicht gebaut werden.",
    en: "You can't build there.",
  },
  "notice.tileOccupied": { de: "Feld ist bereits belegt.", en: "That tile is taken." },
  "notice.notEnoughGold": {
    de: "Nicht genug Gold ({cost} nötig).",
    en: "Not enough gold ({cost} needed).",
  },
  "notice.fullyUpgraded": {
    de: "Turm ist voll ausgebaut — jetzt spezialisieren.",
    en: "Tower is fully upgraded — specialize it now.",
  },
  "notice.upgradeFirst": {
    de: "Erst voll ausbauen, dann spezialisieren.",
    en: "Fully upgrade it first, then specialize.",
  },
  "notice.specUnlocked": {
    de: "{tower}: {spec} freigeschaltet.",
    en: "{tower}: {spec} unlocked.",
  },
  "notice.laneBetweenWaves": {
    de: "Lane-Umbau nur zwischen den Wellen.",
    en: "Lane edits only between waves.",
  },
  "notice.laneReset": {
    de: "Lane auf Standard zurückgesetzt.",
    en: "Lane reset to default.",
  },
  "notice.abilityCooling": { de: "Fähigkeit lädt noch.", en: "Ability is still recharging." },
  "notice.needThreat": {
    de: "Braucht {threat} Bedrohung.",
    en: "Requires {threat} threat.",
  },
  "notice.abilityUsed": { de: "{ability} aktiviert.", en: "{ability} activated." },
  "notice.noAttackTarget": {
    de: "Kein gültiges Ziel für den Angriff.",
    en: "No valid target for the attack.",
  },
  "notice.sendsDisabled": {
    de: "In diesem Modus gibt es keine Angriffe.",
    en: "There are no attacks in this mode.",
  },
  "notice.needTwoPlayers": {
    de: "Angriffe brauchen mindestens zwei Teilnehmer.",
    en: "Attacks need at least two participants.",
  },
  "notice.sendLocked": {
    de: "{unit} braucht {threat} Bedrohung.",
    en: "{unit} requires {threat} threat.",
  },
  "notice.invalidTarget": { de: "Ungültiges Ziel.", en: "Invalid target." },
  "notice.targetGone": {
    de: "Ziel ist nicht mehr im Spiel.",
    en: "That target is out of the game.",
  },
  "notice.sendLaunched": {
    de: "{unit} an {target} geschickt.",
    en: "{unit} sent to {target}.",
  },
  "notice.underAttack": {
    de: "{attacker} greift an: {unit}!",
    en: "{attacker} is attacking: {unit}!",
  },

  // ------------------------------------------------- Lane-Editor-Gründe
  "lane.noSpawn": {
    de: "Spawn-Feld fehlt oder wurde überschrieben",
    en: "The spawn tile is missing or was overwritten",
  },
  "lane.noCore": {
    de: "Core-Feld fehlt oder wurde überschrieben",
    en: "The core tile is missing or was overwritten",
  },
  "lane.noPath": {
    de: "Kein durchgehender Weg vom Spawn zum Core",
    en: "No continuous path from spawn to core",
  },
  "lane.badCoord": { de: "Ungültige Koordinate", en: "Invalid coordinate" },
  "lane.outside": {
    de: "Feld liegt außerhalb der Karte",
    en: "That tile is outside the map",
  },
  "lane.protected": {
    de: "Spawn und Core können nicht verändert werden",
    en: "Spawn and core can't be changed",
  },
  "lane.alreadyLane": { de: "Feld ist bereits Lane", en: "That tile is already path" },
  "lane.mustTouch": {
    de: "Neue Lane muss an eine bestehende Lane angrenzen",
    en: "New path must connect to existing path",
  },
  "lane.onlyLane": {
    de: "Nur Lane-Felder können entfernt werden",
    en: "Only path tiles can be removed",
  },
  "lane.rejected": { de: "Umbau nicht möglich.", en: "That edit isn't possible." },

  // -------------------------------------------------- Ergebnisgründe
  "result.reason.allWaves": {
    de: "Alle Wellen überstanden",
    en: "Survived every wave",
  },
  "result.reason.coreLost": { de: "Der Core ist gefallen", en: "The core has fallen" },
  "result.reason.winner": { de: "{name} gewinnt", en: "{name} wins" },
  "result.reason.draw": { de: "Unentschieden", en: "Draw" },
  "result.reason.aiWins": {
    de: "Alle Spieler sind gefallen — die KI gewinnt",
    en: "Every player has fallen — the AI wins",
  },
  "result.reason.reachedWave": {
    de: "Bis Welle {wave} durchgehalten",
    en: "Held out to wave {wave}",
  },

  // ------------------------------------------------------ Verbindung
  "net.lost": {
    de: "Verbindung verloren. Versuche neu zu verbinden …",
    en: "Connection lost. Trying to reconnect …",
  },
  "net.failed": {
    de: "Verbindung fehlgeschlagen: {reason}",
    en: "Connection failed: {reason}",
  },
  "net.roomFull": { de: "Der Raum ist voll.", en: "That room is full." },
  "net.roomMissing": { de: "Raum nicht gefunden.", en: "Room not found." },
};

/** Holt einen Oberflächen- oder Meldungstext. */
export function t(
  key: string,
  lang: Lang,
  params?: Record<string, string | number>
): string {
  const eintrag = UI[key];
  // Fehlt der Schlüssel, ist er selbst die ehrlichste Anzeige — so fällt es
  // beim Testen sofort auf, statt still leer zu bleiben.
  if (!eintrag) return key;
  return fill(eintrag[lang] ?? eintrag.de, params);
}

/** Alle bekannten Meldungsschlüssel — der Test prüft damit den Server ab. */
export const NOTICE_KEYS = Object.keys(UI).filter((k) => k.startsWith("notice."));
export const RESULT_REASON_KEYS = Object.keys(UI).filter((k) =>
  k.startsWith("result.reason.")
);
