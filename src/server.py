"""Local web server for Tic-Tac-Pro.

Serves the browser UI from ``web/`` and a small JSON API that drives the
same ``Game`` engine and AI players the terminal version uses. Standard
library only: no extra dependencies.

    python run.py            # from the repository root

API (all JSON):
    GET  /api/state                     current state
    POST /api/new   {mode, difficulty, depth}
                    mode: "pvp" | "pvc";  difficulty: "random" | "rule" | "minimax"
    POST /api/move  {row, col}          human move
    POST /api/cpu                       let the CPU play its move
    POST /api/draw  {accept}            PvP: accept=true ends in a draw;
                                        PvC: the CPU always declines
"""
import json
import random
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from src.ai import MinimaxAI, RandomAI, RuleBasedAI
from src.game import Game

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

DIFFICULTIES = {
    "random": ("Random", lambda depth: RandomAI()),
    "rule": ("Rule-Based", lambda depth: RuleBasedAI()),
    "minimax": ("Minimax", lambda depth: MinimaxAI(depth=depth)),
}


class Session:
    """One game plus the settings around it. Thread-safe via ``lock``."""

    def __init__(self):
        self.lock = threading.Lock()
        self.new_game()

    # ------------------------------------------------------------ control
    def new_game(self, mode="pvp", difficulty="minimax", depth=3):
        if mode not in ("pvp", "pvc"):
            raise ValueError("mode must be 'pvp' or 'pvc'")
        if difficulty not in DIFFICULTIES:
            raise ValueError("difficulty must be one of: " + ", ".join(DIFFICULTIES))
        depth = max(1, min(int(depth), 6))

        self.game = Game()
        self.mode = mode
        self.depth = depth
        self.ai = None
        self.difficulty = None
        self.difficulty_name = None
        if mode == "pvc":
            self.difficulty = difficulty
            self.difficulty_name, factory = DIFFICULTIES[difficulty]
            self.ai = factory(depth)
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

        expired = oldest if oldest is not None and game.board.is_empty(*oldest) else None
        self.last_move = {
            "player": player.symbol,
            "cell": [row, col],
            "expired": list(expired) if expired else None,
            "by": by,
        }
        if game.winner is not None:
            who = "CPU" if (by == "cpu") else f"Player {game.winner}"
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
        scores = None
        if hasattr(self.ai, "score_moves"):
            scores = self.ai.score_moves(game)
            best = max(scores.values())
            best_moves = [m for m, s in scores.items() if s == best]
            move = random.choice(best_moves)
        else:
            move = self.ai.choose_move(game)
        self.ai_time_ms = round((time.perf_counter() - start) * 1000, 1)

        if move is None:
            raise ValueError("The CPU has no legal move.")
        self.ai_scores = ({f"{r},{c}": round(s, 2) for (r, c), s in scores.items()}
                          if scores else None)
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
            "draw": game.draw,
            "mode": self.mode,
            "difficulty": self.difficulty,
            "difficulty_name": self.difficulty_name,
            "depth": self.depth if self.difficulty == "minimax" else None,
            "cpu_symbol": "O" if self.ai is not None else None,
            "cpu_to_move": (self.ai is not None and not game.game_over
                            and game.current_player is game.player2),
            "last_move": self.last_move,
            "ai_scores": self.ai_scores,
            "ai_time_ms": self.ai_time_ms,
            "message": self.message,
        }


SESSION = Session()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt, *args):  # quieter console
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

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
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise ValueError("Body must be JSON.")
        if not isinstance(data, dict):
            raise ValueError("Body must be a JSON object.")
        return data

    # -------------------------------------------------------- routes
    def do_GET(self):
        if self.path.split("?")[0] == "/api/state":
            with SESSION.lock:
                return self._json(200, SESSION.state())
        if self.path.startswith("/api/"):
            return self._json(404, {"error": "Unknown endpoint."})
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            data = self._read_json()
            with SESSION.lock:
                if path == "/api/new":
                    result = SESSION.new_game(
                        mode=data.get("mode", "pvp"),
                        difficulty=data.get("difficulty", "minimax"),
                        depth=data.get("depth", 3),
                    )
                elif path == "/api/move":
                    result = SESSION.human_move(data.get("row"), data.get("col"))
                elif path == "/api/cpu":
                    result = SESSION.cpu_move()
                elif path == "/api/draw":
                    result = SESSION.offer_draw(bool(data.get("accept", False)))
                else:
                    return self._json(404, {"error": "Unknown endpoint."})
            return self._json(200, result)
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})


def serve(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Tic-Tac-Pro running at http://{host}:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    serve()
