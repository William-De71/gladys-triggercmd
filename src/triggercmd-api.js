// -----------------------------------------------------------------------------
// HTTP client of the TRIGGERcmd API (https://www.triggercmd.com/api), with the
// token of the account (the "instructions" page of triggercmd.com) as a Bearer.
//
// Documented by TRIGGERcmd (docs.triggercmd.com, API section):
//   GET  command/list      { records: [...] }: every command of every computer,
//                          with `name`, `allowParams`, `voice`, `id` and
//                          `computer` (populated: `{ id, name }`)
//   POST run/trigger       { computer, command, params?, sender }: run a
//                          command on a computer, by their NAMES (the older
//                          documentation says `trigger` for `command`: both
//                          are sent)
// Used by the official agent (github.com/rvmey/TRIGGERcmd-Agent, MIT) for the
// optional "Gladys" computer, that receives the commands for the scenes:
//   GET  computer/list     { records: [{ id, name }] }
//   POST computer/save     form { name } -> { data: { id } }; 403 "You must
//                          subscribe before adding another computer"
//   GET  command/list?computer_id=<id>   the commands of one computer
//   POST command/save      form { name, computer, voice, voiceReply,
//                          allowParams, mcpToolDescription, icon }
//   POST command/delete2   form { name, computer }
//   POST run/save          form { status, computer, command }: "Command ran"
//
// Errors seen live (2026-10-26): a wrong token answers 401
// {"err":"Invalid Token!"} on every endpoint, over HTTP and the socket alike.
//
// Pace: the free plan runs one command per minute (a second one in the minute
// is dropped by TRIGGERcmd); the subscription has no limit. Reading is not
// limited. One request at a time here, 250 ms apart; a 429 (never seen) holds
// every request until its Retry-After.
// -----------------------------------------------------------------------------

const BASE_URL = 'https://www.triggercmd.com';
const TIMEOUT_MS = 20000;
const SPACING_MS = 250;
const MIN_PAUSE_MS = 30 * 1000;
const MAX_PAUSE_MS = 60 * 60 * 1000;
const SENDER = 'Gladys Assistant';

/**
 * @description An error of the TRIGGERcmd API.
 */
