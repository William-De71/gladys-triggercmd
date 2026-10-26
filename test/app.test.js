// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// TRIGGERcmd (test/helpers/fake-triggercmd.js): an in-memory fetch and a fake
// socket. No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, ACCESS_RETRY_MS, LIST_EVERY_MS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS, optionValue } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, RUN_OUTPUTS, REFRESH_OUTPUTS } from '../src/events.js';
import { commandKey } from '../src/computers.js';
import { FILE } from '../src/store.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  createFakeTriggercmd,
  createFakeSockets,
  dataDir,
  recordingLogger,
  TOKEN,
  OTHER_TOKEN,
} from './helpers/fake-triggercmd.js';

const NOW = Date.parse('2026-10-26T10:00:00Z');
const MINUTE = 60 * 1000;
const CONFIG = { token: TOKEN };
const GLADYS_CONFIG = {
  token: TOKEN,
  gladys_computer: true,
  gladys_computer_name: 'Gladys',
  gladys_commands: 'Movie, Good night',
};
const PREFIX = 'ext:test-integration';
const deviceId = (computer) => `${PREFIX}:computer:${computer}`;
const featureId = (computer, name) => `${deviceId(computer)}:${commandKey(name)}`;

/**
 * @description The integration, connected to a fake Gladys and a fake TRIGGERcmd.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, sockets, clock, dir, logger }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake } = {}) {
  fake ??= createFakeTriggercmd();
  const sockets = createFakeSockets();
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: fake.fetch,
    WebSocket: sockets.WebSocket,
    socketTiming: { retryMs: 5, maxRetryMs: 20, answerMs: 1000 },
    baseUrl: fake.baseUrl,
    dataDir: dir,
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    spacingMs: 0,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    app.listener.stop();
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, fake, sockets: sockets.sockets, clock, dir, logger };
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const deviceOf = (gladys, computer) =>
  gladys.fake.discoveredDevices.find((device) => device.external_id === deviceId(computer));
const featureOf = (device, name) => device.features.find((feature) => feature.name === name);
const paths = (fake, from = 0) =>
  fake.calls.slice(from).map((call) => `${call.method} ${call.path}`);
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const tick = () => new Promise((resolve) => setImmediate(resolve));
/**
 * @description Wait until a condition holds (1 second at most).
 * @param {Function} condition - `() => boolean`.
 * @returns {Promise<void>}
 */
async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('startup: the commands are read, one device per computer, a button or a switch per command', async (t) => {
  const { gladys, fake } = await startApp(t);
  assert.deepEqual(paths(fake), ['GET /api/command/list']);
  assert.equal(fake.calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.match(fake.calls[0].headers['user-agent'], /^gladys-triggercmd\//);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Office PC', 'Raspberry'],
  );
  const office = deviceOf(gladys, 'c-office');
  assert.deepEqual(
    office.features.map((feature) => [feature.name, feature.category, feature.type]),
    [
      ['Lock screen', 'button', 'push'],
      ['Volume', 'switch', 'binary'],
    ],
  );
  for (const feature of office.features) {
    assert.equal(feature.read_only, false);
    assert.equal(feature.has_feedback, false);
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 1);
  }
  assert.equal(office.should_poll, false);
  assert.equal(office.poll_frequency, undefined);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /Computers: 2, commands: 3/);
});

test('the token is never logged nor written to /data; the file is 0600', async (t) => {
  const { dir, logger, gladys } = await startApp(t);
  await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  const path = join(dir, FILE);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.ok(!readFileSync(path, 'utf8').includes(TOKEN));
  assert.ok(!logger.lines.join('\n').includes(TOKEN));
  assert.ok(!logger.lines.join('\n').includes('not-a-real-signature'));
});

test('a push button runs its command; a switch sends on / off and shows what was sent', async (t) => {
  const { gladys, fake } = await startApp(t);
  await createAll(gladys);
  const office = deviceOf(gladys, 'c-office');
  let ack = await gladys.fake.setValue(office, featureOf(office, 'Lock screen'), 1);
  assert.equal(ack.success, true);
  assert.deepEqual(fake.state.runs.at(-1), {
    computer: 'Office PC',
    command: 'Lock screen',
    trigger: 'Lock screen',
    sender: 'Gladys Assistant',
  });
  const volume = featureOf(office, 'Volume');
  ack = await gladys.fake.setValue(office, volume, 1);
  assert.equal(ack.success, true);
  assert.equal(fake.state.runs.at(-1).params, 'on');
  assert.equal(gladys.fake.lastState(volume.external_id), 1);
  await gladys.fake.setValue(office, volume, 0);
  assert.equal(fake.state.runs.at(-1).params, 'off');
  assert.equal(gladys.fake.lastState(volume.external_id), 0);
  assert.equal(events(gladys, TRIGGERS.RUN_FAILED).length, 0);
});

