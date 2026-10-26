// -----------------------------------------------------------------------------
// The optional "Gladys" computer: Gladys shows up in TRIGGERcmd as one more
// computer, whose commands start Gladys scenes. Alexa, Google Assistant, the
// TRIGGERcmd panels, IFTTT or an AI assistant (MCP) run them like any other
// TRIGGERcmd command; the integration receives them in real time and fires
// the "command received" scene trigger.
//
// Like the official agent (github.com/rvmey/TRIGGERcmd-Agent, MIT):
//   - the computer is created once (POST computer/save), found again by its
//     id, else by its name; the free plan holds a single computer (403 "You
//     must subscribe before adding another computer");
//   - its commands follow the configuration (command/save, command/delete2),
//     with parameters allowed (Alexa and Google send "on" / "off");
//   - it listens on the Sails socket of triggercmd.com (socket.io 2 over a
//     WebSocket, checked live on 2026-10-26: open, connect, ping / pong and a
//     401 {"err":"Invalid Token!"} for a wrong token) in the room of the
//     computer (GET /api/computer/subscribeToFunRoom?roomName=<id>); each run
//     arrives as a `message` event `{ trigger, id, params, sender }`, and is
//     reported back (POST run/save "Command ran") for the run list of the site.
// -----------------------------------------------------------------------------

import { BASE_URL, SENDER } from './triggercmd-api.js';

const SAILS_QUERY = {
  __sails_io_sdk_version: '0.11.0',
  __sails_io_sdk_platform: 'node',
  __sails_io_sdk_language: 'javascript',
};
const SUBSCRIBE_TIMEOUT_MS = 20000;
const RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;
const MAX_COMMAND = 100;
const MAX_COMMANDS = 50;

/**
 * @description The command names of the configuration: a comma, semicolon or
 * line separated list, trimmed, without duplicates (case ignored).
 * @param {unknown} raw - The text of the configuration.
 * @returns {string[]} The names.
 */
