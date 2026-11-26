# Tic-Tac-Pro — Audit Fixes (branch `fix/audit-issues`, 26 Nov 2026)

This document records every problem found in the project audit (see
`../AUDIT.md`), what was changed to solve it, and how the change was verified.
No game rule was changed. The engine API used by the AIs
(`get_legal_moves`, `copy`, `make_move`) is untouched, so MCTS can be added on
top of this branch exactly as planned.

Summary of the verification run on this branch:

| Check | Before | After |
|---|---|---|
| `python -m pytest` | 51 tests, **1 failing** | **54 tests, all passing** (run 5×, stable) |
| Minimax d3 as X vs Rule-Based | **0 – 20** | **18 – 12** |
| Minimax d3 as O vs Rule-Based | 0 – 3, 17 games cycled | **30 – 0** |
| Minimax d4 as X vs Rule-Based | 0 – 5 | **10 – 0** |
| Minimax d3 vs Random (as X / as O) | 29–1 / not measured | 50–0 / 50–0 |
| Minimax decision time, depth 5, empty board | 2.4 s | **0.35 s** |
| Minimax decision time, depth 3, empty board | 111 ms | 44 ms |
| Terminal menu can select Minimax | No | Yes |

---

## 1. Failing test — `test_game_state_can_repeat`

**Problem.** The test read `game.board.board`; the attribute is `game.board.grid`,
so it crashed with `AttributeError` before asserting anything. Even if it had
run, it only printed a message and never asserted, so it could not fail
meaningfully. The progress summary's "50 passing" count predates this test.

**Solution.** Rewritten as a real test. X cycles through four cells and O
through four other cells; no three of either player's cells form a line, so
nobody wins, and the complete state after ply 6 recurs at ply 14 (an 8-ply
cycle). The test asserts exactly that. It uses the new `Game.state_key()`
(see §2). A second test checks that two games with identical boards but
different queue order produce different keys.

**Why it matters for the presentation.** This is a constructive proof that
Tic-Tac-Pro games can be infinite, which closes the "Currently Under
Investigation" item in the progress summary and justifies a rollout cap or
repetition rule for MCTS.

Files: `tests/test_ai.py`

## 2. No canonical state identity — `Game.state_key()` added

**Problem.** The board alone does not identify a position (same board,
different queues ⇒ different symbol expires next). The old test and any future
transposition table or MCTS node had to rebuild a key by hand.

**Solution.** `Game.state_key()` returns a hashable tuple of board, X queue,
O queue, current player, `game_over`, `winner`, `draw`. Also normalised the
odd 12-space indentation in `get_legal_moves` / `end_in_draw`.

Files: `src/game.py`

## 3. Minimax lost every game to Rule-Based as X

**Problem.** The evaluation returned 0 for every non-terminal cut-off node, and
the root loop used strict `>` to update the best move. In the opening every
move scored 0, so the AI always played the first legal move: (0,0), then (0,1).
Against a centre-grabbing, always-blocking opponent that fixed opening was lost
by ply 5 and over by ply 10, identically in every game, at depths 3, 4 and 5.
The determinism also made the AI trivially exploitable.

**Solution.** Four changes in `MinimaxAI`, all behind the same
`choose_move(game)` interface:

1. **Random tie-break.** `choose_move` collects every move with the best score
   and picks one at random. New method `score_moves(game)` exposes the per-move
   root scores (useful for tests, debugging and the demo).
2. **Depth-aware terminal scores.** A terminal result is scaled by
   `(1 + remaining depth)`: a win in 1 ply scores higher than a win in 3, and a
   loss in 3 plies scores higher than a loss in 1. The AI now takes immediate
   wins instead of equally-scored slower ones and delays unavoidable losses.
   `_evaluate` still returns +1 / −1 / 0 / None, as documented.
3. **Cut-off heuristic.** At depth 0 the node returns a positional estimate in
   (−1, 1): +0.1 per open two-in-a-row for the AI, −0.1 per open
   two-in-a-row for the opponent, ±0.05 for the centre. Because |h| < 1 it can
   never outrank a real win or loss.
4. **Alpha-beta pruning.** Same results as plain Minimax (asserted by a new
   test that compares against an unpruned reference search), about 7× fewer
   nodes at depth 5 and ~7× faster.

