---
title: Tic-Tac-Pro
emoji: ⭕
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Tic-Tac-Toe where your oldest symbol expires. Play the Minimax AI.
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

## Deploy to Hugging Face Spaces

The repo already contains the three things a Docker Space needs: the YAML
front matter at the top of this README (`sdk: docker`, `app_port: 7860`), a
`Dockerfile`, and a server that binds `0.0.0.0:7860` when `HOST`/`PORT` are set.

1. Create a Space at https://huggingface.co/new-space with **SDK: Docker**
   (template *Blank*), public or private as you like.
2. Push this repository to it:

   ```powershell
   git remote add hf https://huggingface.co/spaces/<your-user>/<space-name>
   git push hf fix/audit-issues:main
   ```

   Use a Hugging Face access token with *write* permission as the password
   when git asks. (Or upload the files through the Space's *Files* tab:
   `Dockerfile`, `README.md`, `run.py`, `src/`, `web/`.)
3. The Space builds the image and starts `python run.py --no-browser`; the
   *Logs* tab shows `Tic-Tac-Pro running at http://0.0.0.0:7860`. Open the
   Space URL and play.

Notes: each visitor gets their own game (sessions expire after two hours of
inactivity); Minimax depth is capped at 5 so a CPU move stays well under a
second on the free CPU tier; nothing is written to disk.

Run the same container locally:

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
