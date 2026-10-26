// -----------------------------------------------------------------------------
// The TRIGGERcmd integration: every handler, registered on a Gladys client.
//
// Runs the TRIGGERcmd commands of the computers of an account (Windows, Mac,
// Linux, Raspberry Pi with the TRIGGERcmd agent) from Gladys, through the
// TRIGGERcmd API and the token of the account:
//   - devices (computers.js): one per computer, one feature per command (a
//     push button, or an on/off switch for a command with parameters);
//   - scene actions: run a command (with parameters), read the commands again;
//   - scene triggers: a command of the Gladys computer was run (Alexa, Google
//     Assistant, panels…), a command Gladys sent was refused, access refused;
//   - dashboard widget (widgets.js): the last runs and a "Run a command" form;
//   - configuration buttons: test the connection, diagnostic;
//   - the optional "Gladys" computer (gladys-computer.js): Gladys shows up in
//     TRIGGERcmd, and its commands start Gladys scenes, in real time.
//
// The commands are read at startup, every 15 minutes, and on demand (scan,
// refresh, an unknown command asked by a scene). index.js only creates the
// SDK client; the tests drive this module with the fake Gladys of the SDK and
// a fake TRIGGERcmd (test/helpers/fake-triggercmd.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { createTriggercmdClient, tokenUserId } from './triggercmd-api.js';
import { createStore } from './store.js';
import {
  parseComputers,
  computerIds,
  parseExternalId,
  buildComputerDevice,
  findCommand,
} from './computers.js';
import { ensureComputer, syncCommands, createListener } from './gladys-computer.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  RUN_OUTPUTS,
  REFRESH_OUTPUTS,
  pick,
  receivedData,
  failureReason,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  messageContent,
  parseOptionValue,
  buildCommandsWidget,
} from './widgets.js';
import { MINUTE_MS, HOUR_MS, defaultTimeZone, usableTimeZone } from './time.js';
import { t, all } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
};
const TICK_MS = 30 * 1000;
const STARTUP_DELAY_MS = 5 * 1000;
const LIST_EVERY_MS = 15 * MINUTE_MS;
const LIST_RETRY_MS = 2 * MINUTE_MS;
const ACCESS_RETRY_MS = 30 * MINUTE_MS;
// The Gladys computer: a failure is tried again later; a plan without room
// for a second computer much later (or when the configuration changes).
const GLADYS_RETRY_MS = 10 * MINUTE_MS;
const GLADYS_SUBSCRIBE_RETRY_MS = 6 * HOUR_MS;
// A manual refresh (button, scene action) at most once every 10 seconds.
const MANUAL_EVERY_MS = 10 * 1000;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-triggercmd/${VERSION} (+https://github.com/William-De71/gladys-triggercmd)`;

/**
 * @description A short fingerprint (16 hexadecimal characters).
 * @param {string} value - The value.
 * @returns {string|null} The fingerprint.
 */
const fingerprint = (value) =>
  value ? createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16) : null;

/**
 * @description The account a token belongs to: a fingerprint of its user id
 * (of the token itself when it is not a JWT).
 * @param {string} token - The token.
 * @returns {string|null} The fingerprint.
 */
