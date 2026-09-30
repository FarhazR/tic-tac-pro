# Tic-Tac-Pro — Project Checkpoint

**Project:** Tic-Tac-Pro
**Status:** Core engine + terminal version + RandomAI + RuleBasedAI complete
**Current tests:** **37/37 passing**
**Next major milestone:** MinimaxAI

---

## 1. Project concept

**Tic-Tac-Pro** is an advanced Tic-Tac-Toe variant inspired by the **Moon Chess** minigame from Genshin Impact.

The fundamental difference from conventional Tic-Tac-Toe is that each player can have a maximum of **3 active symbols**.

When a player attempts to place their **4th symbol**:

1. Their oldest existing symbol expires.
2. The oldest symbol is removed from the board.
3. The new symbol remains.
4. The resulting 3-symbol state is then checked for victory.

The symbols therefore behave like a **FIFO queue**.

Example:

Player X moves:

Move 1 → A
Move 2 → B
Move 3 → C

Queue:
[A, B, C]

Move 4 → D

A expires.

Queue:
[B, C, D]
```

This creates a continuously changing board rather than a conventional permanently-filled Tic-Tac-Toe board.

---

# 2. Current project structure

The project currently follows this structure:

```text
tic-tac-pro/
│
├── src/
│   ├── __init__.py
│   ├── board.py
│   ├── player.py
│   ├── game.py
│   ├── ai.py
│   └── main.py
│
└── tests/
    ├── __init__.py
    ├── test_board.py
    ├── test_player.py
    ├── test_game.py
    └── test_ai.py
```

The architecture deliberately separates:

* Board representation
* Player state
* Game rules/state
* AI decision-making
* User interface

This is important because the same game engine should eventually be usable by:

* Terminal UI
* AI simulations
* Minimax
* Reinforcement-learning experiments, if desired
* Godot graphical UI

---

# 3. `Board` — completed

File:

```text
src/board.py
```

The board is a **3×3 matrix**.

Current representation:

```python
[
    [" ", " ", " "],
    [" ", " ", " "],
    [" ", " ", " "]
]
```

Coordinates currently use:

```text
(row, column)
```

where both range from `0` to `2`.

### Board functionality

Implemented:

* `is_empty(row, col)`
* `place_symbol(row, col, symbol)`
* `remove_symbol(row, col)`
* `check_win(symbol)`
* `display()`

### Win conditions

`check_win()` checks:

* 3 horizontal rows
* 3 vertical columns
* Main diagonal
* Opposite diagonal

The board itself does **not** know anything about move expiration. That responsibility belongs to the game/player layer.

### Current display

The terminal board currently looks roughly like:

```text
   0   1   2
  -----------
0| X |   | O |
  -----------
1|   | X |   |
  -----------
2| O |   | X |
  -----------
```

---

# 4. `Player` — completed

File:

```text
src/player.py
```

Each player has:

```python
self.symbol
self.moves
```

`moves` is implemented using:

```python
collections.deque
```

This is deliberate because we need efficient FIFO behavior.

### `add_move(position)`

The method:

1. Removes the oldest move if the player already has 3.
2. Adds the new move.
3. Returns the expired move.

For example:

```text
Before:
[(0,0), (1,1), (2,2)]

New move:
(0,2)

Returned expired move:
(0,0)

