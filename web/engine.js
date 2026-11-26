/* Tic-Tac-Pro in-browser engine.
 *
 * A line-for-line port of src/board.py, src/player.py, src/game.py, src/ai.py
 * and the Session class in src/server.py, so the page can run on a static host
 * (for example a free Hugging Face Static Space) with no Python server.
 * tests/test_js_engine.py replays random games and Minimax positions through
 * both implementations and requires identical results.
 *
 * Exposes `TicTacPro` with: Game, RandomAI, RuleBasedAI, MinimaxAI, Session,
 * localApi(path, body) -> Promise of the same JSON the Python API returns.
 */
(function (root) {
  "use strict";

  const LINES = [
    [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]],
    [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]],
  ];
  const CORNERS = ["0,0", "0,2", "2,0", "2,2"];
  const MAX_DEPTH = 5;
  const MAX_SIMULATIONS = 3000;

  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ------------------------------------------------------------------ board
  class Board {
    constructor() {
      this.grid = [[" ", " ", " "], [" ", " ", " "], [" ", " ", " "]];
    }
    isEmpty(r, c) { return this.grid[r][c] === " "; }
    placeSymbol(r, c, s) {
      if (!this.isEmpty(r, c)) return false;
      this.grid[r][c] = s;
      return true;
    }
    removeSymbol(r, c) { this.grid[r][c] = " "; }
    checkWin(s) {
      return LINES.some((line) => line.every(([r, c]) => this.grid[r][c] === s));
    }
    clone() {
      const b = new Board();
      b.grid = this.grid.map((row) => row.slice());
      return b;
    }
  }

  // ------------------------------------------------------------------ player
  class Player {
    constructor(symbol) {
      this.symbol = symbol;
      this.moves = [];            // FIFO of [r, c], oldest first
    }
    addMove(pos) {
      let expired = null;
      if (this.moves.length >= 3) expired = this.moves.shift();
      this.moves.push(pos);
      return expired;
    }
    clone() {
      const p = new Player(this.symbol);
      p.moves = this.moves.map((m) => m.slice());
      return p;
    }
  }

  // ------------------------------------------------------------------ game
  class Game {
    constructor() {
      this.board = new Board();
      this.player1 = new Player("X");
      this.player2 = new Player("O");
      this.currentPlayer = this.player1;
      this.gameOver = false;
      this.winner = null;
      this.draw = false;
    }
    switchPlayer() {
      this.currentPlayer = this.currentPlayer === this.player1 ? this.player2 : this.player1;
    }
    makeMove(r, c) {
      if (this.gameOver) return false;
      if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < 3 && c >= 0 && c < 3)) return false;
      if (!this.board.isEmpty(r, c)) return false;

      const player = this.currentPlayer;
      this.board.placeSymbol(r, c, player.symbol);
      const expired = player.addMove([r, c]);
      if (expired) this.board.removeSymbol(expired[0], expired[1]);

      if (this.board.checkWin(player.symbol)) {
        this.gameOver = true;
        this.winner = player.symbol;
        return true;
      }
      this.switchPlayer();
      return true;
    }
    copy() {
      const g = new Game();
      g.board = this.board.clone();
      g.player1 = this.player1.clone();
      g.player2 = this.player2.clone();
      g.currentPlayer = this.currentPlayer === this.player1 ? g.player1 : g.player2;
      g.gameOver = this.gameOver;
      g.winner = this.winner;
      g.draw = this.draw;
      return g;
    }
    getLegalMoves() {
      const out = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (this.board.isEmpty(r, c)) out.push([r, c]);
      return out;
    }
    endInDraw() {
      if (this.gameOver) return false;
      this.gameOver = true;
      this.draw = true;
      return true;
    }
    getOpponent() { return this.currentPlayer === this.player1 ? this.player2 : this.player1; }
    stateKey() {
      return JSON.stringify([this.board.grid, this.player1.moves, this.player2.moves,
        this.currentPlayer.symbol, this.gameOver, this.winner, this.draw]);
    }
  }

  // ------------------------------------------------------------------ AIs
  class RandomAI {
    chooseMove(game) {
      const legal = game.getLegalMoves();
      return legal.length ? choice(legal) : null;
    }
  }

  class RuleBasedAI {
    chooseMove(game) {
      const legal = game.getLegalMoves();
      if (!legal.length) return null;

      // 1. immediate win
      for (const m of legal) {
        const sim = game.copy();
        sim.makeMove(m[0], m[1]);
        if (sim.winner === game.currentPlayer.symbol) return m;
      }
      // 2. block an immediate opponent win
      const opponentIsP1 = game.getOpponent() === game.player1;
      for (const m of legal) {
        const sim = game.copy();
        const simOpp = opponentIsP1 ? sim.player1 : sim.player2;
        sim.currentPlayer = simOpp;
        sim.makeMove(m[0], m[1]);
        if (sim.winner === simOpp.symbol) return m;
      }
      // 3. centre, then a random corner
      if (legal.some(([r, c]) => r === 1 && c === 1)) return [1, 1];
      const corners = legal.filter(([r, c]) => CORNERS.includes(`${r},${c}`));
      if (corners.length) return choice(corners);
      // 4. anything
      return choice(legal);
    }
  }

  class MinimaxAI {
    constructor(depth = 3) {
      this.symbol = null;
      this.depth = depth;
      this.nodesSearched = 0;
    }
    evaluate(game) {
      if (game.winner === this.symbol) return 1;
      if (game.winner !== null) return -1;
      if (game.draw) return 0;
      return null;
    }
    heuristic(game) {
      const grid = game.board.grid;
      const opp = this.symbol === "X" ? "O" : "X";
      let score = 0.0;
      for (const line of LINES) {
        let mine = 0, theirs = 0;
        for (const [r, c] of line) {
          if (grid[r][c] === this.symbol) mine++;
          else if (grid[r][c] === opp) theirs++;
        }
        if (mine === 2 && theirs === 0) score += 0.1;
        else if (theirs === 2 && mine === 0) score -= 0.1;
      }
      const centre = grid[1][1];
      if (centre === this.symbol) score += 0.05;
      else if (centre === opp) score -= 0.05;
      return score;
    }
    minimax(game, depth, maximizing, alpha = -Infinity, beta = Infinity) {
      this.nodesSearched++;
      const terminal = this.evaluate(game);
      if (terminal !== null) return terminal * (1 + depth);
      if (depth === 0) return this.heuristic(game);
      const legal = game.getLegalMoves();
      if (!legal.length) return 0;

      if (maximizing) {
        let best = -Infinity;
        for (const m of legal) {
          const sim = game.copy();
          sim.makeMove(m[0], m[1]);
          best = Math.max(best, this.minimax(sim, depth - 1, false, alpha, beta));
          alpha = Math.max(alpha, best);
          if (beta <= alpha) break;
        }
        return best;
      }
      let best = Infinity;
      for (const m of legal) {
        const sim = game.copy();
        sim.makeMove(m[0], m[1]);
        best = Math.min(best, this.minimax(sim, depth - 1, true, alpha, beta));
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    scoreMoves(game) {
      this.symbol = game.currentPlayer.symbol;
      this.nodesSearched = 0;
      const scores = new Map();
      for (const m of game.getLegalMoves()) {
        const sim = game.copy();
        sim.makeMove(m[0], m[1]);
        scores.set(`${m[0]},${m[1]}`, this.minimax(sim, this.depth, false));
      }
      return scores;
    }
    chooseMove(game) {
      const legal = game.getLegalMoves();
      if (!legal.length) return null;
      const scores = this.scoreMoves(game);
      this.lastScores = new Map([...scores].map(([k, v]) => [k, Math.round(v * 100) / 100]));
      const best = Math.max(...scores.values());
      const bestMoves = [...scores.entries()].filter(([, s]) => s === best).map(([k]) => k.split(",").map(Number));
      return choice(bestMoves);
    }
  }

  // ------------------------------------------------------------------ MCTS (port of src/ai.py)
  class MCTSNode {
    constructor(game, parent = null, move = null, mover = null) {
      this.game = game;
      this.parent = parent;
      this.move = move;
      this.mover = mover;          // symbol that moved into this node; wins are from its view
      this.children = [];
      this.untried = game.gameOver ? [] : game.getLegalMoves();
      this.visits = 0;
      this.wins = 0;
    }
  }

  class MCTS_AI {
    constructor(simulations = 500, exploration = Math.SQRT2, rolloutLimit = 30) {
      this.simulations = simulations;
      this.exploration = exploration;
      this.rolloutLimit = rolloutLimit;
      this.lastScores = null;      // Map "r,c" -> win rate
      this.lastVisits = null;
      this.nodesSearched = 0;
    }
    select(node) {
      const logN = Math.log(node.visits);
      let best = null, bestValue = -Infinity;
      for (const c of node.children) {
        const v = c.wins / c.visits + this.exploration * Math.sqrt(logN / c.visits);
        if (v > bestValue) { bestValue = v; best = c; }
      }
      return best;
    }
    expand(node) {
      const i = Math.floor(Math.random() * node.untried.length);
      const move = node.untried.splice(i, 1)[0];
      const sim = node.game.copy();
      sim.makeMove(move[0], move[1]);
      const child = new MCTSNode(sim, node, move, node.game.currentPlayer.symbol);
      node.children.push(child);
      this.nodesSearched++;
      return child;
    }
    rollout(game) {
      if (game.gameOver) return game.winner;
      const sim = game.copy();
      const seen = new Set([sim.stateKey()]);
      for (let i = 0; i < this.rolloutLimit; i++) {
        const m = choice(sim.getLegalMoves());
        sim.makeMove(m[0], m[1]);
        if (sim.gameOver) return sim.winner;
        const key = sim.stateKey();
        if (seen.has(key)) return null;      // repetition counts as a draw
        seen.add(key);
      }
      return null;                           // ply cap counts as a draw
    }
    backpropagate(path, winner) {
      for (const node of path) {
        node.visits++;
        if (node.mover === null) continue;
        if (winner === null) node.wins += 0.5;
        else if (winner === node.mover) node.wins += 1;
      }
    }
    chooseMove(game) {
      const legal = game.getLegalMoves();
      if (!legal.length) return null;
      this.nodesSearched = 0;
      const root = new MCTSNode(game.copy());
      for (let i = 0; i < this.simulations; i++) {
        let node = root;
        const path = [root];
        while (!node.untried.length && node.children.length) { node = this.select(node); path.push(node); }
        if (node.untried.length) { node = this.expand(node); path.push(node); }
        this.backpropagate(path, this.rollout(node.game));
      }
      const most = Math.max(...root.children.map((c) => c.visits));
      const best = choice(root.children.filter((c) => c.visits === most));
      this.lastScores = new Map(root.children.map((c) => [`${c.move[0]},${c.move[1]}`, Math.round((c.wins / c.visits) * 100) / 100]));
      this.lastVisits = new Map(root.children.map((c) => [`${c.move[0]},${c.move[1]}`, c.visits]));
      return best.move;
    }
  }

  const DIFFICULTIES = {
    random: ["Random", () => new RandomAI()],
    rule: ["Rule-Based", () => new RuleBasedAI()],
    minimax: ["Minimax", (depth) => new MinimaxAI(depth)],
    mcts: ["MCTS", (depth, sims) => new MCTS_AI(sims)],
  };

  function winningLine(board, symbol) {
    for (const line of LINES) {
      if (line.every(([r, c]) => board.grid[r][c] === symbol)) return line.map((cell) => cell.slice());
    }
    return null;
  }

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  const bad = (msg) => { throw new ApiError(msg, 400); };

  // ------------------------------------------------------------------ session (mirror of src/server.py)
  class Session {
    constructor() {
      this.score = { X: 0, O: 0, draw: 0 };
      this.newGame();
    }
    newGame(mode = "pvp", difficulty = "minimax", depth = 3, simulations = 500) {
      if (mode !== "pvp" && mode !== "pvc") bad("mode must be 'pvp' or 'pvc'");
      if (!DIFFICULTIES[difficulty]) bad("difficulty must be one of: random, rule, minimax, mcts");
      depth = parseInt(depth, 10);
      simulations = parseInt(simulations, 10);
      if (Number.isNaN(depth) || Number.isNaN(simulations)) bad("depth and simulations must be integers");
      depth = Math.max(1, Math.min(depth, MAX_DEPTH));
      simulations = Math.max(50, Math.min(simulations, MAX_SIMULATIONS));

      this.game = new Game();
      this.mode = mode;
      this.depth = depth;
      this.simulations = simulations;
      this.ai = null;
      this.difficulty = null;
      this.difficultyName = null;
      if (mode === "pvc") {
        this.difficulty = difficulty;
        this.difficultyName = DIFFICULTIES[difficulty][0];
        this.ai = DIFFICULTIES[difficulty][1](depth, simulations);
      }
      this.ply = 0;
      this.lastMove = null;
      this.aiScores = null;
      this.aiTimeMs = null;
      this.message = "X to move.";
      return this.state();
    }
    _applyMove(r, c, by) {
      const game = this.game;
      const player = game.currentPlayer;
      const oldest = player.moves.length === 3 ? player.moves[0] : null;
      if (!game.makeMove(r, c)) return false;
      this.ply++;
      const expired = oldest && game.board.isEmpty(oldest[0], oldest[1]) ? oldest : null;
      this.lastMove = { player: player.symbol, cell: [r, c], expired: expired ? expired.slice() : null, by };
      if (game.winner !== null) {
        this.score[game.winner]++;
        const who = by === "cpu" ? "CPU" : `Player ${game.winner}`;
        this.message = `${who} (${game.winner}) wins!`;
      } else {
        this.message = `${game.currentPlayer.symbol} to move.`;
      }
      return true;
    }
    humanMove(r, c) {
      const game = this.game;
      if (game.gameOver) bad("The game is over. Start a new game.");
      if (this.ai && game.currentPlayer === game.player2) bad("It is the CPU's turn.");
      r = Number(r); c = Number(c);
      if (!Number.isInteger(r) || !Number.isInteger(c)) bad("row and col must be integers");
      if (!this._applyMove(r, c, "human")) bad("Illegal move: the cell is occupied or out of range.");
      return this.state();
    }
    cpuMove() {
      const game = this.game;
      if (!this.ai) bad("No CPU in a Player vs Player game.");
      if (game.gameOver) bad("The game is over.");
      if (game.currentPlayer !== game.player2) bad("It is not the CPU's turn.");

      const start = performance.now();
      const move = this.ai.chooseMove(game);
      this.aiTimeMs = Math.round((performance.now() - start) * 10) / 10;
      if (!move) bad("The CPU has no legal move.");
      const scores = this.ai.lastScores || null;     // Minimax root scores / MCTS win rates
      this.aiScores = scores ? Object.fromEntries(scores) : null;
      this._applyMove(move[0], move[1], "cpu");
      return this.state();
    }
    offerDraw(accept) {
      const game = this.game;
      if (game.gameOver) bad("The game is over.");
      if (this.ai) {
        this.message = `CPU (O) declines the draw. ${game.currentPlayer.symbol} to move.`;
        return { accepted: false, ...this.state() };
      }
      if (accept) {
        game.endInDraw();
        this.score.draw++;
        this.message = "Draw agreed. Game over.";
        return { accepted: true, ...this.state() };
      }
      this.message = `Draw declined. ${game.currentPlayer.symbol} to move.`;
      return { accepted: false, ...this.state() };
    }
    state() {
      const g = this.game;
      const q = (p) => p.moves.map((m) => m.slice());
      const expiring = (p) => (p.moves.length === 3 ? p.moves[0].slice() : null);
      return {
        board: g.board.grid.map((row) => row.slice()),
        current: g.currentPlayer.symbol,
        queues: { X: q(g.player1), O: q(g.player2) },
        expiring: { X: expiring(g.player1), O: expiring(g.player2) },
        legal_moves: g.getLegalMoves(),
        game_over: g.gameOver,
        winner: g.winner,
        winning_line: g.winner ? winningLine(g.board, g.winner) : null,
        draw: g.draw,
        ply: this.ply,
        in_progress: this.ply > 0 && !g.gameOver,
        score: { ...this.score },
        mode: this.mode,
        difficulty: this.difficulty,
        difficulty_name: this.difficultyName,
        depth: this.difficulty === "minimax" ? this.depth : null,
        simulations: this.difficulty === "mcts" ? this.simulations : null,
        cpu_symbol: this.ai ? "O" : null,
        cpu_to_move: !!this.ai && !g.gameOver && g.currentPlayer === g.player2,
        last_move: this.lastMove,
        ai_scores: this.aiScores,
        ai_time_ms: this.aiTimeMs,
        message: this.message,
      };
    }
  }

  // ------------------------------------------------------------------ local "API"
  let session = null;

  function localApi(path, body) {
    return new Promise((resolve, reject) => {
      try {
        path = path.split("?")[0];
        if (path === "/api/health") return resolve({ ok: true, local: true });
        if (path === "/api/state") {
          if (!session) throw new ApiError("No game yet. Start a new one.", 404);
          return resolve(session.state());
        }
        if (body === undefined) throw new ApiError("Unknown endpoint.", 404);
        if (path === "/api/new") {
          if (!session) session = new Session();
          return resolve(session.newGame(body.mode ?? "pvp", body.difficulty ?? "minimax", body.depth ?? 3, body.simulations ?? 500));
        }
        if (!session) throw new ApiError("No game yet. Start a new one.", 404);
        if (path === "/api/move") return resolve(session.humanMove(body.row, body.col));
        if (path === "/api/cpu") return resolve(session.cpuMove());
        if (path === "/api/draw") return resolve(session.offerDraw(!!body.accept));
        throw new ApiError("Unknown endpoint.", 404);
      } catch (e) {
        reject(e instanceof ApiError ? e : new ApiError(e.message, 400));
      }
    });
  }

  const TicTacPro = { Board, Player, Game, RandomAI, RuleBasedAI, MinimaxAI, MCTS_AI, Session, localApi, LINES, MAX_DEPTH, MAX_SIMULATIONS };
  root.TicTacPro = TicTacPro;
  if (typeof module !== "undefined" && module.exports) module.exports = TicTacPro;
})(typeof window !== "undefined" ? window : globalThis);
