import random

from src.ai import MCTS_AI
from src.game import Game


def _position(moves):
    game = Game()
    for move in moves:
        game.make_move(*move)
    return game


def test_mcts_returns_legal_move_and_root_statistics():
    game = Game()
    ai = MCTS_AI(simulations=120, rng=random.Random(7))

    move = ai.choose_move(game)

    assert move in game.get_legal_moves()
    assert set(ai.last_scores) == set(game.get_legal_moves())
    assert sum(ai.last_visits.values()) == 120
    assert all(0.0 <= s <= 1.0 for s in ai.last_scores.values())
    assert ai.nodes_searched <= 120


def test_mcts_takes_immediate_win():
    # X: (0,0) (0,1)   O: (1,0) (1,1)   -> X wins with (0,2)
    game = _position([(0, 0), (1, 0), (0, 1), (1, 1)])
    for seed in range(5):
        assert MCTS_AI(simulations=300, rng=random.Random(seed)).choose_move(game) == (0, 2)


def test_mcts_blocks_immediate_loss():
    # X: (2,0) (1,2)   O: (0,0) (0,1)   -> O threatens (0,2); X must block
    game = _position([(2, 0), (0, 0), (1, 2), (0, 1)])
    for seed in range(5):
        assert MCTS_AI(simulations=400, rng=random.Random(seed)).choose_move(game) == (0, 2)


def test_mcts_rollout_always_terminates_with_a_valid_outcome():
    # The board never fills, so only the ply cap or the repetition rule can
    # end a rollout that produces no winner.
    ai = MCTS_AI(rollout_limit=30, rng=random.Random(3))
    outcomes = {ai._rollout(Game()) for _ in range(200)}
    assert outcomes <= {"X", "O", None}


def test_mcts_rollout_from_terminal_position_returns_winner():
    game = _position([(0, 0), (1, 0), (0, 1), (1, 1), (0, 2)])
    assert game.winner == "X"
    assert MCTS_AI(rng=random.Random(0))._rollout(game) == "X"


def test_mcts_beats_random_player():
    wins = 0
    for seed in range(8):
        rng = random.Random(seed)
        game = Game()
        plies = 0
        while not game.game_over and plies < 60:
            if game.current_player is game.player1:
                move = MCTS_AI(simulations=150, rng=rng).choose_move(game)
            else:
                move = rng.choice(game.get_legal_moves())
            game.make_move(*move)
            plies += 1
        wins += game.winner == "X"
    assert wins >= 7
