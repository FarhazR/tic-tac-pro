"""Round-robin benchmark of the Tic-Tac-Pro AI players.

    python benchmark.py                 # default: 12 games per colour per pairing
    python benchmark.py --games 30 --out results.md

Every pairing is played with both colours. A game is capped at 60 plies, and a
capped game counts as a draw (the engine itself has no automatic draw; two
careful players can cycle forever). Decision times are per move.
"""
import argparse
import random
import statistics
import time

from src.ai import MCTS_AI, MinimaxAI, RandomAI, RuleBasedAI
from src.game import Game

PLAYERS = {
    "Random": lambda rng: RandomAI(),
    "Rule-Based": lambda rng: RuleBasedAI(),
    "Minimax d3": lambda rng: MinimaxAI(depth=3),
    "MCTS 200": lambda rng: MCTS_AI(simulations=200, rng=rng),
    "MCTS 500": lambda rng: MCTS_AI(simulations=500, rng=rng),
    "MCTS 1000": lambda rng: MCTS_AI(simulations=1000, rng=rng),
}

PAIRINGS = [
    ("MCTS 500", "Random"),
    ("MCTS 500", "Rule-Based"),
    ("MCTS 500", "Minimax d3"),
    ("MCTS 200", "Minimax d3"),
    ("MCTS 1000", "Minimax d3"),
    ("Minimax d3", "Rule-Based"),
]


def play(ax, ao, rng, cap):
    game = Game()
    times = {"X": [], "O": []}
    plies = 0
    while not game.game_over and plies < cap:
        ai = ax if game.current_player is game.player1 else ao
        sym = game.current_player.symbol
        start = time.perf_counter()
        move = ai.choose_move(game)
        times[sym].append(time.perf_counter() - start)
        game.make_move(*move)
        plies += 1
    return game.winner, plies, times


def run_pairing(a, b, games, cap, seed):
    """Play `games` with a as X and `games` with b as X. Returns a's record."""
    rng = random.Random(seed)
    record = {"win": 0, "draw": 0, "loss": 0}
    a_times, b_times, lengths = [], [], []
    for a_is_x in (True, False):
        for _ in range(games):
            pa, pb = PLAYERS[a](rng), PLAYERS[b](rng)
            winner, plies, times = play(pa if a_is_x else pb, pb if a_is_x else pa, rng, cap)
            a_sym = "X" if a_is_x else "O"
            if winner is None:
                record["draw"] += 1
            elif winner == a_sym:
                record["win"] += 1
            else:
                record["loss"] += 1
            a_times += times[a_sym]
            b_times += times["O" if a_is_x else "X"]
            lengths.append(plies)
    return record, statistics.mean(a_times) * 1000, statistics.mean(b_times) * 1000, statistics.mean(lengths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=12, help="games per colour per pairing")
    parser.add_argument("--cap", type=int, default=60, help="ply cap; a capped game is a draw")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--out", default="benchmark_results.md")
    args = parser.parse_args()

    rows = []
    header = (f"| Player A | Player B | A wins | draws / capped | A losses | A ms/move | B ms/move | mean plies |\n"
              f"|---|---|---:|---:|---:|---:|---:|---:|")
    print(header, flush=True)
    for i, (a, b) in enumerate(PAIRINGS):
        rec, ta, tb, plies = run_pairing(a, b, args.games, args.cap, args.seed + i)
        row = f"| {a} | {b} | {rec['win']} | {rec['draw']} | {rec['loss']} | {ta:.0f} | {tb:.0f} | {plies:.1f} |"
        rows.append(row)
        print(row, flush=True)

    total = 2 * args.games
    text = (f"# Tic-Tac-Pro benchmark\n\n{total} games per pairing ({args.games} per colour), "
            f"{args.cap}-ply cap counted as a draw, seed {args.seed}.\n\n" + header + "\n" + "\n".join(rows) + "\n")
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
