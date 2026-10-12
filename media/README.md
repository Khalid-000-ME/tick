# media

How the demo and the launch video are made. Everything here is built from the running app, so a rebuild
picks up whatever the product looks like that day.

```
scripts/record.mjs      drives the app in a phone-sized browser and records one video per scene
scripts/cursor.js       the pointer you see: it fades in only to do something, blurs with its speed, presses
scripts/frame.mjs       the backdrop, the phone frame (its screen is a hole) and the screen's corner mask
scripts/close.mjs       the closing card
scripts/build-demo.mjs  trims each scene to its line, composites, captions, and lays the voiceover under
scripts/brag.mjs        the 21-second launch video, with its own track
scripts/store-shots.mjs the 9:16 store previews
scripts/store-art.mjs   the store icon and banner
voice/script.json       the demo's lines, one per scene
voice/VOICEOVER-SCRIPT.md  the same lines with timings, to record by hand
store/                  the finished store art (committed)
```

Rebuilding:

```bash
cd app && npm run dev          # the recorder drives localhost:3000
cd media/scripts
npm_config_yes=1 node record.mjs          # all scenes, or name them: node record.mjs trade room
node frame.mjs && node close.mjs
node build-demo.mjs            # → media/out/tick-demo.mp4
node brag.mjs                  # → brag-output/brag.mp4
```

The voice is [Piper](https://github.com/rhasspy/piper) with the `en_US-ryan-high` model (`pip3 install
piper-tts`, models in `voice/`, both gitignored because they are large). The scenes, renders and finished
videos are build output and are not committed.
