from src.ai import RandomAI, RuleBasedAI, MinimaxAI
from src.game import Game


def test_random_ai_returns_legal_move():
    game = Game()
    ai = RandomAI()

    move = ai.choose_move(game)

    assert move in game.get_legal_moves()

def test_random_ai_does_not_choose_occupied_cell():
    game = Game()
    ai = RandomAI()

    game.make_move(0, 0)

    move = ai.choose_move(game)

    assert move in game.get_legal_moves()
    assert move != (0, 0)

def test_random_ai_returns_none_when_no_moves_available():
    game = Game()

    # Artificially fill the board for this test.
    for row in range(3):
        for col in range(3):
            game.board.place_symbol(row, col, "X")

    ai = RandomAI()

    assert ai.choose_move(game) is None

def test_rule_based_ai_takes_winning_move():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (1,0)
    game.make_move(1, 0)

    # X: (0,1)
    game.make_move(0, 1)

    # O: (1,1)
    game.make_move(1, 1)

    ai = RuleBasedAI()

    # X can win with (0,2)
    assert ai.choose_move(game) == (0, 2)

def test_rule_based_ai_blocks_opponent_win():
    game = Game()

    # X: (2,0)
    game.make_move(2, 0)

    # O: (0,0)
    game.make_move(0, 0)

    # X: (1,2)
    game.make_move(1, 2)

    # O: (0,1)
    game.make_move(0, 1)

    ai = RuleBasedAI()

    # O would win with (0,2), so X should block it.
    assert ai.choose_move(game) == (0, 2)

def test_rule_based_ai_returns_legal_move():
    game = Game()
    ai = RuleBasedAI()

    move = ai.choose_move(game)

    assert move in game.get_legal_moves()

def test_rule_based_ai_finds_win_after_expiration():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (2,0)
    game.make_move(2, 0)

    # X: (1,1)
    game.make_move(1, 1)

    # O: (2,1)
    game.make_move(2, 1)

    # X: (0,2)
    game.make_move(0, 2)

    # O: (1,0)
    game.make_move(1, 0)

    ai = RuleBasedAI()

    assert ai.choose_move(game) == (2, 2)

def test_rule_based_ai_prefers_center():
    game = Game()
    ai = RuleBasedAI()

    assert ai.choose_move(game) == (1, 1)

def test_rule_based_ai_prefers_corner_when_center_is_occupied():
    game = Game()
    ai = RuleBasedAI()

    game.make_move(1, 1)

    move = ai.choose_move(game)

    assert move in {
        (0, 0),
        (0, 2),
        (2, 0),
        (2, 2)
    }

def test_rule_based_ai_missing_a_winning_block():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (1,1)
    game.make_move(1, 1)

    # X: (2,2)
    game.make_move(2, 2)

    # O: (1,0)
    game.make_move(1, 0)

    ai = RuleBasedAI()

    assert ai.choose_move(game) == (1, 2)

def test_minimax_ai_takes_winning_move():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (1,0)
    game.make_move(1, 0)

    # X: (0,1)
    game.make_move(0, 1)

    # O: (1,1)
    game.make_move(1, 1)

    ai = MinimaxAI()

    # X can win with (0,2)
    assert ai.choose_move(game) == (0, 2)


def test_minimax_ai_blocks_opponent_win():
    game = Game()

    # X: (2,0)
    game.make_move(2, 0)

    # O: (0,0)
    game.make_move(0, 0)

    # X: (1,2)
    game.make_move(1, 2)

    # O: (0,1)
    game.make_move(0, 1)

    ai = MinimaxAI()

    # O would win with (0,2), so X must block it.
    assert ai.choose_move(game) == (0, 2)


def test_minimax_ai_returns_legal_move():
    game = Game()
    ai = MinimaxAI()

    move = ai.choose_move(game)

    assert move in game.get_legal_moves()

def test_minimax_evaluates_win_as_positive():
    game = Game()
    ai = MinimaxAI()

    ai.symbol = "X"
    game.winner = "X"
    game.game_over = True

    assert ai._evaluate(game) == 1


def test_minimax_evaluates_loss_as_negative():
    game = Game()
    ai = MinimaxAI()

    ai.symbol = "X"
    game.winner = "O"
    game.game_over = True

    assert ai._evaluate(game) == -1


def test_minimax_evaluates_draw_as_zero():
    game = Game()
    ai = MinimaxAI()

    ai.symbol = "X"
    game.draw = True
    game.game_over = True

    assert ai._evaluate(game) == 0


def test_minimax_evaluates_non_terminal_as_none():
    game = Game()
    ai = MinimaxAI()

    ai.symbol = "X"

    assert ai._evaluate(game) is None

def test_minimax_detects_immediate_winning_state():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (1,0)
    game.make_move(1, 0)

    # X: (0,1)
    game.make_move(0, 1)

    # O: (1,1)
    game.make_move(1, 1)

    ai = MinimaxAI()
    ai.symbol = "X"

    simulated_game = game.copy()
    simulated_game.make_move(0, 2)

    # A won position scores positive; the magnitude grows with the depth
    # remaining so that faster wins are preferred over slower ones.
    assert ai._minimax(simulated_game, 3, False) > 0