function parseCommandNames(raw) {
  const seen = new Set();
  const names = [];
  for (const part of String(raw ?? '').split(/[,;\n]/)) {
    const name = part.trim().replace(/\s+/g, ' ').slice(0, MAX_COMMAND);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names.slice(0, MAX_COMMANDS);
}

/**
 * @description The description of a command for the AI assistants (MCP).
 * @param {string} name - The command.
 * @returns {string} The description.
 */
const commandDescription = (name) =>
  `Starts the Gladys Assistant scenes triggered by "${name}". Parameter: on or off (optional).`;

/**
 * @description Bring the commands of the Gladys computer in line with the
 * configuration.
 * @param {object} api - createTriggercmdClient().
 * @param {string} computerId - The Gladys computer.
 * @param {string[]} wanted - The command names of the configuration.
 * @returns {Promise<{ added: string[], removed: string[] }>} What changed.
 */
async function syncCommands(api, computerId, wanted) {
  const records = await api.listComputerCommands(computerId);
  const present = [
    ...new Set(
      records.map((record) => String(record?.name ?? '').trim()).filter((name) => name !== ''),
    ),
  ];
  const removed = present.filter((name) => !wanted.includes(name));
  const added = wanted.filter((name) => !present.includes(name));
  // Removals first: TRIGGERcmd deletes by name.
  for (const name of removed) {
    await api.removeCommand(computerId, name);
  }
  for (const name of added) {
    await api.addCommand(computerId, name, commandDescription(name));
  }
  return { added, removed };
}

/**
 * @description Find the Gladys computer, or create it.
 * @param {object} api - createTriggercmdClient().
 * @param {object} options - `{ knownId, name }`: the id kept, the name configured.
 * @returns {Promise<{ id: string, name: string, created: boolean }>} The computer.
 */
async function ensureComputer(api, { knownId, name }) {
  const computers = await api.listComputers();
  const idOf = (record) => String(record?.id ?? record?._id ?? '');
  const byId = knownId ? computers.find((record) => idOf(record) === knownId) : null;
  if (byId) {
    return { id: knownId, name: String(byId.name ?? name), created: false };
  }
  const byName = computers.find(
    (record) => String(record?.name ?? '').toLowerCase() === name.toLowerCase(),
  );
  if (byName && idOf(byName)) {
    return { id: idOf(byName), name: String(byName.name), created: false };
  }
  return { id: await api.createComputer(name), name, created: true };
}

/**
 * @description The URL of the socket: Engine.IO 3 over a WebSocket, with the
 * query of the Sails client.
 * @param {string} baseUrl - The site root (https://…).
 * @returns {string} The wss:// URL.
 */
function socketUrl(baseUrl) {
  const query = new URLSearchParams({ ...SAILS_QUERY, EIO: '3', transport: 'websocket' });
  return `${baseUrl.replace(/^http/, 'ws')}/socket.io/?${query}`;
}

/**
 * @description The real-time listener of the Gladys computer: a minimal
 * socket.io 2 client (Engine.IO 3 packets over the WebSocket of Node.js), the
 * protocol of the Sails server of triggercmd.com:
 *   `0{…pingInterval…}` open, `40` connected, `2` / `3` ping / pong,
 *   `42["message",{…}]` an event, `42<n>[…]` a request, `43<n>[…]` its answer.
 * @param {object} options - Options.
 * @param {Function} options.getToken - `() => string`.
 * @param {string} options.userAgent - The User-Agent.
 * @param {Function} options.onCommand - `({ trigger, id, params, sender }) => void`.
 * @param {Function} options.onState - `(state, detail) => void`: `connecting`,
 * `listening`, `refused` (token), `failed`.
 * @param {Function} [options.WebSocket] - The WebSocket class (tests).
 * @param {string} [options.baseUrl] - The site root (tests).
 * @param {object} [options.timing] - `{ retryMs, maxRetryMs, answerMs }` (tests).
 * @returns {object} `{ start(computerId), stop(), state() }`.
 */
function createListener({
  getToken,
  userAgent,
  onCommand,
  onState,
  WebSocket: WebSocketClass = globalThis.WebSocket,
  baseUrl = BASE_URL,
  timing = {},
}) {
  const retryMs = timing.retryMs ?? RETRY_MS;
  const maxRetryMs = timing.maxRetryMs ?? MAX_RETRY_MS;
  const answerMs = timing.answerMs ?? SUBSCRIBE_TIMEOUT_MS;
  let socket = null;
  let current = 'closed';
  let computer = null;
  let delay = retryMs;
  let retryTimer = null;
  let pingTimer = null;
  let watchdog = null;
  let answerTimer = null;
  let nextAck = 0;
  const pending = new Map();

  const setState = (state, detail = '') => {
    current = state;
    onState(state, detail);
  };

  /**
   * @description Forget the socket and its timers.
   */
  function drop() {
    clearInterval(pingTimer);
    clearTimeout(watchdog);
    clearTimeout(answerTimer);
    pending.clear();
    const previous = socket;
    socket = null;
    if (previous) {
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
      try {
        previous.close();
      } catch {
        // already closed
      }
    }
  }

  /**
   * @description Close, and connect again after a growing delay (5 s to 1 min).
   * @param {string} detail - Why.
   */
  function retry(detail) {
    drop();
    if (!computer) {
      return;
    }
    setState('failed', detail);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
    retryTimer.unref?.();
    delay = Math.min(maxRetryMs, delay * 2);
  }

  /**
   * @description Expect a packet before a delay, else connect again.
   * @param {number} ms - The delay.
   */
  function watch(ms) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => retry('no answer from the server'), ms);
    watchdog.unref?.();
  }

  /**
   * @description Send a request through the socket, with its answer callback.
   * @param {object} request - `{ method, url, headers, data }`.
   * @param {Function} callback - `(response) => void`.
   */
  function send(request, callback) {
    nextAck += 1;
    pending.set(nextAck, callback);
    socket.send(`42${nextAck}${JSON.stringify(['get', request])}`);
  }

  /**
   * @description Join the room of the computer.
   */
  function subscribe() {
    answerTimer = setTimeout(() => retry('no answer to the subscription'), answerMs);
    answerTimer.unref?.();
    send(
      {
        method: 'get',
        url: `/api/computer/subscribeToFunRoom?roomName=${encodeURIComponent(computer)}`,
        headers: { Authorization: `Bearer ${getToken()}` },
        data: {},
      },
      (response) => {
        clearTimeout(answerTimer);
        const status = Number(response?.statusCode ?? 200);
        if (status === 401 || status === 403) {
          const detail = String(response?.body?.err ?? status);
          stop();
          setState('refused', detail);
          return;
        }
        if (status >= 400) {
          retry(`subscription answered ${status}`);
          return;
        }
        delay = retryMs;
        setState('listening');
      },
    );
  }

  /**
   * @description An event of the server.
   * @param {unknown} event - The data of a `message` event.
   */
  function message(event) {
    if (!event || typeof event !== 'object') {
      return;
    }
    // A run sent by Gladys itself would loop through the scenes: never.
    if (event.sender === SENDER) {
      return;
    }
    onCommand({
      trigger: String(event.trigger ?? '').slice(0, MAX_COMMAND),
      id: String(event.id ?? ''),
      params: typeof event.params === 'string' ? event.params.slice(0, 1000) : '',
      sender: typeof event.sender === 'string' ? event.sender.slice(0, 100) : '',
    });
  }

  /**
   * @description A packet of the server.
   * @param {string} data - The packet.
   */
  function packet(data) {
    const type = data[0];
    if (type === '0') {
      // Open: ping every pingInterval, the server answers within pingTimeout.
      let open = {};
      try {
        open = JSON.parse(data.slice(1));
      } catch {
        // defaults
      }
      const interval = Number(open.pingInterval) || 25000;
      const timeout = Number(open.pingTimeout) || 60000;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        try {
          socket?.send('2');
        } catch {
          // the close event follows
        }
      }, interval);
      pingTimer.unref?.();
      watch(interval + timeout);
      return;
    }
    if (type === '3') {
      return;
    }
    if (type === '1') {
      retry('closed by the server');
      return;
    }
    if (type !== '4') {
      return;
    }
    const kind = data[1];
    if (kind === '0') {
      subscribe();
      return;
    }
    if (kind === '1') {
      retry('disconnected by the server');
      return;
    }
    const match = /^(\d*)(\[.*)$/s.exec(data.slice(2));
    if (!match) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(match[2]);
    } catch {
      return;
    }
    if (kind === '3') {
      const callback = pending.get(Number(match[1]));
      pending.delete(Number(match[1]));
      callback?.(payload[0]);
      return;
    }
    if (kind === '2' && payload[0] === 'message') {
      message(payload[1]);
    }
  }

  /**
   * @description Open the socket.
   */
  function connect() {
    drop();
    if (!computer) {
      return;
    }
    setState('connecting');
    try {
      socket = new WebSocketClass(socketUrl(baseUrl), { headers: { 'User-Agent': userAgent } });
    } catch (err) {
      retry(String(err?.message ?? err));
      return;
    }
    watch(answerMs);
    socket.onmessage = (event) => {
      // Any packet shows the server is there.
      if (pingTimer) {
        watch(answerMs + 60000);
      }
      packet(String(event.data));
    };
    socket.onerror = () => {};
    socket.onclose = (event) => retry(`socket closed (${event?.code ?? '?'})`);
  }

  /**
   * @description Stop listening.
   */
  function stop() {
    computer = null;
    clearTimeout(retryTimer);
    drop();
    if (current !== 'refused') {
      current = 'closed';
    }
  }

  /**
   * @description Listen to a computer (closes the previous socket).
   * @param {string} computerId - The Gladys computer.
   */
  function start(computerId) {
    stop();
    current = 'closed';
    computer = computerId;
    delay = retryMs;
    connect();
  }

  return { start, stop, state: () => current };
}

export {
  SAILS_QUERY,
  socketUrl,
  MAX_COMMANDS as MAX_GLADYS_COMMANDS,
  parseCommandNames,
  commandDescription,
  syncCommands,
  ensureComputer,
  createListener,
};
