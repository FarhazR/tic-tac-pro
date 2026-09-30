from src.game import Game
from src.ai import RandomAI, RuleBasedAI


def main():
    print("================================")
    print("       TIC-TAC-PRO")
    print("================================")

    print("Select game mode:")
    print("1. Player vs Player")
    print("2. Player vs CPU")
    print()

    while True:
        mode = input("Enter 1 or 2: ")

        if mode in ("1", "2"):
            break

        print("Invalid choice. Please enter 1 or 2.")

    game = Game()
    ai = None

    if mode == "2":
        print()
        print("Select CPU difficulty:")
        print("1. Random")
        print("2. Rule-Based")
        print()

        while True:
            difficulty = input("Enter 1 or 2: ")

            if difficulty == "1":
                ai = RandomAI()
                break

            if difficulty == "2":
                ai = RuleBasedAI()
                break

            print("Invalid choice. Please enter 1 or 2.")


    print()
    print("Enter row and column as two numbers.")
    print("Example: 0 2")
    print("Rows and columns range from 0 to 2.")
    print("Each player can have a maximum of 3 active moves; Enter 9 9 to offer a draw.")
    print()

    while not game.game_over:
        game.board.display()

        player = game.current_player

        print(f"Player {player.symbol}'s turn.")
        print(f"Active moves: {list(player.moves)}")
        if len(player.moves) == 3:
            print(f"Expiring move: {player.moves[0]}")

        # CPU turn
        if mode == "2" and player == game.player2:
            move = ai.choose_move(game)

            if move is None:
                print("No legal moves available.")
                break

            row, col = move
            print(f"CPU chooses: {row} {col}")

        # Human turn
        else:
            user_input = input("Enter row and column: ")

            # Try to interpret the input
            try:
                row, col = map(int, user_input.split())
            except ValueError:
                print("Invalid input. Please enter two numbers, e.g. 1 2.")
                continue

            # Check for draw offer
            if row == 9 and col == 9:
                print()
                print(f"Player {player.symbol} offers a draw.")

                opponent = game.player2 if player == game.player1 else game.player1
                while True:
                    response = input(
                        f"Player {opponent.symbol} has offered a draw."
                        "Accept? Enter 0 to decline, 1 to accept: "
                    )
                    if response == "0":
                        print("Draw offer declined.")
                        break
                    elif response == "1":
                        print("Draw offer accepted. Game ends in a draw.")
                        game.end_in_draw()
                        break
                    else:
                        print("Invalid input. Please enter 0 or 1.")
                continue

        # Attempt to make the move
        if not game.make_move(row, col):
            print("Invalid move. The cell may be occupied or coordinates invalid.")
            continue

        # Check whether the move ended the game
        if game.game_over:
            game.board.display()
            print(f"Player {player.symbol} wins!")
            break


if __name__ == "__main__":
    main()