const accountOf = (token) => fingerprint(tokenUserId(token) ?? token);

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of TRIGGERcmd (tests).
 * @param {Function} [options.WebSocket] - WebSocket class of the Gladys computer (tests).
 * @param {object} [options.socketTiming] - Delays of its socket (tests).
 * @param {string} [options.baseUrl] - The site root (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the timer (false in tests).
 * @param {number} [options.spacingMs] - Time between two requests (0 in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    WebSocket: WebSocketClass,
    socketTiming,
    baseUrl,
    dataDir,
    now = () => Date.now(),
    timeZone: zone = defaultTimeZone(),
    timers = true,
    spacingMs,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let createdDevices = new Set();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastListTry = 0;
  let lastManual = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;
  // The Gladys computer: its state, and when to try again.
  let gladysState = 'off';
  let gladysDetail = '';
  let gladysRetryAt = 0;
  let gladysSetup = null;
  // The last value sent to each switch (TRIGGERcmd never tells it back).
  const switchStates = new Map();

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const api = createTriggercmdClient({
    getToken: () => config.token,
    userAgent: USER_AGENT,
    now,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(spacingMs) ? { spacingMs } : {}),
  });
  const listener = createListener({
    getToken: () => config.token,
    userAgent: USER_AGENT,
    onCommand: (event) => {
      received(event).catch((err) => logger.error('Received command', err));
    },
    onState: (state, detail) => {
      gladysState = state === 'closed' ? gladysState : state;
      gladysDetail = detail;
      if (state === 'refused') {
        gladysRetryAt = now() + ACCESS_RETRY_MS;
      } else if (state === 'failed') {
        logger.warn(`Gladys computer: ${detail}`);
      }
      refreshStatus().catch(() => {});
      refreshWidgets();
    },
    ...(WebSocketClass ? { WebSocket: WebSocketClass } : {}),
    ...(socketTiming ? { timing: socketTiming } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });

  const hasToken = () => Boolean(config.token);

  /**
   * @description The computers offered as devices: every computer with a
   * command, except the Gladys computer (its commands start Gladys scenes).
   * @returns {object[]} parseComputers() computers.
   */
  const computers = () =>
    store.data.computers.filter(
      (computer) => computer.commands.length > 0 && computer.id !== store.data.gladys?.id,
    );

  /**
   * @description The text of an error, in a language.
   * @param {object} err - A TriggercmdError (or `{ kind }`).
   * @param {string} lang - The language.
   * @returns {string} The text.
   */
  function errorText(err, lang) {
    const key = {
      auth: 'errAuth',
      subscribe: 'errSubscribe',
      not_found: 'errNotFound',
      rate_limit: 'errRateLimit',
      unreachable: 'errUnreachable',
      server: 'errServer',
      unknown_command: 'errUnknownCommand',
      gladys_computer: 'errGladysComputer',
    }[err?.kind];
    if (key) {
      return t(key, lang, { computer: err.computer ?? '', command: err.command ?? '' });
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  // --- Status ------------------------------------------------------------------------

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!hasToken()) {
      await reportStatus(false, all('statusNoToken'));
      return;
    }
    if (store.data.accessRefused) {
      await reportStatus(false, all('statusRefused'));
      return;
    }
    if (!store.data.listAt) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    const list = computers();
    const commands = list.reduce((sum, computer) => sum + computer.commands.length, 0);
    await reportStatus(
      true,
      all((lang) =>
        [
          t(list.length ? 'statusOk' : 'statusNoComputer', lang, {
            computers: list.length,
            commands,
          }),
          ...(config.gladysComputer
            ? [t(`statusGladys_${gladysState}`, lang, { name: config.computerName })]
            : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Fire a scene event.
   * @param {string} key - The trigger.
   * @param {object} data - Its flat data.
   * @returns {Promise<void>}
   */
  async function fire(key, data) {
    logger.info(`TRIGGERcmd: ${key}`);
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Unable to fire ${key}: ${err.message}`);
    }
  }

  // --- Access ------------------------------------------------------------------------

  /**
   * @description Remember that TRIGGERcmd refuses the token (the trigger fires
   * once per refusal).
   * @param {object} err - The TriggercmdError.
   * @returns {Promise<void>}
   */
  async function refused(err) {
    const first = !store.data.accessRefused;
    store.data.accessRefused = { at: now(), message: String(err.message).slice(0, 200) };
    if (first) {
      await fire(TRIGGERS.ACCESS_REFUSED, { message: store.data.accessRefused.message });
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of the computers, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const devices = computers().map((computer) => buildComputerDevice(gladys, computer));
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Send the last value of the switches again (a device just created).
   * @returns {Promise<void>}
   */
  async function publishSwitchStates() {
    const states = [...switchStates.entries()]
      .filter(([id]) => createdDevices.has(id.slice(0, id.lastIndexOf(':'))))
      .map(([id, state]) => ({ device_feature_external_id: id, state }));
    if (states.length) {
      await gladys.publishChangedStates(states);
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Read the computers and their commands.
   * @returns {Promise<{ error: object|null }>} The error, if any.
   */
  async function readList() {
    lastListTry = now();
    try {
      const records = await api.listCommands();
      // A command whose computer is not populated gives its id only: the
      // names come from the computer list.
      const needNames = records.some((record) => typeof record?.computer === 'string');
      const list = parseComputers(records, needNames ? await api.listComputers() : []);
      const account = accountOf(config.token);
      if (store.data.account && store.data.account !== account) {
        store.data.history = [];
        store.data.gladys = null;
      }
      store.data.account = account;
      store.data.computers = list;
      store.data.listAt = now();
      store.data.accessRefused = null;
      store.data.lastError = null;
      await store.save();
      await publishDiscoveredDevices();
      refreshWidgets();
      return { error: null };
    } catch (err) {
      logger.warn(`Unable to read the commands: ${err.message}`);
      store.data.lastError = { at: now(), kind: err.kind ?? 'failed', message: err.message };
      if (err.kind === 'auth') {
        await refused(err);
      }
      await store.save();
      return { error: err };
    } finally {
      await refreshStatus();
    }
  }

  /**
   * @description Whether the list is due.
   * @returns {boolean} True when it should be read now.
   */
  function listDue() {
    if (!hasToken()) {
      return false;
    }
    if (store.data.accessRefused) {
      return now() - lastListTry >= ACCESS_RETRY_MS;
    }
    if (store.data.lastError && now() - lastListTry < LIST_RETRY_MS) {
      return false;
    }
    return !store.data.listAt || now() - store.data.listAt >= LIST_EVERY_MS;
  }

  /**
   * @description One round of the timer: the list when due, the Gladys computer.
   * @returns {Promise<void>}
   */
  function tick() {
    if (stopped) {
      return Promise.resolve();
    }
    if (!running) {
      running = (async () => {
        if (listDue()) {
          await readList();
        }
        if (config.gladysComputer && !gladysSetup && gladysRetryAt && now() >= gladysRetryAt) {
          await setupGladysComputer();
        }
      })()
        .catch((err) => logger.error('Reading', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description Arm the timer.
   */
  function schedule() {
    if (!timers || stopped) {
      return;
    }
    clearInterval(timer);
    clearTimeout(startTimer);
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
  }

  /**
   * @description Read the list now, at most once every 10 seconds.
   * @returns {Promise<{ error: object|null }>} The error, if any.
   */
  async function manualRefresh() {
    if (now() - lastManual < MANUAL_EVERY_MS) {
      return { error: null };
    }
    lastManual = now();
    await running;
    return readList();
  }

  // --- Running a command -------------------------------------------------------------

  /**
   * @description Run a command, and remember the run.
   * @param {object} computer - The computer.
   * @param {object} command - The command.
   * @param {string} params - The parameters ('' for none).
   * @param {object} options - `{ notify }`: fire `run_failed` on a failure
   * (never for a scene action: it fails instead).
   * @returns {Promise<string>} The message of TRIGGERcmd.
   */
  async function runCommand(computer, command, params, { notify }) {
    const run = {
      at: now(),
      direction: 'sent',
      computer: computer.name,
      command: command.name,
      params,
      sender: '',
    };
    try {
      const message = await api.trigger({
        computer: computer.name,
        command: command.name,
        params,
      });
      store.addRun({ ...run, ok: true, message });
      logger.info(`Ran "${command.name}" on "${computer.name}"`);
      return message;
    } catch (err) {
      store.addRun({ ...run, ok: false, message: err.message });
      if (err.kind === 'auth') {
        await refused(err);
        lastStatus = null;
        await refreshStatus();
      }
      if (notify) {
        await fire(TRIGGERS.RUN_FAILED, {
          computer: computer.name,
          command: command.name,
          reason: failureReason(err),
          message: String(err.message).slice(0, 200),
        });
      }
      throw err;
    } finally {
      await store.save();
      refreshWidgets();
    }
  }

  /**
   * @description Find a command by its names, reading the list again once
   * when it is unknown (a command just added on the computer).
   * @param {string} computerName - The computer.
   * @param {string} commandName - The command.
   * @returns {Promise<{ computer: object, command: object }>} What was found.
   * @throws {Error} `{ kind: 'unknown_command' | 'gladys_computer' }`.
   */
  async function resolveCommand(computerName, commandName) {
    const gladysName = store.data.gladys?.name;
    if (gladysName && gladysName.toLowerCase() === String(computerName).trim().toLowerCase()) {
      throw Object.assign(new Error('The Gladys computer runs scenes: not from a scene'), {
        kind: 'gladys_computer',
      });
    }
    let found = findCommand(computers(), computerName, commandName);
    if (!found.command && now() - lastListTry >= MANUAL_EVERY_MS) {
      await readList();
      found = findCommand(computers(), computerName, commandName);
    }
    if (!found.command) {
      throw Object.assign(
        new Error(`Unknown command "${commandName}" on the computer "${computerName}"`),
        { kind: 'unknown_command', computer: computerName, command: commandName },
      );
    }
    return found;
  }

  // --- The Gladys computer -----------------------------------------------------------

  /**
   * @description A command of the Gladys computer was run in TRIGGERcmd.
   * @param {object} event - `{ trigger, id, params, sender }`.
   * @returns {Promise<void>}
   */
  async function received(event) {
    const computer = store.data.gladys;
    if (!computer || !event.trigger) {
      return;
    }
    store.addRun({
      at: now(),
      direction: 'received',
      computer: computer.name,
      command: event.trigger,
      params: event.params,
      sender: event.sender,
      ok: true,
      message: '',
    });
    await fire(TRIGGERS.COMMAND_RECEIVED, receivedData(event, computer.name));
    await store.save();
    refreshWidgets();
    if (event.id) {
      api
        .reportRun(computer.id, event.id)
        .catch((err) => logger.warn(`Unable to report the run: ${err.message}`));
    }
  }

  /**
   * @description Create (or find) the Gladys computer, align its commands,
   * listen to it; or stop listening when it is disabled.
   * @returns {Promise<void>}
   */
  function setupGladysComputer() {
    if (gladysSetup) {
      return gladysSetup;
    }
    gladysSetup = (async () => {
      if (!config.gladysComputer || !hasToken()) {
        listener.stop();
        gladysState = 'off';
        gladysRetryAt = 0;
        return;
      }
      gladysState = 'waiting';
      try {
        const kept =
          store.data.gladys && store.data.gladys.name === config.computerName
            ? store.data.gladys.id
            : null;
        const computer = await ensureComputer(api, { knownId: kept, name: config.computerName });
        store.data.gladys = { id: computer.id, name: computer.name };
        await store.save();
        if (computer.created) {
          logger.info(`Gladys computer "${computer.name}" created in TRIGGERcmd`);
        }
        const { added, removed } = await syncCommands(api, computer.id, config.commands);
        if (added.length || removed.length) {
          logger.info(
            `Gladys computer: ${added.length} command(s) added, ${removed.length} removed`,
          );
        }
        gladysRetryAt = 0;
        listener.start(computer.id);
        // The Gladys computer is not a device: offer the list without it.
        await publishDiscoveredDevices();
      } catch (err) {
        logger.warn(`Gladys computer: ${err.message}`);
        if (err.kind === 'subscribe') {
          gladysState = 'subscription';
          gladysRetryAt = now() + GLADYS_SUBSCRIBE_RETRY_MS;
        } else if (err.kind === 'auth') {
          gladysState = 'refused';
          gladysRetryAt = now() + ACCESS_RETRY_MS;
        } else {
          gladysState = 'failed';
          gladysDetail = err.message;
          gladysRetryAt = now() + GLADYS_RETRY_MS;
        }
      }
    })()
      .catch((err) => logger.error('Gladys computer', err))
      .finally(async () => {
        gladysSetup = null;
        await refreshStatus();
        refreshWidgets();
      });
    return gladysSetup;
  }

  // --- Widget ------------------------------------------------------------------------

  /**
   * @description The computers a widget shows: the one of its setting, else all.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object[]} The computers.
   */
  function widgetComputers(externalId) {
    const target = parseExternalId(externalId);
    const list = computers();
    const one = target ? list.find((computer) => computer.id === target.computerId) : null;
    return one ? [one] : list;
  }

  gladys.onWidgetGet(WIDGETS.COMMANDS, async ({ settings = {}, language: lang }) => {
    if (!hasToken()) {
      return messageContent(t('statusNoToken', lang));
    }
    if (store.data.accessRefused) {
      return messageContent(t('statusRefused', lang));
    }
    if (!store.data.listAt) {
      return messageContent(t('statusWaiting', lang));
    }
    const shown = widgetComputers(settings.computer);
    const names = new Set(shown.map((computer) => computer.name));
    const gladysName = store.data.gladys?.name;
    const history = store.data.history.filter(
      (run) =>
        names.has(run.computer) ||
        // The Gladys computer is not a device: its runs show on the widget of
        // every computer, as long as it is enabled.
        (config.gladysComputer && run.direction === 'received' && run.computer === gladysName),
    );
    return buildCommandsWidget({
      computers: shown,
      history,
      gladysComputer: config.gladysComputer
        ? { name: config.computerName, state: gladysState }
        : null,
      language: lang,
      now: now(),
      timeZone,
    });
  });

  gladys.onWidgetAction(WIDGETS.COMMANDS, async (actionKey, params, { values } = {}) => {
    if (actionKey === WIDGET_ACTIONS.REFRESH) {
      const { error } = await manualRefresh();
      if (error) {
        return all((lang) => errorText(error, lang));
      }
      const list = computers();
      return all('refreshDone', {
        computers: list.length,
        commands: list.reduce((sum, computer) => sum + computer.commands.length, 0),
      });
    }
    if (actionKey !== WIDGET_ACTIONS.RUN) {
      throw new Error(`Unknown action ${actionKey}`);
    }
    const target = parseOptionValue(values?.command);
    const computer = computers().find((entry) => entry.id === target?.computerId);
    const command = computer?.commands.find((entry) => entry.key === target?.key);
    if (!command) {
      return all('errCommandGone');
    }
    const parameters = String(values?.parameters ?? '')
      .trim()
      .slice(0, 1000);
    try {
      await runCommand(computer, command, parameters, { notify: true });
      return all('runSent', { command: command.name, computer: computer.name });
    } catch (err) {
      return all((lang) => errorText(err, lang));
    }
  });

  // --- Devices: commands -------------------------------------------------------------

  gladys.onSetValue(async (device, feature, value) => {
    const target = parseExternalId(feature?.external_id);
    const computer = computers().find((entry) => entry.id === target?.computerId);
    const command = computer?.commands.find((entry) => entry.key === target?.key);
    if (!command) {
      throw new Error(
        'Unknown command: it was removed from the computer, or the list is not read yet',
      );
    }
    const on = Number(value) >= 1;
    if (command.allowParams) {
      await runCommand(computer, command, on ? 'on' : 'off', { notify: true });
      const id = feature.external_id;
      switchStates.set(id, on ? 1 : 0);
      await gladys.publishChangedStates([{ device_feature_external_id: id, state: on ? 1 : 0 }]);
      return;
    }
    // A push button: pressing it runs the command.
    await runCommand(computer, command, '', { notify: true });
  });

  // --- Scene actions -----------------------------------------------------------------
  // They never fire a scene event: a failure fails the action.

  gladys.onSceneAction(SCENE_ACTIONS.RUN_COMMAND, async (fields = {}) => {
    if (!hasToken()) {
      throw new Error('No TRIGGERcmd token: open the configuration of the integration');
    }
    const { computer, command } = await resolveCommand(
      String(fields.computer ?? ''),
      String(fields.command ?? ''),
    );
    const parameters = String(fields.parameters ?? '')
      .trim()
      .slice(0, 1000);
    const message = await runCommand(computer, command, parameters, { notify: false });
    return pick({ computer: computer.name, command: command.name, message }, RUN_OUTPUTS);
  });

  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, async () => {
    if (!hasToken()) {
      throw new Error('No TRIGGERcmd token: open the configuration of the integration');
    }
    const { error } = await manualRefresh();
    if (error) {
      throw error;
    }
    const list = computers();
    return pick(
      {
        computer_count: list.length,
        command_count: list.reduce((sum, computer) => sum + computer.commands.length, 0),
      },
      REFRESH_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!hasToken()) {
      return all('statusNoToken');
    }
    store.data.accessRefused = null;
    lastStatus = null;
    const { error } = await readList();
    if (error) {
      return all((lang) => errorText(error, lang));
    }
    if (config.gladysComputer) {
      await setupGladysComputer();
    }
    const list = computers();
    const names = list
      .map((computer) => computer.name)
      .slice(0, 10)
      .join(', ');
    const commands = list.reduce((sum, computer) => sum + computer.commands.length, 0);
    return all((lang) =>
      [
        t(list.length ? 'testOk' : 'testNoComputer', lang, {
          computers: list.length,
          commands,
          names: names ? ` (${names})` : '',
        }),
        ...(config.gladysComputer
          ? [t(`statusGladys_${gladysState}`, lang, { name: config.computerName })]
          : []),
      ]
        .join(' ')
        .slice(0, 1000),
    );
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      token: config.token ? 'set' : 'missing',
      account: store.data.account,
      listAt: iso(store.data.listAt),
      accessRefused: store.data.accessRefused,
      lastError: store.data.lastError,
      api: { ...api.counts(), pausedUntil: iso(api.pausedUntil()) },
      gladysComputer: {
        enabled: config.gladysComputer,
        name: config.computerName,
        commands: config.commands,
        kept: store.data.gladys,
        state: gladysState,
        detail: gladysDetail,
        retryAt: iso(gladysRetryAt),
      },
      computers: store.data.computers.map((computer) => ({
        id: computer.id,
        name: computer.name,
        created: createdDevices.has(computerIds(gladys, computer.id).device),
        commands: computer.commands.map((command) => ({
          name: command.name,
          key: command.key,
          allowParams: command.allowParams,
        })),
      })),
      history: store.data.history.slice(0, 10).map((run) => ({ ...run, at: iso(run.at) })),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `TRIGGERcmd diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    if (hasToken()) {
      await manualRefresh();
    }
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send the switches again.
    await publishSwitchStates();
    refreshWidgets();
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the configuration.
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      config = normalizeConfig(await gladys.getConfig());
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  /**
   * @description Apply the configuration: the list now when it is due, the
   * Gladys computer, the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await refreshStatus();
    if (listDue()) {
      await readList();
    }
    await setupGladysComputer();
    schedule();
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    if (previous.token !== config.token) {
      // Another token: the list is read again; another account forgets what
      // was read (readList()).
      store.data.accessRefused = null;
      store.data.listAt = 0;
      store.data.lastError = null;
      lastListTry = 0;
    }
    gladysRetryAt = 0;
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      if (store.data.account && store.data.account !== accountOf(config.token)) {
        store.data.listAt = 0;
      }
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    listener.stop();
    await store.save();
  });

  return {
    store,
    api,
    listener,
    tick,
    readList,
    manualRefresh,
    received,
    setupGladysComputer,
    computers,
    gladysState: () => gladysState,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, USER_AGENT, LIST_EVERY_MS, ACCESS_RETRY_MS };
