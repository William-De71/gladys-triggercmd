// -----------------------------------------------------------------------------
// The computers of a TRIGGERcmd account and their commands: the answers of
// the API made safe, and the Gladys devices built from them.
//
// One device per computer (its id in TRIGGERcmd, stable as long as the agent
// keeps it), one feature per command:
//   - a command without parameters is a push button (button / push): pressing
//     it runs the command;
//   - a command that accepts parameters is a switch (switch / binary), like in
//     Home Assistant: on runs it with the parameter "on", off with "off" (the
//     "Off Command" of the agent). TRIGGERcmd never says whether the command
//     is on: the switch shows what Gladys last sent.
// A feature is keyed by a hash of the command name: the agent of TRIGGERcmd
// deletes and re-adds a command when it is edited (its id changes), and runs
// it by its name.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

const COMPUTER_TYPE = 'computer';
const MAX_COMMANDS = 100;
const MAX_NAME = 100;

/**
 * @description A trimmed string, '' when not a string.
 * @param {unknown} value - The value.
 * @returns {string} The string.
 */
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @description The id of a record (`id`, else `_id`).
 * @param {object} record - The record.
 * @returns {string} The id, '' when none.
 */
const idOf = (record) => text(record?.id) || text(record?._id);

/**
 * @description The key of the feature of a command: a hash of its name.
 * @param {string} name - The name of the command.
 * @returns {string} `cmd_` and 12 hexadecimal characters.
 */
const commandKey = (name) =>
  `cmd_${createHash('sha256').update(String(name), 'utf8').digest('hex').slice(0, 12)}`;

/**
 * @description Group the commands of `command/list` by computer.
 * @param {object[]} records - The raw records of `command/list`.
 * @param {object[]} [computers] - The raw records of `computer/list`, for the
 * names of the computers a command only gives the id of.
 * @returns {object[]} `[{ id, name, commands: [{ id, name, key, allowParams, voice }] }]`,
 * sorted by name.
 */
function parseComputers(records, computers = []) {
  const names = new Map(
    (Array.isArray(computers) ? computers : [])
      .filter((computer) => idOf(computer) && text(computer.name))
      .map((computer) => [idOf(computer), text(computer.name)]),
  );
  const byId = new Map();
  for (const computer of Array.isArray(computers) ? computers : []) {
    const id = idOf(computer);
    if (id && text(computer.name) && !byId.has(id)) {
      byId.set(id, { id, name: text(computer.name).slice(0, MAX_NAME), commands: [] });
    }
  }
  for (const record of Array.isArray(records) ? records : []) {
    const name = text(record?.name) || text(record?.trigger);
    const owner = record?.computer;
    const computerId = typeof owner === 'string' ? text(owner) : idOf(owner);
    const computerName = (typeof owner === 'object' && text(owner?.name)) || names.get(computerId);
    if (!name || !computerId || !computerName) {
      continue;
    }
    if (!byId.has(computerId)) {
      byId.set(computerId, {
        id: computerId,
        name: computerName.slice(0, MAX_NAME),
        commands: [],
      });
    }
    const computer = byId.get(computerId);
    // The agent can leave the same name twice for a while (its sync adds before
    // the server deletes the old copy): the first one is enough.
    if (computer.commands.some((command) => command.name === name)) {
      continue;
    }
    computer.commands.push({
      id: idOf(record),
      name,
      key: commandKey(name),
      allowParams: record.allowParams === true || record.allowParams === 'true',
      voice: text(record.voice),
    });
  }
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  return [...byId.values()]
    .map((computer) => ({
      ...computer,
      commands: computer.commands
        .sort((a, b) => collator.compare(a.name, b.name))
        .slice(0, MAX_COMMANDS),
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * @description The external ids of a computer.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} id - The id of the computer in TRIGGERcmd.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const computerIds = (gladys, id) => gladys.externalIds(COMPUTER_TYPE, String(id));

/**
 * @description The id of the computer and the key of the command of a feature
 * (or device) external id.
 * @param {unknown} externalId - `ext:triggercmd:computer:<id>:cmd_<hash>`.
 * @returns {{ computerId: string, key: string|null }|null} Null when not one of ours.
 */
function parseExternalId(externalId) {
  const match = String(externalId ?? '').match(/:computer:([^:]+)(?::(cmd_[0-9a-f]{12}))?$/);
  return match ? { computerId: match[1], key: match[2] ?? null } : null;
}

/**
 * @description The feature of a command.
 * @param {object} ids - The external ids of its computer.
 * @param {object} command - parseComputers() command.
 * @returns {object} The feature.
 */
function buildCommandFeature(ids, command) {
  const toggle = command.allowParams;
  return {
    name: command.name.slice(0, MAX_NAME),
    external_id: ids.feature(command.key),
    category: toggle ? DEVICE_FEATURE_CATEGORIES.SWITCH : DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: toggle ? DEVICE_FEATURE_TYPES.SWITCH.BINARY : DEVICE_FEATURE_TYPES.BUTTON.PUSH,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: toggle,
  };
}

/**
 * @description The device of a computer.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} computer - parseComputers() computer.
 * @returns {object} The discovered device.
 */
function buildComputerDevice(gladys, computer) {
  const ids = computerIds(gladys, computer.id);
  return {
    name: computer.name,
    external_id: ids.device,
    model: 'TRIGGERcmd',
    should_poll: false,
    params: [{ name: 'TRIGGERCMD_COMPUTER_ID', value: computer.id }],
    features: computer.commands.map((command) => buildCommandFeature(ids, command)),
  };
}

/**
 * @description Find a command by the names a user typed (case and accents ignored).
 * @param {object[]} computers - parseComputers().
 * @param {string} computerName - The computer.
 * @param {string} commandName - The command.
 * @returns {{ computer: object|null, command: object|null }} What was found.
 */
function findCommand(computers, computerName, commandName) {
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const same = (a, b) => collator.compare(text(a), text(b)) === 0;
  const computer = computers.find((entry) => same(entry.name, computerName)) ?? null;
  const command = computer?.commands.find((entry) => same(entry.name, commandName)) ?? null;
  return { computer, command };
}

export {
  COMPUTER_TYPE,
  MAX_COMMANDS,
  commandKey,
  parseComputers,
  computerIds,
  parseExternalId,
  buildComputerDevice,
  findCommand,
};
