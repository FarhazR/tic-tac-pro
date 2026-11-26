"""Local / hosted web server for Tic-Tac-Pro.

Serves the browser UI from ``web/`` and a small JSON API that drives the
same ``Game`` engine and AI players the terminal version uses. Standard
library only: no extra dependencies.

    python run.py                                   # local
    python run.py --host 0.0.0.0 --port 7860        # container / Hugging Face

Every browser tab is its own game: the client sends an ``X-Session-Id``
header (a random id it keeps in sessionStorage) and the server keeps one
``Session`` per id, expiring idle ones.

API (all JSON, all need ``X-Session-Id``):
    GET  /api/state                     current state, 404 if no game yet
    POST /api/new   {mode, difficulty, depth}
                    mode: "pvp" | "pvc";  difficulty: "random" | "rule" | "minimax"
    POST /api/move  {row, col}          human move
    POST /api/cpu                       let the CPU play its move
    POST /api/draw  {accept}            PvP: accept=true ends in a draw;
                                        PvC: the CPU always declines
"""
import json
import os
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from src.ai import MCTS_AI, MinimaxAI, RandomAI, RuleBasedAI
from src.game import Game
from src.rooms import RoomError, RoomService, make_store

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

DIFFICULTIES = {
    "random": ("Random", lambda depth, sims: RandomAI()),
    "rule": ("Rule-Based", lambda depth, sims: RuleBasedAI()),
    "minimax": ("Minimax", lambda depth, sims: MinimaxAI(depth=depth)),
    "mcts": ("MCTS", lambda depth, sims: MCTS_AI(simulations=sims)),
}

LINES = (
    ((0, 0), (0, 1), (0, 2)), ((1, 0), (1, 1), (1, 2)), ((2, 0), (2, 1), (2, 2)),
    ((0, 0), (1, 0), (2, 0)), ((0, 1), (1, 1), (2, 1)), ((0, 2), (1, 2), (2, 2)),
    ((0, 0), (1, 1), (2, 2)), ((0, 2), (1, 1), (2, 0)),
)

MAX_DEPTH = 5           # keeps a hosted Minimax move well under a second
MAX_SIMULATIONS = 3000  # same for MCTS (500 simulations take about 0.1 s)


def winning_line(board, symbol):
    for line in LINES:
        if all(board.grid[r][c] == symbol for r, c in line):
            return [list(cell) for cell in line]
    return None