Queue becomes:
[(1,1), (2,2), (0,2)]
```

The actual board removal is handled by `Game`, not `Player`.

---

# 5. `Game` — completed core engine

File:

```text
src/game.py
```

The `Game` class owns the actual game state.

It contains:

```python
self.board
self.player1
self.player2
self.current_player
self.game_over
self.winner
self.draw
```

Players are:

```text
Player 1 → X
Player 2 → O
```

---

## 6. `Game.make_move()` behavior

This is one of the most important parts of the project.

A move goes through the following process:

### 1. Check whether the game is already over

No moves can be made after victory/draw.

### 2. Validate coordinates

Only:

```text
0 ≤ row < 3
0 ≤ col < 3
```

are valid game positions.

### 3. Check whether the selected cell is empty

This is an important Tic-Tac-Pro rule.

Even if the occupied cell belongs to the current player's **oldest symbol**, the player **cannot select it on that turn**.

For example:

```text
X currently owns:
A, B, C
```

If A is about to expire, X still cannot choose A's occupied cell as the fourth move.

They must select another empty cell.

Only after the new move is placed does A disappear.

A then becomes available on the **next turn**.

This behavior has been explicitly tested.

### 4. Place the new symbol

### 5. Add the move to the player's FIFO queue

### 6. Expire the oldest symbol if necessary

### 7. Check victory

**Victory is checked after expiration.**

This is extremely important.

The temporary four-symbol state does **not** count as a winning state.

Only the resulting board after the oldest symbol disappears determines whether the player wins.

### 8. If no victory, switch players

---

# 7. Draw system — completed

Draws are **not automatically triggered by the board becoming full**.

Instead, a player can manually offer a draw by entering:

```text
9 9
```

during their turn.

The other player receives:

```text
Player O, accept the draw?
Enter 0 to reject or 1 to accept:
```

### If they enter `0`

The draw is rejected.

The same player retains their turn.

**Rejecting the draw does not consume a move.**

### If they enter `1`

The game ends.

State becomes:

```python
game.game_over == True
game.draw == True
game.winner is None
```

This behavior has been tested.

---

# 8. Legal move system — completed

`Game.get_legal_moves()` returns every currently empty cell.

For example:

```python
[
    (0,0),
    (0,1),
    ...
]
```

It automatically respects the important expiration rule because an occupied expiring cell is still occupied until after the current move.

This method is particularly important for AI.

Both RandomAI and RuleBasedAI use it instead of implementing their own definition of legal moves.

---

# 9. Game copying — completed

`Game.copy()` uses:

```python
copy.deepcopy(self)
```

This was implemented specifically with future AI search in mind.

It allows us to safely simulate hypothetical moves without modifying the real game.

For example:

```python
simulated_game = game.copy()
simulated_game.make_move(...)
```

The original game remains untouched.

We have explicitly tested:

* Same board state
* Same player queues
* Same current player
* Same winner/game-over/draw state
* Independent board state
* Independent move queues

This will be **essential for MinimaxAI**.

---

# 10. `get_opponent()` — completed

The `Game` class now provides:

```python
get_opponent()
```

It returns the player who is not currently active.

This was added to prevent duplicated opponent-selection logic throughout the code.

It also became important for AI simulations.

---

# 11. `RandomAI` — completed

File:

```text
src/ai.py
```

`RandomAI` implements:

```python
choose_move(game)
```

It:

1. Gets legal moves.
2. Returns `None` if none exist.
3. Otherwise randomly chooses one.

This AI deliberately has no strategy.

It serves as the easiest difficulty level and also provides a useful baseline.

---

# 12. `RuleBasedAI` — completed

This is the second difficulty level.

Current decision hierarchy:

```text
1. Immediate win
        ↓
2. Block immediate opponent win
        ↓
3. Prefer center
        ↓
4. Prefer corners
        ↓
5. Random legal move
```

### Immediate winning move

The AI simulates each legal move using:

```python
game.copy()
```

and checks whether that move produces:

```python
simulated_game.winner == current_player.symbol
```

If so, it takes the move.

### Blocking opponent

It similarly simulates the opponent making each possible legal move.

If the opponent would win, the AI chooses that cell to block.

There was an actual bug discovered here during testing involving original-game player objects being mixed with copied-game objects.

That was corrected so that the simulated opponent belongs entirely to the copied game state.

This is now covered by tests.

### Positional preferences

If there is no immediate tactical move:

```text
Center > Corners > Edges
```

Center:

```text
(1,1)
```

Corners:

```text
(0,0)
(0,2)
(2,0)
(2,2)
```

If multiple corners are available, one is selected randomly.

---

# 13. Deliberately NOT included in RuleBasedAI

We discussed future-threat/fork detection and decided **not to include it in RuleBasedAI**.

This was a deliberate architectural decision.

We don't want RuleBasedAI to start performing multi-turn game-tree analysis.

Features such as:

* Fork detection
* Multi-turn planning
* Future winning opportunities
* Deep threat analysis
* Long-term consequences of move expiration

are better suited to **MinimaxAI**.

This gives us a clearer distinction between difficulty levels:

```text
RandomAI
    ↓
basic randomness

RuleBasedAI
    ↓
human-designed tactical rules

MinimaxAI
    ↓
