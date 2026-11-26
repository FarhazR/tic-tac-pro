import random

class RandomAI:
    def choose_move(self, game):
        legal_moves = game.get_legal_moves()

        if not legal_moves:
            return None

        return random.choice(legal_moves)

class RuleBasedAI:

    def choose_move(self, game):
        legal_moves = game.get_legal_moves()

        if not legal_moves:
            return None

        # 1. Look for an immediate winning move
        for move in legal_moves:
            simulated_game = game.copy()
            simulated_game.make_move(*move)

            if simulated_game.winner == game.current_player.symbol:
                return move

        # 2. Look for an opponent winning move and block it
        opponent = game.get_opponent()

        for move in legal_moves:
            simulated_game = game.copy()

            # Find the corresponding opponent in the copied game.
            simulated_opponent = (
                simulated_game.player1
                if opponent == game.player1
                else simulated_game.player2
            )

            simulated_game.current_player = simulated_opponent
            simulated_game.make_move(*move)

            if simulated_game.winner == simulated_opponent.symbol:
                return move

        # 3. Prefer strategically valuable positions
        center = (1, 1)
        corners = {
            (0, 0),
            (0, 2),
            (2, 0),
            (2, 2)
        }

        if center in legal_moves:
            return center

        available_corners = [
            move for move in legal_moves
            if move in corners
        ]

        if available_corners:
            return random.choice(available_corners)

        # 4. Otherwise choose any legal move
        return random.choice(legal_moves)

class MinimaxAI:
    """Depth-limited Minimax with alpha-beta pruning.

    `depth` is the number of plies searched *after* the candidate root move,
    so the total lookahead is depth + 1 plies (depth=3 -> 4 plies).

    Scores (from the AI's point of view):
        terminal win   : +(1 + remaining depth)   faster wins score higher
        terminal loss  : -(1 + remaining depth)   slower losses score higher
        draw           : 0
        depth cut-off  : heuristic in (-1, 1), so it can never outrank a
                         real terminal outcome

    Moves with exactly equal scores are chosen at random, so the AI is not
    locked into the same (weak) opening every game.
    """

    CENTER = (1, 1)
    LINES = (
        ((0, 0), (0, 1), (0, 2)),
        ((1, 0), (1, 1), (1, 2)),
        ((2, 0), (2, 1), (2, 2)),
        ((0, 0), (1, 0), (2, 0)),
        ((0, 1), (1, 1), (2, 1)),
        ((0, 2), (1, 2), (2, 2)),
        ((0, 0), (1, 1), (2, 2)),
        ((0, 2), (1, 1), (2, 0)),
    )

    def __init__(self, depth=3):
        self.symbol = None
        self.depth = depth
        self.nodes_searched = 0

    def _evaluate(self, game):
        """Terminal evaluation: +1 win, -1 loss, 0 draw, None if not over."""
        if game.winner == self.symbol:
            return 1

        if game.winner is not None:
            return -1

        if game.draw:
            return 0

        return None

    def _heuristic(self, game):
        """Positional estimate for non-terminal cut-off nodes, |value| < 1.

        Counts open two-in-a-rows (two own symbols, third cell empty) for
        each side, plus a small bonus for holding the centre.
        """
        grid = game.board.grid
        opponent = "O" if self.symbol == "X" else "X"
        score = 0.0

        for line in self.LINES:
            cells = [grid[r][c] for r, c in line]
            mine = cells.count(self.symbol)
            theirs = cells.count(opponent)

            if mine == 2 and theirs == 0:
                score += 0.1
            elif theirs == 2 and mine == 0:
                score -= 0.1

        center = grid[1][1]
        if center == self.symbol:
            score += 0.05
        elif center == opponent:
            score -= 0.05

        return score

    def _minimax(self, game, depth, maximizing, alpha=float("-inf"), beta=float("inf")):
        self.nodes_searched += 1

        score = self._evaluate(game)

        if score is not None:
            return score * (1 + depth)

        if depth == 0:
            return self._heuristic(game)

        legal_moves = game.get_legal_moves()

        if not legal_moves:
            return 0

        if maximizing:
            best_score = float("-inf")

            for move in legal_moves:
                simulated_game = game.copy()
                simulated_game.make_move(*move)

                score = self._minimax(simulated_game, depth - 1, False, alpha, beta)
                best_score = max(best_score, score)
                alpha = max(alpha, best_score)

                if beta <= alpha:
                    break

            return best_score

        best_score = float("inf")

        for move in legal_moves:
            simulated_game = game.copy()
            simulated_game.make_move(*move)

            score = self._minimax(simulated_game, depth - 1, True, alpha, beta)
            best_score = min(best_score, score)
            beta = min(beta, best_score)

            if beta <= alpha:
                break

        return best_score

    def score_moves(self, game):
        """Return {move: score} for every legal move at the root."""
        self.symbol = game.current_player.symbol
        self.nodes_searched = 0
        scores = {}

        for move in game.get_legal_moves():
            simulated_game = game.copy()
            simulated_game.make_move(*move)
            scores[move] = self._minimax(simulated_game, self.depth, False)

        return scores

    def choose_move(self, game):
        legal_moves = game.get_legal_moves()

        if not legal_moves:
            return None

        scores = self.score_moves(game)
        best_score = max(scores.values())
        best_moves = [move for move, score in scores.items() if score == best_score]

        return random.choice(best_moves)
