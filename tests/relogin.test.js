// Login / logout test: "log in, log out, log in again" must always work.
//
// WHAT IT TESTS
//   Two test players log in and out 5 times in a row WITHOUT reloading the page:
//     - test_ann in a PC-sized window
//     - test_ben in a phone-sized window (touch screen)
//   After each LOGIN it checks:
//     - your own name label is shown (exactly one, with the right name)
//     - the status box says "Online (2 players)"
//     - the chat log and the Log out button are shown, the login popup is gone
//     - on the phone: the Chat button and the joystick are shown
//     - chat works both ways, and each message appears exactly ONCE
//       (no duplicate listeners or UI left over from earlier rounds)
//     - a chat bubble shows above the other player's fish
//   After each LOGOUT it checks:
//     - the login popup is back
//     - all game UI is gone: name labels, status box, chat, buttons, joystick
//   It also fails if the page shows any JavaScript error.
//   (This test was written for a bug where the second login froze the game.)
//
// WHAT MUST BE RUNNING FIRST
//   Nothing. The test starts its OWN servers and stops them at the end:
//     - the website (Vite) on port 4300
//     - the real-time server (wrangler dev) on port 8797 (debug port 9339)
//   These ports must be free. It does NOT use or stop your own `vercel dev`
//   (port 3000) or `wrangler dev` (port 8787).
//   You need Microsoft Edge or Google Chrome installed (it uses your normal
//   browser in the background). Set TEST_BROWSER=chrome to use Chrome.
//
// SECRETS AND ACCOUNTS
//   No real secrets: the test makes a random, throw-away JWT secret each run
//   and gives it only to its own test real-time server.
//   No MongoDB: the login API is FAKED inside the test browser (the test
//   answers /api/login itself with a token made with that throw-away secret).
//   So no test accounts are created, and there is nothing to clean up.
//   (The real login API and database are not tested here.)
//
// RUN IT
//   npm run test:relogin
//   Set HEADED=1 to watch the browser windows.

import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import { chromium } from 'playwright-core';
import jwt from 'jsonwebtoken';

// ---------- Settings ----------
const SITE_PORT = 4300;
const REALTIME_PORT = 8797;
const REALTIME_DEBUG_PORT = 9339;
const SITE_URL = `http://localhost:${SITE_PORT}/`;
const ROUNDS = 5;
// A random secret, new every run. Only our own test server knows it.
const TEST_SECRET = crypto.randomBytes(32).toString('hex');
const BROWSER_CHANNEL = process.env.TEST_BROWSER === 'chrome' ? 'chrome' : 'msedge';
const IS_WINDOWS = process.platform === 'win32';

const problems = [];
const pageErrors = [];
const servers = [];

// Records a problem if `ok` is false.
function check(ok, what) {
  if (!ok) problems.push(what);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ======================= Servers =======================

// True if nothing is listening on the port yet.
function portIsFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
}

// Starts a server in the background and remembers it, so we can stop it.
function startServer(name, command, options) {
  const child = spawn(command, { shell: true, stdio: 'pipe', detached: !IS_WINDOWS, ...options });
  // Keep the last output, to show it if the server does not start.
  child.log = '';
  const keep = (data) => { child.log = (child.log + data).slice(-2000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.serverName = name;
  servers.push(child);
  return child;
}

// Stops every server we started (and the programs they started).
function stopServers() {
  for (const child of servers) {
    try {
      if (IS_WINDOWS) execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already stopped.
    }
  }
}

// Waits until `url` answers (any HTTP status), or gives up after `ms`.
async function waitForUrl(url, ms, child) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await fetch(url);
      return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`${child.serverName} did not start. Its last output:\n${child.log}`);
}