class Session:
    """One visitor: the current game, its settings and a running score.
    Thread-safe via ``lock``."""

    def __init__(self):
        self.lock = threading.Lock()
        self.score = {"X": 0, "O": 0, "draw": 0}
        self.new_game()

    # ------------------------------------------------------------ control
    def new_game(self, mode="pvp", difficulty="minimax", depth=3, simulations=500):
        if mode not in ("pvp", "pvc"):
            raise ValueError("mode must be 'pvp' or 'pvc'")
        if difficulty not in DIFFICULTIES:
            raise ValueError("difficulty must be one of: " + ", ".join(DIFFICULTIES))
        try:
            depth = max(1, min(int(depth), MAX_DEPTH))
            simulations = max(50, min(int(simulations), MAX_SIMULATIONS))
        except (TypeError, ValueError):
            raise ValueError("depth and simulations must be integers")

        self.game = Game()
        self.mode = mode
        self.depth = depth
        self.simulations = simulations
        self.ai = None
        self.difficulty = None
        self.difficulty_name = None
        if mode == "pvc":
            self.difficulty = difficulty
            self.difficulty_name, factory = DIFFICULTIES[difficulty]
            self.ai = factory(depth, simulations)
        self.ply = 0
        self.last_move = None
        self.ai_scores = None
        self.ai_time_ms = None
        self.message = "X to move."
        return self.state()

    def _apply_move(self, row, col, by):
        game = self.game
        player = game.current_player
        oldest = player.moves[0] if len(player.moves) == 3 else None

        if not game.make_move(row, col):
            return False

        self.ply += 1
        expired = oldest if oldest is not None and game.board.is_empty(*oldest) else None
        self.last_move = {
            "player": player.symbol,
            "cell": [row, col],
            "expired": list(expired) if expired else None,
            "by": by,
        }
        if game.winner is not None:
            self.score[game.winner] += 1
            who = "CPU" if by == "cpu" else f"Player {game.winner}"
            self.message = f"{who} ({game.winner}) wins!"
        else:
            self.message = f"{game.current_player.symbol} to move."
        return True

    def human_move(self, row, col):
        game = self.game
        if game.game_over:
            raise ValueError("The game is over. Start a new game.")
        if self.ai is not None and game.current_player is game.player2:
            raise ValueError("It is the CPU's turn.")
        try:
            row, col = int(row), int(col)
        except (TypeError, ValueError):
            raise ValueError("row and col must be integers")
        if not self._apply_move(row, col, "human"):
            raise ValueError("Illegal move: the cell is occupied or out of range.")
        return self.state()

    def cpu_move(self):
        game = self.game
        if self.ai is None:
            raise ValueError("No CPU in a Player vs Player game.")
        if game.game_over:
            raise ValueError("The game is over.")
        if game.current_player is not game.player2:
            raise ValueError("It is not the CPU's turn.")

        start = time.perf_counter()
        move = self.ai.choose_move(game)
        self.ai_time_ms = round((time.perf_counter() - start) * 1000, 1)

        if move is None:
            raise ValueError("The CPU has no legal move.")
        scores = getattr(self.ai, "last_scores", None)   # Minimax root scores / MCTS win rates
        self.ai_scores = {f"{r},{c}": s for (r, c), s in scores.items()} if scores else None
        self._apply_move(move[0], move[1], "cpu")
        return self.state()

    def offer_draw(self, accept=None):
        game = self.game
        if game.game_over:
            raise ValueError("The game is over.")
        if self.ai is not None:
            self.message = f"CPU ({game.player2.symbol}) declines the draw. {game.current_player.symbol} to move."
            return {"accepted": False, **self.state()}
        if accept:
            game.end_in_draw()
            self.score["draw"] += 1
            self.message = "Draw agreed. Game over."
            return {"accepted": True, **self.state()}
        self.message = f"Draw declined. {game.current_player.symbol} to move."
        return {"accepted": False, **self.state()}

    # ------------------------------------------------------------ view
    def state(self):
        game = self.game

        def q(player):
            return [list(m) for m in player.moves]

        def expiring(player):
            return list(player.moves[0]) if len(player.moves) == 3 else None

        return {
            "board": [row[:] for row in game.board.grid],
            "current": game.current_player.symbol,
            "queues": {"X": q(game.player1), "O": q(game.player2)},
            "expiring": {"X": expiring(game.player1), "O": expiring(game.player2)},
            "legal_moves": [list(m) for m in game.get_legal_moves()],
            "game_over": game.game_over,
            "winner": game.winner,
            "winning_line": winning_line(game.board, game.winner) if game.winner else None,
            "draw": game.draw,
            "ply": self.ply,
            "in_progress": self.ply > 0 and not game.game_over,
            "score": dict(self.score),
            "mode": self.mode,
            "difficulty": self.difficulty,
            "difficulty_name": self.difficulty_name,
            "depth": self.depth if self.difficulty == "minimax" else None,
            "simulations": self.simulations if self.difficulty == "mcts" else None,
            "cpu_symbol": "O" if self.ai is not None else None,
            "cpu_to_move": (self.ai is not None and not game.game_over
                            and game.current_player is game.player2),
            "last_move": self.last_move,
            "ai_scores": self.ai_scores,
            "ai_time_ms": self.ai_time_ms,
            "message": self.message,
        }


class SessionStore:
    """Sessions keyed by the client's id; idle ones expire."""

    def __init__(self, ttl_seconds=2 * 3600, max_sessions=2000):
        self.ttl = ttl_seconds
        self.max_sessions = max_sessions
        self._sessions = {}   # sid -> [Session, last_seen]
        self._lock = threading.Lock()

    def get(self, sid):
        with self._lock:
            entry = self._sessions.get(sid)
            if entry is None:
                return None
            entry[1] = time.time()
            return entry[0]

    def get_or_create(self, sid):
        with self._lock:
            entry = self._sessions.get(sid)
            if entry is None:
                self._prune_locked()
                entry = self._sessions[sid] = [Session(), time.time()]
            entry[1] = time.time()
            return entry[0]

    def __len__(self):
        with self._lock:
            return len(self._sessions)

    def _prune_locked(self):
        now = time.time()
        for sid in [s for s, (_, seen) in self._sessions.items() if now - seen > self.ttl]:
            del self._sessions[sid]
        while len(self._sessions) >= self.max_sessions:
            oldest = min(self._sessions, key=lambda s: self._sessions[s][1])
            del self._sessions[oldest]


