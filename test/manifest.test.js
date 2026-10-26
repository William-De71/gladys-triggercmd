import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  RUN_OUTPUTS,
  REFRESH_OUTPUTS,
  STATES,
  FAILURE_REASONS,
} from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { DEFAULT_COMPUTER_NAME } from '../src/config.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-triggercmd';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'TRIGGERcmd');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-triggercmd:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-triggercmd');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
});

test('declares the cloud transport: triggercmd.com only, through the client and the socket', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(source('../src/triggercmd-api.js'), /https:\/\/www\.triggercmd\.com/);
  assert.match(source('../src/gladys-computer.js'), /new WebSocketClass\(socketUrl\(baseUrl\)/);
  for (const file of ['app', 'computers', 'events', 'widgets', 'store', 'time', 'config']) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|new WebSocket|node:https?|node:net|node:dgram/,
      file,
    );
  }
  // A single channel: no transport to publish per device.
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('Gladys 5.3.0 for the catalog keywords; no permission; the configuration fields', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['servers', 'assistants']);
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'energy_contracts',
    'music',
  ]) {
    assert.equal(manifest[key], undefined, `${key} (permission, or a newer Gladys)`);
  }
  const config = byKey(manifest.config_schema);
  assert.deepEqual([config.get('token').type, config.get('token').required], ['secret', true]);
  assert.deepEqual(
    [config.get('gladys_computer').type, config.get('gladys_computer').default],
    ['boolean', false],
  );
  assert.equal(config.get('gladys_computer_name').default, DEFAULT_COMPUTER_NAME);
  assert.equal(config.get('gladys_commands').type, 'string');
  for (const field of manifest.config_schema) {
    assert.ok(['section', 'string', 'secret', 'boolean'].includes(field.type), field.key);
  }
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
    assert.match(app, new RegExp(`onWidgetAction\\(WIDGETS\\.${key}`), key);
  }
  assert.match(app, /onSetValue/);
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
  const outputs = (key) =>
    byKey(manifest.scene_actions)
      .get(key)
      .outputs.map((output) => output.key);
  assert.deepEqual(outputs('run_command'), RUN_OUTPUTS);
  assert.deepEqual(outputs('refresh'), REFRESH_OUTPUTS);
  // A field added later to run_command must be optional: required ones stay these.
  assert.deepEqual(
    byKey(manifest.scene_actions)
      .get('run_command')
      .fields.filter((field) => field.required)
      .map((field) => field.key),
    ['computer', 'command'],
  );
  // Every trigger field is a key of the event data (the core compares them),
  // and a variable too.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
      assert.equal(field.required, false, `${trigger.key}.${field.key}`);
    }
  }
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(values(byKey(triggers.get('command_received').fields).get('state')), STATES);
  assert.deepEqual(values(byKey(triggers.get('run_failed').fields).get('reason')), FAILURE_REASONS);
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.fields.length <= 10, `${action.key}: ${action.fields.length} fields`);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('catalog keywords of Gladys 5.3.0, usable everywhere', () => {
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10, 'one to ten keywords');
  keywords.forEach((keyword) => assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword));
  assert.equal(new Set(keywords).size, keywords.length, 'unique once trimmed and lowercased');
  // TRIGGERcmd works in every country: no `countries`.
  assert.equal(manifest.countries, undefined);
});
