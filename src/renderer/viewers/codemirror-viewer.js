/**
 * CodeMirror 6 Editor Viewer Module (ESM, lazy-loaded)
 * Mounts a plain CodeMirror 6 editor (basic setup only — no LSP-style
 * intellisense/autocomplete/linting) for in-app editing of code/text files.
 * Mirrors the pdf-viewer.js / three-viewer.js module shape/conventions.
 */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const languageCompartment = new Compartment();

// Single dark theme matching the app's CSS custom properties — no light/dark
// toggle needed since the whole app is dark-themed (see styles/base.css :root).
const appTheme = EditorView.theme({
  '&': {
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-primary)',
    height: '100%',
    fontSize: 'var(--font-xs)',
  },
  '.cm-content': {
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    caretColor: 'var(--accent)',
  },
  '.cm-scroller': {
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    lineHeight: '1.5',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-dim)',
  },
  '.cm-panels': { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border-color)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border-color)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-dim)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-dim)' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--bg-active)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--accent-dim)',
    outline: '1px solid var(--accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border-color)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-hover)',
    border: 'none',
    color: 'var(--text-secondary)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
  },
}, { dark: true });

/**
 * Mount a CodeMirror 6 editor into the given container.
 * @param {HTMLElement} container - The mount point (fills its parent's space)
 * @param {Object} opts
 * @param {string} opts.content - Initial file content
 * @param {string} opts.filename - File name, used for language auto-detection
 * @param {(value: string) => void} [opts.onSave] - Called on Ctrl+S / Cmd+S
 * @param {(isDirty: boolean) => void} [opts.onChange] - Called whenever the
 *   dirty state (doc differs from the initial content) may have changed
 * @returns {{ getValue: () => string, focus: () => void, destroy: () => void }}
 */
export function mountEditor(container, { content = '', filename = '', onSave, onChange } = {}) {
  const startDoc = content;
  let destroyed = false;

  const saveKeymap = keymap.of([
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        if (onSave) onSave();
        return true;
      },
    },
    indentWithTab,
  ]);

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) {
      onChange(update.state.doc.toString() !== startDoc);
    }
  });

  const state = EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      saveKeymap,
      languageCompartment.of([]),
      appTheme,
      updateListener,
      EditorView.lineWrapping,
    ],
  });

  const view = new EditorView({ state, parent: container });

  // Language detection is async: @codemirror/language-data's .load() dynamically
  // imports the matching @codemirror/lang-* package. Apply it through a
  // Compartment once resolved so it doesn't block initial mount.
  if (filename) {
    const desc = LanguageDescription.matchFilename(languages, filename);
    if (desc) {
      desc.load().then((support) => {
        if (destroyed) return;
        view.dispatch({ effects: languageCompartment.reconfigure(support) });
      }).catch(() => { /* no language support available — plain text is fine */ });
    }
  }

  return {
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true;
      view.destroy();
    },
  };
}
