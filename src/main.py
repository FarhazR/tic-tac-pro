from src.game import Game
from src.ai import MCTS_AI, MinimaxAI, RandomAI, RuleBasedAI


DIFFICULTIES = {
    "1": ("Random", lambda: RandomAI()),
    "2": ("Rule-Based", lambda: RuleBasedAI()),
    "3": ("Minimax (depth 3)", lambda: MinimaxAI(depth=3)),
    "4": ("MCTS (500 simulations)", lambda: MCTS_AI(simulations=500)),
}


def choose_option(prompt, valid):
    while True:
        choice = input(prompt)

        if choice in valid:
            return choice

        print(f"Invalid choice. Please enter one of: {', '.join(valid)}.")


def handle_draw_offer(game, offering_player, ai):
    """Resolve a draw offer. Returns True if the game ended in a draw."""
    responder = game.get_opponent()

    print()
    print(f"Player {offering_player.symbol} offers a draw.")

    # The CPU answers for itself; it never accepts an offered draw.
    if ai is not None and responder is game.player2:
        print(f"CPU ({responder.symbol}) declines the draw.")
        return False

    response = choose_option(
        f"Player {responder.symbol}, accept the draw? "
        "Enter 0 to decline, 1 to accept: ",
        ("0", "1"),
    )

    if response == "1":
        game.end_in_draw()
        print("Draw offer accepted. Game ends in a draw.")
        return True

    print("Draw offer declined.")
    return False


def main():
    print("================================")
    print("       TIC-TAC-PRO")
    print("================================")

    print("Select game mode:")
    print("1. Player vs Player")
    print("2. Player vs CPU")
    print()

    mode = choose_option("Enter 1 or 2: ", ("1", "2"))

    game = Game()
    ai = None

    if mode == "2":
        print()
        print("Select CPU difficulty:")
        for key, (name, _) in DIFFICULTIES.items():
            print(f"{key}. {name}")
        print()

        difficulty = choose_option("Enter 1, 2, 3 or 4: ", tuple(DIFFICULTIES))
        name, factory = DIFFICULTIES[difficulty]
        ai = factory()
        print(f"CPU difficulty: {name}")

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
        if ai is not None and player is game.player2:
            move = ai.choose_move(game)

            if move is None:
                print("No legal moves available.")
                break

            row, col = move
            print(f"CPU chooses: {row} {col}")

        # Human turn
        else:
            user_input = input("Enter row and column: ")

            try:
                row, col = map(int, user_input.split())
            except ValueError:
                print("Invalid input. Please enter two numbers, e.g. 1 2.")
                continue

            if row == 9 and col == 9:
                handle_draw_offer(game, player, ai)
                continue

        if not game.make_move(row, col):
            print("Invalid move. The cell may be occupied or coordinates invalid.")
            continue

    game.board.display()

    if game.draw:
        print("Game over: draw.")
    elif game.winner is not None:
        print(f"Player {game.winner} wins!")


if __name__ == "__main__":
    main()
