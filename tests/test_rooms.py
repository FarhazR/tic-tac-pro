"""Online rooms: the service logic on the in-memory store, and the same
scenario against Postgres when DATABASE_URL is set (skipped otherwise)."""
import os

import pytest

from src.rooms import MemoryStore, PostgresStore, RoomError, RoomService, game_from_dict, game_to_dict
from src.game import Game


def play_full_round(svc):
    """Create, join, accept, play X to a top-row win. Returns (host, guest, view)."""
    host = svc.create("Alice")
    guest = svc.join(host["code"], "Bob")
    code = host["code"]
    assert svc.view(code, host["token"])["status"] == "pending"
    view = svc.respond(code, host["token"], accept=True)
    assert view["status"] == "playing"
    for role, (r, c) in [("X", (0, 0)), ("O", (1, 0)), ("X", (0, 1)), ("O", (1, 1)), ("X", (0, 2))]:
        token = host["token"] if role == "X" else guest["token"]
        view = svc.move(code, token, r, c)
    return host, guest, view


def test_game_round_trips_through_json():
    game = Game()
    for move in [(0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (2, 1), (0, 2)]:
        game.make_move(*move)
    copy = game_from_dict(game_to_dict(game))
    assert copy.board.grid == game.board.grid
    assert list(copy.player1.moves) == list(game.player1.moves)
    assert list(copy.player2.moves) == list(game.player2.moves)
    assert copy.current_player.symbol == game.current_player.symbol
    assert copy.state_key() == game.state_key()


def test_create_join_accept_play_and_rematch_in_memory():
    svc = RoomService(MemoryStore())
    host, guest, view = play_full_round(svc)
    code = host["code"]

    assert len(code) == 6 and host["role"] == "X" and guest["role"] == "O"
    assert view["game_over"] and view["winner"] == "X"
    assert view["winning_line"] == [[0, 0], [0, 1], [0, 2]]
    assert view["score"] == {"X": 1, "O": 0, "draw": 0}
    assert view["players"] == {"X": "Alice", "O": "Bob"}

    # the guest sees the same room from their side
    guest_view = svc.view(code, guest["token"])
    assert guest_view["you"] == "O" and guest_view["winner"] == "X"

    # rematch keeps the score and starts round 2 with an empty board
    view = svc.rematch(code, guest["token"])
    assert view["round"] == 2 and view["ply"] == 0 and not view["game_over"]
    assert view["score"]["X"] == 1
    assert view["board"] == [[" "] * 3 for _ in range(3)]


def test_turn_order_and_membership_are_enforced():
    svc = RoomService(MemoryStore())
    host = svc.create("Alice")
    code = host["code"]

    with pytest.raises(RoomError) as err:
        svc.move(code, host["token"], 0, 0)          # nobody has joined
    assert err.value.status == 409

    guest = svc.join(code, "Bob")
    with pytest.raises(RoomError):
        svc.respond(code, guest["token"], accept=True)   # only the host accepts
    svc.respond(code, host["token"], accept=True)

    with pytest.raises(RoomError) as err:
        svc.move(code, guest["token"], 0, 0)         # X moves first
    assert err.value.status == 409
    with pytest.raises(RoomError) as err:
        svc.move(code, "not-a-token", 0, 0)
    assert err.value.status == 403
    with pytest.raises(RoomError):
        svc.join(code, "Carol")                      # room is full
    with pytest.raises(RoomError):
        svc.view("ZZZZZZ", host["token"])            # unknown room -> 404


def test_decline_and_leave():
    svc = RoomService(MemoryStore())
    host = svc.create("Alice")
    code = host["code"]
    guest = svc.join(code, "Bob")
    view = svc.respond(code, host["token"], accept=False)
    assert view["status"] == "waiting" and view["players"]["O"] is None

    guest = svc.join(code, "Bob")
    svc.respond(code, host["token"], accept=True)
    svc.leave(code, guest["token"])
    assert svc.view(code, host["token"])["status"] == "closed"


def test_draw_offer_flow():
    svc = RoomService(MemoryStore())
    host = svc.create("Alice")
    code = host["code"]
    guest = svc.join(code, "Bob")
    svc.respond(code, host["token"], accept=True)

    view = svc.draw(code, host["token"], "offer")
    assert view["pending_draw"] == "X"
    with pytest.raises(RoomError):
        svc.draw(code, host["token"], "accept")      # cannot accept your own offer
    view = svc.draw(code, guest["token"], "decline")
    assert view["pending_draw"] is None and not view["game_over"]

    svc.draw(code, guest["token"], "offer")
    view = svc.draw(code, host["token"], "accept")
    assert view["game_over"] and view["draw"] and view["score"]["draw"] == 1


def test_bad_input_is_rejected():
    svc = RoomService(MemoryStore())
    with pytest.raises(RoomError):
        svc.create("   ")
    with pytest.raises(RoomError):
        svc.join("abc", "Bob")                       # malformed code
    host = svc.create("A very long name that goes past twenty characters")
    assert len(host["name"]) <= 20


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")
def test_full_round_against_postgres():
    store = PostgresStore(os.environ["DATABASE_URL"])
    try:
        svc = RoomService(store)
        host, guest, view = play_full_round(svc)
        assert view["winner"] == "X" and view["score"]["X"] == 1
        # a second service instance (another server process) sees the same room
        other = RoomService(PostgresStore(os.environ["DATABASE_URL"]))
        assert other.view(host["code"], guest["token"])["winner"] == "X"
        other.store.close()
    finally:
        store.close()
