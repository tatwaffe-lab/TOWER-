import { COMMANDERS, CommanderId, PERKS } from "./commanderData";
import { ENEMIES } from "./enemyData";
import { GAME_MODES, GameMode } from "./gameModes";
import { Lang, tr } from "./i18n";
import { MAPS } from "./maps";
import { SEND_UNITS } from "./sendData";
import { TARGETING_LABEL } from "./combat";
import { TOWERS } from "./towerData";

/**
 * Auflösung von Inhaltspfaden wie `tower.gunner.name`.
 *
 * Der Server schickt in seinen Meldungen keine fertigen Namen, sondern solche
 * Pfade — er weiß ja nicht, welche Sprache der Empfänger eingestellt hat.
 * Hier wird der Pfad wieder zu Text: auf Deutsch aus den Datendateien, auf
 * Englisch aus der Übersetzungstabelle.
 *
 * Liegt bewusst getrennt von `i18n.ts`: die Übersetzungstabelle soll die
 * Datendateien nicht kennen müssen, sonst hinge jede Datei, die `tr()` nutzen
 * will, am gesamten Spielinhalt.
 */

/** Der deutsche Originaltext zu einem Pfad, oder null bei unbekanntem Pfad. */
export function germanFor(path: string): string | null {
  const teile = path.split(".");
  const bereich = teile[0];

  if (bereich === "tower") {
    // tower.<id>.name | tower.<id>.role | tower.<id>.spec.<specId>.name|desc
    const def = TOWERS[teile[1]];
    if (!def) return null;
    if (teile[2] === "name") return def.name;
    if (teile[2] === "role") return def.role;
    if (teile[2] === "spec") {
      const spec = def.specializations.find((sp) => sp.id === teile[3]);
      if (!spec) return null;
      if (teile[4] === "name") return spec.name;
      if (teile[4] === "desc") return spec.description;
    }
    return null;
  }

  if (bereich === "enemy") {
    const def = ENEMIES[teile[1]];
    return def && teile[2] === "name" ? def.name : null;
  }

  if (bereich === "cmd") {
    const def = COMMANDERS[teile[1] as CommanderId];
    if (!def) return null;
    if (teile[2] === "name") return def.name;
    if (teile[2] === "tagline") return def.tagline;
    if (teile[2] === "passive") return def.passiveText;
    if (teile[2] === "ab") {
      if (teile[3] === "name") return def.ability.name;
      if (teile[3] === "desc") return def.ability.description;
    }
    if (teile[2] === "ult") {
      if (teile[3] === "name") return def.ultimate.name;
      if (teile[3] === "desc") return def.ultimate.description;
    }
    return null;
  }

  if (bereich === "perk") {
    const def = PERKS[teile[1]];
    if (!def) return null;
    if (teile[2] === "name") return def.name;
    if (teile[2] === "desc") return def.description;
    return null;
  }

  if (bereich === "send") {
    const def = SEND_UNITS[teile[1]];
    if (!def) return null;
    if (teile[2] === "name") return def.name;
    if (teile[2] === "desc") return def.description;
    return null;
  }

  if (bereich === "map") {
    const def = MAPS.find((m) => m.id === teile[1]);
    if (!def) return null;
    if (teile[2] === "name") return def.name;
    if (teile[2] === "desc") return def.description;
    return null;
  }

  if (bereich === "mode") {
    const def = GAME_MODES[teile[1] as GameMode];
    if (!def) return null;
    if (teile[2] === "name") return def.name;
    if (teile[2] === "tagline") return def.tagline;
    if (teile[2] === "desc") return def.description;
    return null;
  }

  if (bereich === "targeting") {
    return TARGETING_LABEL[teile[1] as keyof typeof TARGETING_LABEL] ?? null;
  }

  // difficulty.<stufe> und ai.<name> tragen ihren deutschen Text schon im Pfad.
  if (bereich === "difficulty" || bereich === "ai") return teile[1] ?? null;

  return null;
}

/** Übersetzt einen Inhaltspfad in die gewünschte Sprache. */
export function trPath(path: string, lang: Lang): string {
  const deutsch = germanFor(path);
  // Unbekannter Pfad: den Pfad selbst zeigen. Das sieht falsch aus und soll
  // das auch — stiller Leertext wäre schwerer zu finden.
  if (deutsch === null) return path;
  return tr(path, lang, deutsch);
}

/**
 * Erkennt, ob ein Meldungsparameter ein Inhaltspfad ist.
 *
 * Spielernamen dürfen dabei nicht versehentlich als Pfad gelten — deshalb
 * wird auf die bekannten Bereichspräfixe geprüft und nicht bloß auf einen
 * enthaltenen Punkt.
 */
const PFAD_PREFIX = /^(tower|enemy|cmd|perk|send|map|mode|targeting|difficulty|ai)\./;

export function isContentPath(value: unknown): value is string {
  return typeof value === "string" && PFAD_PREFIX.test(value) && germanFor(value) !== null;
}

/** Setzt in Meldungsparametern alle Inhaltspfade in echte Namen um. */
export function resolveParams(
  params: Record<string, string | number> | undefined,
  lang: Lang
): Record<string, string | number> | undefined {
  if (!params) return params;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = isContentPath(v) ? trPath(v, lang) : v;
  }
  return out;
}
