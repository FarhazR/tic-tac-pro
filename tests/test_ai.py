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

    assert ai._minimax(simulated_game, 3, False) == 1

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
    assert ai.choose_move(game) == (0, 1)

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

    assert ai.choose_move(game) == (0, 1)

def test_game_state_can_repeat():
    game = Game()

    seen_states = set()

    def get_state(game):
        board = tuple(
            tuple(row)
            for row in game.board.board
        )

        x_queue = tuple(game.player1.moves)
        o_queue = tuple(game.player2.moves)

        current_player = game.current_player.symbol

        return (
            board,
            x_queue,
            o_queue,
            current_player,
            game.game_over,
            game.winner,
            game.draw,
        )

    # Record the initial state
    seen_states.add(get_state(game))

    # Make a sequence of legal moves.
    for _ in range(30):
        legal_moves = game.get_legal_moves()

        if not legal_moves or game.game_over:
            break

        game.make_move(*legal_moves[0])

        state = get_state(game)

        if state in seen_states:
            print("\nREPEATED STATE FOUND")
            print("State:", state)
            return

        seen_states.add(state)

    print("\nNo repeated state found.")