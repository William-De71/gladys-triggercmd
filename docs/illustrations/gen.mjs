// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake TRIGGERcmd of the tests (test/helpers/fake-triggercmd.js),
// on a made-up Monday, 26 October 2026 in Paris: the volume of the office PC
// set from the widget, a reboot of the Raspberry refused (the free plan runs
// one command a minute), then Alexa turning "Movie" on through the Gladys
// computer. Never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { optionValue } = await load('src/widgets.js');
const { commandKey } = await load('src/computers.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { createFakeTriggercmd, createFakeSockets, dataDir, recordingLogger, TOKEN } = await load(
  'test/helpers/fake-triggercmd.js',
);

const NOW = Date.parse('2026-10-26T18:40:00Z');
const MINUTE = 60 * 1000;
const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['commands'];
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * @description One language: the widget after three runs.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const fake = createFakeTriggercmd();
  const sockets = createFakeSockets();
  const clock = { now: NOW - 40 * MINUTE };
  const gladys = createFakeGladys({
    config: {
      token: TOKEN,
      gladys_computer: true,
      gladys_computer_name: 'Gladys',
      gladys_commands: 'Movie, Good night',
    },
  });
  const app = createApp(gladys, {
    fetch: fake.fetch,
    WebSocket: sockets.WebSocket,
    baseUrl: fake.baseUrl,
    dataDir: dataDir(),
    now: () => clock.now,
    timeZone: 'Europe/Paris',
    timers: false,
    spacingMs: 0,
    logger: recordingLogger(),
  });
  await gladys.connect();
  await app.whenReady();
  const [socket] = sockets.sockets;
  socket.serverOpen();
  const request = socket.lastRequest();
  socket.serverAnswer(request.ack, { body: {}, statusCode: 200 });

  clock.now = NOW - 26 * MINUTE;
  await gladys.fake.widgetAction('commands', 'run', undefined, {
    values: {
      command: optionValue({ id: 'c-office' }, { key: commandKey('Volume') }),
      parameters: '30',
    },
  });
  clock.now = NOW - 9 * MINUTE;
  fake.state.failNext = { status: 429 };
  await gladys.fake.sceneAction('run_command', { computer: 'Raspberry', command: 'Reboot' });
  clock.now = NOW - 2 * MINUTE;
  socket.serverMessage({ trigger: 'Movie', id: 'k-movie', params: 'on', sender: 'Alexa' });
  await wait();
  clock.now = NOW;
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (await gladys.fake.widgetGet(key, { language })).data.content;
  }
  app.listener.stop();
  await gladys.fake.shutdown();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
    now: NOW,
  }),
);