STORE = SessionStore()
ROOMS = None
_ROOMS_LOCK = threading.Lock()


def rooms():
    """Online-room service, created on first use (Postgres when DATABASE_URL is set)."""
    global ROOMS
    with _ROOMS_LOCK:
        if ROOMS is None:
            ROOMS = RoomService(make_store())
        return ROOMS
SID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt, *args):  # quieter console
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # the static build (another origin) calls this API for online rooms
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-Id, X-Room-Token")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # -------------------------------------------------------- helpers
    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return {}
        if length > 4096:
            raise ValueError("Body too large.")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise ValueError("Body must be JSON.")
        if not isinstance(data, dict):
            raise ValueError("Body must be a JSON object.")
        return data

    def _sid(self):
        sid = self.headers.get("X-Session-Id", "")
        if not SID_RE.match(sid):
            raise ValueError("Missing or invalid X-Session-Id header.")
        return sid

    # -------------------------------------------------------- online rooms
    def _handle_rooms(self, method, path, data):
        parts = [p for p in path.split("/") if p]          # api, rooms, <code>, <action>
        try:
            svc = rooms()
            if method == "GET":
                if len(parts) != 3:
                    raise RoomError("Unknown endpoint.", 404)
                query = parse_qs(urlparse(self.path).query)
                token = self.headers.get("X-Room-Token") or (query.get("token") or [""])[0]
                return self._json(200, svc.view(parts[2], token))
            if len(parts) == 2:
                return self._json(200, svc.create(data.get("name")))
            if len(parts) != 4:
                raise RoomError("Unknown endpoint.", 404)
            code, action = parts[2], parts[3]
            token = self.headers.get("X-Room-Token") or data.get("token") or ""
            if action == "join":
                result = svc.join(code, data.get("name"))
            elif action == "respond":
                result = svc.respond(code, token, bool(data.get("accept")))
            elif action == "move":
                result = svc.move(code, token, data.get("row"), data.get("col"))
            elif action == "draw":
                result = svc.draw(code, token, data.get("action"))
            elif action == "rematch":
                result = svc.rematch(code, token)
            elif action == "leave":
                result = svc.leave(code, token)
            else:
                raise RoomError("Unknown endpoint.", 404)
            return self._json(200, result)
        except RoomError as exc:
            return self._json(exc.status, {"error": str(exc)})
        except Exception as exc:                            # database unreachable, etc.
            return self._json(503, {"error": f"Room service unavailable ({exc.__class__.__name__})."})

    # -------------------------------------------------------- routes
    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/rooms"):
            return self._handle_rooms("GET", path, {})
        if path == "/api/state":
            try:
                session = STORE.get(self._sid())
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            if session is None:
                return self._json(404, {"error": "No game yet. Start a new one."})
            with session.lock:
                return self._json(200, session.state())
        if path == "/api/health":
            return self._json(200, {"ok": True, "sessions": len(STORE),
                                    "rooms": rooms().store.__class__.__name__.replace("Store", "").lower()})
        if path.startswith("/api/"):
            return self._json(404, {"error": "Unknown endpoint."})
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            data = self._read_json()
            if path.startswith("/api/rooms"):
                return self._handle_rooms("POST", path, data)
            sid = self._sid()
            if path == "/api/new":
                session = STORE.get_or_create(sid)
                with session.lock:
                    result = session.new_game(
                        mode=data.get("mode", "pvp"),
                        difficulty=data.get("difficulty", "minimax"),
                        depth=data.get("depth", 3),
                        simulations=data.get("simulations", 500),
                    )
                return self._json(200, result)

            session = STORE.get(sid)
            if session is None:
                return self._json(404, {"error": "No game yet. Start a new one."})
            with session.lock:
                if path == "/api/move":
                    result = session.human_move(data.get("row"), data.get("col"))
                elif path == "/api/cpu":
                    result = session.cpu_move()
                elif path == "/api/draw":
                    result = session.offer_draw(bool(data.get("accept", False)))
                else:
                    return self._json(404, {"error": "Unknown endpoint."})
            return self._json(200, result)
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})


def serve(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"Tic-Tac-Pro running at http://{host}:{port}  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    serve()
