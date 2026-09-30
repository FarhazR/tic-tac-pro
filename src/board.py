class Board:
    def __init__(self):
        self.grid = [
            [" ", " ", " "],
            [" ", " ", " "],
            [" ", " ", " "]
        ]

    def is_empty(self, row, col):
        return self.grid[row][col] == " "

    def place_symbol(self, row, col, symbol):
        if not self.is_empty(row, col):
            return False

        self.grid[row][col] = symbol
        return True

    def remove_symbol(self, row, col):
        self.grid[row][col] = " "

    def check_win(self, symbol):
        # Check rows
        for row in self.grid:
            if all(cell == symbol for cell in row):
                return True

        # Check columns
        for col in range(3):
            if all(self.grid[row][col] == symbol for row in range(3)):
                return True

        # Check main diagonal
        if all(self.grid[i][i] == symbol for i in range(3)):
            return True

        # Check opposite diagonal
        if all(self.grid[i][2 - i] == symbol for i in range(3)):
            return True

        return False

    def display(self):
        print()
        print("   0   1   2")
        print("  -----------")

        for i in range(3):
            print(f"{i}| {self.grid[i][0]} | {self.grid[i][1]} | {self.grid[i][2]} |")
            print("  -----------")

        print()