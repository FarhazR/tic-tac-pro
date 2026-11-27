"""Online rooms: two browsers on different devices play Player vs Player.

A room is a JSON document {code, status, host, guest, game, ...} kept in a
``RoomStore``. Two stores exist with the same interface:

    PostgresStore   when DATABASE_URL is set (psycopg 3); one table ``rooms``
                    with the document in a JSONB column, updated under
                    SELECT ... FOR UPDATE so two devices cannot race.
    MemoryStore     otherwise; fine for a single local server.

Flow:  host creates a room (gets a 6-letter code and a token) -> guest joins
with the code (status "pending") -> host accepts or declines -> "playing".
Both sides poll GET /api/rooms/<code> about once a second. Moves, draw
offers, rematches and leaving go through ``RoomService``. Every mutating call
needs the caller's token; the service works out which colour it is.
"""
import json
import os
import secrets
import threading
import time
from collections import deque

from src.game import Game

LINES = (
    ((0, 0), (0, 1), (0, 2)), ((1, 0), (1, 1), (1, 2)), ((2, 0), (2, 1), (2, 2)),
    ((0, 0), (1, 0), (2, 0)), ((0, 1), (1, 1), (2, 1)), ((0, 2), (1, 2), (2, 2)),
    ((0, 0), (1, 1), (2, 2)), ((0, 2), (1, 1), (2, 0)),
)
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_TTL_SECONDS = 24 * 3600
MAX_NAME = 20


class RoomError(ValueError):
    """Client error with an HTTP status."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def winning_line(board, symbol):
    for line in LINES:
        if all(board.grid[r][c] == symbol for r, c in line):
            return [list(cell) for cell in line]
    return None


# ---------------------------------------------------------------- game <-> json
def game_to_dict(game):
    return {
        "board": [row[:] for row in game.board.grid],
        "x_moves": [list(m) for m in game.player1.moves],
        "o_moves": [list(m) for m in game.player2.moves],
        "current": game.current_player.symbol,
        "game_over": game.game_over,
        "winner": game.winner,
        "draw": game.draw,
    }


def game_from_dict(data):
    game = Game()
    game.board.grid = [row[:] for row in data["board"]]
    game.player1.moves = deque(tuple(m) for m in data["x_moves"])
    game.player2.moves = deque(tuple(m) for m in data["o_moves"])
    game.current_player = game.player1 if data["current"] == "X" else game.player2
    game.game_over = data["game_over"]
    game.winner = data["winner"]
    game.draw = data["draw"]
    return game


# ---------------------------------------------------------------- stores
class MemoryStore:
    def __init__(self):
        self._rooms = {}
        self._lock = threading.Lock()

    def create(self, room):
        with self._lock:
            self._prune_locked()
            self._rooms[room["code"]] = room

    def exists(self, code):
        with self._lock:
            return code in self._rooms

    def get(self, code):
        with self._lock:
            room = self._rooms.get(code)
            return json.loads(json.dumps(room)) if room else None

    def update(self, code, fn):
        """Run fn(room) under the store's lock and persist the mutated room."""
        with self._lock:
            room = self._rooms.get(code)
            if room is None:
                raise RoomError("Room not found.", 404)
            result = fn(room)
            room["updated_at"] = time.time()
            room["version"] += 1
            return result

    def _prune_locked(self):
        now = time.time()
        for code in [c for c, r in self._rooms.items() if now - r["updated_at"] > ROOM_TTL_SECONDS]:
            del self._rooms[code]

    def close(self):
        pass


