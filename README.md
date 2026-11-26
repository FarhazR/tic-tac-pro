---
title: Tic-Tac-Pro
emoji: ⭕
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Tic-Tac-Toe where your oldest symbol expires
---

# Tic-Tac-Pro

Tic-Tac-Toe on a 3×3 board where each player may hold at most **three active
symbols**. A fourth move expires the player's oldest symbol (first in, first
out), and victory is checked *after* the expiration. The board therefore never
fills up, and a position is defined by the board **and** both players' move
queues, not the board alone.

The project is a testbed for adversarial search: Random, Rule-Based and
depth-limited Minimax players exist, and Monte Carlo Tree Search is the planned
addition and comparison target.

## Layout

```
src/
  board.py    3×3 grid: place / remove / win check / display
  player.py   symbol + FIFO deque of at most 3 active moves
  game.py     rules, turn order, expiration, draw flag, copy(), legal moves, state_key()
  ai.py       RandomAI, RuleBasedAI, MinimaxAI  (all expose choose_move(game))
  main.py     terminal interface
  server.py   local web server: JSON API over the same engine
web/          browser UI (index.html, style.css, app.js)
run.py        starts the web server and opens the browser
tests/        pytest suite
```

Design rule: **AI code never re-implements the rules.** Every strategy plays
through `game.get_legal_moves()`, `game.copy()` and `game.make_move()`.

## Play in the browser

```powershell
python run.py
```

This starts one local process that serves the web UI **and** the game API
(standard library only, no installs), then opens http://127.0.0.1:8000/.
On Windows you can also double-click `run.bat`. Options: `--port 9000`,
`--no-browser`.

Pick two players or versus CPU (Random, Rule-Based or Minimax with a depth),
press *Start game*, click cells to play, and use *Offer draw* as in the terminal
game. Settings lock while a game is in progress; *Restart* unlocks them. The
cell holding the current player's oldest symbol is dashed, and against Minimax
you can tick *Minimax scores* to see the root score it gave every cell. Wins
and draws are counted per browser tab.

The server is `src/server.py` (one `Session` per visitor, keyed by an
`X-Session-Id` header the page generates, plus a JSON API: `/api/state`,
`/api/new`, `/api/move`, `/api/cpu`, `/api/draw`, `/api/health`); the UI is
`web/`. It is plain `http.server`, so it needs no packages.

## Two ways the browser version can run

- **With the Python server** (`python run.py`): the page talks to
  `src/server.py`, which drives the Python engine and AIs.
- **Without any server**: `web/engine.js` is a line-for-line port of the
  engine and the three AIs. If the page cannot reach `/api/health` it switches
  to the in-browser engine automatically, so the `web/` folder works on any
  static host. `tests/test_js_engine.py` replays random games and Minimax
  positions through both implementations and requires identical results. The
  small note under the board says which engine is in use.

## Deploy to Hugging Face Spaces (free, Static Space)

Hugging Face now puts Docker and Gradio Spaces behind a paid plan; Static
Spaces stay free. The `web/` folder is a complete static site, including its
own `README.md` with the `sdk: static` front matter, so you publish just that
folder.

1. Create a Space at https://huggingface.co/new-space, choose **Static** as
   the SDK, template *Blank*, and create it.
2. From the repository root, push only the `web/` folder as the Space's
   `main` branch:

   ```powershell
   git remote add hf https://huggingface.co/spaces/<your-user>/<space-name>
   ```

   ```powershell
   git subtree push --prefix web hf main
   ```

   When git asks for a password, use a Hugging Face access token with
   *write* permission (https://huggingface.co/settings/tokens). If the Space
   already has a commit and the push is rejected, run
   `git push hf $(git subtree split --prefix web fix/audit-issues):main --force`
   once; afterwards `git subtree push` works.

   No git? Open the Space's *Files* tab and upload `index.html`,
   `style.css`, `app.js`, `engine.js` and `README.md` from `web/`.
3. The Space serves `index.html` straight away. Open the Space URL and play;
   the note under the board reads "running in your browser".

Each later `git subtree push` redeploys. Scores live in the visitor's tab.

## Deploy the Python server instead (paid or self-hosted)

The repo also carries a `Dockerfile` and the `sdk: docker` front matter at
the top of this README, for a Docker Space on a PRO account or any container
host (Render, Fly.io, a VPS). The server binds `0.0.0.0:7860` when `HOST` and
`PORT` are set, caps Minimax depth at 5, keeps one game per visitor and
writes nothing to disk.

```powershell
docker build -t tic-tac-pro .
docker run --rm -p 7860:7860 tic-tac-pro
```

## Play in the terminal

```powershell
python -m src.main
```

Enter moves as `row col` (0–2). Enter `9 9` to offer a draw.

## Test

```powershell
python -m pip install -r requirements.txt
python -m pytest
```

## Known properties of the game (measured)

- At least three cells are always empty, so the game only ends by a win or an
  agreed draw. Complete states can repeat; two always-blocking players can cycle
  indefinitely. Any AI-vs-AI simulation needs a ply cap or a repetition rule.
- Random vs Random: X wins ≈ 54 %, O ≈ 46 %.
- Minimax cost grows ≈ 5× per extra ply without pruning.
