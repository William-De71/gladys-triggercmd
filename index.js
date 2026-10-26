// -----------------------------------------------------------------------------
// Entry point of the TRIGGERcmd external integration.
//
// The computers of a TRIGGERcmd account (Windows, Mac, Linux, Raspberry Pi with
// the TRIGGERcmd agent) and their commands, through the TRIGGERcmd API and the
// token of the account:
//   - devices: one per computer, a push button or an on/off switch per
//     command, offered on the Discovery screen (src/computers.js);
//   - scene actions: run a command, read the commands again;
//   - scene triggers: command received by the Gladys computer, command
//     refused, token refused;
//   - dashboard widget: the last runs and a "Run a command" form;
//   - the optional "Gladys" computer, whose commands start scenes
//     (src/gladys-computer.js).
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown by the widget)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the TRIGGERcmd integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