class PostgresStore:
    SCHEMA = """
        CREATE TABLE IF NOT EXISTS rooms (
            code        text PRIMARY KEY,
            data        jsonb NOT NULL,
            updated_at  timestamptz NOT NULL DEFAULT now()
        )
    """

    def __init__(self, dsn):
        import psycopg
        from psycopg.types.json import Jsonb
        self._psycopg = psycopg
        self._Jsonb = Jsonb
        self._dsn = dsn
        self._lock = threading.Lock()
        self._conn = None
        with self._connection() as conn:
            conn.execute(self.SCHEMA)
            conn.commit()

    def _connection(self):
        """One shared connection, reopened if it dropped."""
        if self._conn is None or self._conn.closed:
            self._conn = self._psycopg.connect(self._dsn, autocommit=False, connect_timeout=10)
        return self._conn

    def create(self, room):
        with self._lock, self._connection() as conn:
            conn.execute("DELETE FROM rooms WHERE updated_at < now() - interval '1 day'")
            conn.execute("INSERT INTO rooms (code, data) VALUES (%s, %s)", (room["code"], self._Jsonb(room)))
            conn.commit()

    def exists(self, code):
        with self._lock, self._connection() as conn:
            row = conn.execute("SELECT 1 FROM rooms WHERE code = %s", (code,)).fetchone()
            conn.commit()
            return row is not None

    def get(self, code):
        with self._lock, self._connection() as conn:
            row = conn.execute("SELECT data FROM rooms WHERE code = %s", (code,)).fetchone()
            conn.commit()
            return row[0] if row else None

    def update(self, code, fn):
        with self._lock, self._connection() as conn:
            try:
                row = conn.execute("SELECT data FROM rooms WHERE code = %s FOR UPDATE", (code,)).fetchone()
                if row is None:
                    raise RoomError("Room not found.", 404)
                room = row[0]
                result = fn(room)
                room["updated_at"] = time.time()
                room["version"] += 1
                conn.execute("UPDATE rooms SET data = %s, updated_at = now() WHERE code = %s",
                             (self._Jsonb(room), code))
                conn.commit()
                return result
            except Exception:
                conn.rollback()
                raise

    def close(self):
        if self._conn is not None and not self._conn.closed:
            self._conn.close()


def make_store(dsn=None):
    """Postgres when DATABASE_URL is set and reachable, else in-memory rooms."""
    dsn = dsn if dsn is not None else os.environ.get("DATABASE_URL", "")
    if dsn:
        try:
            store = PostgresStore(dsn)
            print("online rooms: Postgres connected", flush=True)
            return store
        except Exception as exc:
            print(f"online rooms: Postgres unreachable ({exc.__class__.__name__}: {str(exc).strip()[:80]}); "
                  "using in-memory rooms", flush=True)
    return MemoryStore()


