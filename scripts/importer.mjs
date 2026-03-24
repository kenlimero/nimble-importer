import { resolveCompendiumItems } from './compendiumResolver.mjs';

const STAT_KEY_MAP = {
  STR: 'strength',
  DEX: 'dexterity',
  INT: 'intelligence',
  WIL: 'will',
};

const SAVE_ROLL_MODE = {
  advantage: 1,
  disadvantage: -1,
  neutral: 0,
};

const SKILL_KEY_MAP = {
  Might: 'might',
  Stealth: 'stealth',
  Finesse: 'finesse',
  Arcana: 'arcana',
  Examination: 'examination',
  Lore: 'lore',
  Insight: 'insight',
  Influence: 'influence',
  Naturecraft: 'naturecraft',
  Perception: 'perception',
};

// Levels at which ability score increases (ASI) happen
const ASI_LEVELS = [4, 5, 8, 9, 12, 13, 16, 17, 20];

let mappings = null;

async function loadMappings() {
  if (mappings) return mappings;
  const response = await fetch('modules/nimble-importer/data/mappings.json');
  if (!response.ok) throw new Error(`Failed to load mappings.json: ${response.status}`);
  mappings = await response.json();
  return mappings;
}

/**
 * Validate the parsed JSON export.
 * @param {object} data - Parsed JSON
 * @returns {string|null} Error message or null if valid
 */
function validate(data) {
  if (Array.isArray(data)) {
    return game.i18n.localize('NIMBLE_IMPORTER.ErrorBatchNotSupported');
  }
  if (data.exportVersion !== 1) {
    return game.i18n.format('NIMBLE_IMPORTER.ErrorInvalidVersion', {
      version: data.exportVersion,
    });
  }
  if (!data.isComplete) {
    return game.i18n.localize('NIMBLE_IMPORTER.ErrorIncomplete');
  }
  if (data.state?.bonusPointsRemaining != null && data.state.bonusPointsRemaining !== 0) {
    return game.i18n.localize('NIMBLE_IMPORTER.ErrorSkillPoints');
  }
  const required = { name: data.name, classname: data.classname, ancestry: data.ancestry };
  const stateRequired = {
    'state.stats': data.state?.stats,
    'state.skillPoints': data.state?.skillPoints,
    'state.level': data.state?.level,
  };
  const all = { ...required, ...stateRequired };
  const missing = Object.entries(all)
    .filter(([, v]) => v == null)
    .map(([k]) => k);
  if (missing.length > 0) {
    return game.i18n.format('NIMBLE_IMPORTER.ErrorMissingFields', {
      fields: missing.join(', '),
    });
  }
  return null;
}

/**
 * Map export abilities to FoundryVTT format.
 */
function mapAbilities(stats) {
  const abilities = {};
  for (const [exportKey, fvttKey] of Object.entries(STAT_KEY_MAP)) {
    abilities[fvttKey] = { baseValue: stats[exportKey] ?? 0 };
  }
  return abilities;
}

/**
 * Map initial skill points (from character creation only, not level-ups).
 */
function mapSkills(skillPoints) {
  const skills = {};
  for (const [exportKey, fvttKey] of Object.entries(SKILL_KEY_MAP)) {
    skills[fvttKey] = { points: skillPoints[exportKey] ?? 0 };
  }
  return skills;
}

/**
 * Compute total skill points (creation + all level-ups) for the actor update.
 * The Nimble system stores the TOTAL points on the actor, not just creation points.
 */
function mapTotalSkills(skillPoints, levelUpHistory) {
  const totals = {};
  for (const [exportKey, fvttKey] of Object.entries(SKILL_KEY_MAP)) {
    totals[fvttKey] = { points: skillPoints[exportKey] ?? 0 };
  }
  if (levelUpHistory) {
    for (const entry of levelUpHistory) {
      if (entry.skillPoint?.skill) {
        const fvttSkill = SKILL_KEY_MAP[entry.skillPoint.skill];
        if (fvttSkill) totals[fvttSkill].points += 1;
      }
    }
  }
  return totals;
}

/**
 * Map export level-up history to FoundryVTT format.
 */
function mapLevelUpHistory(history, classIdentifier) {
  if (!history || history.length === 0) return [];
  return history.map((entry) => {
    const skillIncreases = {};
    if (entry.skillPoint?.skill) {
      const fvttSkill = SKILL_KEY_MAP[entry.skillPoint.skill];
      if (fvttSkill) skillIncreases[fvttSkill] = 1;
    }

    const abilityIncreases = {};
    if (entry.statBoost?.stat) {
      const fvttAbility = STAT_KEY_MAP[entry.statBoost.stat];
      if (fvttAbility) abilityIncreases[fvttAbility] = 1;
    }

    return {
      level: entry.level,
      hpIncrease: entry.hp?.value ?? 0,
      skillIncreases,
      abilityIncreases,
      hitDieAdded: true,
      classIdentifier,
    };
  });
}

/**
 * Build the abilityScoreData updates for the class item.
 * Maps stat boosts from level-up history to the ASI level slots.
 */
function buildAbilityScoreData(levelUpHistory) {
  const data = {};
  if (!levelUpHistory) return data;
  for (const entry of levelUpHistory) {
    if (entry.statBoost?.stat && ASI_LEVELS.includes(entry.level)) {
      const fvttAbility = STAT_KEY_MAP[entry.statBoost.stat];
      if (fvttAbility) {
        data[entry.level] = { value: fvttAbility };
      }
    }
  }
  return data;
}