test('a refused run fails the command and fires run_failed with its reason', async (t) => {
  const { gladys, fake } = await startApp(t);
  await createAll(gladys);
  const office = deviceOf(gladys, 'c-office');
  fake.state.failNext = { status: 429, body: {} };
  const ack = await gladys.fake.setValue(office, featureOf(office, 'Lock screen'), 1);
  assert.equal(ack.success, false);
  const [event] = events(gladys, TRIGGERS.RUN_FAILED);
  assert.deepEqual(
    { ...event.data, message: undefined },
    {
      computer: 'Office PC',
      command: 'Lock screen',
      reason: 'rate_limit',
      message: undefined,
    },
  );
  // A command removed from the computer: the feature fails, the list is not guessed.
  fake.state.commands = fake.state.commands.filter((command) => command.name !== 'Lock screen');
  await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH);
  const removed = await gladys.fake.setValue(
    office,
    { external_id: featureId('c-office', 'Lock screen') },
    1,
  );
  assert.equal(removed.success, false);
});

test('scene action run_command: names without case, declared outputs only, no event on failure', async (t) => {
  const { gladys, fake, clock } = await startApp(t);
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'office pc',
    command: 'VOLUME',
    parameters: ' 40 ',
  });
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, {
    computer: 'Office PC',
    command: 'Volume',
    message: 'Command triggered',
  });
  assert.deepEqual(Object.keys(ack.data.outputs).sort(), [...RUN_OUTPUTS].sort());
  assert.equal(fake.state.runs.at(-1).params, '40');
  // Unknown: the list is read again once (not more than every 10 s), then the
  // action fails, without any event.
  clock.now += 11 * 1000;
  const before = fake.calls.length;
  const failed = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'Office PC',
    command: 'Nope',
  });
  assert.equal(failed.success, false);
  assert.match(failed.error, /Unknown command "Nope"/);
  assert.deepEqual(paths(fake, before), ['GET /api/command/list']);
  // A command added on the computer since the last reading is found.
  fake.state.commands.push({ id: 'k9', name: 'Mute', computer: 'c-pi', allowParams: false });
  clock.now += 11 * 1000;
  const added = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'Raspberry',
    command: 'Mute',
  });
  assert.equal(added.success, true);
  fake.state.failNext = { status: 500, body: {} };
  const server = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'Raspberry',
    command: 'Mute',
  });
  assert.equal(server.success, false);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('scene action refresh: counts, declared outputs only, at most once every 10 seconds', async (t) => {
  const { gladys, fake, clock } = await startApp(t);
  const before = fake.calls.length;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH);
  assert.deepEqual(ack.data.outputs, { computer_count: 2, command_count: 3 });
  assert.deepEqual(Object.keys(ack.data.outputs).sort(), [...REFRESH_OUTPUTS].sort());
  await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH);
  assert.equal(fake.calls.length - before, 1);
  clock.now += 11 * 1000;
  await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH);
  assert.equal(fake.calls.length - before, 2);
});

test('the list is read again every 15 minutes, new commands are offered', async (t) => {
  const { gladys, app, fake, clock } = await startApp(t);
  const before = fake.calls.length;
  await app.tick();
  assert.equal(fake.calls.length, before);
  fake.state.commands.push({ id: 'k9', name: 'Mute', computer: 'c-pi', allowParams: false });
  clock.now += LIST_EVERY_MS;
  await app.tick();
  assert.equal(fake.calls.length, before + 1);
  assert.deepEqual(
    deviceOf(gladys, 'c-pi').features.map((feature) => feature.name),
    ['Mute', 'Reboot'],
  );
});

test('a command whose computer is an id only: the names come from the computer list', async (t) => {
  const fake = createFakeTriggercmd();
  fake.state.populate = false;
  const { gladys } = await startApp(t, { fake });
  assert.deepEqual(paths(fake), ['GET /api/command/list', 'GET /api/computer/list']);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Office PC', 'Raspberry'],
  );
});

