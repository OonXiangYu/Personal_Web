# Oscar World

A small 2D pixel-art game for the web: a **side-view ocean**. Every player is a fish.
Swimming down means going deeper. PC and phone players share the same world.

**Done so far:**
- Log in with a username and password.
- Real-time multiplayer: everyone who is logged in sees each other swim.
- Chat bubbles and a chat log.
- A painted ocean (1920 × 1920 px world) in parallax layers: sky, water and a coral reef along the
  bottom of the screen (resting on the seabed at the bottom), each moving at its own speed when the camera moves (`src/game/ParallaxOcean.js`).
  The water gets darker with depth (a "depth shade"); the reef has its own milder darkening. Plus slow bubbles.
  Fish swim in all directions with a little inertia, and can never leave the water.
- Schools of sardines in the sunlight layer (`src/game/Sardines.js`, "boids"). They scatter when
  any player fish comes close and regroup later. Only in each browser (not sent to the server).
  Press **B** on a PC to show the debug view (neighbour and scare radii, direction arrows).
- The camera stays inside the world (no black is ever shown), plus a 128 px strip of sky
  above the surface (`SKY_VIEW_HEIGHT` in `src/game/Ocean.js`). On very wide screens the
  zoom goes up so the world always fills the screen width.
- A Tiled map with walls, a spawn point and layers above the players.
- Visitors play straight away as a **guest** fish (`Guest_1234`, grey name). Logging in is
  optional: the "Log in" button (top-right) opens the popup. See "Guests" below.

Next: the chat moderation model.

## Before you deploy: run the test

```bash
npm run test:relogin
```

Two visitors (`test_ann` on a PC-sized window, `test_ben` on a 360 px phone) start as guests,
then go guest → log in → log out → guest 5 times without reloading. It checks the name labels
(own name yellow, guests grey), the status box, chat (and the 60-character guest limit), the
Log in / Log out buttons, the popup (the fish stops while it is open; it closes with the X,
Esc or a click outside), the Chat button and joystick, and that the fish **keeps its place**
on every login and logout. Always exactly 2 fish in the room, no duplicates, no JavaScript
errors. It ends with **PASSED** or **FAILED** (and a list of problems).

- Nothing needs to be running: it starts its own test servers on ports **4300** and **8797**
  (and 9339), and stops them at the end. Your own `vercel dev` / `wrangler dev` are not touched.
- It needs **Microsoft Edge** or **Google Chrome** installed (`TEST_BROWSER=chrome` for Chrome).
  `HEADED=1` shows the windows.
- No real secrets and no database: the login is faked inside the test, with a random
  throw-away secret. No accounts are created, so there is nothing to clean up in MongoDB.
  (So it does not test the real login API.)

## How to deploy

Always in this order:

1. **Real-time server first:** `cd realtime && npx wrangler deploy`
2. **Then the website:** `git push` (Vercel deploys it).

Why this order? A new website may ask the server for things an old server does not know
(for example guest connections). A new server still works with an old website.
After changing the map, both steps are needed (see "Editing the map").

## Tech

