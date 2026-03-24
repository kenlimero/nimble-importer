/**
 * Resolves items from Nimble system compendium packs by name.
 * Returns item data suitable for embedding on an actor, plus warnings for missing items.
 *
 * @typedef {'class'|'ancestry'|'background'|'subclass'|'object'} PackKey
 *
 * @typedef {Object} ResolvedItems
 * @property {object[]} coreItems - Class, ancestry, background, subclass items
 * @property {object[]} equipmentItems - Equipment/object items
 * @property {string[]} warnings - Localized warning messages
 * @property {object|null} classItem - Resolved class item (for hit die size, identifier)
 */

/** @type {Record<PackKey, string>} */
const PACK_MAP = {
  class: 'nimble.nimble-classes',
  ancestry: 'nimble.nimble-ancestries',
  background: 'nimble.nimble-backgrounds',
  subclass: 'nimble.nimble-subclasses',
  object: 'nimble.nimble-items',
};

/**
 * Search a compendium pack for an item by name.
 * @param {PackKey} packKey - Key in PACK_MAP
 * @param {string} name - Exact name to match
 * @returns {Promise<object|null>} Item document data or null
 */
async function findInPack(packKey, name) {
  const packId = PACK_MAP[packKey];
  if (!packId) return null;

  const pack = game.packs.get(packId);
  if (!pack) {
    console.warn(`nimble-importer | Compendium pack "${packId}" not found`);
    return null;
  }

  try {
    const index = await pack.getIndex({ fields: ['name'] });
    const entry = index.find((e) => e.name === name);
    if (!entry) return null;

    const doc = await pack.getDocument(entry._id);
    return doc.toObject();
  } catch (err) {
    console.error(`nimble-importer | Error reading pack "${packId}" for "${name}":`, err);
    return null;
  }
}

/**
 * Attempt to resolve an item from a compendium pack, pushing a warning if not found.
 * @param {PackKey} packKey - Key in PACK_MAP
 * @param {string} name - Item name to look up
 * @param {string[]} warnings - Warnings array to push to on failure
 * @returns {Promise<object|null>} Resolved item or null
 */
async function resolveItem(packKey, name, warnings) {
  const item = await findInPack(packKey, name);
  if (!item) {
    warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
      name,
      pack: `${packKey}s`,
    }));
  }
  return item;
}

/**
 * Resolve all compendium items for a character export.
 * @param {object} exportData - Parsed JSON export
 * @param {object} mappings - ID→name mappings from mappings.json
 * @param {number} [level=1] - Character level (subclass requires >= 3)
 * @returns {Promise<ResolvedItems>}
 */
export async function resolveCompendiumItems(exportData, mappings, level = 1) {
  const coreItems = [];
  const warnings = [];
  const { state } = exportData;

  // Class
  const classItem = await resolveItem('class', exportData.classname, warnings);
  if (classItem) coreItems.push(classItem);

  // Ancestry
  const ancestryItem = await resolveItem('ancestry', exportData.ancestry, warnings);
  if (ancestryItem) coreItems.push(ancestryItem);

  // Background (lookup name from mapping ID)
  const bgName = mappings.backgrounds[String(state.backgroundId)];
  if (bgName) {
    const bgItem = await resolveItem('background', bgName, warnings);
    if (bgItem) coreItems.push(bgItem);
  } else if (state.backgroundId != null) {
    warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
      name: `background #${state.backgroundId}`,
      pack: 'backgrounds',
    }));
  }

  // Subclass (only at level 3+)
  if (level >= 3 && state.subclassId) {
    const scName = mappings.subclasses[String(state.subclassId)];
    if (scName) {
      const scItem = await resolveItem('subclass', scName, warnings);
      if (scItem) coreItems.push(scItem);
    }
  }

  // Equipment — resolve in parallel for better performance
  const equipmentItems = [];
  if (state.selectedEquipment?.length > 0) {
    const results = await Promise.all(
      state.selectedEquipment.map((equip) => resolveItem('object', equip.name, warnings)),
    );
    for (const item of results) {
      if (item) equipmentItems.push(item);
    }
  }

  return { coreItems, equipmentItems, warnings, classItem };
}