# ---------------------------------------------------------------- service
class RoomService:
    def __init__(self, store):
        self.store = store

    # ---------------------------------------------------- helpers
    @staticmethod
    def _clean_name(name):
        name = " ".join(str(name or "").split())[:MAX_NAME]
        if not name:
            raise RoomError("Please enter a name.")
        return name

    @staticmethod
    def _clean_code(code):
        code = str(code or "").strip().upper().replace("-", "").replace(" ", "")
        if len(code) != 6 or any(ch not in CODE_ALPHABET for ch in code):
            raise RoomError("Room codes are 6 letters or digits.")
        return code

    def _new_code(self):
        for _ in range(20):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
            if not self.store.exists(code):
                return code
        raise RoomError("Could not allocate a room code, try again.", 503)

    @staticmethod
    def _score(room):
        """Per-player tally; rooms created before colours alternated used X/O keys (host was X)."""
        score = room["score"]
        if "host" not in score:
            score = room["score"] = {"host": score.get("X", 0), "guest": score.get("O", 0), "draw": score.get("draw", 0)}
        return score

    @classmethod
    def _score_by_symbol(cls, room):
        """The tally keyed by the symbol each player holds in the current round."""
        score = cls._score(room)
        host_sym = cls._symbol_of(room, "host")
        return {host_sym: score["host"], ("O" if host_sym == "X" else "X"): score["guest"], "draw": score["draw"]}

    @staticmethod
    def _symbol_of(room, who):
        """Host plays X in odd rounds and O in even rounds; the guest the other way."""
        swapped = bool(room.get("swapped"))
        if who == "host":
            return "O" if swapped else "X"
        return "X" if swapped else "O"

    @classmethod
    def _role(cls, room, token):
        if token and room["host"]["token"] == token:
            return cls._symbol_of(room, "host")
        if token and room.get("guest") and room["guest"]["token"] == token:
            return cls._symbol_of(room, "guest")
        raise RoomError("Not a member of this room.", 403)

    @staticmethod
    def _fresh_game():
        return game_to_dict(Game())

    # ---------------------------------------------------- lifecycle
    def create(self, name):
        name = self._clean_name(name)
        room = {
            "code": self._new_code(),
            "status": "waiting",            # waiting -> pending -> playing -> closed
            "host": {"name": name, "token": secrets.token_urlsafe(16)},
            "guest": None,
            "game": self._fresh_game(),
            "round": 1,
            "swapped": False,               # colours alternate every rematch
            "ply": 0,
            "last_move": None,
            "pending_draw": None,           # symbol that offered a draw
            "score": {"host": 0, "guest": 0, "draw": 0},   # per player: colours alternate
            "message": "Waiting for a second player.",
            "created_at": time.time(),
            "updated_at": time.time(),
            "version": 0,
        }
        self.store.create(room)
        return {"code": room["code"], "token": room["host"]["token"], "role": self._symbol_of(room, "host"), "name": name}

    def join(self, code, name):
        code, name = self._clean_code(code), self._clean_name(name)
        token = secrets.token_urlsafe(16)

        def apply(room):
            if room["status"] == "closed":
                raise RoomError("That room is closed.", 410)
            if room["status"] != "waiting" or room.get("guest"):
                raise RoomError("That room already has a second player.", 409)
            if name.lower() == room["host"]["name"].lower():
                raise RoomError("The host already uses that name, pick another.")
            room["guest"] = {"name": name, "token": token}
            room["status"] = "pending"
            room["message"] = f"{name} wants to join. Waiting for {room['host']['name']} to accept."
            return {"code": code, "token": token, "role": self._symbol_of(room, "guest"), "name": name}

        return self.store.update(code, apply)

    def respond(self, code, token, accept):
        code = self._clean_code(code)

        def apply(room):
            if token != room["host"]["token"]:
                raise RoomError("Only the host can accept or decline.", 403)
            if room["status"] != "pending" or not room.get("guest"):
                raise RoomError("Nobody is waiting to join.", 409)
            if accept:
                room["status"] = "playing"
                room["message"] = f"{self._name(room, 'X')} (X) to move."
            else:
                declined = room["guest"]["name"]
                room["guest"] = None
                room["status"] = "waiting"
                room["message"] = f"{declined} was declined. Waiting for a second player."
            return self._view(room, self._symbol_of(room, "host"))

        return self.store.update(code, apply)

    def leave(self, code, token):
        code = self._clean_code(code)

        def apply(room):
            role = self._role(room, token)
            is_guest = bool(room.get("guest")) and room["guest"]["token"] == token
            if is_guest and room["status"] == "pending":
                room["guest"] = None
                room["status"] = "waiting"
                room["message"] = "Waiting for a second player."
                return {"ok": True}
            name = self._name(room, role)
            room["status"] = "closed"
            room["message"] = f"{name} left the room."
            return {"ok": True}

        return self.store.update(code, apply)

    # ---------------------------------------------------- play
    def move(self, code, token, row, col):
        code = self._clean_code(code)

        def apply(room):
            role = self._role(room, token)
            if room["status"] != "playing":
                raise RoomError("The game has not started.", 409)
            game = game_from_dict(room["game"])
            if game.game_over:
                raise RoomError("The game is over.", 409)
            if game.current_player.symbol != role:
                raise RoomError("It is not your turn.", 409)
            try:
                r, c = int(row), int(col)
            except (TypeError, ValueError):
                raise RoomError("row and col must be integers")
            player = game.current_player
            oldest = player.moves[0] if len(player.moves) == 3 else None
            if not game.make_move(r, c):
                raise RoomError("Illegal move: the cell is occupied or out of range.")
            expired = oldest if oldest is not None and game.board.is_empty(*oldest) else None
            room["ply"] += 1
            room["pending_draw"] = None
            room["last_move"] = {"player": role, "cell": [r, c], "expired": list(expired) if expired else None, "by": "human"}
            room["game"] = game_to_dict(game)
            if game.winner:
                self._score(room)["host" if self._symbol_of(room, "host") == game.winner else "guest"] += 1
                room["message"] = f"{self._name(room, game.winner)} ({game.winner}) wins!"
            else:
                room["message"] = f"{self._name(room, game.current_player.symbol)} ({game.current_player.symbol}) to move."
            return self._view(room, role)

        return self.store.update(code, apply)

    def draw(self, code, token, action):
        code = self._clean_code(code)

        def apply(room):
            role = self._role(room, token)
            if room["status"] != "playing":
                raise RoomError("The game has not started.", 409)
            game = game_from_dict(room["game"])
            if game.game_over:
                raise RoomError("The game is over.", 409)
            other = "O" if role == "X" else "X"
            if action == "offer":
                if room["pending_draw"]:
                    raise RoomError("A draw offer is already pending.", 409)
                room["pending_draw"] = role
                room["message"] = f"{self._name(room, role)} offers a draw."
            elif action in ("accept", "decline"):
                if room["pending_draw"] != other:
                    raise RoomError("There is no draw offer to answer.", 409)
                room["pending_draw"] = None
                if action == "accept":
                    game.end_in_draw()
                    room["game"] = game_to_dict(game)
                    self._score(room)["draw"] += 1
                    room["message"] = "Draw agreed. Game over."
                else:
                    room["message"] = f"{self._name(room, role)} declined the draw. {self._name(room, game.current_player.symbol)} to move."
            else:
                raise RoomError("action must be offer, accept or decline.")
            return self._view(room, role)

        return self.store.update(code, apply)

    def rematch(self, code, token):
        code = self._clean_code(code)

        def apply(room):
            role = self._role(room, token)
            if room["status"] != "playing":
                raise RoomError("The game has not started.", 409)
            if not room["game"]["game_over"]:
                raise RoomError("Finish the current game first.", 409)
            room["game"] = self._fresh_game()
            room["round"] += 1
            room["swapped"] = not room.get("swapped", False)
            room["ply"] = 0
            room["last_move"] = None
            room["pending_draw"] = None
            room["message"] = f"Round {room['round']}. Colours swapped: {self._name(room, 'X')} plays X and moves first."
            return self._view(room, self._role(room, token))

        return self.store.update(code, apply)

    # ---------------------------------------------------- read
    def view(self, code, token):
        code = self._clean_code(code)
        room = self.store.get(code)
        if room is None:
            raise RoomError("Room not found.", 404)
        return self._view(room, self._role(room, token))

    @classmethod
    def _name(cls, room, symbol):
        who = "host" if cls._symbol_of(room, "host") == symbol else "guest"
        if who == "host":
            return room["host"]["name"]
        return room["guest"]["name"] if room.get("guest") else f"Player {symbol}"

    def _view(self, room, role):
        game = game_from_dict(room["game"])

        def q(player):
            return [list(m) for m in player.moves]

        def expiring(player):
            return list(player.moves[0]) if len(player.moves) == 3 else None

        return {
            "code": room["code"],
            "status": room["status"],
            "you": role,
            "round": room["round"],
            "version": room["version"],
            "players": {
                "X": self._name(room, "X") if (room.get("guest") or self._symbol_of(room, "host") == "X") else None,
                "O": self._name(room, "O") if (room.get("guest") or self._symbol_of(room, "host") == "O") else None,
            },
            "host": room["host"]["name"],
            "pending_draw": room["pending_draw"],
            # the same shape the single-device UI already renders
            "board": [row[:] for row in game.board.grid],
            "current": game.current_player.symbol,
            "queues": {"X": q(game.player1), "O": q(game.player2)},
            "expiring": {"X": expiring(game.player1), "O": expiring(game.player2)},
            "legal_moves": [list(m) for m in game.get_legal_moves()],
            "game_over": game.game_over,
            "winner": game.winner,
            "winning_line": winning_line(game.board, game.winner) if game.winner else None,
            "draw": game.draw,
            "ply": room["ply"],
            "in_progress": room["status"] == "playing" and not game.game_over,
            "score": self._score_by_symbol(room),
            "mode": "online",
            "difficulty": None,
            "difficulty_name": None,
            "depth": None,
            "simulations": None,
            "cpu_symbol": None,
            "cpu_to_move": False,
            "last_move": room["last_move"],
            "ai_scores": None,
            "ai_time_ms": None,
            "message": room["message"],
        }
