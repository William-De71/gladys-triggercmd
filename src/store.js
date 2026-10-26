// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/triggercmd.json (mode 0600):
//
//   - `account`        a short SHA-256 of the user id of the token (never the
//                      token): what was read belongs to this account;
//   - `computers`      the computers and their commands (parseComputers()),
//                      and when they were read (`listAt`): the scene actions
//                      and the widget work at once after a restart;
//   - `gladys`         the Gladys computer created in TRIGGERcmd:
//                      `{ id, name }`, or null;
//   - `history`        the last runs (sent by Gladys or received by the Gladys
//                      computer), newest first, for the widget;
//   - `accessRefused`  why TRIGGERcmd refuses the token, or null (the trigger
//                      fires once per refusal);
//   - `lastError`      the last error (diagnostic).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'triggercmd.json';
const MAX_HISTORY = 20;
const EMPTY = () => ({
  account: null,
  computers: [],
  listAt: 0,
  gladys: null,
  history: [],
  accessRefused: null,
  lastError: null,
});

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a
 * rename), readable by its owner only.
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value !== '';

/**
 * @description A computer read back from the file, or null.
 * @param {unknown} raw - The value.
 * @returns {object|null} The computer.
 */
function readComputer(raw) {
  if (!isObject(raw) || !isText(raw.id) || !isText(raw.name) || !Array.isArray(raw.commands)) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    commands: raw.commands
      .filter((command) => isObject(command) && isText(command.name) && isText(command.key))
      .map((command) => ({
        id: typeof command.id === 'string' ? command.id : '',
        name: command.name,
        key: command.key,
        allowParams: command.allowParams === true,
        voice: typeof command.voice === 'string' ? command.voice : '',
      })),
  };
}

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save, addRun, path }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    path,
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      store.data.account = isText(raw.account) ? raw.account : null;
      store.data.computers = Array.isArray(raw.computers)
        ? raw.computers.map(readComputer).filter(Boolean)
        : [];
      store.data.listAt = Number.isFinite(raw.listAt) ? raw.listAt : 0;
      store.data.gladys =
        isObject(raw.gladys) && isText(raw.gladys.id) && isText(raw.gladys.name)
          ? { id: raw.gladys.id, name: raw.gladys.name }
          : null;
      store.data.history = Array.isArray(raw.history)
        ? raw.history
            .filter((run) => isObject(run) && Number.isFinite(run.at) && isText(run.command))
            .slice(0, MAX_HISTORY)
        : [];
      store.data.accessRefused = isObject(raw.accessRefused) ? raw.accessRefused : null;
      store.data.lastError = isObject(raw.lastError) ? raw.lastError : null;
    },
    /**
     * @description Remember a run, newest first.
     * @param {object} run - `{ at, direction ('sent' | 'received'), computer,
     * command, params, ok, sender, message }`.
     */
    addRun(run) {
      store.data.history = [run, ...store.data.history].slice(0, MAX_HISTORY);
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, MAX_HISTORY, createStore };
