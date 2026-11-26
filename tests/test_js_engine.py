"""Cross-check web/engine.js (the in-browser port) against the Python engine.

Skipped when Node.js is not installed. Random game sequences and Minimax
positions are generated here, replayed in both implementations, and must
agree exactly (boards, queues, winners, legal moves, Minimax root scores).
"""
import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from src.ai import MinimaxAI
from src.game import Game

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "web" / "engine.js"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

NODE_SCRIPT = r"""
const T = require(process.argv[process.argv.length - 1]);   // with `node -e`, argv has no script entry
const cases = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = { games: [], scores: [] };
for (const moves of cases.games) {
  const g = new T.Game();
  const accepted = [];
  for (const [r, c] of moves) accepted.push(g.makeMove(r, c));
  out.games.push({
    accepted, board: g.board.grid, x: g.player1.moves, o: g.player2.moves,
    current: g.currentPlayer.symbol, over: g.gameOver, winner: g.winner,
    legal: g.getLegalMoves(),
  });
}
for (const { moves, depth } of cases.positions) {
  const g = new T.Game();
  for (const [r, c] of moves) g.makeMove(r, c);
  const ai = new T.MinimaxAI(depth);
  out.scores.push(g.gameOver ? null : Object.fromEntries(ai.scoreMoves(g)));
}
process.stdout.write(JSON.stringify(out));
"""


def run_node(payload):
    result = subprocess.run(
        [NODE, "-e", NODE_SCRIPT, str(ENGINE)],
        input=json.dumps(payload), capture_output=True, text=True, check=True, cwd=ROOT,
    )
    return json.loads(result.stdout)


def python_game(moves):
    g = Game()
    accepted = [g.make_move(r, c) for r, c in moves]
    return {
        "accepted": accepted,
        "board": [row[:] for row in g.board.grid],
        "x": [list(m) for m in g.player1.moves],
        "o": [list(m) for m in g.player2.moves],
        "current": g.current_player.symbol,
        "over": g.game_over,
        "winner": g.winner,
        "legal": [list(m) for m in g.get_legal_moves()],
    }, g


def test_js_engine_matches_python_on_random_games_and_minimax_scores():
    rng = random.Random(2026)
    games = []
    for _ in range(150):
        g = Game()
        moves = []
        for _ in range(rng.randint(1, 40)):
            # mostly legal moves, with a few deliberately illegal ones mixed in
            if rng.random() < 0.15:
                mv = (rng.randint(-1, 3), rng.randint(-1, 3))
            else:
                legal = g.get_legal_moves()
                mv = rng.choice(legal) if legal else (0, 0)
            moves.append(list(mv))
            g.make_move(*mv)
            if g.game_over:
                break
        games.append(moves)

    positions = []
    for _ in range(25):
        g = Game()
        moves = []
        for _ in range(rng.randint(0, 8)):
            legal = g.get_legal_moves()
            mv = rng.choice(legal)
            moves.append(list(mv))
            g.make_move(*mv)
            if g.game_over:
                break
        positions.append({"moves": moves, "depth": rng.choice([1, 2, 3, 4])})

    js = run_node({"games": games, "positions": positions})

    for moves, got in zip(games, js["games"]):
        expected, _ = python_game([tuple(m) for m in moves])
        assert got == expected, f"engine mismatch after moves {moves}"

    for pos, got in zip(positions, js["scores"]):
        g = Game()
        for r, c in pos["moves"]:
            g.make_move(r, c)
        if g.game_over:
            assert got is None
            continue
        expected = MinimaxAI(depth=pos["depth"]).score_moves(g)
        assert set(got) == {f"{r},{c}" for r, c in expected}
        for (r, c), score in expected.items():
            assert abs(got[f"{r},{c}"] - score) < 1e-9, f"score mismatch at {pos} for {(r, c)}"
