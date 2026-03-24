import { importCharacter } from './importer.mjs';

Hooks.once('init', () => {
  console.log('nimble-importer | Initializing Nimble Character Importer');
});

Hooks.on('renderActorDirectory', (_app, html) => {
  if (game.system.id !== 'nimble') return;

  const headerActions = html[0]?.querySelector?.('.header-actions')
    ?? html.querySelector?.('.header-actions');
  if (!headerActions || headerActions.querySelector('.nimble-import-btn')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('nimble-import-btn');
  button.innerHTML = `<i class="fas fa-file-import"></i> ${game.i18n.localize('NIMBLE_IMPORTER.Button')}`;
  button.addEventListener('click', () => openImportDialog());
  headerActions.appendChild(button);
});

/**
 * Open the file-picker dialog for importing a character JSON.
 * @returns {Promise<void>}
 */
async function openImportDialog() {
  const content = await foundry.applications.handlebars.renderTemplate(
    'modules/nimble-importer/templates/import-dialog.hbs',
    {},
  );

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('NIMBLE_IMPORTER.DialogTitle') },
    content,
    buttons: [
      {
        action: 'import',
        icon: 'fas fa-file-import',
        label: game.i18n.localize('NIMBLE_IMPORTER.Import'),
        default: true,
        callback: (_event, button) => button.form?.parentElement ?? button.closest('.dialog'),
      },
      {
        action: 'cancel',
        icon: 'fas fa-times',
        label: game.i18n.localize('NIMBLE_IMPORTER.Cancel'),
      },
    ],
  });

  if (result) await handleImport(result);
}

/**
 * Handle the import button click: read the file and run the importer.
 * @param {JQuery|HTMLElement} html - Dialog content element
 * @returns {Promise<void>}
 */
async function handleImport(html) {
  try {
    const root = html instanceof HTMLElement ? html : (html[0] ?? html);
    const input = root.querySelector('input[name="nimble-json"]');

    if (!input?.files?.length) {
      ui.notifications.warn(game.i18n.localize('NIMBLE_IMPORTER.ErrorNoFile'));
      return;
    }

    const jsonString = await input.files[0].text();
    const { actor, warnings, error } = await importCharacter(jsonString);

    if (error) {
      ui.notifications.error(error);
      return;
    }

    if (warnings.length > 0) {
      ui.notifications.warn(game.i18n.format('NIMBLE_IMPORTER.SuccessWithWarnings', {
        name: actor.name,
        count: warnings.length,
      }));
      showReport(actor, warnings);
    } else {
      ui.notifications.info(game.i18n.format('NIMBLE_IMPORTER.Success', {
        name: actor.name,
      }));
    }
  } catch (err) {
    console.error('nimble-importer |', err);
    ui.notifications.error(game.i18n.localize('NIMBLE_IMPORTER.ErrorUnexpected'));
  }
}

/**
 * Escape HTML entities to prevent XSS in dialog content.
 * @param {string} str - Raw string
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return typeof foundry !== 'undefined' && foundry.utils?.escapeHTML
    ? foundry.utils.escapeHTML(str)
    : str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Show a post-import report dialog listing warnings and offering to open the sheet.
 * @param {Actor} actor - The created actor
 * @param {string[]} warnings - Warning messages to display
 */
function showReport(actor, warnings) {
  const warningList = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  const content = `
    <p><strong>${escapeHtml(actor.name)}</strong></p>
    <h4>${game.i18n.localize('NIMBLE_IMPORTER.ReportWarnings')}</h4>
    <ul>${warningList}</ul>
  `;

  foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('NIMBLE_IMPORTER.ReportTitle') },
    content,
    buttons: [
      {
        action: 'open',
        icon: 'fas fa-user',
        label: 'Open Sheet',
        default: true,
        callback: () => actor.sheet.render(true),
      },
      {
        action: 'ok',
        icon: 'fas fa-check',
        label: 'OK',
      },
    ],
  });
}
