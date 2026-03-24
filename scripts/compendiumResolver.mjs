/**
 * Resolves items from Nimble system compendium packs by name.
 * Returns item data suitable for embedding on an actor, plus warnings for missing items.
 */

const PACK_MAP = {
  class: 'nimble.nimble-classes',
  ancestry: 'nimble.nimble-ancestries',
  background: 'nimble.nimble-backgrounds',
  subclass: 'nimble.nimble-subclasses',
  object: 'nimble.nimble-items',
};

/**
 * Search a compendium pack for an item by name.
 * @param {string} packKey - Key in PACK_MAP (e.g. 'class')
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

  const index = await pack.getIndex({ fields: ['name'] });
  const entry = index.find((e) => e.name === name);
  if (!entry) return null;

  const doc = await pack.getDocument(entry._id);
  return doc.toObject();
}

/**
 * Resolve all compendium items for a character export.
 * @param {object} exportData - Parsed JSON export
 * @param {object} mappings - ID→name mappings
 * @returns {Promise<{items: object[], warnings: string[], classItem: object|null}>}
 */
export async function resolveCompendiumItems(exportData, mappings, level = 1) {
  const coreItems = [];
  const equipmentItems = [];
  const warnings = [];
  const { state } = exportData;

  // Class
  const classItem = await findInPack('class', exportData.classname);
  if (classItem) {
    coreItems.push(classItem);
  } else {
    warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
      name: exportData.classname,
      pack: 'classes',
    }));
  }

  // Ancestry
  const ancestryItem = await findInPack('ancestry', exportData.ancestry);
  if (ancestryItem) {
    coreItems.push(ancestryItem);
  } else {
    warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
      name: exportData.ancestry,
      pack: 'ancestries',
    }));
  }

  // Background
  const bgName = mappings.backgrounds[String(state.backgroundId)];
  if (bgName) {
    const bgItem = await findInPack('background', bgName);
    if (bgItem) {
      coreItems.push(bgItem);
    } else {
      warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
        name: bgName,
        pack: 'backgrounds',
      }));
    }
  } else if (state.backgroundId != null) {
    warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
      name: `background #${state.backgroundId}`,
      pack: 'backgrounds',
    }));
  }

  // Subclass
  if (level >= 3 && state.subclassId) {
    const scName = mappings.subclasses[String(state.subclassId)];
    if (scName) {
      const scItem = await findInPack('subclass', scName);
      if (scItem) {
        coreItems.push(scItem);
      } else {
        warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
          name: scName,
          pack: 'subclasses',
        }));
      }
    }
  }

  // Equipment
  if (state.selectedEquipment) {
    for (const equip of state.selectedEquipment) {
      const objItem = await findInPack('object', equip.name);
      if (objItem) {
        equipmentItems.push(objItem);
      } else {
        warnings.push(game.i18n.format('NIMBLE_IMPORTER.WarnItemNotFound', {
          name: equip.name,
          pack: 'objects',
        }));
      }
    }
  }

  return { coreItems, equipmentItems, warnings, classItem };
}
