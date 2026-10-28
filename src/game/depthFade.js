// Makes fish fade into the water as they swim deeper.
// Near the surface a fish has its normal colours. Deeper down it takes on
// the colour of the water around it and becomes more see-through, until it
// is almost invisible at the bottom. (A glow/light effect comes later.)
//
// Used for every fish: your own, other players, and fish seen by spectators.
// Name labels and chat bubbles are not faded (they are HTML).

import { waterColorAt, mixColors } from './Ocean.js';

// ---------- Tweak these ----------

// Where fading starts, as a share of the world height (0 = surface, 1 = bottom).
// Above this depth, fish keep their full colours.
export const FADE_START_DEPTH = 0.2;

// How visible a fish is at the very bottom (its alpha: 0 = invisible, 1 = solid).
// Your own fish stays a bit more visible, so you can still find yourself.
export const MIN_VISIBILITY_OWN_FISH = 0.15;
export const MIN_VISIBILITY_OTHER_FISH = 0.05;

// ---------- The curve ----------
// `t` goes from 0 (at FADE_START_DEPTH) to 1 (at the bottom).
// We use fade = t × t (an "ease-in" curve) instead of fade = t (a straight line):
// it changes slowly at first, then faster deeper down. So fish stay bright
// in the shallow part and darken quickly near the bottom. For example:
//   a quarter of the way down the fading part:  t = 0.25 -> fade = 0.06
//   halfway:                                     t = 0.5  -> fade = 0.25
//   three quarters of the way:                   t = 0.75 -> fade = 0.56
//   the bottom:                                  t = 1    -> fade = 1

const WHITE = 0xffffff; // a white tint = the picture's normal colours

// Works out how a fish at height `y` should look.
// Returns { tint, alpha } to put on the fish picture:
//   tint:  mixes from white (normal colours) toward the water colour at
//          this depth. A tint multiplies the picture's colours, so the fish
//          takes on the water's blue and gets darker, like the water does.
//   alpha: from 1 down to `minVisibility` at the bottom.
export function depthFade(y, worldHeight, minVisibility) {
  const depth = Math.min(1, Math.max(0, y / worldHeight));
  const t = Math.max(0, (depth - FADE_START_DEPTH) / (1 - FADE_START_DEPTH));
  const fade = t * t;

  return {
    tint: mixColors(WHITE, waterColorAt(depth), fade),
    alpha: 1 - fade * (1 - minVisibility),
  };
}
