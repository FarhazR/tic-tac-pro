import copy

from src.board import Board
from src.player import Player


class Game:
    def __init__(self):
        self.board = Board()
        self.player1 = Player("X")
        self.player2 = Player("O")
        self.current_player = self.player1
        self.game_over = False
        self.winner = None
        self.draw = False

    def switch_player(self):
        if self.current_player == self.player1:
            self.current_player = self.player2
        else:
            self.current_player = self.player1

    def make_move(self, row, col):
        if self.game_over:
            return False

        # Check that coordinates are valid
        if not (0 <= row < 3 and 0 <= col < 3):
            return False

        # Cell must be empty at the time of input
        if not self.board.is_empty(row, col):
            return False

        player = self.current_player
        position = (row, col)

        # Place the new symbol
        self.board.place_symbol(row, col, player.symbol)

        # Add move to player's queue
        expired_move = player.add_move(position)

        # Remove oldest symbol if necessary
        if expired_move is not None:
            self.board.remove_symbol(*expired_move)

        # Check for victory
        if self.board.check_win(player.symbol):
            self.game_over = True
            self.winner = player.symbol
            return True
        
        # Switch turns
        self.switch_player()

        return True

    def copy(self):
        return copy.deepcopy(self)

    def get_legal_moves(self):
            legal_moves = []
    
            for row in range(3):
                for col in range(3):
                    if self.board.is_empty(row, col):
                        legal_moves.append((row, col))
    
            return legal_moves

    def end_in_draw(self):
        if self.game_over:
            return False
    
        self.game_over = True
        self.draw = True
        return True

    def get_opponent(self):
        if self.current_player == self.player1:
            return self.player2

        return self.player1