async function startTestServers() {
  for (const port of [SITE_PORT, REALTIME_PORT, REALTIME_DEBUG_PORT]) {
    if (!(await portIsFree(port))) {
      throw new Error(`Port ${port} is in use. Stop whatever uses it, then run the test again.`);
    }
  }

  // The real-time server, with the throw-away secret, accepting only our test site.
  const realtime = startServer(
    'wrangler dev',
    `npx wrangler dev --port ${REALTIME_PORT} --inspector-port ${REALTIME_DEBUG_PORT} ` +
      `--var JWT_SECRET:${TEST_SECRET} --var ALLOWED_ORIGINS:http://localhost:${SITE_PORT}`,
    { cwd: 'realtime' },
  );
  // The website, pointing at our test real-time server.
  const site = startServer('vite', `npx vite --port ${SITE_PORT} --strictPort`, {
    env: { ...process.env, VITE_REALTIME_HOST: `localhost:${REALTIME_PORT}` },
  });

  await waitForUrl(`http://localhost:${REALTIME_PORT}/auth-check`, 90_000, realtime);
  await waitForUrl(SITE_URL, 60_000, site);
}

// ======================= Players =======================

// Opens a browser window for one test player, on the login popup.
async function openPlayer(browser, id, name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`[${name}] ${error.message}`));

  // Fake login API: answer /api/login with a token for this player, signed
  // with the throw-away secret (so our test real-time server accepts it).
  const token = jwt.sign({ sub: id, name }, TEST_SECRET, { expiresIn: '1h' });
  await page.route('**/api/login', (route) => route.fulfill({ json: { token, user: { id, username: name } } }));

  await page.goto(SITE_URL);
  await page.waitForSelector('#auth-fields:not([hidden])');
  return { page, name, isPhone: Boolean(contextOptions.hasTouch) };
}

async function logIn(player) {
  const page = player.page;
  await page.locator('#auth-username').fill(player.name);
  await page.locator('#auth-password').fill('test-password');
  if (player.isPhone) await page.locator('#auth-submit').tap();
  else await page.click('#auth-submit');
}

async function logOut(player) {
  if (player.isPhone) await player.page.locator('#logout-button').tap();
  else await player.page.click('#logout-button');
}

async function say(player, text) {
  const page = player.page;
  if (player.isPhone) {
    await page.locator('#chat-button').tap();
    await page.locator('#chat-input').fill(text);
    await page.locator('#chat-send').tap();
  } else {
    await page.keyboard.press('Enter');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
}

// Everything the checks need to know about the page, read in one go.
function readUi(player) {
  return player.page.evaluate(() => {
    // An element is "shown" if no parent is hidden and it takes up space.
    // (offsetParent cannot be used: it is always null for position: fixed elements.)
    const shown = (element) => {
      if (!element || element.closest('[hidden]')) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    return {
      ownNames: [...document.querySelectorAll('.player-tag.is-local')].map((tag) => ({
        name: tag.querySelector('.player-name').textContent,
        shown: !tag.hidden,
      })),
      allNameTags: document.querySelectorAll('.player-tag').length,
      status: shown(document.getElementById('net-status')) ? document.getElementById('net-status-text').textContent : null,
      chatLog: shown(document.getElementById('chat-log')),
      chatButton: shown(document.getElementById('chat-button')),
      chatBox: shown(document.getElementById('chat-bar')),
      joysticks: document.querySelectorAll('.joystick-base').length,
      joystickShown: [...document.querySelectorAll('.joystick-base')].some(shown),
      logOutButton: shown(document.getElementById('logout-button')),
      loginPopup: shown(document.getElementById('auth-fields')),
      gameCanvases: document.querySelectorAll('#game canvas').length,
      chatLines: [...document.querySelectorAll('#chat-log-lines .chat-line')].map((line) => line.textContent),
    };
  });
}

async function waitUntil(condition, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await condition()) return true;
    await wait(150);
  }
  return false;
}

// ======================= One round =======================

