from src.game import Game


def test_players_alternate_turns():
    game = Game()

    assert game.current_player.symbol == "X"

    game.make_move(0, 0)
    assert game.current_player.symbol == "O"

    game.make_move(1, 0)
    assert game.current_player.symbol == "X"

    game.make_move(0, 1)
    assert game.current_player.symbol == "O"

def test_cannot_place_on_occupied_cell():
    game = Game()

    assert game.make_move(0, 0)

    # O attempts to place on X's cell
    assert not game.make_move(0, 0)

    assert game.board.grid[0][0] == "X"
    assert game.current_player.symbol == "O"

def test_fourth_move_expires_oldest_move():
    game = Game()

    # X move 1
    game.make_move(0, 0)

    # O move 1
    game.make_move(1, 0)

    # X move 2
    game.make_move(0, 1)

    # O move 2
    game.make_move(1, 1)

    # X move 3
    game.make_move(2, 0)

    # O move 3
    game.make_move(2, 1)

    # X move 4
    game.make_move(0, 2)

    assert game.board.is_empty(0, 0)

    assert list(game.player1.moves) == [
        (0, 1),
        (2, 0),
        (0, 2)
    ]

def test_expiring_cell_cannot_be_used_until_next_turn():
    game = Game()

    # X move 1 → B2
    game.make_move(1, 1)

    # O move 1
    game.make_move(0, 0)

    # X move 2
    game.make_move(0, 1)

    # O move 2
    game.make_move(0, 2)

    # X move 3
    game.make_move(2, 0)

    # O move 3
    game.make_move(2, 1)

    # X's oldest move is now B2.
    # But B2 is STILL occupied before X makes move 4.
    assert game.board.grid[1][1] == "X"

    # X attempts to play on B2.
    assert not game.make_move(1, 1)

    # B2 must STILL contain X.
    assert game.board.grid[1][1] == "X"

    # X still has the same three moves.
    assert list(game.player1.moves) == [
        (1, 1),
        (0, 1),
        (2, 0)
    ]

def test_game_can_end_in_draw():
    game = Game()

    assert not game.game_over
    assert not game.draw
    assert game.winner is None

    assert game.end_in_draw()

    assert game.game_over
    assert game.draw
    assert game.winner is None

def test_cannot_end_finished_game_in_draw():
    game = Game()

    game.make_move(0, 0)

    # X can still win later, but for this test we'll
    # simply end the game as a draw first.
    assert game.end_in_draw()

    # Trying to end an already finished game again should fail.
    assert not game.end_in_draw()

def test_get_legal_moves_on_empty_board():
    game = Game()

    assert game.get_legal_moves() == [
        (0, 0), (0, 1), (0, 2),
        (1, 0), (1, 1), (1, 2),
        (2, 0), (2, 1), (2, 2)
    ]

def test_get_legal_moves_excludes_occupied_cells():
    game = Game()

    game.make_move(0, 0)

    assert game.get_legal_moves() == [
        (0, 1), (0, 2),
        (1, 0), (1, 1), (1, 2),
        (2, 0), (2, 1), (2, 2)
    ]

def test_get_legal_moves_excludes_oldest_occupied_move():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (1,0)
    game.make_move(1, 0)

    # X: (0,1)
    game.make_move(0, 1)

    # O: (1,1)
    game.make_move(1, 1)

    # X: (2,0)
    game.make_move(2, 0)

    # O: (2,1)
    game.make_move(2, 1)

    # X's oldest move is (0,0)
    assert (0, 0) not in game.get_legal_moves()

    # X has not made the next move yet, so (0,0) is still occupied.
    assert game.board.grid[0][0] == "X"

def test_game_copy_has_same_state():
    game = Game()

    game.make_move(0, 0)
    game.make_move(1, 1)

    copied_game = game.copy()

    assert copied_game.board.grid == game.board.grid
    assert list(copied_game.player1.moves) == list(game.player1.moves)
    assert list(copied_game.player2.moves) == list(game.player2.moves)
    assert copied_game.current_player.symbol == game.current_player.symbol
    assert copied_game.game_over == game.game_over
    assert copied_game.winner == game.winner
    assert copied_game.draw == game.draw

def test_game_copy_is_independent():
    game = Game()

    game.make_move(0, 0)

    copied_game = game.copy()

    copied_game.make_move(1, 1)

    assert game.board.grid[1][1] == " "
    assert copied_game.board.grid[1][1] == "O"

def test_game_copy_has_independent_move_queues():
    game = Game()

    game.make_move(0, 0)
    game.make_move(1, 0)
    game.make_move(0, 1)

    copied_game = game.copy()

    copied_game.make_move(1, 1)

    assert list(game.player1.moves) == [
        (0, 0),
        (0, 1)
    ]

    assert list(copied_game.player1.moves) == [
        (0, 0),
        (0, 1)
    ]

    assert list(game.player2.moves) == [
        (1, 0)
    ]

    assert list(copied_game.player2.moves) == [
        (1, 0),
        (1, 1)
    ]

def test_move_does_not_win_when_winning_symbol_expires():
    game = Game()

    # X: (0,0)
    game.make_move(0, 0)

    # O: (1,0)
    game.make_move(1, 0)

    # X: (1,1)
    game.make_move(1, 1)

    # O: (2,1)
    game.make_move(2, 1)

    # X: (2,0)
    game.make_move(2, 0)

    # O: (0,2)
    game.make_move(0, 2)

    simulated_game = game.copy()

    # X plays (2,2).
    simulated_game.make_move(2, 2)

    assert simulated_game.board.grid[0][0] == " "
    assert simulated_game.winner is None
    assert not simulated_game.game_over

def test_fourth_move_can_create_win_after_expiration():
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

    # X plays (2,2).
    # (0,0) expires.
    # X now has (1,1), (0,2), (2,2).
    assert game.make_move(2, 2)

    assert not game.game_over
    assert game.winner is None

def test_get_opponent_of_player1():
    game = Game()

    assert game.current_player == game.player1
    assert game.get_opponent() == game.player2

def test_get_opponent_of_player2():
    game = Game()

    game.make_move(0, 0)

    assert game.current_player == game.player2
    assert game.get_opponent() == game.player1