import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const timers = new Map();
let timerId = 0;
globalThis.window = {
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
};
class Plugin {
  constructor() { this.commands = []; this.views = new Map(); }
  async loadData() { return {}; }
  registerView(name, factory) { this.views.set(name, factory); }
  addRibbonIcon() {}
  addCommand(command) { this.commands.push(command); }
  addSettingTab() {}
  registerEvent() {}
}
class TFolder {}
const api = { Plugin, TFolder, TFile: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, setIcon() {} };
const PluginClass = new Function('require', 'module', source + '\nreturn DragonScrollHomePlugin;')(() => api, { exports: {} });
function workspace() {
  const ready = [], events = new Map();
  return { ready, events, app: {
    vault: { on(name, callback) { events.set(name, callback); return { name }; } },
    workspace: {
      onLayoutReady(callback) { ready.push(callback); },
      getLeavesOfType() { return []; },
      on() { return {}; },
      detachLeavesOfType() { throw new Error('Unload must not detach workspace leaves'); },
    },
  } };
}
const state = workspace();
const plugin = new PluginClass();
plugin.app = state.app;
await plugin.onload();
assert.deepEqual(plugin.commands.map(command => command.id), ['open-home', 'refresh-home']);
assert.equal(state.ready.length, 1);
assert.equal(timers.size, 0, 'Startup should not leave delayed view-opening callbacks');
let opens = 0;
plugin.activateView = async () => { opens++; };
state.ready[0]();
assert.equal(opens, 1);
state.events.get('create')(new TFolder());
assert.equal(timers.size, 1, 'Vault refresh should be debounced');
plugin.summaryCache.set('example', 'summary');
plugin.onunload();
assert.equal(timers.size, 0, 'Unload must cancel pending refresh');
assert.equal(plugin.summaryCache.size, 0);
state.ready[0]();
assert.equal(opens, 1, 'A layout callback after unload must not open a view');
const late = new PluginClass();
late.app = workspace().app;
let resolveData;
late.loadData = () => new Promise(resolve => { resolveData = resolve; });
const loading = late.onload();
late.onunload();
resolveData({});
await loading;
assert.equal(late.views.size, 0, 'A plugin unloaded during async settings loading must not register new views');
console.log('Lifecycle checks passed: one startup path, no delayed reopen after unload, debounce cleanup and command IDs.');