test('a refused token: status, one access_refused event, no retry before 30 minutes, then fixed', async (t) => {
  const fake = createFakeTriggercmd();
  fake.state.tokens.delete(TOKEN);
  const { gladys, app, clock } = await startApp(t, { fake });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /refuse le jeton/);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1);
  const before = fake.calls.length;
  clock.now += 10 * MINUTE;
  await app.tick();
  assert.equal(fake.calls.length, before);
  clock.now += ACCESS_RETRY_MS;
  await app.tick();
  assert.equal(fake.calls.length, before + 1);
  assert.equal(events(gladys, TRIGGERS.ACCESS_REFUSED).length, 1, 'once per refusal');
  fake.state.tokens.add(TOKEN);
  clock.now += ACCESS_RETRY_MS;
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('without a token: status, widget message, actions refuse', async (t) => {
  const { gladys, fake } = await startApp(t, { config: {} });
  assert.deepEqual(fake.calls, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const widget = await gladys.fake.widgetGet(WIDGETS.COMMANDS, { language: 'fr' });
  assert.match(widget.data.content.components[0].text, /jeton/);
  const action = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'Office PC',
    command: 'Lock screen',
  });
  assert.equal(action.success, false);
  const testAck = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(testAck.data.message?.en ?? JSON.stringify(testAck.data), /token/);
});

test('widget: valid in every language, the form runs a command, the history shows it', async (t) => {
  const { gladys, fake } = await startApp(t);
  for (const language of LANGUAGES) {
    const ack = await gladys.fake.widgetGet(WIDGETS.COMMANDS, { language });
    const report = validateWidgetContent(ack.data.content);
    assert.deepEqual(report, [], language);
  }
  const computer = { id: 'c-office', name: 'Office PC' };
  const run = await gladys.fake.widgetAction(WIDGETS.COMMANDS, WIDGET_ACTIONS.RUN, undefined, {
    values: {
      command: optionValue(computer, { key: commandKey('Volume') }),
      parameters: '25',
    },
  });
  assert.match(JSON.stringify(run.data), /Volume/);
  assert.deepEqual(fake.state.runs.at(-1), {
    computer: 'Office PC',
    command: 'Volume',
    trigger: 'Volume',
    params: '25',
    sender: 'Gladys Assistant',
  });
  const ack = await gladys.fake.widgetGet(WIDGETS.COMMANDS, {
    language: 'fr',
    settings: { computer: deviceId('c-office') },
  });
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((component) => component.type === 'card-list');
  assert.equal(list.items[0].title, 'Volume (25)');
  assert.equal(list.items[0].badge.text, 'Envoyée');
  const form = content.components.find((component) => component.action?.key === 'run');
  assert.deepEqual(
    form.action.fields[0].options.map((option) => option.label.en),
    ['Lock screen', 'Volume'],
  );
  const gone = await gladys.fake.widgetAction(WIDGETS.COMMANDS, WIDGET_ACTIONS.RUN, undefined, {
    values: { command: 'c-office|cmd_000000000000' },
  });
  assert.match(gone.data.message?.en ?? JSON.stringify(gone.data), /no longer exists/);
  const refresh = await gladys.fake.widgetAction(WIDGETS.COMMANDS, WIDGET_ACTIONS.REFRESH);
  assert.match(JSON.stringify(refresh.data), /Computers: 2/);
});

test('test the connection, and the diagnostic', async (t) => {
  const { gladys } = await startApp(t);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message?.fr ?? JSON.stringify(ack.data), /Office PC, Raspberry/);
  const diagnostic = await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  assert.equal(diagnostic.success, true);
});

test('another token of another account: the history of the previous one is forgotten', async (t) => {
  const { gladys, app } = await startApp(t);
  await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'Office PC',
    command: 'Lock screen',
  });
  assert.equal(app.store.data.history.length, 1);
  await gladys.fake.configUpdated({ token: OTHER_TOKEN });
  assert.equal(app.store.data.history.length, 0);
});

