from collections import deque


class Player:
    def __init__(self, symbol):
        self.symbol = symbol
        self.moves = deque()

    def add_move(self, position):
        expired_move = None

        if len(self.moves) >= 3:
            expired_move = self.moves.popleft()

        self.moves.append(position)

        return expired_move