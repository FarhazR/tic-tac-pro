from src.board import Board


def test_empty_board():
    board = Board()

    for row in range(3):
        for col in range(3):
            assert board.is_empty(row, col)


def test_place_symbol():
    board = Board()

    assert board.place_symbol(0, 0, "X")
    assert board.grid[0][0] == "X"
    assert not board.is_empty(0, 0)


def test_cannot_place_on_occupied_cell():
    board = Board()

    assert board.place_symbol(1, 1, "X")
    assert not board.place_symbol(1, 1, "O")

    assert board.grid[1][1] == "X"


def test_remove_symbol():
    board = Board()

    board.place_symbol(2, 2, "X")
    board.remove_symbol(2, 2)

    assert board.is_empty(2, 2)


def test_horizontal_win():
    board = Board()

    board.place_symbol(0, 0, "X")
    board.place_symbol(0, 1, "X")
    board.place_symbol(0, 2, "X")

    assert board.check_win("X")


def test_vertical_win():
    board = Board()

    board.place_symbol(0, 1, "O")
    board.place_symbol(1, 1, "O")
    board.place_symbol(2, 1, "O")

    assert board.check_win("O")


def test_diagonal_win():
    board = Board()

    board.place_symbol(0, 0, "X")
    board.place_symbol(1, 1, "X")
    board.place_symbol(2, 2, "X")

    assert board.check_win("X")