class TriggercmdError extends Error {
  /**
   * @param {string} kind - `auth` (token refused), `subscribe` (a paid plan
   * is needed), `not_found`, `rate_limit`, `server`, `http`, `unreachable`.
   * @param {string} message - What went wrong (never the token).
   * @param {object} [extra] - `{ status, endpoint, retryAfter }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'TriggercmdError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The seconds of a Retry-After header (a number or an HTTP date).
 * @param {string|null} header - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Seconds, null when absent or unreadable.
 */
function retryAfterSeconds(header, now) {
  if (header === null || header === undefined || header === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : null;
}

/**
 * @description The user id a token belongs to (its JWT payload `id`), read
 * without checking the signature: only to tell two accounts apart.
 * @param {string} token - The token.
 * @returns {string|null} The id, null when the token is not a JWT.
 */
function tokenUserId(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.id === 'string' && payload.id ? payload.id : null;
  } catch {
    return null;
  }
}

/**
 * @description The message of an error body: `err`, `error` or `message`.
 * @param {object|null} body - The body.
 * @returns {string} The message, '' when none.
 */
function bodyMessage(body) {
  const value = body?.err ?? body?.error ?? body?.message;
  return typeof value === 'string' ? value.slice(0, 200) : '';
}

/**
 * @description The TRIGGERcmd client.
 * @param {object} options - Options.
 * @param {Function} options.getToken - `() => string`, the token of the configuration.
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.baseUrl] - The site root (tests).
 * @param {number} [options.spacingMs] - Minimum time between two requests.
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} The client.
 */
function createTriggercmdClient({
  getToken,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  baseUrl = BASE_URL,
  spacingMs = SPACING_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let chain = Promise.resolve();
  let lastEnd = 0;
  let pausedUntil = 0;
  let requests = 0;
  let runs = 0;

  /**
   * @description Run a function in the queue: one request at a time, spaced.
   * @param {Function} run - `() => Promise`.
   * @returns {Promise<*>} Its result.
   */
  function queued(run) {
    const result = chain.then(async () => {
      const wait = lastEnd + spacingMs - now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await run();
      } finally {
        lastEnd = now();
      }
    });
    chain = result.catch(() => {});
    return result;
  }

  /**
   * @description Read a JSON body; null when it is not JSON.
   * @param {Response} response - The response.
   * @returns {Promise<object|null>} The body.
   */
  async function jsonOf(response) {
    const text = await response.text().catch(() => '');
    try {
      const body = JSON.parse(text);
      return body && typeof body === 'object' ? body : null;
    } catch {
      return text ? { message: text.slice(0, 200) } : null;
    }
  }

  /**
   * @description Send one request and read its JSON answer.
   * @param {string} method - GET or POST.
   * @param {string} path - The path under the site root (`/api/...`).
   * @param {object} [options] - `{ json, form }`: the body.
   * @returns {Promise<object>} The body.
   */
  function request(method, path, { json, form } = {}) {
    return queued(async () => {
      const endpoint = path.split('?')[0];
      if (pausedUntil > now()) {
        throw new TriggercmdError('rate_limit', 'TRIGGERcmd asked to wait (429)', {
          endpoint,
          retryAfter: Math.ceil((pausedUntil - now()) / 1000),
        });
      }
      const token = getToken();
      if (!token) {
        throw new TriggercmdError('auth', 'No TRIGGERcmd token', { endpoint });
      }
      const headers = {
        'user-agent': userAgent,
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      };
      let body;
      if (json) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (form) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(
          Object.entries(form).map(([key, value]) => [key, String(value ?? '')]),
        ).toString();
      }
      requests += 1;
      let response;
      try {
        response = await fetchFn(`${baseUrl}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new TriggercmdError('unreachable', `TRIGGERcmd unreachable: ${err.message}`, {
          endpoint,
        });
      }
      const data = await jsonOf(response);
      const { status } = response;
      if (status >= 200 && status < 300) {
        return data ?? {};
      }
      const detail = bodyMessage(data);
      const extra = { status, endpoint };
      if (status === 401) {
        throw new TriggercmdError('auth', `Token refused (${detail || status})`, extra);
      }
      if (status === 402 || status === 403) {
        throw new TriggercmdError(
          'subscribe',
          `Refused by TRIGGERcmd (${detail || status})`,
          extra,
        );
      }
      if (status === 404) {
        throw new TriggercmdError('not_found', `Not found (${detail || status})`, extra);
      }
      if (status === 429) {
        const seconds = retryAfterSeconds(response.headers.get('retry-after'), now());
        const pause = Math.min(
          MAX_PAUSE_MS,
          Math.max(MIN_PAUSE_MS, (seconds ?? MIN_PAUSE_MS / 1000) * 1000),
        );
        pausedUntil = now() + pause;
        throw new TriggercmdError('rate_limit', 'TRIGGERcmd asked to wait (429)', {
          ...extra,
          retryAfter: Math.ceil(pause / 1000),
        });
      }
      if (status >= 500) {
        throw new TriggercmdError('server', `TRIGGERcmd error ${status}`, extra);
      }
      throw new TriggercmdError('http', `TRIGGERcmd answered ${status} (${detail})`, extra);
    });
  }

  /**
   * @description The records of a list answer.
   * @param {object} body - The body.
   * @returns {object[]} The records.
   */
  const recordsOf = (body) =>
    Array.isArray(body?.records) ? body.records : Array.isArray(body) ? body : [];

  return {
    /**
     * @description Every command of every computer of the account.
     * @returns {Promise<object[]>} The raw records.
     */
    async listCommands() {
      return recordsOf(await request('GET', '/api/command/list'));
    },

    /**
     * @description The commands of one computer.
     * @param {string} computerId - The id of the computer.
     * @returns {Promise<object[]>} The raw records.
     */
    async listComputerCommands(computerId) {
      return recordsOf(
        await request('GET', `/api/command/list?computer_id=${encodeURIComponent(computerId)}`),
      );
    },

    /**
     * @description The computers of the account.
     * @returns {Promise<object[]>} The raw records.
     */
    async listComputers() {
      return recordsOf(await request('GET', '/api/computer/list'));
    },

    /**
     * @description Run a command on a computer.
     * @param {object} run - `{ computer, command, params }`: the names.
     * @returns {Promise<string>} The message of TRIGGERcmd ('' when none).
     */
    async trigger({ computer, command, params }) {
      runs += 1;
      const body = await request('POST', '/api/run/trigger', {
        json: {
          computer,
          command,
          trigger: command,
          ...(params ? { params } : {}),
          sender: SENDER,
        },
      });
      return bodyMessage(body);
    },

    /**
     * @description Create a computer.
     * @param {string} name - Its name.
     * @returns {Promise<string>} Its id.
     */
    async createComputer(name) {
      const body = await request('POST', '/api/computer/save', { form: { name } });
      const id = body?.data?.id ?? body?.id;
      if (typeof id !== 'string' || !id) {
        throw new TriggercmdError('http', 'TRIGGERcmd did not give the id of the computer', {
          endpoint: '/api/computer/save',
        });
      }
      return id;
    },

    /**
     * @description Add a command to a computer.
     * @param {string} computerId - The computer.
     * @param {string} name - The command (its voice name too).
     * @param {string} description - What the command does, for the AI assistants.
     * @returns {Promise<void>}
     */
    async addCommand(computerId, name, description) {
      await request('POST', '/api/command/save', {
        form: {
          name,
          computer: computerId,
          voice: name,
          voiceReply: '',
          allowParams: 'true',
          mcpToolDescription: description,
          icon: '',
        },
      });
    },

    /**
     * @description Remove a command from a computer.
     * @param {string} computerId - The computer.
     * @param {string} name - The command.
     * @returns {Promise<void>}
     */
    async removeCommand(computerId, name) {
      await request('POST', '/api/command/delete2', { form: { name, computer: computerId } });
    },

    /**
     * @description Tell TRIGGERcmd a command was received (its run list).
     * @param {string} computerId - The computer.
     * @param {string} commandId - The id of the command.
     * @returns {Promise<void>}
     */
    async reportRun(computerId, commandId) {
      await request('POST', '/api/run/save', {
        form: { status: 'Command ran', computer: computerId, command: commandId },
      });
    },

    pausedUntil: () => (pausedUntil > now() ? pausedUntil : 0),
    counts: () => ({ requests, runs }),
  };
}

export {
  BASE_URL,
  SENDER,
  TriggercmdError,
  createTriggercmdClient,
  tokenUserId,
  retryAfterSeconds,
};
