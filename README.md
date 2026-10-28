# Pixel World

A small 2D pixel-art open world game for the web (top-down view).
PC and phone players will share the same world.

**Step 1 (now):** log in with a username and password, then walk around a placeholder map.
Multiplayer and chat come later.

## Tech

- **Frontend:** Vite + Phaser 3 (plain JavaScript)
- **Login API:** Vercel Serverless Functions in the `/api` folder
- **Database:** MongoDB Atlas (database `pixelworld`, collection `users`)
- **Hosting:** Vercel (functions run in Dublin, `dub1`, close to the Atlas cluster in Ireland)

## Folder layout

```
api/                 Login API (each file is one endpoint)
  _lib/              Server-only API code (the "_" means it is not an endpoint)
  register.js        POST /api/register
  login.js           POST /api/login
  me.js              GET  /api/me
shared/              Code used by BOTH the browser and the API (input rules)
public/assets/       Images (served as they are)
src/
  main.js            Page start-up: auto login, login form, start the game
  ui/                HTML login form, API calls, token storage, CSS
  game/              Phaser game: scenes, Player class, controls
Sprites/             Unused sprites for later (attack animations)
```

## Environment variables

| Name | What it is |
|------|------------|
| `MONGODB_URI` | The connection string from MongoDB Atlas. In Atlas: **Connect → Drivers**. It looks like `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`. |
| `MONGODB_DB` | Optional. The database name. If not set, `pixelworld` is used. The database name inside `MONGODB_URI` is ignored. The API creates the unique index on `usernameLower` by itself. |
| `JWT_SECRET` | A long random secret used to sign login tokens. If someone gets it, they can log in as anyone, so keep it private. |

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
4. Make a file called `.env.local` (copy `.env.example`) and fill in both values.
   This file is in `.gitignore`, so it will not be committed.
5. Start the game and the API together:
   ```bash
   vercel dev
   ```
6. Open the address it prints (usually http://localhost:3000).

> `npm run dev` only starts the frontend, so login will not work with it.
> Use `vercel dev` instead.

### MongoDB Atlas network access

Atlas only accepts connections from allowed IP addresses.
In Atlas, go to **Network Access** and add your own IP for local development.
Vercel functions do not have fixed IP addresses, so for the deployed game
you need to allow `0.0.0.0/0` (anywhere). The password in `MONGODB_URI` still protects the database.

## Deploy to Vercel

1. Push the repo to GitHub.
2. On vercel.com, click **Add New → Project** and import the repo.
   Vercel finds Vite by itself (build command `npm run build`, output folder `dist`).
3. In **Project → Settings → Environment Variables**, add `MONGODB_URI` and `JWT_SECRET`.
4. Deploy. After that, every push to `main` deploys again.

If you change an environment variable, deploy again so the functions get the new value.

## Check that it builds

```bash
npm run build
```
