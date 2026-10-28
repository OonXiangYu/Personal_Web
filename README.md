# Oscar World

A small 2D pixel-art open world game for the web (top-down view).
PC and phone players will share the same world.

**Done so far:**
- Log in with a username and password.
- Real-time multiplayer: everyone who is logged in sees each other move.
- Chat bubbles and a chat log.
- A Tiled map with walls, a spawn point and layers above the players.
- Before logging in, the live world runs behind the login popup
  (logged-out visitors watch as read-only "spectators", see below).

Next: the chat moderation model.

## How to deploy

Always in this order:

1. **Real-time server first:** `cd realtime && npx wrangler deploy`
2. **Then the website:** `git push` (Vercel deploys it).

Why this order? A new website may ask the server for things an old server does not know
(for example spectator connections). A new server still works with an old website.
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
  world.js           Walking speed, player size
  mapInfo.js         Reads size, walls and spawn from the Tiled map (browser + server)
realtime/            Real-time server (Cloudflare Worker), deployed separately
  src/index.js       Checks origin, room and token, then passes the connection on
  src/WorldRoom.js   One game room: players, move checks, the 10-per-second tick
  src/worldMap.js    Imports the same world.tmj as the browser
  src/auth.js        Token check with `jose`
  wrangler.jsonc     Worker settings (Durable Object, allowed websites)
public/assets/       Images and the map (served as they are). File names: lowercase only.
  maps/world.tmj     The world map (Tiled)
  tilesets/          Tileset images used by the map
  fonts/             The pixel font (Fusion Pixel) and its license files
tools/
  generate-floor.js  Makes the "ground" layer of world.tmj (grass)
src/
  main.js            Page start-up: auto login, login form, start the game
  ui/                HTML login form, API calls, token storage, status box, CSS
  net/               Connection to the real-time server
  game/              Phaser game: scenes, map, Player class, remote players, controls
Sprites/             Unused sprites for later (attack animations)
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
- Do not paint on the `ground` layer: `node tools/generate-floor.js` replaces it.
  Paint on your own layers above it.

### Layers above the players (treetops, roofs)

Normally every tile layer is drawn **under** the players. To draw a layer **over** them:
1. Select the layer in the Layers panel.
2. In the Properties panel, under **Custom Properties**, click **+**.
3. Name: `above`, type: **bool**. Click OK, then tick the box (value = true).

### Walls (the collision layer)

1. **Layer > New > Tile Layer**. Name it exactly `collision` (lowercase).
2. Paint any tile where players must not walk. Which tile does not matter; it is never drawn.
   Tip: lower the layer's opacity in Tiled so you can see the map under it.
3. Save. Every non-empty tile in this layer is a wall. Players slide along walls.
   Only the player's **feet** touch walls, so their head can overlap a wall that is "behind" them.

### Spawn point (where players start)

1. **Layer > New > Object Layer** (any name, for example `points`).
2. Pick the **Insert Point** tool (the pin icon, shortcut `I`) and click where players should start.
3. In the Properties panel, set the object's **Name** to `spawn`.
4. Save.

Without a spawn point, players start in the middle of the map.
If the spawn point is on a wall, the game moves it to the nearest free spot.

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

### Spectators (logged-out visitors)

The login page shows the live world. For that, a logged-out page opens a read-only
"spectator" connection (no token, `?spectator=1`; the Origin is still checked).

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
