# Nimble Character Importer

A FoundryVTT module that imports characters created with the [Nimble RPG Character Builder](https://nimblenomicon.online/) into the [Nimble RPG system](https://github.com/Nimble-Co/FoundryVTT-Nimble) as fully playable actors.

## Requirements

- FoundryVTT v13+
- [Nimble RPG System](https://github.com/Nimble-Co/FoundryVTT-Nimble) installed and active

## How to Use

1. Create your character on [nimblernomicon.online](https://nimblenomicon.online/)
2. Export your character as a JSON file from the character builder
3. In FoundryVTT, enable the **Nimble Character Importer** module
4. Open the **Actors** sidebar and click the **Import Nimble Character** button
5. Select your exported JSON file and click **Import**

## What Gets Imported

- Class, subclass, ancestry, and background (resolved from system compendiums)
- Ability scores (STR, DEX, INT, WIL)
- Saving throw advantages/disadvantages
- Skill points (creation + level-up totals)
- Full level-up history (HP gains, stat boosts, skill increases)
- Equipment (weapons and armor)
- Languages
- Gold
- Size category

## Installation

Copy or symlink the `nimble-importer/` folder into your FoundryVTT `Data/modules/` directory, then enable the module in your world settings.

## Notes

- Only complete characters (`isComplete: true`) can be imported
- One character per file (no batch import)
- Homebrew content may not be found in the system compendiums — a warning will be displayed for any missing items
- Extra spell school choices and ancestry save bonuses require manual configuration after import

---

# Nimble Character Importer (FR)

Un module FoundryVTT qui importe les personnages construits avec le [Nimble RPG Character Builder](https://nimblenomicon.online/) dans le [systeme Nimble RPG](https://github.com/Nimble-Co/FoundryVTT-Nimble) en tant qu'acteurs jouables.

## Prerequis

- FoundryVTT v13+
- [Nimble RPG System](https://github.com/Nimble-Co/FoundryVTT-Nimble) installe et actif

## Utilisation

1. Creez votre personnage sur [nimblenomicon.online](https://nimblernomicon.online/)
2. Exportez votre personnage en fichier JSON depuis le character builder
3. Dans FoundryVTT, activez le module **Nimble Character Importer**
4. Ouvrez la barre laterale **Actors** et cliquez sur le bouton **Import Nimble Character**
5. Selectionnez votre fichier JSON et cliquez sur **Import**

## Ce qui est importe

- Classe, sous-classe, ascendance et background (resolus depuis les compendiums du systeme)
- Scores de capacites (STR, DEX, INT, WIL)
- Avantages/desavantages aux jets de sauvegarde
- Points de competences (creation + montees de niveau)
- Historique complet des montees de niveau (gains de PV, boosts de stats, augmentations de competences)
- Equipement (armes et armures)
- Langues
- Or
- Categorie de taille

## Installation

Copiez ou creez un lien symbolique du dossier `nimble-importer/` dans le repertoire `Data/modules/` de votre FoundryVTT, puis activez le module dans les parametres de votre monde.

## Remarques

- Seuls les personnages termines (`isComplete: true`) peuvent etre importes
- Un personnage par fichier (pas d'import en lot)
- Le contenu homebrew peut ne pas etre trouve dans les compendiums du systeme — un avertissement sera affiche pour chaque element manquant
- Les choix d'ecoles de magie supplementaires et les bonus de sauvegarde d'ascendance necessitent une configuration manuelle apres l'import