def test_minimax_ai_has_default_search_depth():
    ai = MinimaxAI()

    assert ai.depth == 3

def test_minimax_ai_accepts_custom_search_depth():
    ai = MinimaxAI(depth=5)

    assert ai.depth == 5

def test_minimax_ai_looks_ahead():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (2,0)
    game.make_move(2, 0)

    # X: (0,1)
    game.make_move(0, 1)

    # O: (2,1)
    game.make_move(2, 1)

    ai = MinimaxAI(depth=3)

    assert ai.choose_move(game) == (0, 2)

def test_minimax_ai_accounts_for_future_expiration():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (2,0)
    game.make_move(2, 0)

    # X: (1,1)
    game.make_move(1, 1)

    # O: (2,1)
    game.make_move(2, 1)

    # X: (0,2)
    game.make_move(0, 2)

    # O: (1,0)
    game.make_move(1, 0)

    ai = MinimaxAI(depth=3)

    # (2,2) looks reasonable on the current board,
    # but Minimax sees that it eventually leads to a loss.
    scores = ai.score_moves(game)

    assert scores[(2, 2)] < 0
    assert ai.choose_move(game) != (2, 2)

def test_minimax_ai_finds_win_after_expiration():
    game = Game()

    # X: (1,1)
    game.make_move(1, 1)

    # O: (2,2)
    game.make_move(2, 2)

    # X: (0,0)
    game.make_move(0, 0)

    # O: (2,1)
    game.make_move(2, 1)

    # X: (1,2)
    game.make_move(1, 2)

    ai = MinimaxAI(depth=3)
    scores = ai.score_moves(game)

    # (2,0) wins immediately. (0,1) also wins, but only after X's oldest
    # symbol (1,1) expires and O can take the centre. Both must be seen as
    # winning, and the immediate win must be preferred.
    assert scores[(2, 0)] > 0
    assert scores[(0, 1)] > 0
    assert scores[(2, 0)] > scores[(0, 1)]
    assert ai.choose_move(game) == (2, 0)


def test_minimax_ai_randomizes_between_equal_moves():
    # With the centre taken and no lookahead, every reply scores the same,
    # so over many calls the AI should not always pick the same cell.
    game = Game()
    game.make_move(1, 1)

    ai = MinimaxAI(depth=0)
    scores = ai.score_moves(game)

    assert len(set(scores.values())) == 1

    choices = {ai.choose_move(game) for _ in range(40)}

    assert len(choices) > 1


def test_minimax_alpha_beta_matches_plain_search():
    # Pruning must not change the root scores, only the work done.
    game = Game()
    for move in [(1, 1), (0, 0), (2, 2)]:
        game.make_move(*move)

    ai = MinimaxAI(depth=3)
    pruned = ai.score_moves(game)

    def plain(g, depth, maximizing):
        score = ai._evaluate(g)
        if score is not None:
            return score * (1 + depth)
        if depth == 0:
            return ai._heuristic(g)
        results = []
        for m in g.get_legal_moves():
            s = g.copy()
            s.make_move(*m)
            results.append(plain(s, depth - 1, not maximizing))
        return max(results) if maximizing else min(results)

    for move, score in pruned.items():
        s = game.copy()
        s.make_move(*move)
        assert plain(s, ai.depth, False) == score


def test_game_state_can_repeat():
    """A complete game state (board + both queues + turn) can recur.

    X rotates through four cells A, B, C, D and O through four cells
    E, F, G, H. No three of either player's four cells form a line, so
    nobody ever wins, and after eight plies the position repeats exactly.
    This is why AI simulations need a ply cap or a repetition rule.
    """
    game = Game()

    x_cells = [(0, 0), (0, 1), (1, 0), (2, 2)]
    o_cells = [(0, 2), (1, 2), (2, 0), (2, 1)]

    seen_states = {game.state_key(): 0}
    first_repeat = None

    for ply in range(1, 25):
        cells = x_cells if game.current_player is game.player1 else o_cells
        move = cells[(ply - 1) // 2 % 4]

        assert game.make_move(*move), f"move {move} at ply {ply} was rejected"
        assert not game.game_over

        state = game.state_key()

        if state in seen_states:
            first_repeat = (seen_states[state], ply)
            break

        seen_states[state] = ply

    assert first_repeat == (6, 14)


def test_state_key_distinguishes_same_board_different_queues():
    # Both games end with X on (0,0),(0,1) and O on (1,0),(1,1), but the
    # order X placed them differs, so a different symbol expires next.
    game_a = Game()
    for move in [(0, 0), (1, 0), (0, 1), (1, 1)]:
        game_a.make_move(*move)

    game_b = Game()
    for move in [(0, 1), (1, 0), (0, 0), (1, 1)]:
        game_b.make_move(*move)

    assert game_a.board.grid == game_b.board.grid
    assert game_a.state_key() != game_b.state_key()
