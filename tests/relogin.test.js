// Guest / login / logout test: "guest → log in → log out → guest" must
// always work, and the fish must keep its place every time.
//
// WHAT IT TESTS
//   Two visitors play 5 rounds WITHOUT reloading the page:
//     - test_ann in a PC-sized window
//     - test_ben in a phone-sized window (360 px wide, touch screen)
//   At page load (no saved login) it checks:
//     - no login popup; each visitor is a guest fish named "Guest_1234"
//     - your own name is yellow, the other guest's name is grey
//     - the "Log in" button is shown, "Log out" is not
//   Each round:
//     1. As guests: chat works both ways, each message exactly ONCE.
//        (Round 1 also checks the 60-character limit for guests.)
//     2. The "Log in" button opens the popup. While it is open the fish
//        does not move (arrow key held down), and Enter does not open the
//        chat. The popup closes with Esc / the X / a click outside, and
//        then the fish can swim again.
//     3. Log in. Checks: the right own name (yellow), the other player's
//        name is white (not a guest), "Log out" shown, the popup gone,
//        chat works, and the fish is still in the SAME PLACE.
//     4. Log out. Checks: a NEW guest (new id), "Log in" shown, and the
//        fish is still in the SAME PLACE.
//   All the time: exactly 2 fish in the room (no duplicates, nothing left
//   over from earlier rounds), and no JavaScript errors on the page.
//
//   How "the same place" is checked: a third, hidden page connects to the
//   test server as a read-only spectator. It sees every fish's id, name,
//   guest flag and position, exactly as the server has them.
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

// Name colours from style.css, as the browser reports them.
const YELLOW = 'rgb(255, 230, 128)'; // our own name
const GREY = 'rgb(168, 168, 168)'; // guests
const WHITE = 'rgb(255, 255, 255)'; // registered players
const GUEST_NAME = /^Guest_\d{4}$/;
// Same as GUEST_CHAT_MAX_CHARS in shared/protocol.js.
const GUEST_CHAT_MAX_CHARS = 60;
// Guests may send 1 chat message per 2 seconds. Wait a bit longer.
const GUEST_CHAT_GAP_MS = 2300;
// "The same place" allows this much difference (in game pixels).
const SAME_PLACE_PX = 2;

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

// ======================= The observer =======================

// Opens the hidden observer page: a read-only spectator connection that
// keeps a list of every fish in the room (window.fish: id → fish).
// It opens a plain file of the test site (not the game), so the browser
// sends the allowed Origin, but no game and no fish of its own start.
async function openObserver(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${SITE_URL}assets/maps/world.tmj`);
  const connected = await page.evaluate((port) => new Promise((resolve) => {
    window.fish = new Map();
    const socket = new WebSocket(`ws://localhost:${port}/parties/world/main?spectator=1`);
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'welcome') {
        window.fish.clear();
        for (const p of data.players) window.fish.set(p.id, p);
        resolve(true);
      } else if (data.type === 'join') {
        window.fish.set(data.player.id, data.player);
      } else if (data.type === 'leave') {
        window.fish.delete(data.id);
      } else if (data.type === 'state') {
        for (const p of data.players) {
          const old = window.fish.get(p.id);
          if (old) window.fish.set(p.id, { ...old, ...p });
        }
      }
    };
    socket.onclose = () => resolve(false);
    setTimeout(() => resolve(false), 10_000);
  }), REALTIME_PORT);
  if (!connected) throw new Error('The observer could not connect to the test real-time server.');
  return page;
}

// All fish the server has right now: [{ id, name, x, y, guest }].
function readFish(observer) {
  return observer.evaluate(() => [...window.fish.values()]);
}

// ======================= Players =======================

// Opens a browser window for one test visitor (they start as a guest).
async function openPlayer(browser, id, name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`[${name}] ${error.message}`));

  // Fake login API: answer /api/login with a token for this player, signed
  // with the throw-away secret (so our test real-time server accepts it).
  const token = jwt.sign({ sub: id, name }, TEST_SECRET, { expiresIn: '1h' });
  await page.route('**/api/login', (route) => route.fulfill({ json: { token, user: { id, username: name } } }));

  await page.goto(SITE_URL);
  return { page, id, name, isPhone: Boolean(contextOptions.hasTouch) };
}

