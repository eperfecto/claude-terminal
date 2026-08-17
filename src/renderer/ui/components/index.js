/**
 * UI Components - Central Export
 */

const Modal = require('./Modal');
const Toast = require('./Toast');
const ContextMenu = require('./ContextMenu');
const Tab = require('./Tab');
const ProjectList = require('./ProjectList');
const TerminalManager = require('./TerminalManager');
const CustomizePicker = require('./CustomizePicker');
const QuickActions = require('./QuickActions');
const FileExplorer = require('./FileExplorer');
const ImportProjectsModal = require('./ImportProjectsModal');

module.exports = {
  ...Modal,
  ...Toast,
  ...ImportProjectsModal,
  ...ContextMenu,
  ...Tab,
  ProjectList,
  TerminalManager,
  CustomizePicker,
  QuickActions,
  FileExplorer
};
