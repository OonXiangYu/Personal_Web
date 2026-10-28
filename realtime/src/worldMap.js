// The map facts (size, walls, spawn) for the real-time server.
//
// We import the SAME map file the browser draws: public/assets/maps/world.tmj.
// wrangler.jsonc has a rule that lets us import .tmj files as text, so the map
// is packed into the Worker when it is built (`wrangler dev` / `wrangler deploy`).
// There is no copy to keep in sync. But it does mean: after changing the map
// in Tiled, deploy BOTH the Worker and the website. (If you forget, players
// see "The game was updated. Please refresh the page.", see WorldScene.js.)
//
// TODO: when there are more rooms (one per map), choose the map by room name.

import mapText from '../../public/assets/maps/world.tmj';
import { readMapInfo } from '../../shared/mapInfo.js';

// Read once, when the Worker starts. If the map is broken, this throws
// a clear error (see readMapInfo), which shows up in the Worker logs.
export const worldMap = readMapInfo(JSON.parse(mapText));