`depth` semantics are unchanged and now documented: it counts plies searched
*after* the candidate root move, so "depth 3" is a 4-ply lookahead. Changing
that would have broken the documented test positions.

**Tests updated because of the new scoring (intent preserved):**

- `test_minimax_detects_immediate_winning_state` asserted the won position
  scored exactly `1`; it now asserts `> 0` (actual value 4 = 1 × (1+3)).
- `test_minimax_ai_finds_win_after_expiration` asserted the chosen move was
  (0,1). (0,1) is a win *through expiration* in 3 plies, but (2,0) is an
  immediate win; the old test only passed because the `>` tie-break kept the
  first move scanned. The test now asserts both score positive and that the
  immediate win (2,0) is preferred.
- `test_minimax_ai_accounts_for_future_expiration` asserted the chosen move
  was (0,1), but (0,1) and (1,2) tied at 0; the real point is that (2,2) is
  recognised as losing. The test now asserts `score[(2,2)] < 0` and that
  (2,2) is not chosen.

**New tests:** random tie-break among equal moves, alpha-beta equals plain
search.

Files: `src/ai.py`, `tests/test_ai.py`

## 4. Minimax missing from the terminal menu

**Problem.** `src/main.py` imported only `RandomAI` and `RuleBasedAI`; the
difficulty menu had options 1 and 2. The only search algorithm in the project
could not be demonstrated.

**Solution.** A `DIFFICULTIES` table drives the menu: 1 Random, 2 Rule-Based,
3 Minimax (depth 3). Adding MCTS later is one more line in that table.

Files: `src/main.py`

## 5. Draw-offer prompt named the wrong player

**Problem.** When X offered a draw the prompt read "Player O has offered a
draw.Accept?" (wrong player, missing space). In Player-vs-CPU mode the human
had to type the CPU's answer.

**Solution.** `handle_draw_offer()` announces the offering player correctly and
asks the *responder* to accept. If the responder is the CPU it declines on its
own ("CPU (O) declines the draw."). An accepted draw now prints
"Game over: draw." and the final board; previously the loop just ended
silently after the acceptance message.

Files: `src/main.py`

## 6. Repository hygiene

**Problem.** Compiled `__pycache__/*.pyc` files were committed; no `.gitignore`,
`README.md`, `requirements.txt` or pytest configuration; `pytest` was not even
installed on the demo machine.

**Solution.**
- `.gitignore` for `__pycache__/`, `*.pyc`, `.pytest_cache/`, virtualenvs, IDE
  folders; cached files removed from the index (`git rm --cached`).
- `README.md`: rules, layout, design rule ("AI never re-implements rules"),
  how to run, how to test, measured properties of the game.
- `requirements.txt` (`pytest>=8`) and `pytest.ini` (`testpaths = tests`).

## 7. Documentation drift (not changed on this branch)

- `progress_summary.md` §2 says `tests/` contains only `test_ai.py`; there are
  four test files. §15/§21/§31 say "50 tests"; the branch has 54.
- Both summaries describe Minimax tie-breaking as "first move encountered";
  it is now random among equals, with depth-aware scores and alpha-beta.
- The summaries live outside the repository, so they were left for the author
  to update when the report is revised.

## 8. Still open (deliberately out of scope here)

- **MCTS** is not implemented. The engine now offers everything it needs:
  `copy()`, `get_legal_moves()`, `make_move()`, `state_key()`, and proof that
  rollouts must be capped.
- **No automatic draw rule.** A draw still only happens via the `9 9` offer.
  Any AI-vs-AI benchmark must impose a ply cap or "same complete state N times
  = draw" rule and document it separately from the game rules, as the proposal
  says.
- **Benchmark script** for the Random / Rule-Based / Minimax / MCTS comparison.
- **Version-control history.** Everything before this branch is one commit by
  one author. Commit incrementally from here on.

## How the numbers above were produced

Terminal UI exercised with piped input for: PvCPU Minimax including a declined
draw offer, and PvP with an accepted draw. Matchups played to a 60-ply cap with
a fixed random seed; "cycled" means the cap was hit after a complete state
repeated. Timings are a single `choose_move` on the empty board, Python 3.13,
Windows.
