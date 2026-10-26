// -----------------------------------------------------------------------------
// A fake TRIGGERcmd for the tests (no network):
//   - `fetch`: an in-memory HTTP API answering like the real one (the 401
//     {"err":"Invalid Token!"} of a wrong token, seen live on 2026-10-26; the
//     shapes of the official agent and clients: `{ records }`, `{ data: { id } }`,
//     the 403 of a second computer on the free plan);
//   - `WebSocket`: a fake socket of the Sails server (socket.io 2 packets),
//     driven by the tests.
// Nothing starts on import (node --test also runs test/helpers/).
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'gladys-triggercmd-'));

/**
 * @description A logger that keeps every line (to check what is never logged).
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')}`,
      );
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

const BASE = 'https://triggercmd.test';
const segment = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/**
 * @description A token shaped like the real ones (a JWT whose payload has the
 * user `id`), never looking like a real secret.
 * @param {string} user - The user id.
 * @returns {string} The token.
 */
const tokenFor = (user) =>
  `${segment({ alg: 'none', typ: 'JWT' })}.${segment({ id: user })}.not-a-real-signature`;
const TOKEN = tokenFor('test-user');
const OTHER_TOKEN = tokenFor('other-user');

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * @description The fake TRIGGERcmd API.
 * @param {object} [options] - `{ computers, commands, maxComputers }`.
 * @returns {object} `{ fetch, baseUrl, calls, state }`.
 */
function createFakeTriggercmd({ maxComputers = 10 } = {}) {
  const state = {
    tokens: new Set([TOKEN, OTHER_TOKEN]),
    computers: [
      { id: 'c-office', name: 'Office PC' },
      { id: 'c-pi', name: 'Raspberry' },
    ],
    commands: [
      { id: 'k1', name: 'Lock screen', computer: 'c-office', allowParams: false, voice: 'lock' },
      { id: 'k2', name: 'Volume', computer: 'c-office', allowParams: true, voice: 'volume' },
      { id: 'k3', name: 'Reboot', computer: 'c-pi', allowParams: false, voice: '' },
    ],
    runs: [],
    reports: [],
    maxComputers,
    // Populate `computer` in command/list (the real API does); false gives the id only.
    populate: true,
    failNext: null,
    nextId: 1,
  };
  const calls = [];

  /**
   * @description The fake fetch.
   * @param {string} url - The URL.
   * @param {object} [init] - The options.
   * @returns {Promise<Response>} The answer.
   */
  async function fetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const type = init.headers?.['content-type'] ?? '';
    let body = {};
    if (type.includes('json')) {
      body = JSON.parse(init.body);
    } else if (type.includes('urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(init.body));
    }
    calls.push({
      method,
      path: pathname,
      query: Object.fromEntries(searchParams),
      body,
      headers: init.headers,
    });
    if (state.failNext) {
      const failure = state.failNext;
      state.failNext = null;
      if (failure === 'network') {
        throw new TypeError('fetch failed');
      }
      return json(failure.status, failure.body ?? {});
    }
    const token = String(init.headers?.authorization ?? '').replace(/^Bearer /, '');
    if (!state.tokens.has(token)) {
      return json(401, { err: 'Invalid Token!' });
    }
    const computerOf = (id) => state.computers.find((computer) => computer.id === id);
    const record = (command) => ({
      ...command,
      computer: state.populate ? { ...computerOf(command.computer) } : command.computer,
    });
    const route = `${method} ${pathname}`;
    if (route === 'GET /api/command/list') {
      const only = searchParams.get('computer_id');
      return json(200, {
        records: state.commands.filter((command) => !only || command.computer === only).map(record),
      });
    }
    if (route === 'GET /api/computer/list') {
      return json(200, { records: state.computers.map((computer) => ({ ...computer })) });
    }
    if (route === 'POST /api/run/trigger') {
      const computer = state.computers.find((entry) => entry.name === body.computer);
      const command = state.commands.find(
        (entry) => entry.computer === computer?.id && entry.name === body.command,
      );
      if (!command) {
        return json(404, { err: 'Command not found' });
      }
      state.runs.push(body);
      return json(200, { message: 'Command triggered' });
    }
    if (route === 'POST /api/computer/save') {
      if (state.computers.length >= state.maxComputers) {
        return json(403, { err: 'You must subscribe before adding another computer.' });
      }
      const id = `c-new-${state.nextId++}`;
      state.computers.push({ id, name: body.name });
      return json(200, { data: { id, name: body.name } });
    }
    if (route === 'POST /api/command/save') {
      state.commands.push({
        id: `k-new-${state.nextId++}`,
        name: body.name,
        computer: body.computer,
        allowParams: body.allowParams === 'true',
        voice: body.voice,
      });
      return json(200, { data: {} });
    }
    if (route === 'POST /api/command/delete2') {
      state.commands = state.commands.filter(
        (command) => !(command.computer === body.computer && command.name === body.name),
      );
      return json(200, {});
    }
    if (route === 'POST /api/run/save') {
      state.reports.push(body);
      return json(200, { data: { id: 'run-1' } });
    }
    return json(404, { err: 'Not found' });
  }

  return { fetch, baseUrl: BASE, calls, state };
}

/**
 * @description A fake WebSocket class of the Sails server: every socket
 * opened is kept in `sockets`; the tests answer with `server*` helpers.
 * @returns {object} `{ WebSocket, sockets }`.
 */
function createFakeSockets() {
  const sockets = [];

  class FakeWebSocket {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }

    send(data) {
      if (this.closed) {
        throw new Error('closed');
      }
      this.sent.push(String(data));
    }

    close() {
      this.closed = true;
    }

    /** The server sends a packet. */
    serverSend(data) {
      this.onmessage?.({ data });
    }

    /** The server opens the session and connects the namespace. */
    serverOpen() {
      this.serverSend('0{"sid":"s1","upgrades":[],"pingInterval":25000,"pingTimeout":60000}');
      this.serverSend('40');
    }

    /** The request sent with an ack: `{ ack, event, request }`. */
    lastRequest() {
      const packet = [...this.sent].reverse().find((data) => /^42\d+\[/.test(data));
      const match = /^42(\d+)(\[.*)$/s.exec(packet ?? '');
      if (!match) {
        return null;
      }
      const [event, request] = JSON.parse(match[2]);
      return { ack: Number(match[1]), event, request };
    }

    /** The server answers a request. */
    serverAnswer(ack, response) {
      this.serverSend(`43${ack}${JSON.stringify([response])}`);
    }

    /** The server sends a `message` event. */
    serverMessage(data) {
      this.serverSend(`42${JSON.stringify(['message', data])}`);
    }

    /** The connection drops. */
    serverClose(code = 1006) {
      this.closed = true;
      this.onclose?.({ code });
    }
  }

  return { WebSocket: FakeWebSocket, sockets };
}

export {
  BASE,
  TOKEN,
  OTHER_TOKEN,
  tokenFor,
  createFakeTriggercmd,
  createFakeSockets,
  dataDir,
  recordingLogger,
};
