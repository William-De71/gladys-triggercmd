// -----------------------------------------------------------------------------
// Dashboard widget of the TRIGGERcmd integration.
//
//   - `commands`  the computers of the account (all, or the one of the
//                 setting): how many computers and commands, the state of the
//                 Gladys computer when it is enabled, the last runs (sent by
//                 Gladys or received by the Gladys computer, with who sent
//                 them), and a "Run a command" button whose form lists the
//                 commands, with their parameters.
// Every text exists in the four languages (the content is cached per
// language). Content budget of a card: 8 components, 1 main one, 6 tiles,
// 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, all, ago } from './i18n.js';
import { formatTime } from './time.js';

const WIDGETS = { COMMANDS: 'commands' };
const WIDGET_ACTIONS = { RUN: 'run', REFRESH: 'refresh' };
const TTL_SECONDS = { commands: 300, message: 120 };
const MAX_CARDS = 6;
// The options of the form: the first commands, in the order of the list.
const MAX_OPTIONS = 40;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description The same text in the four languages.
 * @param {string} value - The text.
 * @returns {object} `{ en, fr, de, es }`.
 */
const same = (value) => all(() => value);

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description The value of the form option of a command.
 * @param {object} computer - The computer.
 * @param {object} command - The command.
 * @returns {string} `<computer id>|<command key>`.
 */
const optionValue = (computer, command) => `${computer.id}|${command.key}`;

/**
 * @description The computer and command of a form value.
 * @param {unknown} value - `<computer id>|<command key>`.
 * @returns {{ computerId: string, key: string }|null} Null when unreadable.
 */
function parseOptionValue(value) {
  const match = String(value ?? '').match(/^([^|]+)\|(cmd_[0-9a-f]{12})$/);
  return match ? { computerId: match[1], key: match[2] } : null;
}

/**
 * @description The "Run a command" button, with its form.
 * @param {object[]} computers - The computers shown.
 * @returns {object|null} The button, null without any command.
 */
function runButton(computers) {
  const several = computers.length > 1;
  const options = computers
    .flatMap((computer) =>
      computer.commands.map((command) => ({
        value: optionValue(computer, command),
        label: same(clip(several ? `${computer.name} › ${command.name}` : command.name, 40)),
      })),
    )
    .slice(0, MAX_OPTIONS);
  if (!options.length) {
    return null;
  }
  return {
    type: 'button',
    label: all((language) => clip(t('buttonRun', language), 24)),
    icon: 'play',
    style: 'primary',
    action: {
      key: WIDGET_ACTIONS.RUN,
      fields: [
        {
          key: 'command',
          type: 'select',
          required: true,
          label: all((language) => clip(t('fieldCommand', language), 40)),
          options,
          default: options[0].value,
        },
        {
          key: 'parameters',
          type: 'string',
          label: all((language) => clip(t('fieldParameters', language), 40)),
          description: all((language) => clip(t('fieldParametersHelp', language), 200)),
          placeholder: all((language) => clip(t('fieldParametersPlaceholder', language), 40)),
        },
      ],
    },
  };
}

/**
 * @description The card of a run.
 * @param {object} run - A run of the history (store.addRun()).
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object} A card-list item.
 */
function runCard(run, { language, now, timeZone }) {
  const time = formatTime(run.at, { language, timeZone, now });
  const parts = [run.computer, time];
  let badge;
  if (run.direction === 'received') {
    badge = { text: t('badgeReceived', language), color: WIDGET_COLORS.INFO };
    if (run.sender) {
      parts.splice(1, 0, t('cardFrom', language, { sender: run.sender }));
    }
  } else if (run.ok) {
    badge = { text: t('badgeSent', language), color: WIDGET_COLORS.SUCCESS };
  } else {
    badge = { text: t('badgeFailed', language), color: WIDGET_COLORS.DANGER };
  }
  const card = {
    title: clip(run.params ? `${run.command} (${run.params})` : run.command, 60),
    subtitle: clip(parts.filter(Boolean).join(' · '), 60),
    badge: { text: clip(badge.text, 16), color: badge.color },
  };
  const details = [
    t('cardAgo', language, { ago: ago(run.at, now, language) }),
    run.message ? clip(run.message, 300) : '',
  ].filter(Boolean);
  card.description = clip(details.join('\n'), 2000);
  return card;
}

/**
 * @description The state of the Gladys computer, as a status row.
 * @param {object} gladysComputer - `{ name, state }` (`listening`,
 * `connecting`, `subscription`, `refused`, `failed`, `waiting`).
 * @param {string} language - The language.
 * @returns {object} The row.
 */
function gladysRow(gladysComputer, language) {
  const colors = {
    listening: WIDGET_COLORS.SUCCESS,
    connecting: WIDGET_COLORS.INFO,
    waiting: WIDGET_COLORS.INFO,
    subscription: WIDGET_COLORS.WARNING,
  };
  return {
    label: clip(t('rowGladysComputer', language, { name: gladysComputer.name }), 40),
    value: clip(t(`gladys_${gladysComputer.state}`, language), 40),
    color: colors[gladysComputer.state] ?? WIDGET_COLORS.DANGER,
  };
}

/**
 * @description The "commands" widget.
 * @param {object} options - Options.
 * @param {object[]} options.computers - The computers shown (parseComputers()).
 * @param {object[]} options.history - The runs, newest first.
 * @param {object|null} options.gladysComputer - `{ name, state }` when enabled.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildCommandsWidget({ computers, history, gladysComputer, language, now, timeZone }) {
  const commandCount = computers.reduce((sum, computer) => sum + computer.commands.length, 0);
  const components = [
    {
      type: 'value',
      label: clip(t(computers.length === 1 ? 'tileComputer' : 'tileComputers', language), 24),
      value: computers.length === 1 ? clip(computers[0].name, 12) : computers.length,
      icon: 'monitor',
      color: computers.length ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: clip(t('tileCommands', language), 24),
      value: commandCount,
      icon: 'terminal',
      color: commandCount ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (gladysComputer) {
    components.push({ type: 'status', items: [gladysRow(gladysComputer, language)] });
  }
  const runs = history.slice(0, MAX_CARDS);
  if (runs.length) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: runs.map((run) => runCard(run, { language, now, timeZone })),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(t(commandCount ? 'widgetNoRun' : 'widgetNoCommand', language), 300),
    });
  }
  const button = runButton(computers);
  if (button) {
    components.push(button);
  }
  components.push({
    type: 'button',
    label: all((lang) => clip(t('buttonRefresh', lang), 24)),
    icon: 'refresh-cw',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { ttl_seconds: TTL_SECONDS.commands, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  TTL_SECONDS,
  MAX_CARDS,
  MAX_OPTIONS,
  clip,
  messageContent,
  optionValue,
  parseOptionValue,
  buildCommandsWidget,
};
