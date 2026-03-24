import { resolveCompendiumItems } from './compendiumResolver.mjs';

/**
 * @typedef {Object} ImportResult
 * @property {Actor|null} actor - Created FoundryVTT actor, or null on failure
 * @property {string[]} warnings - Non-fatal warnings (missing items, manual steps needed)
 * @property {string|null} error - Fatal error message, or null on success
 */

/** Maps export stat abbreviations to FoundryVTT ability keys. */
const STAT_KEY_MAP = {
  STR: 'strength',
  DEX: 'dexterity',
  INT: 'intelligence',
  WIL: 'will',
};

/** Maps saving throw roll mode strings to numeric FoundryVTT values. */
const SAVE_ROLL_MODE = {
  advantage: 1,
  disadvantage: -1,
  neutral: 0,
};

/** Maps export skill names to FoundryVTT skill keys. */
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

/** Levels at which ability score increases (ASI) happen. */
const ASI_LEVELS = [4, 5, 8, 9, 12, 13, 16, 17, 20];

/** @type {object|null} Cached mappings.json content. */
let mappings = null;

/**
 * Load and cache the ID→name mappings file.
 * @returns {Promise<object>}
 */
async function loadMappings() {
  if (mappings) return mappings;
  const response = await fetch('modules/nimble-importer/data/mappings.json');
  if (!response.ok) throw new Error(`Failed to load mappings.json: ${response.status}`);
  mappings = await response.json();
  return mappings;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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
    return game.i18n.format('NIMBLE_IMPORTER.ErrorInvalidVersion', { version: data.exportVersion });
  }
  if (!data.isComplete) {
    return game.i18n.localize('NIMBLE_IMPORTER.ErrorIncomplete');
  }
  if (data.state?.bonusPointsRemaining != null && data.state.bonusPointsRemaining !== 0) {
    return game.i18n.localize('NIMBLE_IMPORTER.ErrorSkillPoints');
  }

  const required = {
    name: data.name,
    classname: data.classname,
    ancestry: data.ancestry,
    'state.stats': data.state?.stats,
    'state.skillPoints': data.state?.skillPoints,
    'state.level': data.state?.level,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => v == null)
    .map(([k]) => k);

  if (missing.length > 0) {
    return game.i18n.format('NIMBLE_IMPORTER.ErrorMissingFields', { fields: missing.join(', ') });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map export stat values to FoundryVTT abilities format.
 * @param {Record<string, number>} stats - Export stats (e.g. { STR: 2, DEX: 1, … })
 * @returns {Record<string, { baseValue: number }>}
 */
function mapAbilities(stats) {
  const abilities = {};
  for (const [exportKey, fvttKey] of Object.entries(STAT_KEY_MAP)) {
    abilities[fvttKey] = { baseValue: stats[exportKey] ?? 0 };
  }
  return abilities;
}

/**
 * Compute total skill points (creation + all level-ups) for the actor update.
 * The Nimble system stores the TOTAL points on the actor, not just creation points.
 * @param {Record<string, number>} skillPoints - Base skill points from character creation
 * @param {object[]} [levelUpHistory] - Level-up history entries
 * @returns {Record<string, { points: number }>}
 */
function mapTotalSkills(skillPoints, levelUpHistory) {
  const totals = {};
  for (const [exportKey, fvttKey] of Object.entries(SKILL_KEY_MAP)) {
    totals[fvttKey] = { points: skillPoints[exportKey] ?? 0 };
  }
  if (levelUpHistory) {
    for (const entry of levelUpHistory) {
      const fvttSkill = SKILL_KEY_MAP[entry.skillPoint?.skill];
      if (fvttSkill) totals[fvttSkill].points += 1;
    }
  }
  return totals;
}

/**
 * Map export level-up history to FoundryVTT format.
 * @param {object[]} [history] - Raw level-up history from export
 * @param {string} classIdentifier - FoundryVTT class identifier
 * @returns {object[]}
 */
function mapLevelUpHistory(history, classIdentifier) {
  if (!history?.length) return [];
  return history.map((entry) => {
    const skillIncreases = {};
    const fvttSkill = SKILL_KEY_MAP[entry.skillPoint?.skill];
    if (fvttSkill) skillIncreases[fvttSkill] = 1;

    // ASI data is stored on the class item's abilityScoreData, not in history entries.
    return {
      level: entry.level,
      hpIncrease: entry.hp?.value ?? 0,
      skillIncreases,
      abilityIncreases: {},
      hitDieAdded: true,
      classIdentifier,
    };
  });
}

/**
 * Build abilityScoreData updates for the class item.
 * Maps stat boosts from level-up history to the ASI level slots.
 * @param {object[]} [levelUpHistory] - Raw level-up history from export
 * @returns {Record<number, { value: string }>}
 */
function buildAbilityScoreData(levelUpHistory) {
  if (!levelUpHistory) return {};
  const data = {};
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

// ---------------------------------------------------------------------------
// Import steps
// ---------------------------------------------------------------------------

/**
 * Step 1: Create a bare actor with base abilities, currency, and languages.
 * @param {object} data - Parsed export data
 * @param {object} state - data.state
 * @returns {Promise<Actor>}
 */
async function createBareActor(data, state) {
  return Actor.create({
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
}

/**
 * Step 2: Add embedded items (core + equipment), replacing auto-granted gear.
 * @param {Actor} actor
 * @param {object[]} coreItems - Class, ancestry, background, subclass
 * @param {object[]} equipmentItems - Imported equipment
 * @returns {Promise<void>}
 */
async function addEmbeddedItems(actor, coreItems, equipmentItems) {
  // Add core items (class _preCreate hook grants starting gear)
  await actor.createEmbeddedDocuments('Item', coreItems);

  // Remove auto-granted equipment, then add imported equipment
  const autoGrantedIds = actor.items
    .filter((i) => i.type === 'object')
    .map((i) => i.id);
  if (autoGrantedIds.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', autoGrantedIds);
  }
  if (equipmentItems.length > 0) {
    await actor.createEmbeddedDocuments('Item', equipmentItems);
  }
}

/**
 * Step 3: Update the class item with level, HP, and ASI data.
 * @param {Actor} actor
 * @param {object} state - data.state
 * @returns {Promise<void>}
 */
async function updateClassItem(actor, state) {
  const classItemOnActor = actor.items.find((i) => i.type === 'class');
  if (!classItemOnActor || state.level <= 1 || !state.levelUpHistory?.length) return;

  // Preserve the level 1 HP entry set by the class _preCreate hook,
  // then append each level-up HP roll. The system expects hpData[0] = level 1 HP.
  const existingHpData = classItemOnActor.system.hpData ?? [];
  const levelUpHpData = state.levelUpHistory.map((entry) => entry.hp?.value ?? 0);
  const hpData = [...existingHpData.slice(0, 1), ...levelUpHpData];
  const asiData = buildAbilityScoreData(state.levelUpHistory);

  /** @type {Record<string, unknown>} */
  const classUpdates = {
    _id: classItemOnActor.id,
    'system.classLevel': state.level,
    'system.hpData': hpData,
  };
  for (const [level, { value }] of Object.entries(asiData)) {
    classUpdates[`system.abilityScoreData.${level}.value`] = value;
  }

  await actor.updateEmbeddedDocuments('Item', [classUpdates]);
}

/**
 * Step 4: Update the actor with level-up data, hit dice, HP, saves, and size.
 * @param {Actor} actor
 * @param {object} state - data.state
 * @param {string} classIdentifier
 * @param {number} hitDieSize
 * @returns {Promise<void>}
 */
async function updateActorLevelData(actor, state, classIdentifier, hitDieSize) {
  const totalSkills = mapTotalSkills(state.skillPoints, state.levelUpHistory);
  const levelUpHistory = mapLevelUpHistory(state.levelUpHistory, classIdentifier);

  /** @type {Record<string, unknown>} */
  const updates = {
    'system.skills': totalSkills,
    'system.classData.levels': Array(state.level).fill(classIdentifier),
    'system.levelUpHistory': levelUpHistory,
    [`system.attributes.hitDice.${hitDieSize}`]: {
      current: state.level,
      origin: Array(state.level).fill(classIdentifier),
    },
  };

  // HP: starting HP + all level-up HP gains
  if (state.levelUpHistory?.length > 0) {
    const totalLevelUpHp = state.levelUpHistory.reduce((sum, e) => sum + (e.hp?.value ?? 0), 0);
    const startingHp = actor.system.attributes?.hp?.value ?? 0;
    updates['system.attributes.hp.value'] = startingHp + totalLevelUpHp;
  }

  // Saving throws
  if (state.saves) {
    for (const [exportKey, value] of Object.entries(state.saves)) {
      const fvttKey = STAT_KEY_MAP[exportKey];
      if (fvttKey && value in SAVE_ROLL_MODE) {
        updates[`system.savingThrows.${fvttKey}.defaultRollMode`] = SAVE_ROLL_MODE[value];
      }
    }
  }

  // Size category
  if (state.chosenSize) {
    updates['system.attributes.sizeCategory'] = state.chosenSize.toLowerCase();
  }

  await actor.update(updates);
}

/**
 * Collect post-import warnings for fields that need manual setup.
 * @param {object} state - data.state
 * @param {object} maps - Loaded mappings
 * @param {string[]} warnings - Warnings array to append to
 */
function collectPostImportWarnings(state, maps, warnings) {
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
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Import a Nimble character from a JSON export.
 *
 * The Nimble system's class _preCreate hook forces level 1 when a class item is
 * added to an actor. A validateLevelHistory() guard resets to level 1 if
 * levelUpHistory.length !== classLevel - 1. Therefore the import is multi-step:
 *
 * 1. Create the actor (bare, no items)
 * 2. Add embedded items (class _preCreate sets up level 1)
 * 3. Update the class item with classLevel, hpData, abilityScoreData
 * 4. Update the actor with classData.levels, levelUpHistory, hitDice, hp, skills
 *
 * @param {string} jsonString - Raw JSON string from file
 * @returns {Promise<ImportResult>}
 */
export async function importCharacter(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { actor: null, warnings: [], error: game.i18n.localize('NIMBLE_IMPORTER.ErrorInvalidJson') };
  }

  const error = validate(data);
  if (error) return { actor: null, warnings: [], error };

  const { state } = data;

  try {
    const maps = await loadMappings();
    const { coreItems, equipmentItems, warnings, classItem } = await resolveCompendiumItems(data, maps, state.level);

    const hitDieSize = classItem?.system?.hitDieSize ?? 8;

    const actor = await createBareActor(data, state);
    await addEmbeddedItems(actor, coreItems, equipmentItems);

    // Read the class identifier from the EMBEDDED item (may differ from compendium)
    const embeddedClass = actor.items.find((i) => i.type === 'class');
    const classIdentifier = embeddedClass?.system?.identifier
      ?? embeddedClass?.identifier
      ?? classItem?.system?.identifier
      ?? data.classname.toLowerCase().replace(/\s+/g, '-');

    console.log(`nimble-importer | Class identifier: "${classIdentifier}" (from embedded: ${!!embeddedClass})`);

    await updateClassItem(actor, state);
    await updateActorLevelData(actor, state, classIdentifier, hitDieSize);
    collectPostImportWarnings(state, maps, warnings);

    return { actor, warnings, error: null };
  } catch (err) {
    console.error('nimble-importer | Import failed:', err);
    return {
      actor: null,
      warnings: [],
      error: game.i18n.format('NIMBLE_IMPORTER.ErrorUnexpected'),
    };
  }
}
