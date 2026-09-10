/**
 * Claude Terminal Remote — Lightweight i18n module
 * Supports FR/EN/ES with auto-detection, persistence, and DOM integration.
 */

const SUPPORTED_LANGS = ['fr', 'en', 'es'];
const DEFAULT_LANG = 'en';

const TRANSLATIONS = {
  fr: {
    // Auth
    'cloud.enterKey': 'Entrez votre clé API',
    'cloud.keyError': 'Connexion échouée. Vérifiez votre clé API.',

    // Navigation
    'nav.projects': 'Projets',
    'nav.chat': 'Chat',
    'nav.dashboard': 'Dashboard',
    'nav.control': 'Contrôle',
    'nav.tabs': 'Onglets',

    // Sessions
    'session.new': 'Nouveau chat',
    'session.newHint': 'Écrivez un message pour commencer',
    'session.noChats': 'Aucun chat',
    'session.noChatsHint': 'Cliquez le bouton ci-dessous pour commencer',
    'session.pastDivider': 'Sessions précédentes',
    'session.resumable': 'à reprendre',
    'session.showMore': 'Voir {count} de plus\u2026',

    // Status
    'status.reconnecting': 'Reconnexion\u2026',
    'status.connected': 'Connecté',
    'status.disconnected': 'Déconnecté',
    'status.thinking': 'Réflexion\u2026',
    'status.noOutput': '(aucune sortie)',
    'status.active': 'Actif',
    'status.idle': 'Inactif',
    'status.error': 'Erreur',
    'status.permission': 'Permission',
    'status.done': 'Terminé',
    'status.claudeFinished': 'Claude a terminé',

    // Headless / Cloud
    'headless.error': 'Erreur session cloud',
    'headless.selectProject': 'Sélectionnez un projet pour démarrer',

    // Projects
    'project.noProjects': 'Aucun projet.',
    'project.noProjectsDash': 'Aucun projet',
    'project.searchPlaceholder': 'Rechercher un projet...',
    'project.noMatches': 'Aucun projet ne correspond.',

    // Dashboard
    'dashboard.timeToday': 'Temps aujourd\'hui',
    'dashboard.activeProject': 'Projet actif',
    'dashboard.sessions': 'Sessions',
    'dashboard.projectsSection': 'Projets',

    // Slash commands
    'slash.compact': 'Compacter l\'historique',
    'slash.clear': 'Effacer la conversation',
    'slash.help': 'Aide',

    // Chat
    'chat.notSentOffline': 'Non envoyé — vous étiez hors ligne.',

    // Misc
    'misc.retry': 'Réessayer',
    'misc.loading': 'Chargement\u2026',
    'misc.justNow': 'à l\'instant',
    'misc.model': 'Modèle',
    'misc.thinking': 'Réflexion',
    'misc.noDetails': 'Aucun détail disponible',

    // PWA
    'pwa.addHome': 'Ajouter à l\'écran d\'accueil',
    'pwa.install': 'Installer',

    // Control
    'control.noSessions': 'Aucune session active',
    'control.title': 'Mission Control',
  },

  en: {
    'cloud.enterKey': 'Enter your API key',
    'cloud.keyError': 'Connection failed. Check your API key.',

    'nav.projects': 'Projects',
    'nav.chat': 'Chat',
    'nav.dashboard': 'Dashboard',
    'nav.control': 'Control',
    'nav.tabs': 'Tabs',

    'session.new': 'New chat',
    'session.newHint': 'Type a message to get started',
    'session.noChats': 'No chats yet',
    'session.noChatsHint': 'Tap the button below to get started',
    'session.pastDivider': 'Past sessions',
    'session.resumable': 'to resume',
    'session.showMore': 'Show {count} more\u2026',

    'status.reconnecting': 'Reconnecting\u2026',
    'status.connected': 'Connected',
    'status.disconnected': 'Disconnected',
    'status.thinking': 'Thinking\u2026',
    'status.noOutput': '(no output)',
    'status.active': 'Active',
    'status.idle': 'Idle',
    'status.error': 'Error',
    'status.permission': 'Permission',
    'status.done': 'Done',
    'status.claudeFinished': 'Claude finished',

    'headless.error': 'Cloud session error',
    'headless.selectProject': 'Select a project to start',

    'project.noProjects': 'No projects yet.',
    'project.noProjectsDash': 'No projects yet',
    'project.searchPlaceholder': 'Search projects...',
    'project.noMatches': 'No projects match your search.',

    'dashboard.timeToday': 'Time today',
    'dashboard.activeProject': 'Active project',
    'dashboard.sessions': 'Sessions',
    'dashboard.projectsSection': 'Projects',

    'slash.compact': 'Compact conversation',
    'slash.clear': 'Clear conversation',
    'slash.help': 'Show help',

    'chat.notSentOffline': 'Not sent — you were offline.',

    'misc.retry': 'Retry',
    'misc.loading': 'Loading\u2026',
    'misc.justNow': 'just now',
    'misc.model': 'Model',
    'misc.thinking': 'Thinking',
    'misc.noDetails': 'No details available',

    'pwa.addHome': 'Add to your home screen',
    'pwa.install': 'Install',

    'control.noSessions': 'No active sessions',
    'control.title': 'Mission Control',
  },

  es: {
    'cloud.enterKey': 'Ingrese su clave API',
    'cloud.keyError': 'Conexi\u00f3n fallida. Verifique su clave API.',

    'nav.projects': 'Proyectos',
    'nav.chat': 'Chat',
    'nav.dashboard': 'Dashboard',
    'nav.control': 'Control',
    'nav.tabs': 'Pesta\u00f1as',

    'session.new': 'Nuevo chat',
    'session.newHint': 'Escribe un mensaje para comenzar',
    'session.noChats': 'Sin chats a\u00fan',
    'session.noChatsHint': 'Toca el bot\u00f3n de abajo para comenzar',
    'session.pastDivider': 'Sesiones anteriores',
    'session.resumable': 'para retomar',
    'session.showMore': 'Ver {count} m\u00e1s\u2026',

    'status.reconnecting': 'Reconectando\u2026',
    'status.connected': 'Conectado',
    'status.disconnected': 'Desconectado',
    'status.thinking': 'Pensando\u2026',
    'status.noOutput': '(sin salida)',
    'status.active': 'Activo',
    'status.idle': 'Inactivo',
    'status.error': 'Error',
    'status.permission': 'Permiso',
    'status.done': 'Terminado',
    'status.claudeFinished': 'Claude termin\u00f3',

    'headless.error': 'Error de sesi\u00f3n cloud',
    'headless.selectProject': 'Seleccione un proyecto para comenzar',

    'project.noProjects': 'Sin proyectos a\u00fan.',
    'project.noProjectsDash': 'Sin proyectos a\u00fan',
    'project.searchPlaceholder': 'Buscar proyecto...',
    'project.noMatches': 'Ningun proyecto coincide.',

    'dashboard.timeToday': 'Tiempo hoy',
    'dashboard.activeProject': 'Proyecto activo',
    'dashboard.sessions': 'Sesiones',
    'dashboard.projectsSection': 'Proyectos',

    'slash.compact': 'Compactar conversaci\u00f3n',
    'slash.clear': 'Borrar conversaci\u00f3n',
    'slash.help': 'Ayuda',

    'chat.notSentOffline': 'No enviado \u2014 estabas sin conexi\u00f3n.',

    'misc.retry': 'Reintentar',
    'misc.loading': 'Cargando\u2026',
    'misc.justNow': 'ahora mismo',
    'misc.model': 'Modelo',
    'misc.thinking': 'Pensamiento',
    'misc.noDetails': 'Sin detalles disponibles',

    'pwa.addHome': 'A\u00f1adir a la pantalla de inicio',
    'pwa.install': 'Instalar',

    'control.noSessions': 'Sin sesiones activas',
    'control.title': 'Mission Control',
  },
};

// ─── State ───────────────────────────────────────────────────────────────────

let _currentLang = DEFAULT_LANG;

function _detectLang() {
  try {
    const saved = localStorage.getItem('ct-remote-lang');
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (_) {}
  try {
    const code = (navigator.language || '').split('-')[0].toLowerCase();
    if (SUPPORTED_LANGS.includes(code)) return code;
  } catch (_) {}
  return DEFAULT_LANG;
}

_currentLang = _detectLang();

// ─── Public API ──────────────────────────────────────────────────────────────

function t(key, params) {
  const val = TRANSLATIONS[_currentLang]?.[key] || TRANSLATIONS[DEFAULT_LANG]?.[key] || key;
  if (!params) return val;
  return val.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}

function setLang(code) {
  if (!SUPPORTED_LANGS.includes(code)) return;
  _currentLang = code;
  try { localStorage.setItem('ct-remote-lang', code); } catch (_) {}
  applyDOM();
}

function getLang() {
  return _currentLang;
}

function applyDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });
}

// ─── Export as global ────────────────────────────────────────────────────────

window.i18n = { t, setLang, getLang, applyDOM, SUPPORTED_LANGS };
