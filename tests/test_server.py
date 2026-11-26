import pytest

from src.server import Session


def play(session, moves):
    for r, c in moves:
        session.human_move(r, c)


def test_new_game_state_shape():
    s = Session()
    state = s.new_game(mode="pvp")

    assert state["board"] == [[" "] * 3 for _ in range(3)]
    assert state["current"] == "X"
    assert state["queues"] == {"X": [], "O": []}
    assert len(state["legal_moves"]) == 9
    assert not state["game_over"]
    assert state["cpu_symbol"] is None


def test_new_game_rejects_bad_settings():
    s = Session()
    with pytest.raises(ValueError):
        s.new_game(mode="solo")
    with pytest.raises(ValueError):
        s.new_game(mode="pvc", difficulty="oracle")


def test_human_move_updates_state_and_rejects_illegal():
    s = Session()
    s.new_game(mode="pvp")

    state = s.human_move(1, 1)
    assert state["board"][1][1] == "X"
    assert state["current"] == "O"
    assert state["last_move"] == {"player": "X", "cell": [1, 1], "expired": None, "by": "human"}

    with pytest.raises(ValueError):
        s.human_move(1, 1)          # occupied
    with pytest.raises(ValueError):
        s.human_move(3, 0)          # out of range
    with pytest.raises(ValueError):
        s.human_move("a", 0)        # not an integer


def test_fourth_move_reports_expired_cell():
    s = Session()
    s.new_game(mode="pvp")
    # X: (0,0) (0,1) (2,0)   O: (1,0) (1,1) (2,1)
    play(s, [(0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (2, 1)])

    before = s.state()
    assert before["expiring"]["X"] == [0, 0]

    state = s.human_move(0, 2)
    assert state["last_move"]["expired"] == [0, 0]
    assert state["board"][0][0] == " "
    assert state["queues"]["X"] == [[0, 1], [2, 0], [0, 2]]


def test_cpu_move_is_legal_and_turns_pass_back():
    s = Session()
    s.new_game(mode="pvc", difficulty="minimax", depth=2)

    state = s.human_move(1, 1)
    assert state["cpu_to_move"]

    with pytest.raises(ValueError):
        s.human_move(0, 0)          # not the human's turn

    state = s.cpu_move()
    assert state["last_move"]["by"] == "cpu"
    assert state["last_move"]["player"] == "O"
    assert state["current"] == "X"
    assert state["ai_scores"] is not None
    assert state["ai_time_ms"] >= 0


def test_cpu_move_refused_in_pvp_or_out_of_turn():
    s = Session()
    s.new_game(mode="pvp")
    with pytest.raises(ValueError):
        s.cpu_move()

    s.new_game(mode="pvc", difficulty="random")
    with pytest.raises(ValueError):
        s.cpu_move()                # X (human) to move


def test_win_is_reported():
    s = Session()
    s.new_game(mode="pvp")
    play(s, [(0, 0), (1, 0), (0, 1), (1, 1)])
    state = s.human_move(0, 2)

    assert state["game_over"]
    assert state["winner"] == "X"
    assert "wins" in state["message"]
    with pytest.raises(ValueError):
        s.human_move(2, 2)


def test_draw_offer_pvp_and_pvc():
    s = Session()
    s.new_game(mode="pvp")
    declined = s.offer_draw(accept=False)
    assert not declined["accepted"] and not declined["game_over"]

    accepted = s.offer_draw(accept=True)
    assert accepted["accepted"] and accepted["game_over"] and accepted["draw"]

    s.new_game(mode="pvc", difficulty="rule")
    result = s.offer_draw(accept=True)
    assert not result["accepted"]
    assert not result["game_over"]
    assert "declines" in result["message"]