test('Gladys computer: created, its commands added, listening; a run fires command_received', async (t) => {
  const { gladys, app, fake, sockets } = await startApp(t, { config: GLADYS_CONFIG });
  const created = fake.state.computers.find((computer) => computer.name === 'Gladys');
  assert.ok(created, 'created in TRIGGERcmd');
  assert.deepEqual(
    fake.state.commands
      .filter((command) => command.computer === created.id)
      .map((command) => [command.name, command.allowParams, command.voice]),
    [
      ['Movie', true, 'Movie'],
      ['Good night', true, 'Good night'],
    ],
  );
  // The socket: open, connect, subscribe to the room of the computer.
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  assert.match(socket.url, /^wss:\/\/triggercmd\.test\/socket\.io\/\?/);
  assert.match(socket.url, /EIO=3/);
  socket.serverOpen();
  const request = socket.lastRequest();
  assert.equal(request.event, 'get');
  assert.equal(
    request.request.url,
    `/api/computer/subscribeToFunRoom?roomName=${encodeURIComponent(created.id)}`,
  );
  assert.equal(request.request.headers.Authorization, `Bearer ${TOKEN}`);
  socket.serverAnswer(request.ack, { body: {}, statusCode: 200 });
  assert.equal(app.gladysState(), 'listening');
  assert.match(gladys.fake.connectionStatus.message.en, /Computer “Gladys”: listening/);
  // The Gladys computer is not a device.
  assert.ok(!deviceOf(gladys, created.id));
  // Alexa turns on "Movie".
  socket.serverMessage({ trigger: 'Movie', id: 'k-movie', params: 'on', sender: 'Alexa' });
  await until(() => events(gladys, TRIGGERS.COMMAND_RECEIVED).length > 0);
  const [event] = events(gladys, TRIGGERS.COMMAND_RECEIVED);
  assert.deepEqual(event.data, {
    command: 'Movie',
    params: 'on',
    state: 'on',
    sender: 'Alexa',
    computer: 'Gladys',
  });
  await until(() => fake.state.reports.length > 0);
  assert.deepEqual(fake.state.reports.at(-1), {
    status: 'Command ran',
    computer: created.id,
    command: 'k-movie',
  });
  // A run sent by Gladys itself never fires a scene (no loop).
  socket.serverMessage({ trigger: 'Movie', params: 'on', sender: 'Gladys Assistant' });
  await tick();
  assert.equal(events(gladys, TRIGGERS.COMMAND_RECEIVED).length, 1);
  // Gladys cannot run the Gladys computer from a scene.
  const loop = await gladys.fake.sceneAction(SCENE_ACTIONS.RUN_COMMAND, {
    computer: 'gladys',
    command: 'Movie',
  });
  assert.equal(loop.success, false);
  // The widget shows the received run.
  const widget = await gladys.fake.widgetGet(WIDGETS.COMMANDS, { language: 'en' });
  const list = widget.data.content.components.find((component) => component.type === 'card-list');
  assert.equal(list.items[0].badge.text, 'Received');
  assert.match(list.items[0].subtitle, /from Alexa/);
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
});

test('Gladys computer: found again after a restart, its commands follow the configuration', async (t) => {
  const fake = createFakeTriggercmd();
  const dir = dataDir();
  const first = await startApp(t, { config: GLADYS_CONFIG, fake, dir });
  first.app.listener.stop();
  const count = fake.state.computers.length;
  await startApp(t, {
    config: { ...GLADYS_CONFIG, gladys_commands: 'Movie; Reading' },
    fake,
    dir,
  });
  assert.equal(fake.state.computers.length, count, 'not created twice');
  const gladysId = fake.state.computers.find((computer) => computer.name === 'Gladys').id;
  assert.deepEqual(
    fake.state.commands
      .filter((command) => command.computer === gladysId)
      .map((command) => command.name),
    ['Movie', 'Reading'],
  );
});

test('Gladys computer: a single computer on the free plan, said plainly, tried again later', async (t) => {
  const fake = createFakeTriggercmd({ maxComputers: 2 });
  const { gladys, app, clock } = await startApp(t, { config: GLADYS_CONFIG, fake });
  assert.equal(app.gladysState(), 'subscription');
  assert.match(gladys.fake.connectionStatus.message.fr, /n’autorise qu’un ordinateur/);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the computers still work');
  const widget = await gladys.fake.widgetGet(WIDGETS.COMMANDS, { language: 'en' });
  const status = widget.data.content.components.find((component) => component.type === 'status');
  assert.equal(status.items[0].value, 'Subscription needed');
  fake.state.maxComputers = 10;
  clock.now += 7 * 60 * MINUTE;
  await app.tick();
  assert.equal(app.gladysState(), 'connecting');
});

test('Gladys computer: the socket reconnects after a drop, and a refused token stops it', async (t) => {
  const { app, sockets } = await startApp(t, { config: GLADYS_CONFIG });
  sockets[0].serverClose();
  assert.equal(app.gladysState(), 'failed');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sockets.length, 2, 'connected again');
  const socket = sockets[1];
  socket.serverOpen();
  const request = socket.lastRequest();
  socket.serverAnswer(request.ack, { body: { err: 'Invalid Token!' }, statusCode: 401 });
  assert.equal(app.gladysState(), 'refused');
  assert.equal(socket.closed, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sockets.length, 2, 'no reconnection with a refused token');
});

test('Gladys computer turned off: the socket closes, nothing is deleted in TRIGGERcmd', async (t) => {
  const { gladys, app, fake, sockets } = await startApp(t, { config: GLADYS_CONFIG });
  const before = fake.calls.length;
  await gladys.fake.configUpdated({ ...GLADYS_CONFIG, gladys_computer: false });
  assert.equal(sockets[0].closed, true);
  assert.equal(app.gladysState(), 'off');
  assert.ok(!paths(fake, before).some((path) => path.includes('delete')));
  assert.ok(fake.state.computers.some((computer) => computer.name === 'Gladys'));
});
