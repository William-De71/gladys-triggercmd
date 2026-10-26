// The TRIGGERcmd client, the parsing of its answers and the configuration,
// against the fake TRIGGERcmd (no network).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTriggercmdClient, tokenUserId, retryAfterSeconds } from '../src/triggercmd-api.js';
import {
  parseComputers,
  commandKey,
  parseExternalId,
  findCommand,
  MAX_COMMANDS,
} from '../src/computers.js';
import { parseCommandNames, socketUrl } from '../src/gladys-computer.js';
import { normalizeConfig } from '../src/config.js';
import { stateOf, failureReason } from '../src/events.js';
import { createFakeTriggercmd, TOKEN, tokenFor } from './helpers/fake-triggercmd.js';

const NOW = Date.parse('2026-10-26T10:00:00Z');

/**
 * @description A client on the fake TRIGGERcmd.
 * @param {object} [options] - `{ token, clock }`.
 * @returns {object} `{ api, fake, clock }`.
 */
function client({ token = TOKEN, clock = { now: NOW } } = {}) {
  const fake = createFakeTriggercmd();
  const api = createTriggercmdClient({
    getToken: () => token,
    userAgent: 'gladys-triggercmd/test',
    fetch: fake.fetch,
    baseUrl: fake.baseUrl,
    spacingMs: 0,
    now: () => clock.now,
  });
  return { api, fake, clock };
}

test('the user id of a token, without checking the signature', () => {
  assert.equal(tokenUserId(TOKEN), 'test-user');
  assert.equal(tokenUserId(tokenFor('someone')), 'someone');
  assert.equal(tokenUserId('not a jwt'), null);
  assert.equal(tokenUserId('a.b.c'), null);
});

test('run/trigger: a JSON body with the names, the command under both keys, the sender', async () => {
  const { api, fake } = client();
  const message = await api.trigger({ computer: 'Office PC', command: 'Volume', params: '30' });
  assert.equal(message, 'Command triggered');
  const call = fake.calls.at(-1);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.deepEqual(call.body, {
    computer: 'Office PC',
    command: 'Volume',
    trigger: 'Volume',
    params: '30',
    sender: 'Gladys Assistant',
  });
  await api.trigger({ computer: 'Office PC', command: 'Lock screen', params: '' });
  assert.equal('params' in fake.calls.at(-1).body, false, 'no empty parameter');
  assert.deepEqual(api.counts(), { requests: 2, runs: 2 });
});

