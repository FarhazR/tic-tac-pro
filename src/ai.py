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

    def __init__(self, depth=3):
        self.symbol = None
        self.depth = depth

    def _evaluate(self, game):
        if game.winner == self.symbol:
            return 1

        if game.winner is not None:
            return -1

        if game.draw:
            return 0

        return None

    def _minimax(self, game, depth, maximizing):
        score = self._evaluate(game)

        if score is not None:
            return score

        if depth == 0:
            return 0

        legal_moves = game.get_legal_moves()

        if not legal_moves:
            return 0

        if maximizing:
            best_score = float("-inf")

            for move in legal_moves:
                simulated_game = game.copy()
                simulated_game.make_move(*move)

                score = self._minimax(
                    simulated_game,
                    depth - 1,
                    False
                )

                best_score = max(best_score, score)

            return best_score

        else:
            best_score = float("inf")

            for move in legal_moves:
                simulated_game = game.copy()
                simulated_game.make_move(*move)

                score = self._minimax(
                    simulated_game,
                    depth - 1,
                    True
                )

                best_score = min(best_score, score)

            return best_score

    def choose_move(self, game):
        legal_moves = game.get_legal_moves()

        if not legal_moves:
            return None

        self.symbol = game.current_player.symbol

        best_move = None
        best_score = float("-inf")

        for move in legal_moves:
            simulated_game = game.copy()
            simulated_game.make_move(*move)

            score = self._minimax(
                simulated_game,
                self.depth,
                False
            )

            if score > best_score:
                best_score = score
                best_move = move

        return best_move