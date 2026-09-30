from src.player import Player


def test_player_starts_with_empty_queue():
    player = Player("X")

    assert player.symbol == "X"
    assert len(player.moves) == 0


def test_player_can_add_moves():
    player = Player("X")

    player.add_move((0, 0))
    player.add_move((1, 1))
    player.add_move((2, 2))

    assert list(player.moves) == [
        (0, 0),
        (1, 1),
        (2, 2)
    ]


def test_fourth_move_expires_oldest_move():
    player = Player("X")

    player.add_move((0, 0))
    player.add_move((1, 1))
    player.add_move((2, 2))

    expired_move = player.add_move((0, 2))

    assert expired_move == (0, 0)

    assert list(player.moves) == [
        (1, 1),
        (2, 2),
        (0, 2)
    ]


def test_player_never_has_more_than_three_moves():
    player = Player("X")

    for position in [
        (0, 0),
        (0, 1),
        (0, 2),
        (1, 0),
        (1, 1)
    ]:
        player.add_move(position)

    assert len(player.moves) == 3