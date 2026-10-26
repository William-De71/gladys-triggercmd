// -----------------------------------------------------------------------------
// Configuration of the TRIGGERcmd integration.
//
// Fields of the config_schema:
//   - `token`                 the token of the TRIGGERcmd account: a `secret`,
//                             never sent back to the UI, never logged, never
//                             written to /data; only sent to triggercmd.com;
//   - `gladys_computer`       whether Gladys shows up in TRIGGERcmd as a
//                             computer whose commands start scenes (off by
//                             default: the free plan holds a single computer);
//   - `gladys_computer_name`  its name in TRIGGERcmd ("Gladys" by default);
//   - `gladys_commands`       its commands: names separated by commas (the
//                             voice names of Alexa and Google Assistant too).
// -----------------------------------------------------------------------------

import { parseCommandNames } from './gladys-computer.js';

const DEFAULT_COMPUTER_NAME = 'Gladys';
const MAX_TOKEN = 4096;

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description Read a boolean of the configuration (Gladys may store it as a string).
 * @param {unknown} raw - The value.
 * @returns {boolean} The boolean.
 */
const readBoolean = (raw) => raw === true || raw === 'true' || raw === 1 || raw === '1';

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ token, gladysComputer, computerName, commands }`.
 * @example
 * normalizeConfig({ token: ' abc ', gladys_commands: 'Movie, Good night' });
 * // { token: 'abc', gladysComputer: false, computerName: 'Gladys', commands: ['Movie', 'Good night'] }
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const token = readString(config.token);
  return {
    // A token is a JWT: no space can be part of it.
    token: token.length <= MAX_TOKEN ? token.replace(/\s+/g, '') : '',
    gladysComputer: readBoolean(config.gladys_computer),
    computerName:
      readString(config.gladys_computer_name).replace(/\s+/g, ' ').slice(0, 50) ||
      DEFAULT_COMPUTER_NAME,
    commands: parseCommandNames(config.gladys_commands),
  };
}

export { DEFAULT_COMPUTER_NAME, normalizeConfig, readBoolean };