- **Frontend:** Vite + Phaser 3 (plain JavaScript)
- **Login API:** Vercel Serverless Functions in the `/api` folder
- **Database:** MongoDB Atlas (database `pixelworld`, collection `users`)
- **Real-time server:** [PartyServer](https://github.com/cloudflare/partykit) on Cloudflare Workers + Durable Objects, in the `realtime/` folder.
  The browser connects with [partysocket](https://www.npmjs.com/package/partysocket).
- **Hosting:** Vercel for the site and login API (functions run in Dublin, `dub1`, close to the Atlas cluster in Ireland),
  Cloudflare for the real-time server.

## How the parts fit together

```
Browser ──HTTPS──▶ Vercel  (site + /api/login, /api/register, /api/me) ──▶ MongoDB Atlas
   │                  makes the login token (JWT) with JWT_SECRET
   │
   └──WebSocket + token──▶ Cloudflare Worker (realtime/)
                              checks the token with the SAME JWT_SECRET
                              ──▶ Durable Object "WorldRoom" (one per room, room "main" for now)
```

The two servers never talk to each other. They only share `JWT_SECRET`,
so the game server can trust tokens made by the login API.

## Folder layout

```
api/                 Login API (each file is one endpoint)
  _lib/              Server-only API code (the "_" means it is not an endpoint)
  register.js        POST /api/register
  login.js           POST /api/login
  me.js              GET  /api/me
shared/              Code used by the browser AND the servers
  validate.js        Username and password rules
  protocol.js        Real-time message types and limits
  world.js           Swimming speed, fish facings, fish hit box and size
  mapInfo.js         Reads size, walls and spawn from the Tiled map (browser + server)
realtime/            Real-time server (Cloudflare Worker), deployed separately
  src/index.js       Checks origin, room and token, then passes the connection on
  src/WorldRoom.js   One game room: players, move checks, the 10-per-second tick
  src/worldMap.js    Imports the same world.tmj as the browser
  src/auth.js        Token check with `jose`
  wrangler.jsonc     Worker settings (Durable Object, allowed websites)
public/assets/       Images and the map (served as they are). File names: lowercase only.
  maps/world.tmj     The world map (Tiled)
  tilesets/          Tileset images used by the map (collision.png: the red wall tile)
  backgrounds/ocean/ The parallax layers: sky, water, coral-far/mid/near/close/foreground (480 px wide, repeating)
  sprites/fish/      The fish swim animations (clownfish-swim.png: 8 frames of 45 x 27, facing left;
                     sardine-swim.png: 3 sizes x 9 frames, cells of 31 x 7)
  fonts/             The pixel font (Fusion Pixel) and its license files
tests/
  relogin.test.js    Guest → log in → log out → guest, 5 times on PC and phone (npm run test:relogin)
tools/
  generate-map.js    Sets up world.tmj: size, empty "ground" layer, collision tileset, spawn point
  make-fish-animation.js  Lines up the fish frames and packs them into clownfish-swim.png
  make-sardine-animation.js  The same for the sardine frames (3 sizes) -> sardine-swim.png
  png.js             Small PNG read/write helpers for the tools
src/
  main.js            Page start-up: auto login, login form, start the game
  ui/                HTML login form, API calls, token storage, status box, CSS
  net/               Connection to the real-time server
  game/              Phaser game: scenes, map, ocean background, fish (Player.js), controls
old-assets/          Files we no longer use, kept just in case (never served):
                     the original fish frames (clownfish-frames/, the source for
                     tools/make-fish-animation.js), the old single fish and its old script
```

## Editing the map (Tiled)

The map is `public/assets/maps/world.tmj`. Open it with [Tiled](https://www.mapeditor.org/).
The game reads the map size, walls and spawn point **from this file**, in the browser
and on the real-time server, so there are no numbers to change in the code.

Rules:
- Every tile layer is drawn, in the same order as in Tiled (bottom layer first).
- Keep tilesets **embedded** in the map (when adding one, choose "Embed in map").
- Keep **Tile Layer Format: CSV** (Map > Map Properties). The game cannot read base64.
- All asset file names are lowercase (the live server is case-sensitive).
- The `ground` layer is empty on purpose: the water, sky and bubbles are drawn by the game
  (colours in `src/game/Ocean.js`). `node tools/generate-map.js` empties `ground` again,
  so paint on your own layers above it.

### Layers above the players (treetops, roofs)

Normally every tile layer is drawn **under** the players. To draw a layer **over** them:
1. Select the layer in the Layers panel.
2. In the Properties panel, under **Custom Properties**, click **+**.
3. Name: `above`, type: **bool**. Click OK, then tick the box (value = true).

### Walls (the collision layer)

1. **Layer > New > Tile Layer**. Name it exactly `collision` (lowercase).
2. Paint with the red tile from the `collision` tileset where fish must not swim.
   (Any tile works; the game never draws this layer.)
3. Save. Every non-empty tile in this layer is a wall. Fish slide along walls.
   Only the fish's **body** touches walls (34 × 16 px), so thin fins and the tail can overlap a wall a little.

### Spawn area (where players start)

The map already has a rectangle named `spawn` in the `points` object layer
(x 480–1440, y 64–192: the sunlit water near the surface). Each new player starts at a
**random spot inside it**, so fish do not appear on top of each other. The server picks the spot.

To change it in Tiled: select the `points` layer, click the rectangle and move or resize it.
To make a new one: **Insert Rectangle** tool (shortcut `R`), draw it, and set its **Name** to `spawn`.
A **point** named `spawn` also works (then everyone starts at that exact spot).

- Without any `spawn` object, the default area above is used.
- Spots inside walls are never used (the game picks the nearest free spot instead).
- A player who reconnects within **60 seconds** (`QUICK_RECONNECT_MS` in
  `realtime/src/WorldRoom.js`) comes back where they left. Later, they start in the spawn area again.

### Fish fade with depth

Deeper fish take on the water's colour and become see-through, so they are almost
invisible at the bottom. Settings are at the top of `src/game/depthFade.js`:
where the fading starts, and how visible your own fish / other fish stay at the bottom.

### Darkness and light in the deep

Deep water gets dark (darker toward the bottom of the screen, by real depth). Your fish
carries a soft light that lights up the water and fish around you; other fish are small
glowing points in the dark, and their names fade out until they come near your light.
Logged out, a wide gentle light follows the middle of the screen.
All settings (where darkness starts, how dark, light sizes, glow colours, pulse, name fade
distance) are at the top of `src/game/DeepLight.js`. Without WebGL, the darkness is skipped.

### After changing the map: deploy BOTH parts

The website and the real-time server each read their own copy of `world.tmj`.
After changing walls, the spawn point or the map size, deploy both, or players will see
"The game was updated. Please refresh the page." and walls may feel wrong.
Follow "How to deploy" above (real-time server first, then the website).
Locally, `npx wrangler dev` notices the change by itself; just refresh the browser.
(Only decoration layers changed? Then the website deploy is enough.)

## Environment variables

| Name | What it is |
|------|------------|
| `MONGODB_URI` | The connection string from MongoDB Atlas. In Atlas: **Connect → Drivers**. It looks like `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`. |
| `MONGODB_DB` | Optional. The database name. If not set, `pixelworld` is used. The database name inside `MONGODB_URI` is ignored. The API creates the unique index on `usernameLower` by itself. |
| `JWT_SECRET` | A long random secret used to sign login tokens. If someone gets it, they can log in as anyone, so keep it private. The real-time server needs the **same** value. |
| `VITE_REALTIME_HOST` | Address of the real-time server, without `http://` or `ws://`. Locally `localhost:8787`. In production `pixelworld-realtime.<your-subdomain>.workers.dev`. Vite builds it into the browser code, so it is not secret. If it is empty, the game runs single player. |

The real-time server (`realtime/`) has its own settings:

| Name | Where | What it is |
|------|-------|------------|
| `JWT_SECRET` | `realtime/.dev.vars` locally, `npx wrangler secret put JWT_SECRET` in production | Must be exactly the same as the Vercel `JWT_SECRET`. |
| `ALLOWED_ORIGINS` | `vars` in `realtime/wrangler.jsonc` | Websites that may connect, separated by commas. Now: `https://oscar-world.vercel.app,http://localhost:3000`. |

### How to make `JWT_SECRET`

Run one of these and copy the output:

```bash
openssl rand -hex 32
```

or, if you do not have `openssl`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use a different secret for local development and for production.
If you change the secret, everyone is logged out (their old tokens stop working).

## Run locally

You need Node.js 18 or newer.

1. Install the packages:
   ```bash
   npm install
   ```
2. Install the Vercel CLI (once) and log in:
   ```bash
   npm install -g vercel
   vercel login
   ```
3. Link this folder to a Vercel project (once). Answer the questions; the defaults are fine:
   ```bash
   vercel link
   ```
4. Make a file called `.env.local` (copy `.env.example`) and fill in the values.
   This file is in `.gitignore`, so it will not be committed.
5. Set up the real-time server (once):
   ```bash
   cd realtime
   npm install
   ```
   Copy `realtime/.dev.vars.example` to `realtime/.dev.vars` and put the **same**
   `JWT_SECRET` as in `.env.local`. This file is also in `.gitignore`.
6. Start both servers, each in its own terminal:
   ```bash
   # Terminal 1, in the main folder: site + login API on port 3000
   vercel dev

   # Terminal 2, in the realtime folder: real-time server on port 8787
   cd realtime
   npx wrangler dev
   ```
7. Open http://localhost:3000. The box in the top-left corner should say "Online (1 player)".

> `npm run dev` only starts the frontend, so login will not work with it.
> Use `vercel dev` instead.

> Use `localhost:3000`, not `127.0.0.1:3000`. The real-time server only accepts
> the websites in `ALLOWED_ORIGINS`, and the browser sends them exactly as typed.

### Test multiplayer on one computer

You need two different accounts, because one account can only play in one place
(a second tab closes the first one).

1. Open http://localhost:3000 in a normal window and log in as user A.
2. Open http://localhost:3000 in a private (incognito) window and log in as user B.
   Private windows have their own storage, so they keep separate logins.
3. Walk around in one window and watch the other.

### MongoDB Atlas network access

Atlas only accepts connections from allowed IP addresses.
In Atlas, go to **Network Access** and add your own IP for local development.
Vercel functions do not have fixed IP addresses, so for the deployed game
you need to allow `0.0.0.0/0` (anywhere). The password in `MONGODB_URI` still protects the database.

## Deploy to Vercel

1. Push the repo to GitHub.
2. On vercel.com, click **Add New → Project** and import the repo.
   Vercel finds Vite by itself (build command `npm run build`, output folder `dist`).
3. In **Project → Settings → Environment Variables**, add `MONGODB_URI`, `JWT_SECRET`
   and `VITE_REALTIME_HOST` (the workers.dev address, see below).
4. Deploy. After that, every push to `main` deploys again.

If you change an environment variable, deploy again so the functions get the new value.
`VITE_REALTIME_HOST` is built into the browser code, so it also needs a new deploy.

## Deploy the real-time server to Cloudflare

You need a Cloudflare account (the free Workers plan is enough) and `npx wrangler login` once.

```bash
cd realtime
npx wrangler secret put JWT_SECRET   # paste the SAME value as on Vercel
npx wrangler deploy
```

`wrangler deploy` prints the address, for example
`https://pixelworld-realtime.<your-subdomain>.workers.dev`.
Put the part after `https://` into `VITE_REALTIME_HOST` on Vercel, then redeploy Vercel.

To check the Worker without deploying: `npm run check` (in `realtime/`).

### Free plan limits

Durable Objects on the free plan must use SQLite storage (`new_sqlite_classes` in `wrangler.jsonc`, already set).
The free plan allows 100,000 requests and 13,000 GB-seconds of run time per day.
Every 20 messages from browsers count as 1 request, so one player walking for an hour
uses about 2,000 requests. The room stops its timer when no players are online.

### Guests

Visitors without a login connect as guests (`?guest=1`, no token; the Origin is still checked).

- The **server** makes the guest's id (`guest:` + random) and name (`Guest_` + 4 digits).
  The browser cannot choose them. Guests are never stored in MongoDB.
- Guests are real players: shown, counted, and they start the room's timer.
- Guest chat is stricter: at most **60 characters**, 1 message per 2 s, 6 per 30 s
  (logged-in players: 80 characters, about 1 per second, 10 per 30 s). All chat goes
  through the moderation step.
- Usernames starting with "guest" (any case) cannot be registered, so nobody can look like a guest.
- A saved valid login logs in by itself on page load.
- **Handoff token:** each `welcome` gives the page a secret token (valid 60 s after the
  connection closes). The next connection sends it, so after login or logout the fish stays in
  the same place, and a reconnecting guest keeps the same name.

Limits (in `shared/protocol.js`):

- `MAX_FISH_PER_ROOM = 30`. A new visitor in a full tank watches as a spectator
  ("The tank is full. You are watching." + "Try again"; close code **4005**). A guest who logs
  in keeps their slot and is never refused.
- Idle fish are closed: guests after **15 minutes**, logged-in players after **30 minutes**
  without moving or chatting (`GUEST_IDLE_MS`, `PLAYER_IDLE_MS`; close code **4006**). The page
  shows "You were away for a while." + "Rejoin", and does not reconnect by itself.

### Spectators (full tank)

When the tank is full, the page opens a read-only "spectator" connection instead
(no token, `?spectator=1`; the Origin is still checked).

- Spectators see players' names and positions, but **never chat**. Anything they send is ignored.
- They are not players: not shown, not counted in "Online (N players)".
- At most **50 spectators** per room; more get close code 4003 and just see the map.
- A spectator connection closes after **10 minutes** (close code 4004) and does not reconnect.
- They never start the room's 10-per-second timer; only players do.
- Free plan: each spectator costs **1 request** when connecting, and sends nothing after that.
  An open connection keeps the room running, but run time is counted **per room**, not per
  connection: one room running all day is 24 h × 128 MB = 10,800 GB-s, under the free 13,000.
  (With several rooms later, this needs another look.)

## If something goes wrong

| What you see | Likely reason |
|---|---|
| "Offline mode (no game server set)" | `VITE_REALTIME_HOST` is empty. Set it and restart `vercel dev` (or redeploy Vercel). |
| "Game server rejected your login…" | `JWT_SECRET` is different on Vercel and on the Worker (or in `.env.local` and `realtime/.dev.vars`). The browser console says so too. |
| Stays on "Reconnecting…", then "Retry" | The real-time server is not running, or the address is wrong, or the website is not in `ALLOWED_ORIGINS`. |
| "You are playing in another tab or device." | The same account opened the game somewhere else. "Play here" moves the game to this tab. |
| "The game was updated. Please refresh the page." | The page and the real-time server have different maps. Refresh. If it stays, deploy both parts (see "Editing the map"). The browser console shows both map fingerprints. |
| The map does not show, console says a tileset is not embedded | In Tiled, select the tileset and use "Embed Tileset". |

## Check that it builds

```bash
npm run build
```

## Pixel font

All text uses **Fusion Pixel Font** (12px design, Simplified Chinese version), which covers
Chinese, English, numbers and symbols. Pixel fonts are only sharp at whole multiples of their
design size, so the CSS uses only **12px, 24px and 36px** for text. Emoji use the system font.

The font file has its version in the name. `vercel.json` tells browsers to keep `.woff2` files
in `public/assets/fonts/` for a year, so a new font version must get a **new file name**
(then update the name in `index.html` and `src/ui/style.css`).

## Credits

- **Fusion Pixel Font** by TakWolf — https://github.com/TakWolf/fusion-pixel-font
  (version 2026.10.25, file `fusion-pixel-12px-proportional-zh_hans`).
  Licensed under the [SIL Open Font License 1.1](public/assets/fonts/fusion-pixel-font-license.txt).
  It includes glyphs from these fonts, whose licenses are in `public/assets/fonts/licenses/`:
  - Ark Pixel Font by TakWolf — SIL Open Font License 1.1
  - Cubic 11 (俐方體11號) — free license, see `cubic-11-license.txt`
  - Galmuri by Lee Minseo — SIL Open Font License 1.1
