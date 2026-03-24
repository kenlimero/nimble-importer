import { importCharacter } from './importer.mjs';

Hooks.once('init', () => {
  console.log('nimble-importer | Initializing Nimble Character Importer');
});

Hooks.on('renderActorDirectory', (app, html) => {
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

async function openImportDialog() {
  const content = await renderTemplate(
    'modules/nimble-importer/templates/import-dialog.hbs',
    {},
  );

  new Dialog({
    title: game.i18n.localize('NIMBLE_IMPORTER.DialogTitle'),
    content,
    buttons: {
      import: {
        icon: '<i class="fas fa-file-import"></i>',
        label: game.i18n.localize('NIMBLE_IMPORTER.Import'),
        callback: (html) => handleImport(html),
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: game.i18n.localize('NIMBLE_IMPORTER.Cancel'),
      },
    },
    default: 'import',
  }).render(true);
}

async function handleImport(html) {
  try {
    const input = html[0]?.querySelector?.('input[name="nimble-json"]')
      ?? html.querySelector?.('input[name="nimble-json"]');
    if (!input?.files?.length) {
      ui.notifications.warn(game.i18n.localize('NIMBLE_IMPORTER.ErrorNoFile'));
      return;
    }

    const file = input.files[0];
    const jsonString = await file.text();

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

function showReport(actor, warnings) {
  const esc = (s) => typeof foundry !== 'undefined' && foundry.utils?.escapeHTML
    ? foundry.utils.escapeHTML(s)
    : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const warningList = warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  const content = `
    <p><strong>${esc(actor.name)}</strong></p>
    <h4>${game.i18n.localize('NIMBLE_IMPORTER.ReportWarnings')}</h4>
    <ul>${warningList}</ul>
  `;

  new Dialog({
    title: game.i18n.localize('NIMBLE_IMPORTER.ReportTitle'),
    content,
    buttons: {
      open: {
        icon: '<i class="fas fa-user"></i>',
        label: 'Open Sheet',
        callback: () => actor.sheet.render(true),
      },
      ok: {
        icon: '<i class="fas fa-check"></i>',
        label: 'OK',
      },
    },
    default: 'open',
  }).render(true);
}
