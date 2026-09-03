# Space Cadet Pinball

A browser pinball game in the spirit of the classic space-station tables: a
full physics simulation, ramps, bumpers, saucers, missions, ranks, multiball
and tilt — playable with a keyboard on desktop or with touch on a phone.

Open `index.html` over HTTP and play. No build step, no dependencies.

```bash
python3 -m http.server 8080     # then visit http://localhost:8080
```

(ES modules need a real HTTP origin — opening the file directly with `file://`
will not load the scripts.)

## About the original game's assets

**This project contains no artwork, music or sound effects from *3D Pinball:
Space Cadet* or any other commercial game.** Those files are copyrighted by
their publisher and cannot be redistributed here.

What ships instead:

* **Artwork** drawn procedurally on a canvas — deck plating, rails, glowing
  bumpers, ramps, lamps and the ball are all generated in `js/render.js`.
* **Audio** synthesised live with the Web Audio API — every bumper, flipper,
  ramp and jingle in `js/audio.js` is generated from oscillators and noise, and
  the background music is a short synth sequence.

If you own a copy of a game and have extracted its sprites and sounds for your
own use, the game can use **your** files instead. Click **Assets…**, then drop
in files or pick a folder. Everything is read locally in your browser with the
File API; nothing is uploaded anywhere.

### Slot names

Files are matched by filename, ignoring case, extension, spaces and dashes, and
allowing prefixes or numeric suffixes — so `SOUND_BUMPER_1.WAV` matches the
`bumper` slot.

| Kind | Slots |
| --- | --- |
| Images | `playfield`, `ball`, `flipper_left`, `flipper_right`, `bumper`, `bumper_lit`, `target`, `target_lit`, `saucer`, `backdrop`, `logo` |
| Sounds | `flipper`, `bumper`, `slingshot`, `target`, `ramp`, `saucer`, `kick`, `launch`, `plungerPull`, `drain`, `promote`, `missionStart`, `missionOk`, `extraBall`, `tilt`, `lock`, `multiball`, `gameOver`, `lightUp` |
| Music | any audio file whose name contains `music`, `theme`, `song`, `track` or `bgm` |

`playfield` is drawn stretched over the whole 380 × 760 table, so a full
playfield image lines the art up with the physics in one step.

### Loading assets automatically

Rather than picking files every session, drop them into `assets/original/`
next to a `manifest.json`:

```json
{
  "images": { "playfield": "playfield.png", "ball": "ball.png" },
  "sounds": { "bumper": "bumper.wav", "flipper": "flipper.wav" },
  "music":  "theme.ogg"
}
```

The directory is git-ignored, so your personal files never end up in a commit.
If the manifest is absent the game silently uses its built-in art and audio.

## Controls

### Desktop

| Key | Action |
| --- | --- |
| `Z` / `←` / left `Shift` | Left flipper |
| `/` / `→` / right `Shift` | Right flipper |
| `Space` (hold, release) | Pull and release the plunger |
| `X` / `C` / `V` | Nudge left / up / right — too many nudges tilts the table |
| `F2` | New game |
| `P` / `Esc` | Pause |
| `M` / `S` | Toggle music / sound effects |

### Mobile

Touch pads appear over the bottom of the screen: the left and right thirds are
the flippers, the centre pad launches the ball, and the two small arrows under
it nudge the table. **NEW** and **II** sit in the top corners. Multi-touch is
supported, so both flippers work at once.

### Layout toggle

The **Layout** control in the top-right switches between:

* **Auto** — desktop layout on wide screens, mobile layout on narrow ones.
* **Desktop** — table plus a side panel with score, rank, mission and controls.
* **Mobile** — full-height table, HUD strip on top, touch pads on the bottom.

The choice is remembered in `localStorage`.

## How to play

* **Launch** the ball from the lane on the right. Plunger power is shown on the
  meter beside the lane.
* **Pop bumpers** in the dome score and count toward survey missions.
* **Rank targets** (left bank) light one at a time; completing the bank twice
  promotes you: Cadet → Ensign → Lieutenant → Captain → Commander → Admiral →
  Fleet Admiral. Each promotion pays a rank bonus.
* **Mission targets** (right bank) light the **wormhole** at the top of the
  table. Dropping into a lit wormhole starts a mission; the side panel shows
  the objective and a progress bar.
* **Ramps** down each side are worth big points and stack a combo multiplier
  when shot back to back.
* **The centre saucer** locks balls. Two locks start **multiball**, during which
  ramps and the saucer pay jackpots.
* **Fuel targets** and the inlane/top rollovers raise the bonus multiplier, up
  to 10×. The multiplier is cashed when the ball drains.
* **Ball save** covers the first few seconds of every ball, and an outlane
  rollover grants a short grace period.

## Project layout

```
index.html          markup and the asset panel
css/style.css       chrome around the canvas
js/main.js          bootstrap, fixed-step loop, UI wiring
js/game.js          rules: scoring, ranks, missions, multiball, ball flow
js/table.js         table geometry, ramps, saucers, targets, flippers
js/physics.js       ball / segment / circle / flipper collision solver
js/render.js        canvas renderer, desktop and mobile layouts
js/audio.js         Web Audio synthesis for every cue plus the music loop
js/assets.js        loader that swaps in player-supplied art and sounds
js/util.js          vector and geometry helpers
```

### Physics notes

The ball is a circle solved against capsule segments and circles with
positional pushout plus an impulse reflection, run at six substeps per
120 Hz tick. Flippers are rotating capsules; the contact point's surface
velocity is subtracted from the ball's before reflecting, which is what gives a
flip its snap. Velocity is capped below the distance covered in one substep so
a hard shot cannot tunnel through a wall.

## Licence

The code in this repository is provided under the MIT licence. It carries no
third-party media, and the asset loader exists so that anyone using media from
another game is using their own copy of files they already own.
