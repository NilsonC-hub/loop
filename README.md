# LOOP

An interactive optical artwork in four movements.

**Graphics by 沈翰轩**

[Open LOOP](https://nilsonc-hub.github.io/loop/)

## Play

- Drag horizontally to unfold one composition into the next. Pull back to reverse it.
- Click the artwork to play the next sound in the current scene's sequence.
- Drag to draw notes and air from the line field. Stop moving or release to let the sound fade.
- Use the sound button or **M** to enable or mute sound. Enabling alone is silent, and an explicit mute stays in effect during further interactions.
- Use **Left / Right** to change scenes and **Escape** to cancel a drag.
- Press **Space** to pause autonomous visual motion or **F** to toggle fullscreen.

The four scenes share continuous geometry: green loops, blue diagonals, a suspended point field and a bright yellow spiral. Each scene has three authored sound-sequence variants. Taps advance one event, while actual drag distance advances notes and movement shapes the air. You control the rhythm and the pauses. Scene changes and returning to the tab do not start playback.

The artwork responds to actual note attacks, pitch and measured audio frequency bands. Quiet visual motion continues when sound is muted. The intended viewing surface is a desktop browser.

## Run locally

Serve this directory with any static HTTP server, then open its local URL in a browser. There is no dependency installation or build step. JavaScript and Web Audio support are required for the full experience.

All fonts and sound files are served locally with the site. There are no remote font requests, analytics or cloud audio services.

## Assets and credits

- **Graphics by 沈翰轩**
- **Syne** typeface: SIL Open Font License; see [`fonts/OFL.txt`](fonts/OFL.txt).
- **Noto Sans SC**: a small subset is included for the Chinese credit; SIL Open Font License, see [`fonts/NotoSansSC-OFL.txt`](fonts/NotoSansSC-OFL.txt).
- **Earshot 0.3.0** procedural sound bank: `tap/soft`, `whoosh_big/swell`, `pluck/kalimba_soft` and `pluck/kalimba_ring`. The upstream MIT license is preserved in [`audio/LICENSE-earshot.txt`](audio/LICENSE-earshot.txt). The browser plays the rendered local WAV files.

The short film is maintained separately from this interactive website.
