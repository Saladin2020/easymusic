# Easy Music studio install plan (prepared, NOT applied)

Nothing below has been run against `/workspace/indie-studio`. Apply only after the user approves.

1. `git clone /workspace/easymusic /workspace/indie-studio/tools/easymusic && cd $_ && git checkout --detach <SHA>`
2. `npm ci && npm run build && npm test` (expect 38 passed, 1 skipped; the skipped one is the Godot test without `GODOT`).
3. Copy `install-plan/easymusic-cli.mjs` → `/workspace/indie-studio/tools/easymusic-cli.mjs` (same shape as the other
   `easy*-cli.mjs` wrappers: sets `EASYMUSIC_HOME`, `EASYMUSIC_WORKSPACE`, adds `/workspace/indie-studio/projects` to
   `EASYMUSIC_ALLOWED_DIRS`).
4. Copy `install-plan/EASYMUSIC.md` → `/workspace/indie-studio/tools/EASYMUSIC.md` and replace `<SHA>`.
5. Smoke: `node /workspace/indie-studio/tools/easymusic-cli.mjs init --workspace /workspace/indie-studio/projects/_smoke2`
   then `render village_day --out .../_smoke2/music-village.ogg` and `export --workspace .../_smoke2`.
6. Shared skill: install `SKILL.draft.md` as `easymusic-loops` (the parent agent does this).
7. Once a GitHub repo exists (user's call): `git remote add github https://github.com/Saladin2020/easymusic.git` in the install.

Needs `ffmpeg` on PATH for OGG/MP3 (present on the box); WAV works without it.
