/**
 * ImportProjectsModal
 *
 * Bulk import: pick a parent folder once, scan it for projects, tick the ones
 * you want and register them all in a single action. The alternative is the
 * one-at-a-time wizard, which does not scale to a machine full of clones.
 */

const { createModal, showModal, closeModal } = require('./Modal');
const { t } = require('../../i18n');
const { escapeHtml } = require('../../utils/dom');
const { addProject, createFolder, findProjectByPath } = require('../../state');
const ProjectList = require('./ProjectList');
const Toast = require('./Toast');

const MODAL_ID = 'import-projects-modal';
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/** Last path segment of a path, whatever the separator. */
function basename(p) {
  const cleaned = String(p || '').replace(/[\\/]+$/, '');
  const segments = cleaned.split(/[\\/]/);
  return segments[segments.length - 1] || cleaned;
}

/**
 * Show the bulk import modal.
 * @param {Object} [options]
 * @param {Function} [options.onImported] Called with the imported projects, so the
 *   caller can run whatever post-registration work it owns (git status probing).
 */
function showImportProjectsModal(options = {}) {
  const api = window.electron_api;

  const existingModal = document.getElementById(MODAL_ID);
  if (existingModal) existingModal.remove();

  // Scan results for the currently selected root, in render order. `existing` is
  // the already-registered project for that path, if any.
  let candidates = [];
  let rootPath = null;

  const modal = createModal({
    id: MODAL_ID,
    title: t('projects.import.title'),
    size: 'large',
    content: `
      <div class="import-projects">
        <div class="import-root-row">
          <input type="text" class="import-root-path" id="import-root-path"
                 placeholder="${escapeHtml(t('projects.import.rootPlaceholder'))}" readonly>
          <button type="button" class="btn btn-secondary" id="import-browse">
            ${escapeHtml(t('projects.import.browse'))}
          </button>
        </div>
        <div class="import-results" id="import-results">
          <div class="import-hint">${escapeHtml(t('projects.import.hint'))}</div>
        </div>
        <div class="import-group-row">
          <label class="import-group-toggle">
            <input type="checkbox" id="import-group-toggle">
            <span>${escapeHtml(t('projects.import.groupIntoFolder'))}</span>
          </label>
          <input type="text" class="import-group-name" id="import-group-name" disabled>
        </div>
      </div>
    `,
    buttons: [
      { label: t('common.cancel'), action: 'cancel', onClick: (m) => closeModal(m) },
      { label: t('projects.import.confirm', { count: 0 }), action: 'import', primary: true, onClick: (m) => runImport(m) }
    ]
  });

  const resultsEl = modal.querySelector('#import-results');
  const rootInput = modal.querySelector('#import-root-path');
  const groupToggle = modal.querySelector('#import-group-toggle');
  const groupName = modal.querySelector('#import-group-name');
  const importBtn = modal.querySelector('[data-action="import"]');

  // ── Rendering ───────────────────────────────────────────────

  function renderMessage(className, message) {
    resultsEl.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
  }

  function renderScanning() {
    resultsEl.innerHTML = `
      <div class="import-scanning">
        <span class="btn-install-spinner"></span>
        <span>${escapeHtml(t('projects.import.scanning'))}</span>
      </div>`;
  }

  function stackBadge(stack) {
    if (!stack) return '';
    const color = HEX_COLOR.test(stack.color || '') ? stack.color : 'var(--text-muted)';
    return `<span class="import-stack-badge" style="--stack-color: ${color}">${escapeHtml(stack.label)}</span>`;
  }

  function gitBadge(candidate) {
    if (!candidate.isGitRepo) return `<span class="import-badge import-badge-muted">${escapeHtml(t('projects.import.noGit'))}</span>`;
    const branch = candidate.branch ? escapeHtml(candidate.branch) : 'git';
    return `<span class="import-badge import-badge-git">${branch}</span>`;
  }

  function renderList(truncated) {
    if (candidates.length === 0) {
      renderMessage('import-hint', t('projects.import.nothingFound'));
      return;
    }

    const importable = candidates.filter(c => !c.existing).length;

    const rowsHtml = candidates.map((candidate, index) => {
      const disabled = Boolean(candidate.existing);
      // Git repos are what the user came for; a plain folder that merely looks
      // like a project starts unticked so nothing is imported by surprise.
      const checked = !disabled && candidate.isGitRepo;
      return `
        <div class="import-item${disabled ? ' is-disabled' : ''}">
          <label class="import-item-label">
            <input type="checkbox" class="import-check" data-index="${index}"
                   ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
            <div class="import-item-info">
              <div class="import-item-head">
                <span class="import-item-name">${escapeHtml(candidate.name)}</span>
                ${gitBadge(candidate)}
                ${stackBadge(candidate.stack)}
                ${disabled ? `<span class="import-badge import-badge-muted">${escapeHtml(t('projects.import.alreadyImported'))}</span>` : ''}
              </div>
              <div class="import-item-path">${escapeHtml(candidate.path)}</div>
            </div>
          </label>
        </div>`;
    }).join('');

    resultsEl.innerHTML = `
      <div class="import-toolbar">
        <span class="import-found">${escapeHtml(t('projects.import.found', { count: candidates.length }))}</span>
        <span class="import-toolbar-actions">
          <button type="button" class="btn-text" id="import-select-all">${escapeHtml(t('projects.import.selectAll'))}</button>
          <button type="button" class="btn-text" id="import-select-none">${escapeHtml(t('projects.import.selectNone'))}</button>
        </span>
      </div>
      ${truncated ? `<div class="import-warning">${escapeHtml(t('projects.import.truncated'))}</div>` : ''}
      ${importable === 0 ? `<div class="import-hint">${escapeHtml(t('projects.import.allImported'))}</div>` : ''}
      <div class="import-list">${rowsHtml}</div>
    `;

    resultsEl.querySelector('#import-select-all')?.addEventListener('click', () => {
      // Never tick a disabled row: it is already registered.
      resultsEl.querySelectorAll('.import-check:not([disabled])').forEach(cb => { cb.checked = true; });
      updateImportButton();
    });
    resultsEl.querySelector('#import-select-none')?.addEventListener('click', () => {
      resultsEl.querySelectorAll('.import-check').forEach(cb => { cb.checked = false; });
      updateImportButton();
    });
  }

  // ── Selection ───────────────────────────────────────────────

  function getSelected() {
    const selected = [];
    resultsEl.querySelectorAll('.import-check').forEach(cb => {
      if (cb.checked && !cb.disabled) selected.push(candidates[parseInt(cb.dataset.index, 10)]);
    });
    return selected.filter(Boolean);
  }

  function updateImportButton() {
    const count = getSelected().length;
    importBtn.textContent = t('projects.import.confirm', { count });
    importBtn.disabled = count === 0;
  }

  // ── Scanning ────────────────────────────────────────────────

  async function scan(selectedRoot) {
    rootPath = selectedRoot;
    rootInput.value = selectedRoot;
    if (!groupName.value.trim()) groupName.value = basename(selectedRoot);

    renderScanning();
    updateImportButton();

    let result;
    try {
      result = await api.project.scanFolders({ rootPath: selectedRoot });
    } catch (err) {
      renderMessage('import-error', t('projects.import.scanFailed'));
      return;
    }

    if (!result || !result.success) {
      renderMessage('import-error', result?.error || t('projects.import.scanFailed'));
      return;
    }

    candidates = result.candidates.map(c => ({ ...c, existing: findProjectByPath(c.path) }));
    renderList(result.truncated);
    updateImportButton();
  }

  // ── Import ──────────────────────────────────────────────────

  function runImport(m) {
    const selected = getSelected();
    if (selected.length === 0) return;

    let folderId = null;
    if (groupToggle.checked) {
      const name = groupName.value.trim() || basename(rootPath);
      folderId = createFolder(name).id;
    }

    // addProject saves through a debounced writer, so the whole batch lands in a
    // single atomic write rather than one per project.
    const imported = selected
      .map(candidate => addProject({ path: candidate.path, name: candidate.name, folderId }))
      .filter(Boolean);

    closeModal(m);
    ProjectList.render();
    Toast.showSuccess(t('projects.import.done', { count: imported.length }));

    if (typeof options.onImported === 'function') options.onImported(imported);
  }

  // ── Wiring ──────────────────────────────────────────────────

  modal.querySelector('#import-browse').addEventListener('click', async () => {
    const selectedRoot = await api.dialog.selectFolder();
    if (selectedRoot) await scan(selectedRoot);
  });

  groupToggle.addEventListener('change', () => {
    groupName.disabled = !groupToggle.checked;
    if (groupToggle.checked) groupName.focus();
  });

  // Delegated: the list is re-rendered on every scan, so per-checkbox listeners
  // would have to be re-bound each time.
  resultsEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('import-check')) updateImportButton();
  });

  updateImportButton();
  showModal(modal);

  return modal;
}

module.exports = { showImportProjectsModal };