async function playRound(round, ann, ben) {
  await logIn(ann);
  await logIn(ben);
  const bothOnline = await waitUntil(
    async () => (await readUi(ann)).status === 'Online (2 players)' && (await readUi(ben)).status === 'Online (2 players)',
  );
  check(bothOnline, `round ${round}: the players did not both get "Online (2 players)"`);
  await wait(600);

  for (const player of [ann, ben]) {
    const ui = await readUi(player);
    const where = `round ${round}, ${player.name} after login:`;
    check(ui.ownNames.length === 1 && ui.ownNames[0].name === player.name && ui.ownNames[0].shown,
      `${where} own name label is wrong ${JSON.stringify(ui.ownNames)}`);
    check(ui.allNameTags === 2, `${where} ${ui.allNameTags} name labels (expected 2)`);
    check(ui.status === 'Online (2 players)', `${where} status box says "${ui.status}"`);
    check(ui.chatLog, `${where} chat log is not shown`);
    check(ui.logOutButton, `${where} Log out button is not shown`);
    check(!ui.loginPopup, `${where} login popup is still shown`);
    check(ui.joysticks <= 1, `${where} ${ui.joysticks} joysticks in the page (expected at most 1)`);
    check(ui.gameCanvases === 1, `${where} ${ui.gameCanvases} game canvases (expected 1)`);
    if (player.isPhone) {
      check(ui.chatButton, `${where} Chat button is not shown`);
      check(ui.joystickShown, `${where} joystick is not shown`);
    }
  }

  // Chat both ways. Each line must arrive, exactly once.
  const fromAnn = `hello ben ${round}`;
  const fromBen = `你好 ann ${round}`;
  await say(ann, fromAnn);
  await wait(1200); // more than 1 s apart, so the chat speed limit is never hit
  await say(ben, fromBen);
  const arrived = await waitUntil(
    async () =>
      (await readUi(ann)).chatLines.some((line) => line.includes(fromBen)) &&
      (await readUi(ben)).chatLines.some((line) => line.includes(fromAnn)),
  );
  check(arrived, `round ${round}: chat did not arrive both ways`);
  for (const player of [ann, ben]) {
    const lines = (await readUi(player)).chatLines;
    for (const text of [fromAnn, fromBen]) {
      const copies = lines.filter((line) => line.includes(text)).length;
      check(copies === 1, `round ${round}, ${player.name}: "${text}" is in the chat log ${copies} times (expected 1)`);
    }
  }
  const bubbleShown = await ben.page.evaluate(
    (text) => [...document.querySelectorAll('.player-tag')].some((tag) => !tag.querySelector('.chat-bubble').hidden && tag.textContent.includes(text)),
    fromAnn,
  );
  check(bubbleShown, `round ${round}: test_ann's chat bubble is not shown on test_ben's screen`);

  await logOut(ann);
  await logOut(ben);
  await wait(1500);
  for (const player of [ann, ben]) {
    const ui = await readUi(player);
    const where = `round ${round}, ${player.name} after logout:`;
    check(ui.loginPopup, `${where} login popup is not shown`);
    check(ui.allNameTags === 0, `${where} ${ui.allNameTags} name labels left (expected 0)`);
    check(ui.status === null, `${where} status box is still shown`);
    check(!ui.chatLog && !ui.chatButton && !ui.chatBox, `${where} chat UI is still shown`);
    check(!ui.logOutButton, `${where} Log out button is still shown`);
    check(ui.joysticks === 0, `${where} ${ui.joysticks} joysticks left in the page (expected 0)`);
    check(ui.gameCanvases === 1, `${where} ${ui.gameCanvases} game canvases (expected 1)`);
  }
}

// ======================= Main =======================

async function main() {
  console.log('Starting test servers (website on port 4300, real-time server on port 8797)...');
  await startTestServers();

  const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: !process.env.HEADED });
  try {
    const ann = await openPlayer(browser, 'u-test-ann', 'test_ann', { viewport: { width: 900, height: 600 } });
    const ben = await openPlayer(browser, 'u-test-ben', 'test_ben', {
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    for (let round = 1; round <= ROUNDS; round++) {
      const before = problems.length + pageErrors.length;
      await playRound(round, ann, ben);
      const ok = problems.length + pageErrors.length === before;
      console.log(`Round ${round} of ${ROUNDS}: ${ok ? 'OK' : 'PROBLEMS (see below)'}`);
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  problems.push(`The test could not run: ${error.message}`);
} finally {
  stopServers();
}

if (pageErrors.length > 0) {
  console.log('\nJavaScript errors on the page:');
  for (const error of pageErrors) console.log('  -', error);
}
if (problems.length > 0) {
  console.log('\nProblems:');
  for (const problem of problems) console.log('  -', problem);
}
const passed = problems.length === 0 && pageErrors.length === 0;
console.log(passed ? '\nPASSED: log in / log out works every time.' : '\nFAILED.');
// A non-zero exit code tells scripts (and you) that the test failed.
process.exit(passed ? 0 : 1);
