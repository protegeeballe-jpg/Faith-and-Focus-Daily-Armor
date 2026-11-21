import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const settingsSource = readFileSync(new URL('../assets/settings-modal.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

class MockElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.open = false;
    this.focusCalls = [];
    this.showModalCalls = 0;
    this.closeCalls = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, ...event });
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  focus(options) {
    this.focusCalls.push(options);
  }

  showModal() {
    this.showModalCalls += 1;
    this.open = true;
  }

  close() {
    this.closeCalls += 1;
    this.open = false;
    this.emit('close');
  }
}

function bootSettingsModule({ omit = [], unsupported = false } = {}) {
  const elements = {
    'settings-modal': new MockElement(),
    'settings-open-button': new MockElement(),
    'settings-close-button': new MockElement()
  };

  if (unsupported) {
    elements['settings-modal'].showModal = undefined;
  }

  for (const id of omit) delete elements[id];

  const document = {
    getElementById(id) {
      return elements[id] || null;
    }
  };

  assert.doesNotThrow(() => vm.runInNewContext(settingsSource, { document }));
  return elements;
}

test('Settings module resolves the dialog and both controls before registering handlers', () => {
  const elements = bootSettingsModule();

  assert.equal(elements['settings-open-button'].listeners.get('click')?.length, 1);
  assert.equal(elements['settings-close-button'].listeners.get('click')?.length, 1);
  assert.equal(elements['settings-modal'].listeners.get('click')?.length, 1);
  assert.equal(elements['settings-modal'].listeners.get('close')?.length, 1);
  assert.match(settingsSource, /getElementById\('settings-modal'\)/);
  assert.match(settingsSource, /getElementById\('settings-open-button'\)/);
  assert.match(settingsSource, /getElementById\('settings-close-button'\)/);
});

test('gear button opens Settings once and updates accessibility state and focus', () => {
  const elements = bootSettingsModule();
  const dialog = elements['settings-modal'];
  const openButton = elements['settings-open-button'];
  const closeButton = elements['settings-close-button'];

  openButton.emit('click');

  assert.equal(dialog.open, true);
  assert.equal(dialog.showModalCalls, 1);
  assert.equal(openButton.getAttribute('aria-expanded'), 'true');
  assert.equal(closeButton.focusCalls.length, 1);

  openButton.emit('click');
  assert.equal(dialog.showModalCalls, 1, 'an already-open dialog must not be opened again');
});

test('close button and backdrop dismiss Settings and restore focus to the gear button', () => {
  const elements = bootSettingsModule();
  const dialog = elements['settings-modal'];
  const openButton = elements['settings-open-button'];
  const closeButton = elements['settings-close-button'];

  openButton.emit('click');
  closeButton.emit('click');

  assert.equal(dialog.open, false);
  assert.equal(dialog.closeCalls, 1);
  assert.equal(openButton.getAttribute('aria-expanded'), 'false');
  assert.equal(openButton.focusCalls.length, 1);
  assert.equal(openButton.focusCalls[0]?.preventScroll, true);

  openButton.emit('click');
  dialog.emit('click', { target: {} });
  assert.equal(dialog.open, true, 'clicks inside the dialog must not dismiss it');

  dialog.emit('click', { target: dialog });
  assert.equal(dialog.open, false, 'a backdrop click must dismiss the dialog');
  assert.equal(openButton.getAttribute('aria-expanded'), 'false');
  assert.equal(openButton.focusCalls.length, 2);
});

test('Settings module fails closed when an element or native dialog method is unavailable', () => {
  const missingClose = bootSettingsModule({ omit: ['settings-close-button'] });
  assert.equal(missingClose['settings-open-button'].listeners.size, 0);
  assert.equal(missingClose['settings-modal'].listeners.size, 0);

  const unsupportedDialog = bootSettingsModule({ unsupported: true });
  assert.equal(unsupportedDialog['settings-open-button'].listeners.size, 0);
  assert.equal(unsupportedDialog['settings-modal'].listeners.size, 0);
});

test('Settings copy accurately documents authenticated live sync without periodic polling', () => {
  assert.match(htmlSource, /Live encrypted sync across trusted devices/);
  assert.match(htmlSource, /secure live connection notifies your other trusted devices/);
  assert.match(htmlSource, /fetches and authenticates only that encrypted packet/);
  assert.match(htmlSource, /live connection pauses while this page is hidden/);
  assert.doesNotMatch(htmlSource, /continuously poll|checks for updates while the app is open|every 10 seconds/);
  assert.match(htmlSource, /id="settings-open-button"[^>]*aria-controls="settings-modal"/);
  assert.match(htmlSource, /<dialog id="settings-modal"/);
  assert.match(htmlSource, /src="\.\/assets\/settings-modal\.js"/);
});
