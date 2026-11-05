/* Offline documentation adapter. This file is not shipped in the install ZIP. */
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.createEl = function (tag, options = {}) {
  const element = document.createElement(tag);
  if (options.text) element.textContent = options.text;
  if (options.cls) element.className = options.cls;
  this.append(element);
  return element;
};
class TFile {
  constructor(data) {
    Object.assign(this, data);
    this.basename = this.name.replace(/\.md$/, '');
    this.extension = 'md';
    this.body = `---\ntitle: ${this.title}\nsummary: ${this.summary}\n---\n`;
    this.stat = { mtime: data.mtime, size: this.body.length };
  }
}
class TFolder {
  constructor(data) {
    this.name = data.name;
    this.path = data.path;
    this.children = data.children.map(child => child.kind === 'folder' ? new TFolder(child) : new TFile(child));
    this.children.forEach(child => child.parent = this);
  }
}
class ItemView {
  constructor(leaf) { this.app = leaf.app; this.contentEl = document.getElementById('home'); }
  addAction() {}
}
class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.getElementById('settings'); }
}
class Setting {
  constructor(container) {
    this.settingEl = container.createEl('div', { cls: 'setting-item' });
    this.infoEl = this.settingEl.createEl('div', { cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createEl('div', { cls: 'setting-item-name' });
    this.descEl = this.infoEl.createEl('div', { cls: 'setting-item-description' });
    this.controls = this.settingEl.createEl('div', { cls: 'setting-item-control' });
  }
  setName(text) { this.nameEl.textContent = text; return this; }
  setDesc(text) { this.descEl.textContent = text; return this; }
  addToggle(configure) {
    const input = this.controls.createEl('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', this.nameEl.textContent);
    const control = {
      setValue(value) { input.checked = value; return this; },
      setDisabled(value) { input.disabled = value; return this; },
      onChange(callback) { input.addEventListener('change', () => callback(input.checked)); return this; },
    };
    configure(control);
    return this;
  }
  addButton(configure) {
    const button = this.controls.createEl('button');
    configure({
      setButtonText(text) { button.textContent = text; return this; },
      onClick(callback) { button.addEventListener('click', callback); return this; },
    });
    return this;
  }
}
const root = new TFolder(DEMO_CONTENT);
const files = new Map();
function index(node) { files.set(node.path, node); node.children?.forEach(index); }
index(root);
const openedFiles = [];
const app = {
  vault: { getRoot: () => root, cachedRead: async file => file.body, getAbstractFileByPath: path => files.get(path) },
  workspace: { getLeaf: mode => ({ openFile: async file => openedFiles.push({ path: file.path, mode }) }) },
};
const obsidian = {
  TFile, TFolder, ItemView, PluginSettingTab, Setting, Plugin: class {},
  setIcon(element) {
    element.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor"/><path d="m15 15 6 6" stroke="currentColor"/></svg>';
  },
};
const { View, Settings } = new Function('require', 'module', PLUGIN_SOURCE + '\nreturn {View:DragonScrollHomeView,Settings:DragonScrollHomeSettingTab};')(() => obsidian, { exports: {} });
const plugin = {
  settings: { openOnStartup: true, hiddenFolders: [] }, summaryCache: new Map(),
  clearSummaryCache() { this.summaryCache.clear(); },
  async saveSettings() { this.savedSettings = JSON.parse(JSON.stringify(this.settings)); },
  getHomeViews: () => [view],
};
const view = new View({ app }, plugin);
const settings = new Settings(app, plugin);
window.demo = { view, settings, plugin, openedFiles };
view.onOpen().then(() => { settings.display(); window.demoReady = true; });
