# assets/original/

Drop your own extracted sprites and sounds here together with a
`manifest.json` and the game will load them at start-up instead of its
built-in artwork and synthesised audio.

```json
{
  "images": { "playfield": "playfield.png", "ball": "ball.png" },
  "sounds": { "bumper": "bumper.wav", "flipper": "flipper.wav" },
  "music":  "theme.ogg"
}
```

The slot names are listed in the project README and in the in-game
**Assets…** panel.

Everything in this directory except this file is git-ignored: media from a
commercial game is copyrighted and must not be committed or redistributed.
Use it locally, from your own copy.
