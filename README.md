# Pixel World

A small 2D pixel-art open world game for the web (top-down view).
PC and phone players will share the same world.

**Done so far:**
- Step 1: log in with a username and password, then walk around a placeholder map.
- Step 2: real-time multiplayer. Everyone who is logged in sees each other move.

Chat comes next.

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
  world.js           Map size, walking speed, spawn point
realtime/            Real-time server (Cloudflare Worker), deployed separately
  src/index.js       Checks origin, room and token, then passes the connection on
  src/WorldRoom.js   One game room: players, move checks, the 10-per-second tick
  src/auth.js        Token check with `jose`
  wrangler.jsonc     Worker settings (Durable Object, allowed websites)
public/assets/       Images (served as they are)
src/
  main.js            Page start-up: auto login, login form, start the game
  ui/                HTML login form, API calls, token storage, status box, CSS
  net/               Connection to the real-time server
  game/              Phaser game: scenes, Player class, remote players, controls
Sprites/             Unused sprites for later (attack animations)
```

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
uses about 2,000 requests. The room stops its timer when nobody is online, so it can shut down
and stop using run time.

## If something goes wrong

| What you see | Likely reason |
|---|---|
| "Offline mode (no game server set)" | `VITE_REALTIME_HOST` is empty. Set it and restart `vercel dev` (or redeploy Vercel). |
| "Game server rejected your login…" | `JWT_SECRET` is different on Vercel and on the Worker (or in `.env.local` and `realtime/.dev.vars`). The browser console says so too. |
| Stays on "Reconnecting…", then "Retry" | The real-time server is not running, or the address is wrong, or the website is not in `ALLOWED_ORIGINS`. |
| "You are playing in another tab or device." | The same account opened the game somewhere else. "Play here" moves the game to this tab. |

## Check that it builds

```bash
npm run build
```