// Taps (phone) or clicks (PC) an element.
async function press(player, selector) {
  if (player.isPhone) await player.page.locator(selector).tap();
  else await player.page.click(selector);
}

async function openPopup(player) {
  await press(player, '#login-button');
  await player.page.waitForSelector('#auth-fields:not([hidden])');
}

async function logIn(player) {
  await openPopup(player);
  const page = player.page;
  await page.locator('#auth-username').fill(player.name);
  await page.locator('#auth-password').fill('test-password');
  await press(player, '#auth-submit');
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
    const tagInfo = (tag) => {
      const nameLabel = tag.querySelector('.player-name');
      return { name: nameLabel.textContent, color: getComputedStyle(nameLabel).color, shown: !tag.hidden };
    };
    return {
      ownNames: [...document.querySelectorAll('.player-tag.is-local')].map(tagInfo),
      otherNames: [...document.querySelectorAll('.player-tag:not(.is-local)')].map(tagInfo),
      status: shown(document.getElementById('net-status')) ? document.getElementById('net-status-text').textContent : null,
      chatLog: shown(document.getElementById('chat-log')),
      chatButton: shown(document.getElementById('chat-button')),
      chatBox: shown(document.getElementById('chat-bar')),
      joysticks: document.querySelectorAll('.joystick-base').length,
      joystickShown: [...document.querySelectorAll('.joystick-base')].some(shown),
      logInButton: shown(document.getElementById('login-button')),
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

// Waits until both pages say "Online (2 players)".
async function waitBothOnline(ann, ben, where) {
  const ok = await waitUntil(
    async () => (await readUi(ann)).status === 'Online (2 players)' && (await readUi(ben)).status === 'Online (2 players)',
  );
  check(ok, `${where}: the players did not both get "Online (2 players)"`);
  // Let the name labels and late messages settle.
  await wait(600);
}

// The fish of this player, as the server has it (found by its own name label).
async function serverFishOf(player, observer) {
  const ui = await readUi(player);
  const ownName = ui.ownNames[0]?.name;
  return (await readFish(observer)).find((fish) => fish.name === ownName) || null;
}

// ======================= Checks =======================

// The checks for one page, as a guest (`guest` true) or logged in (false).
function checkPage(ui, player, other, { guest, where }) {
  const own = ui.ownNames;
  check(own.length === 1 && own[0].shown, `${where} ${own.length} own name labels ${JSON.stringify(own)} (expected 1, shown)`);
  if (own.length === 1) {
    const nameOk = guest ? GUEST_NAME.test(own[0].name) : own[0].name === player.name;
    check(nameOk, `${where} own name is "${own[0].name}"`);
    check(own[0].color === YELLOW, `${where} own name colour is ${own[0].color} (expected yellow)`);
  }
  check(ui.otherNames.length === 1, `${where} ${ui.otherNames.length} other name labels (expected 1)`);
  if (ui.otherNames.length === 1) {
    const o = ui.otherNames[0];
    const nameOk = guest ? GUEST_NAME.test(o.name) : o.name === other.name;
    check(nameOk, `${where} the other player's name is "${o.name}"`);
    const color = guest ? GREY : WHITE;
    check(o.color === color, `${where} the other player's name colour is ${o.color} (expected ${color})`);
  }
  check(ui.status === 'Online (2 players)', `${where} status box says "${ui.status}"`);
  check(ui.chatLog, `${where} chat log is not shown`);
  check(ui.logInButton === guest, `${where} Log in button is ${ui.logInButton ? '' : 'not '}shown`);
  check(ui.logOutButton === !guest, `${where} Log out button is ${ui.logOutButton ? '' : 'not '}shown`);
  check(!ui.loginPopup, `${where} login popup is shown`);
  check(ui.joysticks <= 1, `${where} ${ui.joysticks} joysticks in the page (expected at most 1)`);
  check(ui.gameCanvases === 1, `${where} ${ui.gameCanvases} game canvases (expected 1)`);
  if (player.isPhone) {
    check(ui.chatButton, `${where} Chat button is not shown`);
    check(ui.joystickShown, `${where} joystick is not shown`);
  }
}

// Checks both pages, and that the server has exactly the 2 expected fish.
async function checkBoth(ann, ben, observer, { guest, where }) {
  await waitBothOnline(ann, ben, where);
  checkPage(await readUi(ann), ann, ben, { guest, where: `${where}, ${ann.name}:` });
  checkPage(await readUi(ben), ben, ann, { guest, where: `${where}, ${ben.name}:` });

  const fish = await readFish(observer);
  check(fish.length === 2, `${where}: the server has ${fish.length} fish (expected 2): ${fish.map((f) => f.name).join(', ')}`);
  for (const f of fish) {
    check(f.guest === guest, `${where}: the server's fish "${f.name}" has guest = ${f.guest}`);
    if (!guest) check(f.id === ann.id || f.id === ben.id, `${where}: unexpected fish id ${f.id}`);
  }
}

// Both say something; each message must arrive at the other, exactly once.
async function checkChat(ann, ben, { annText, benText, where }) {
  await say(ann, annText);
  await wait(GUEST_CHAT_GAP_MS);
  await say(ben, benText);
  const arrived = await waitUntil(
    async () =>
      (await readUi(ann)).chatLines.some((line) => line.includes(benText)) &&
      (await readUi(ben)).chatLines.some((line) => line.includes(annText)),
  );
  check(arrived, `${where}: chat did not arrive both ways`);
  for (const player of [ann, ben]) {
    const lines = (await readUi(player)).chatLines;
    for (const text of [annText, benText]) {
      const copies = lines.filter((line) => line.includes(text)).length;
      check(copies === 1, `${where}, ${player.name}: "${text}" is in the chat log ${copies} times (expected 1)`);
    }
  }
  const bubbleShown = await ben.page.evaluate(
    (text) => [...document.querySelectorAll('.player-tag')].some((tag) => !tag.querySelector('.chat-bubble').hidden && tag.textContent.includes(text)),
    annText,
  );
  check(bubbleShown, `${where}: test_ann's chat bubble is not shown on test_ben's screen`);
  await wait(GUEST_CHAT_GAP_MS);
}

// Guests may send at most 60 characters: the chat box stops at 60.
async function checkGuestChatLimit(ann, ben, where) {
  const long = 'abcdefghij'.repeat(7); // 70 characters
  await say(ann, long);
  const allowed = long.slice(0, GUEST_CHAT_MAX_CHARS);
  const arrived = await waitUntil(async () => (await readUi(ben)).chatLines.some((line) => line.includes(allowed)));
  check(arrived, `${where}: the long guest message did not arrive`);
  const tooLong = (await readUi(ben)).chatLines.some((line) => line.includes(long.slice(0, GUEST_CHAT_MAX_CHARS + 1)));
  check(!tooLong, `${where}: a guest message longer than ${GUEST_CHAT_MAX_CHARS} characters got through`);
  await wait(GUEST_CHAT_GAP_MS);
}

// Holds an arrow key down for `ms` (PC only).
async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
}

// Opens the popup and checks that the fish stands still and Enter does not
// open the chat while it is open. Then closes it in the given way, and
// checks that the fish can swim again.
async function checkPopup(player, observer, { closeWith, where, swimKey }) {
  const page = player.page;
  await openPopup(player);
  const before = await serverFishOf(player, observer);

  if (!player.isPhone) {
    // Hold a movement key: the fish must not move while the popup is open.
    await holdKey(page, swimKey, 600);
    await page.keyboard.press('Enter'); // must not open the chat
    await wait(800);
    const after = await serverFishOf(player, observer);
    check(before && after && Math.abs(after.x - before.x) <= SAME_PLACE_PX && Math.abs(after.y - before.y) <= SAME_PLACE_PX,
      `${where}: the fish moved while the login popup was open (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
    check(!(await readUi(player)).chatBox, `${where}: Enter opened the chat box under the login popup`);
  }

  if (closeWith === 'esc') await page.keyboard.press('Escape');
  else if (closeWith === 'x') await press(player, '#auth-close');
  else if (player.isPhone) await page.touchscreen.tap(3, 3); // the dark area outside the card
  else await page.mouse.click(3, 3);
  const closed = await waitUntil(async () => !(await readUi(player)).loginPopup, 3000);
  check(closed, `${where}: the popup did not close with ${closeWith}`);
  const ui = await readUi(player);
  check(ui.logInButton, `${where}: Log in button is not shown after closing the popup`);

  if (!player.isPhone) {
    // The fish can swim again.
    const start = await serverFishOf(player, observer);
    await holdKey(page, swimKey, 400);
    await wait(1500); // the fish glides a little after the key is let go
    const moved = await serverFishOf(player, observer);
    check(start && moved && Math.abs(moved.x - start.x) > SAME_PLACE_PX,
      `${where}: the fish cannot swim after the popup closed`);
  }
}

// The server's fish of `player` must be within SAME_PLACE_PX of `place`.
async function checkSamePlace(player, observer, place, where) {
  const fish = await serverFishOf(player, observer);
  const same = fish && Math.abs(fish.x - place.x) <= SAME_PLACE_PX && Math.abs(fish.y - place.y) <= SAME_PLACE_PX;
  check(same, `${where}, ${player.name}: the fish moved from (${place.x}, ${place.y}) to ${fish ? `(${fish.x}, ${fish.y})` : 'nowhere'}`);
  return fish;
}

// ======================= One round =======================

async function playRound(round, ann, ben, observer) {
  const r = `round ${round}`;

  // 1. Guest chat.
  await checkChat(ann, ben, { annText: `hi from guest ann ${round}`, benText: `你好 guest ben ${round}`, where: `${r} as guests` });
  if (round === 1) await checkGuestChatLimit(ann, ben, `${r} as guests`);

  // 2. The popup: opening and closing it, in a different way each round.
  const closeWays = ['esc', 'x', 'outside'];
  await checkPopup(ann, observer, {
    closeWith: closeWays[(round - 1) % 3],
    where: `${r}, test_ann popup`,
    // Left and right in turn, so the fish never reaches a wall.
    swimKey: round % 2 ? 'ArrowRight' : 'ArrowLeft',
  });
  await checkPopup(ben, observer, { closeWith: closeWays[round % 3], where: `${r}, test_ben popup` });

  // 3. Log in. The fish must stay where the guest fish was.
  const guestFish = { ann: await serverFishOf(ann, observer), ben: await serverFishOf(ben, observer) };
  await logIn(ann);
  await logIn(ben);
  await checkBoth(ann, ben, observer, { guest: false, where: `${r} after login` });
  await checkSamePlace(ann, observer, guestFish.ann, `${r} after login`);
  await checkSamePlace(ben, observer, guestFish.ben, `${r} after login`);
  await checkChat(ann, ben, { annText: `hello ben ${round}`, benText: `你好 ann ${round}`, where: `${r} logged in` });

  // 4. Log out. A NEW guest, in the same place.
  const userFish = { ann: await serverFishOf(ann, observer), ben: await serverFishOf(ben, observer) };
  await press(ann, '#logout-button');
  await press(ben, '#logout-button');
  await checkBoth(ann, ben, observer, { guest: true, where: `${r} after logout` });
  for (const player of [ann, ben]) {
    const fish = await checkSamePlace(player, observer, userFish[player === ann ? 'ann' : 'ben'], `${r} after logout`);
    const oldGuest = guestFish[player === ann ? 'ann' : 'ben'];
    check(!fish || !oldGuest || fish.id !== oldGuest.id, `${r} after logout, ${player.name}: still the old guest (expected a new one)`);
  }
}

// ======================= Main =======================

async function main() {
  console.log('Starting test servers (website on port 4300, real-time server on port 8797)...');
  await startTestServers();

  const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: !process.env.HEADED });
  try {
    const observer = await openObserver(browser);
    const ann = await openPlayer(browser, 'u-test-ann', 'test_ann', { viewport: { width: 900, height: 600 } });
    const ben = await openPlayer(browser, 'u-test-ben', 'test_ben', {
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    // At page load: guests straight away, no popup.
    await checkBoth(ann, ben, observer, { guest: true, where: 'page load' });
    console.log(`Page load: ${problems.length + pageErrors.length === 0 ? 'OK' : 'PROBLEMS (see below)'}`);

    for (let round = 1; round <= ROUNDS; round++) {
      const before = problems.length + pageErrors.length;
      await playRound(round, ann, ben, observer);
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
console.log(passed ? '\nPASSED: guest → log in → log out → guest works every time.' : '\nFAILED.');
// A non-zero exit code tells scripts (and you) that the test failed.
process.exit(passed ? 0 : 1);
