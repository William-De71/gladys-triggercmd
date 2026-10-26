// -----------------------------------------------------------------------------
// Scene triggers and the keys of the scene actions.
//
// Triggers:
//   - `command_received`  a command of the Gladys computer was run in
//                         TRIGGERcmd (Alexa, Google Assistant, a panel, IFTTT,
//                         an AI assistant…): never for a run sent by Gladys;
//   - `run_failed`        TRIGGERcmd refused a command Gladys sent (from a
//                         device, the widget or a scene): unknown computer or
//                         command, rate limit, token…; never fired by the
//                         `run_command` scene action itself, which fails
//                         instead (no loop through the scenes);
//   - `access_refused`    TRIGGERcmd refuses the token (once per refusal).
// Scene actions:
//   - `run_command`       run a command on a computer, with parameters;
//   - `refresh`           read the computers and their commands again.
// -----------------------------------------------------------------------------

const TRIGGERS = {
  COMMAND_RECEIVED: 'command_received',
  RUN_FAILED: 'run_failed',
  ACCESS_REFUSED: 'access_refused',
};

const SCENE_ACTIONS = {
  RUN_COMMAND: 'run_command',
  REFRESH: 'refresh',
};

const RUN_OUTPUTS = ['computer', 'command', 'message'];
const REFRESH_OUTPUTS = ['computer_count', 'command_count'];
// The `state` of `command_received`: what Alexa and Google send.
const STATES = ['on', 'off'];
const FAILURE_REASONS = [
  'unknown_command',
  'rate_limit',
  'token',
  'subscription',
  'unreachable',
  'error',
];

/**
 * @description Keep only the declared outputs, as scalars.
 * @param {object} values - The values.
 * @param {string[]} keys - The declared outputs.
 * @returns {object} The outputs.
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== undefined)
      .map((key) => [
        key,
        typeof values[key] === 'string' ? values[key].slice(0, 10000) : values[key],
      ]),
  );
}

/**
 * @description The state a parameter carries: `on`, `off`, or '' (anything else).
 * @param {string} params - The parameters.
 * @returns {string} The state.
 */
function stateOf(params) {
  const value = String(params ?? '')
    .trim()
    .toLowerCase();
  return STATES.includes(value) ? value : '';
}

/**
 * @description The data of `command_received`.
 * @param {object} event - `{ trigger, params, sender }` from the socket.
 * @param {string} computerName - The name of the Gladys computer.
 * @returns {object} The flat data.
 */
function receivedData(event, computerName) {
  return {
    command: event.trigger,
    params: event.params,
    state: stateOf(event.params),
    sender: event.sender,
    computer: computerName,
  };
}

/**
 * @description The reason of a failed run, for `run_failed`.
 * @param {object} err - A TriggercmdError, or `{ kind: 'unknown_command' }`.
 * @returns {string} One of FAILURE_REASONS.
 */
function failureReason(err) {
  return (
    {
      unknown_command: 'unknown_command',
      not_found: 'unknown_command',
      rate_limit: 'rate_limit',
      auth: 'token',
      subscribe: 'subscription',
      unreachable: 'unreachable',
    }[err?.kind] ?? 'error'
  );
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  RUN_OUTPUTS,
  REFRESH_OUTPUTS,
  STATES,
  FAILURE_REASONS,
  pick,
  stateOf,
  receivedData,
  failureReason,
};