/**
 * Import a Nimble character from a JSON export.
 *
 * The Nimble system's class _preCreate hook forces level 1 when a class item is
 * added to an actor. A validateLevelHistory() guard resets to level 1 if
 * levelUpHistory.length !== classLevel - 1. Therefore we must:
 *
 * 1. Create the actor (bare, no items)
 * 2. Add embedded items (class _preCreate sets up level 1)
 * 3. Update the class item with classLevel, hpData, abilityScoreData
 * 4. Update the actor with classData.levels, levelUpHistory, hitDice, hp, skills
 *
 * @param {string} jsonString - Raw JSON string from file
 * @returns {Promise<{actor: Actor|null, warnings: string[], error: string|null}>}
 */
export async function importCharacter(jsonString) {
  // Parse JSON
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { actor: null, warnings: [], error: game.i18n.localize('NIMBLE_IMPORTER.ErrorInvalidJson') };
  }

  // Validate
  const error = validate(data);
  if (error) return { actor: null, warnings: [], error };

  const { state } = data;
  const maps = await loadMappings();

  // Resolve compendium items (core items separate from equipment)
  const { coreItems, equipmentItems, warnings, classItem } = await resolveCompendiumItems(data, maps, state.level);

  // Determine class identifier and hit die size from resolved class item
  const classIdentifier = classItem?.system?.identifier ?? data.classname.toLowerCase().replace(/\s+/g, '-');
  const hitDieSize = classItem?.system?.hitDieSize ?? 8;

  // --- Step 1: Create the bare actor (no items) ---
  const actor = await Actor.create({
    name: data.name,
    type: 'character',
    system: {
      abilities: mapAbilities(state.stats),
      currency: {
        gp: { value: state.goldRemaining ?? 0 },
      },
      proficiencies: {
        languages: (state.chosenLanguages ?? []).map((l) => l.toLowerCase()),
      },
    },
  });

  // --- Step 2a: Add core items (class, ancestry, background, subclass) ---
  // The class _preCreate hook grants starting gear via grantItem rules.
  await actor.createEmbeddedDocuments('Item', coreItems);

  // --- Step 2b: Remove auto-granted equipment, then add imported equipment ---
  const autoGrantedObjects = actor.items.filter((i) => i.type === 'object').map((i) => i.id);
  if (autoGrantedObjects.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', autoGrantedObjects);
  }
  if (equipmentItems.length > 0) {
    await actor.createEmbeddedDocuments('Item', equipmentItems);
  }

  // --- Step 3: Update the class item for level-up data ---
  const classItemOnActor = actor.items.find((i) => i.type === 'class');

  if (classItemOnActor && state.level > 1 && state.levelUpHistory?.length > 0) {
    const hpData = state.levelUpHistory.map((entry) => entry.hp?.value ?? 0);
    const asiData = buildAbilityScoreData(state.levelUpHistory);

    const classUpdates = {
      _id: classItemOnActor.id,
      'system.classLevel': state.level,
      'system.hpData': hpData,
    };

    // Write ASI data for each level that has a stat boost
    for (const [level, value] of Object.entries(asiData)) {
      classUpdates[`system.abilityScoreData.${level}.value`] = value.value;
    }

    await actor.updateEmbeddedDocuments('Item', [classUpdates]);
  }

  // --- Step 4: Update the actor with level-up data ---
  const levelUpHistory = mapLevelUpHistory(state.levelUpHistory, classIdentifier);
  const totalSkills = mapTotalSkills(state.skillPoints, state.levelUpHistory);

  const actorUpdates = {
    'system.skills': totalSkills,
    'system.classData.levels': Array(state.level).fill(classIdentifier),
    'system.levelUpHistory': levelUpHistory,
  };

  // Update hit dice (current = level, origin = array of classIdentifier per level)
  actorUpdates[`system.attributes.hitDice.${hitDieSize}`] = {
    current: state.level,
    origin: Array(state.level).fill(classIdentifier),
  };

  // Update HP: starting HP + all level-up HP gains
  if (state.levelUpHistory?.length > 0) {
    const totalLevelUpHp = state.levelUpHistory.reduce((sum, e) => sum + (e.hp?.value ?? 0), 0);
    const startingHp = actor.system.attributes?.hp?.value ?? 0;
    actorUpdates['system.attributes.hp.value'] = startingHp + totalLevelUpHp;
  }

  // Saving throws (advantage/disadvantage/neutral)
  if (state.saves) {
    for (const [exportKey, value] of Object.entries(state.saves)) {
      const fvttKey = STAT_KEY_MAP[exportKey];
      if (fvttKey && value in SAVE_ROLL_MODE) {
        actorUpdates[`system.savingThrows.${fvttKey}.defaultRollMode`] = SAVE_ROLL_MODE[value];
      }
    }
  }

  // Size category
  if (state.chosenSize) {
    actorUpdates['system.attributes.sizeCategory'] = state.chosenSize.toLowerCase();
  }

  await actor.update(actorUpdates);

  // --- Warnings for special fields ---
  if (state.chosenExtraSchoolId) {
    const schoolName = maps.spellSchools[String(state.chosenExtraSchoolId)];
    if (schoolName) {
      warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnExtraSchool', { name: schoolName }));
    }
  }

  if (state.ancestrySaveBonus) {
    const fvttStat = STAT_KEY_MAP[state.ancestrySaveBonus];
    warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnSaveBonus', {
      stat: fvttStat ?? state.ancestrySaveBonus,
    }));
  }

  return { actor, warnings, error: null };
}