look-ahead/search
```

---

# 14. Terminal interface — completed

File:

```text
src/main.py
```

The game can currently be launched using:

```powershell
python -m src.main
```

The startup menu supports:

```text
Select game mode:
1. Player vs Player
2. Player vs CPU
```

If PvP is selected, both players enter moves.

If PvCPU is selected, the user is prompted for:

```text
Select CPU difficulty:
1. Random
2. Rule-Based
```

The appropriate AI object is instantiated.

The rest of the game doesn't need to know which AI was selected because both implement:

```python
choose_move(game)
```

This is effectively a **Strategy Pattern**, which was one of the architectural goals.

---

# 15. Current PvCPU behavior

Currently:

```text
Human → X
CPU → O
```

The CPU automatically chooses its move.

The interface displays something like:

```text
CPU chooses: 1 2
```

The CPU does not currently make draw offers.

Human players can still offer a draw through:

```text
9 9
```

---

# 16. Testing status

Current result:

```text
37 passed
```

Repeated tests of the RuleBasedAI blocking behavior also passed.

The test suite currently covers:

### Board

* Empty board
* Placing symbols
* Occupied-cell rejection
* Removing symbols
* Horizontal win
* Vertical win
* Diagonal wins

### Player

* Empty initial queue
* Adding moves
* Fourth-move expiration
* Maximum three active moves

### Game

* Alternating turns
* Occupied-cell rejection
* Expiration
* Expiring cell cannot be selected prematurely
* Draw state
* Preventing duplicate draw endings
* Legal moves
* Expiring occupied cells excluded from legal moves
* Game copying
* Copy independence
* Independent move queues
* Expiration-aware win detection
* Fourth move producing a win after expiration
* `get_opponent()`

### AI

* RandomAI returns legal move
* RandomAI avoids occupied cells
* RandomAI returns `None` when no moves exist
* RuleBasedAI immediate win
* RuleBasedAI immediate block
* RuleBasedAI legal move
* RuleBasedAI center preference
* RuleBasedAI corner preference
* RuleBasedAI blocking the newly discovered middle-row threat

**Current checkpoint: 37/37 passing.**

---

# 17. What remains to be built

## Phase 1 — MinimaxAI

This is the **next major development task**.

File:

```text
src/ai.py
```

We'll add:

```python
class MinimaxAI:
    def choose_move(self, game):
        ...
```

It will use:

```text
get_legal_moves()
copy()
make_move()
winner
game_over
draw
```

rather than duplicating game rules.

### Important Minimax considerations

Ordinary Tic-Tac-Toe Minimax cannot simply be copied over because Tic-Tac-Pro has:

* Maximum 3 active symbols
* FIFO expiration
* Changing board state
* Moves that can remove existing symbols
* Potentially repeating states
* Draws that aren't based on board fullness

So the search implementation needs to be designed specifically around the Tic-Tac-Pro state.

We will likely need:

* Terminal-state evaluation
* Win/loss/draw scoring
* Recursive search
* Move simulation
* Depth considerations
* Possibly memoization/transposition tables
* Possibly a depth limit if the state space becomes too large

A major goal will be ensuring Minimax actually plays **significantly better than RuleBasedAI**.

---

# 18. Minimax strategic behavior

Features that we intentionally left out of RuleBasedAI can emerge naturally through Minimax:

* Forks
* Future winning moves
* Blocking future threats
* Sacrificing a position for a better future state
* Considering symbol expiration
* Avoiding strategically bad expirations
* Long-term board control

The key philosophy:

> **RuleBasedAI knows rules and tactical patterns. Minimax evaluates consequences.**

---

# 19. AI difficulty integration after Minimax

Once Minimax works, `main.py` will eventually offer:

```text
Select CPU difficulty:

1. Random
2. Rule-Based
3. Minimax
```

At that point all three classes can share the same interface:

```python
choose_move(game)
```

No changes to `Game` should be necessary merely because a new AI was added.

---

# 20. Potential future engine improvements

Once Minimax is functioning, we should review whether the game engine needs additional functionality to support it cleanly.

Potential additions:

### State evaluation

Something like:

```python
evaluate()
```

or keep evaluation inside `MinimaxAI`.

We should decide based on separation of responsibilities.

### State identity

Potentially useful for memoization:

```text
board state
+
player move queues
+
current player
+
game status
```

Because the board alone is **not sufficient** to describe a Tic-Tac-Pro state.

For example, two games could have visually identical boards but different move queues, resulting in different symbols expiring next.

This is a particularly important consideration for Minimax.

---

# 21. Potential rule clarification/testing

Before finalizing Minimax, we should thoroughly test edge cases involving:

* Fourth move
* Expiration producing a win
* Expiration destroying a potential win
* Expiration of a symbol involved in a threat
* Nearly full boards
* Repeated board configurations
* Long games
* Draw offers
* No legal moves
* Game states where both players could potentially win through future expiration

These cases are especially important because ordinary Tic-Tac-Toe assumptions don't necessarily hold.

---

# 22. Future Stage — Godot graphical interface

After the Python engine and AI are mature, the long-term plan is to build a **Godot GUI**.

The intended architecture is:

```text
             Godot UI
                │
                ↓
        Python/game engine
                │
       ┌────────┼────────┐
       ↓        ↓        ↓
     Board    Player     AI
                         │
                ┌────────┼────────┐
                ↓        ↓        ↓
             Random   RuleBased  Minimax
