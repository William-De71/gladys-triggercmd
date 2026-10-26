import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  buildCommandsWidget,
  messageContent,
  optionValue,
  parseOptionValue,
  MAX_CARDS,
  MAX_OPTIONS,
} from '../src/widgets.js';
import { parseComputers, commandKey } from '../src/computers.js';
import { LANGUAGES } from '../src/i18n.js';

const NOW = Date.parse('2026-10-26T10:00:00Z');
const MINUTE = 60 * 1000;
const OPTIONS = { now: NOW, timeZone: 'Europe/Paris' };
const computers = parseComputers([
  { name: 'Lock screen', computer: { id: 'a', name: 'Office PC' } },
  { name: 'Volume', allowParams: true, computer: { id: 'a', name: 'Office PC' } },
  { name: 'Reboot', computer: { id: 'b', name: 'Raspberry' } },
]);
const history = [
  {
    at: NOW - 2 * MINUTE,
    direction: 'received',
    computer: 'Gladys',
    command: 'Movie',
    params: 'on',
    sender: 'Alexa',
    ok: true,
    message: '',
  },
  {
    at: NOW - 5 * MINUTE,
    direction: 'sent',
    computer: 'Office PC',
    command: 'Volume',
    params: '30',
    sender: '',
    ok: true,
    message: 'Command triggered',
  },
  {
    at: NOW - 26 * 60 * MINUTE,
    direction: 'sent',
    computer: 'Raspberry',
    command: 'Reboot',
    params: '',
    sender: '',
    ok: false,
    message: 'TRIGGERcmd asked to wait (429)',
  },
];
const count = (content, type) => content.components.filter((c) => c.type === type).length;

/**
 * @description Check a content against the core rules (what the core would drop).
 * @param {object} content - The content.
 * @param {string} label - For the messages.
 */
function valid(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], label);
  assert.ok(content.components.length <= 8, label);
  assert.ok(content.ttl_seconds >= 10 && content.ttl_seconds <= 3600, label);
  const main = content.components.filter((c) => ['chart', 'card-list', 'image'].includes(c.type));
  assert.ok(main.length <= 1, label);
  assert.ok(count(content, 'value') + count(content, 'gauge') <= 6, label);
  assert.ok(count(content, 'status') <= 1, label);
  assert.ok(count(content, 'button') <= 4, label);
}

test('commands: tiles, runs, the form and the Gladys computer, in every language', () => {
  for (const language of LANGUAGES) {
    for (const state of [
      'listening',
      'subscription',
      'failed',
      'waiting',
      'refused',
      'connecting',
    ]) {
      const content = buildCommandsWidget({
        computers,
        history,
        gladysComputer: { name: 'Gladys', state },
        language,
        ...OPTIONS,
      });
      valid(content, `${language} ${state}`);
    }
  }
  const content = buildCommandsWidget({
    computers,
    history,
    gladysComputer: { name: 'Gladys', state: 'listening' },
    language: 'fr',
    ...OPTIONS,
  });
  const tiles = content.components.filter((c) => c.type === 'value').map((c) => c.value);
  assert.deepEqual(tiles, [2, 3]);
  const [status] = content.components.filter((c) => c.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'Ordinateur « Gladys »',
    value: 'À l’écoute',
    color: 'success',
  });
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.text]),
    [
      ['Movie (on)', 'Reçue'],
      ['Volume (30)', 'Envoyée'],
      ['Reboot', 'Échec'],
    ],
  );
  assert.equal(list.items[0].subtitle, 'Gladys · de Alexa · 10:58');
  // The day before, in summer time (09:00 in Paris).
  assert.equal(list.items[2].subtitle, 'Raspberry · dim. 25 09:00');
  const form = content.components.find((c) => c.action?.key === 'run');
  assert.deepEqual(
    form.action.fields[0].options.map((option) => option.label.fr),
    ['Office PC › Lock screen', 'Office PC › Volume', 'Raspberry › Reboot'],
  );
  assert.equal(form.action.fields[0].default, form.action.fields[0].options[0].value);
});

test('one computer: its name as a tile, the command names alone in the form', () => {
  const content = buildCommandsWidget({
    computers: computers.slice(1),
    history: [],
    gladysComputer: null,
    language: 'en',
    ...OPTIONS,
  });
  valid(content, 'one');
  assert.equal(content.components[0].label, 'Computer');
  assert.equal(content.components[0].value, 'Raspberry');
  assert.equal(count(content, 'status'), 0);
  assert.match(content.components.find((c) => c.type === 'text').text, /No command run yet/);
  const form = content.components.find((c) => c.action?.key === 'run');
  assert.deepEqual(
    form.action.fields[0].options.map((option) => option.label.en),
    ['Reboot'],
  );
});

test('no command at all: no form, a hint; long lists are bounded', () => {
  const empty = buildCommandsWidget({
    computers: [],
    history: [],
    gladysComputer: null,
    language: 'de',
    ...OPTIONS,
  });
  valid(empty, 'empty');
  assert.ok(!empty.components.some((c) => c.action?.key === 'run'));
  const many = parseComputers(
    Array.from({ length: 60 }, (_, i) => ({
      name: `A very long command name number ${i} that goes on`,
      computer: { id: 'a', name: 'A computer with a long name' },
    })),
  );
  const runs = Array.from({ length: 20 }, () => ({ ...history[1], command: 'x'.repeat(200) }));
  const content = buildCommandsWidget({
    computers: many,
    history: runs,
    gladysComputer: null,
    language: 'es',
    ...OPTIONS,
  });
  valid(content, 'many');
  const form = content.components.find((c) => c.action?.key === 'run');
  assert.equal(form.action.fields[0].options.length, MAX_OPTIONS);
  assert.equal(content.components.find((c) => c.type === 'card-list').items.length, MAX_CARDS);
});

test('the form value of a command', () => {
  const value = optionValue({ id: 'abc' }, { key: commandKey('Volume') });
  assert.deepEqual(parseOptionValue(value), { computerId: 'abc', key: commandKey('Volume') });
  assert.equal(parseOptionValue('abc|nope'), null);
  assert.equal(parseOptionValue(undefined), null);
});

test('a message content is valid', () => {
  valid(messageContent('Hello', { heading: 'Title' }), 'message');
});