test('the forms of the agent endpoints are url-encoded', async () => {
  const { api, fake } = client();
  const id = await api.createComputer('Gladys');
  await api.addCommand(id, 'Movie', 'A description');
  await api.removeCommand(id, 'Movie');
  await api.reportRun(id, 'k1');
  const [create, add, remove, report] = fake.calls;
  assert.equal(create.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(create.body, { name: 'Gladys' });
  assert.deepEqual(add.body, {
    name: 'Movie',
    computer: id,
    voice: 'Movie',
    voiceReply: '',
    allowParams: 'true',
    mcpToolDescription: 'A description',
    icon: '',
  });
  assert.deepEqual(remove.body, { name: 'Movie', computer: id });
  assert.deepEqual(report.body, { status: 'Command ran', computer: id, command: 'k1' });
});

test('errors: 401 auth, 403 subscribe, 404 not found, 5xx server, network unreachable', async () => {
  const refused = client({ token: tokenFor('nobody') });
  await assert.rejects(refused.api.listCommands(), { kind: 'auth', status: 401 });
  const { api, fake } = client();
  fake.state.maxComputers = 2;
  await assert.rejects(api.createComputer('Gladys'), { kind: 'subscribe', status: 403 });
  await assert.rejects(api.trigger({ computer: 'x', command: 'y' }), { kind: 'not_found' });
  fake.state.failNext = { status: 502 };
  await assert.rejects(api.listCommands(), { kind: 'server' });
  fake.state.failNext = 'network';
  await assert.rejects(api.listCommands(), { kind: 'unreachable' });
  const empty = createTriggercmdClient({ getToken: () => '', userAgent: 'x', fetch: fake.fetch });
  await assert.rejects(empty.listCommands(), { kind: 'auth' });
});

test('a 429 holds every request until its Retry-After (30 s at least)', async () => {
  const { api, fake, clock } = client();
  fake.state.failNext = { status: 429 };
  await assert.rejects(api.listCommands(), { kind: 'rate_limit', retryAfter: 30 });
  const before = fake.calls.length;
  await assert.rejects(api.listCommands(), { kind: 'rate_limit' });
  assert.equal(fake.calls.length, before, 'no request while paused');
  assert.ok(api.pausedUntil() > 0);
  clock.now += 31 * 1000;
  await api.listCommands();
  assert.equal(api.pausedUntil(), 0);
  assert.equal(retryAfterSeconds('120', NOW), 120);
  assert.equal(retryAfterSeconds(new Date(NOW + 60000).toUTCString(), NOW), 60);
  assert.equal(retryAfterSeconds('', NOW), null);
});

test('parseComputers: grouped and sorted, populated or not, duplicates and empty names dropped', () => {
  const records = [
    { id: '2', name: 'Zoom', computer: { id: 'b', name: 'Bureau' }, allowParams: 'true' },
    { id: '1', name: 'alarm', computer: { id: 'b', name: 'Bureau' } },
    { id: '3', name: 'alarm', computer: { id: 'b', name: 'Bureau' } },
    { id: '4', name: ' ', computer: { id: 'b', name: 'Bureau' } },
    { id: '5', name: 'Reboot', computer: 'a' },
    { id: '6', name: 'Orphan', computer: 'unknown' },
    { _id: '7', trigger: 'Old style', computer: { _id: 'a', name: 'Atelier' } },
  ];
  const list = parseComputers(records, [{ id: 'a', name: 'Atelier' }]);
  assert.deepEqual(
    list.map((computer) => [computer.id, computer.name, computer.commands.map((c) => c.name)]),
    [
      ['a', 'Atelier', ['Old style', 'Reboot']],
      ['b', 'Bureau', ['alarm', 'Zoom']],
    ],
  );
  const zoom = list[1].commands[1];
  assert.equal(zoom.allowParams, true);
  assert.equal(zoom.key, commandKey('Zoom'));
  assert.equal(list[1].commands[0].id, '1', 'the first copy is kept');
  assert.deepEqual(parseComputers(null), []);
  const many = Array.from({ length: MAX_COMMANDS + 5 }, (_, i) => ({
    name: `c${i}`,
    computer: { id: 'x', name: 'X' },
  }));
  assert.equal(parseComputers(many)[0].commands.length, MAX_COMMANDS);
});

test('the key of a command is stable and comes from its name only', () => {
  assert.equal(commandKey('Lock screen'), commandKey('Lock screen'));
  assert.notEqual(commandKey('Lock screen'), commandKey('lock screen'));
  assert.match(commandKey('Volume'), /^cmd_[0-9a-f]{12}$/);
  assert.deepEqual(parseExternalId(`ext:x:computer:abc:${commandKey('Volume')}`), {
    computerId: 'abc',
    key: commandKey('Volume'),
  });
  assert.deepEqual(parseExternalId('ext:x:computer:abc'), { computerId: 'abc', key: null });
  assert.equal(parseExternalId('ext:x:plant:1'), null);
});

test('findCommand ignores case and accents', () => {
  const list = parseComputers([{ name: 'Écran', computer: { id: 'a', name: 'Salon' } }]);
  assert.equal(findCommand(list, 'SALON', 'ecran').command?.name, 'Écran');
  assert.equal(findCommand(list, 'Salon', 'Autre').command, null);
  assert.equal(findCommand(list, 'Cuisine', 'Écran').computer, null);
});

test('the configuration: token without spaces, the Gladys computer, its command names', () => {
  assert.deepEqual(normalizeConfig(), {
    token: '',
    gladysComputer: false,
    computerName: 'Gladys',
    commands: [],
  });
  const config = normalizeConfig({
    token: ` ${TOKEN}\n`,
    gladys_computer: 'true',
    gladys_computer_name: '  Maison  ',
    gladys_commands: 'Movie, movie; Good   night\nWake up,,',
  });
  assert.equal(config.token, TOKEN);
  assert.equal(config.gladysComputer, true);
  assert.equal(config.computerName, 'Maison');
  assert.deepEqual(config.commands, ['Movie', 'Good night', 'Wake up']);
  assert.equal(
    parseCommandNames(Array.from({ length: 60 }, (_, i) => `c${i}`).join(',')).length,
    50,
  );
});

test('the socket URL: Engine.IO 3 over a WebSocket, with the query of the Sails client', () => {
  const url = new URL(socketUrl('https://www.triggercmd.com'));
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.pathname, '/socket.io/');
  assert.equal(url.searchParams.get('EIO'), '3');
  assert.equal(url.searchParams.get('transport'), 'websocket');
  assert.equal(url.searchParams.get('__sails_io_sdk_version'), '0.11.0');
});

test('the state of a parameter, and the reason of a failure', () => {
  assert.equal(stateOf(' ON '), 'on');
  assert.equal(stateOf('off'), 'off');
  assert.equal(stateOf('50'), '');
  assert.equal(failureReason({ kind: 'auth' }), 'token');
  assert.equal(failureReason({ kind: 'not_found' }), 'unknown_command');
  assert.equal(failureReason({ kind: 'subscribe' }), 'subscription');
  assert.equal(failureReason({ kind: 'server' }), 'error');
});