```

The GUI should **not duplicate the game rules**.

Ideally, the UI simply:

1. Displays the current state.
2. Accepts player input.
3. Passes moves to the engine.
4. Reads the resulting state.
5. Displays expiration/win/game-over events.

---

# 23. Potential future GUI features

Not yet implemented, but possible later:

* Graphical 3×3 board
* Clickable cells
* X/O animations
* Symbol expiration animation
* Turn indicator
* Player move history
* Visual indication of which symbol will expire next
* Draw-offer dialog
* CPU difficulty selection
* Restart game
* Main menu
* Win/draw screen
* Sound effects
* Visual polish/theme
* Possibly Moon Chess-inspired aesthetics

These should come **after the underlying game/AI behavior is stable**.

---

# 24. Possible future research/advanced AI

After Minimax and Godot, there are several optional directions.

### Reinforcement learning

Because the game has unusual state dynamics, Tic-Tac-Pro could eventually be used as an RL environment.

Potential approaches:

* Q-learning
* Self-play
* Monte Carlo Tree Search
* Neural-network-based evaluation

The existing:

```python
Game.copy()
get_legal_moves()
make_move()
```

architecture is already useful for experimentation.

### AI performance comparison

We could eventually run thousands of simulated games:

```text
Random vs Random
Random vs RuleBased
RuleBased vs RuleBased
RuleBased vs Minimax
Minimax vs Minimax
```

and calculate:

* Win rate
* Draw rate
* Average game length
* First-player advantage
* Most common opening moves

This would be useful for evaluating whether the game's rules are balanced.

---

# 25. Potential future game-balance investigation

Because Tic-Tac-Pro is not ordinary Tic-Tac-Toe, we don't yet know whether:

* X has a significant first-player advantage
* O has a disadvantage
* Certain opening positions are overwhelmingly strong
* Some positions create effectively forced wins
* Draws are common or rare

Once Minimax is working, we can use exhaustive or large-scale simulations to investigate the game's theoretical behavior.

This could become an interesting part of the project itself.

---

# 26. What we should NOT change unnecessarily

At this checkpoint, the following architecture should be treated as stable:

```text
Board
Player
Game
AI classes
main
tests
```

In particular:

### Don't put AI logic inside `Game`

`Game` should know the rules of the game, not how an AI thinks.

### Don't put terminal input inside `Game`

`main.py` handles interaction.

### Don't duplicate expiration logic inside AI

AI should call:

```python
game.make_move()
```

and let the engine handle expiration.

### Don't duplicate legal-move logic inside AI

AI should call:

```python
game.get_legal_moves()
```

### Don't make RuleBasedAI into a shallow Minimax

Its purpose is to be a middle difficulty.

---

# 27. Current development philosophy

We've established a useful workflow that should continue:

```text
Implement one feature
        ↓
Write targeted tests
        ↓
Run pytest
        ↓
Fix discovered edge cases
        ↓
Run full test suite
        ↓
Only then move to next feature
```

This has already caught a couple of subtle issues that would have been easy to miss through manual play alone.

The most notable example was the **expiration test where it initially appeared that the wrong symbol wasn't expiring**, but the real problem was that it was actually O's turn rather than X's. We corrected the test rather than incorrectly changing the engine.

Likewise, the RuleBasedAI's blocking logic exposed a problem with using player objects from the original game while modifying a deep-copied game.

These are exactly the kinds of issues the incremental testing approach is intended to catch.

---

# 28. Current checkpoint in one view

```text
TIC-TAC-PRO
│
├── Core Engine
│   ├── Board                         ✅
│   ├── Player / FIFO expiration     ✅
│   ├── Game rules                    ✅
│   ├── Win detection                 ✅
│   ├── Draw offers                   ✅
│   ├── Legal moves                   ✅
│   ├── Game copying                  ✅
│   └── Opponent detection            ✅
│
├── AI
│   ├── RandomAI                      ✅
│   ├── RuleBasedAI                   ✅
│   └── MinimaxAI                     ⏳ NEXT
│
├── Terminal UI
│   ├── PvP                           ✅
│   ├── PvCPU                         ✅
│   ├── Random difficulty             ✅
│   └── Rule-Based difficulty         ✅
│
├── Testing
│   └── 37/37 passing                 ✅
│
├── Graphical UI
│   └── Godot                         ⏳ FUTURE
│
└── Advanced/optional
    ├── AI benchmarking               ⏳
    ├── Game-theoretic analysis       ⏳
    ├── RL / self-play                ⏳
    └── Game balancing                ⏳
```

## Immediate next session

When we pick this back up, the logical starting point is:

> **Build `MinimaxAI` from the existing engine, starting with the search/terminal-state logic and tests before integrating it into `main.py`.**

We should **not** jump straight into a huge Minimax implementation. We'll build it in the same incremental fashion that got us to this checkpoint.

**Current stable baseline: `37/37 tests passing`, terminal PvP working, terminal PvCPU working with RandomAI and RuleBasedAI.**
