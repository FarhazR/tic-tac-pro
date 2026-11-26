# Tic-Tac-Pro benchmark

30 games per pairing (15 per colour), 60-ply cap counted as a draw, seed 2026.

| Player A | Player B | A wins | draws / capped | A losses | A ms/move | B ms/move | mean plies |
|---|---|---:|---:|---:|---:|---:|---:|
| MCTS 500 | Random | 30 | 0 | 0 | 40 | 0 | 6.2 |
| MCTS 500 | Rule-Based | 24 | 0 | 6 | 35 | 0 | 11.6 |
| MCTS 500 | Minimax d3 | 24 | 0 | 6 | 38 | 10 | 13.5 |
| MCTS 200 | Minimax d3 | 21 | 0 | 9 | 17 | 11 | 11.5 |
| MCTS 1000 | Minimax d3 | 27 | 0 | 3 | 70 | 10 | 14.4 |
| Minimax d3 | Rule-Based | 24 | 0 | 6 | 9 | 0 | 16.1 |
