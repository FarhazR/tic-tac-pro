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
      const search = this.startSearch(game);
      while (!search.step(1)) { /* evaluate every root move */ }
      return search.scores;
    }
    /** Steppable search: step(n) evaluates n more root moves; snapshot() is the UI tree. */
    startSearch(game) {
      const self = this;
      this.symbol = game.currentPlayer.symbol;
      this.nodesSearched = 0;
      const legal = game.getLegalMoves();
      const scores = new Map();
      let i = 0;
      const detail = new Map();          // "r,c" -> { nodes, replies }
      // Evaluate one root move exactly as minimax(sim, depth, false) would, but keep the
      // opponent replies it examined so the UI can draw them.
      const evalRoot = (m) => {
        const sim = game.copy();
        sim.makeMove(m[0], m[1]);
        const before = self.nodesSearched;
        self.nodesSearched++;
        const depth = self.depth;
        const terminal = self.evaluate(sim);
        let score;
        const replies = [];
        if (terminal !== null) score = terminal * (1 + depth);
        else if (depth === 0) score = self.heuristic(sim);
        else {
          const reps = sim.getLegalMoves();
          let best = Infinity, alpha = -Infinity, beta = Infinity, cut = false;
          for (const r of reps) {
            if (cut) { replies.push({ move: r.slice(), score: null, pruned: true }); continue; }
            const s2 = sim.copy();
            s2.makeMove(r[0], r[1]);
            const v = self.minimax(s2, depth - 1, true, alpha, beta);
            replies.push({ move: r.slice(), score: Math.round(v * 100) / 100, pruned: false });
            best = Math.min(best, v);
            beta = Math.min(beta, best);
            if (beta <= alpha) cut = true;
          }
          score = reps.length ? best : 0;
        }
        return { score, replies, nodes: self.nodesSearched - before };
      };
      const search = {
        scores, total: legal.length, get done() { return i; },
        step(n) {
          for (let k = 0; k < n && i < legal.length; k++, i++) {
            const m = legal[i];
            const key = `${m[0]},${m[1]}`;
            const r = evalRoot(m);
            scores.set(key, r.score);
            detail.set(key, r);
          }
          return i >= legal.length;
        },
        snapshot() {
          const vals = [...scores.values()];
          const best = vals.length ? Math.max(...vals) : null;
          return {
            type: "minimax", depth: self.depth, nodes: self.nodesSearched, done: i, total: legal.length,
            root: legal.map((m) => {
              const k = `${m[0]},${m[1]}`;
              const d = detail.get(k);
              const s = scores.has(k) ? Math.round(scores.get(k) * 100) / 100 : null;
              return { move: m.slice(), score: s, best: s !== null && scores.get(k) === best, pending: !scores.has(k),
                nodes: d ? d.nodes : 0, children: d ? d.replies : [] };
            }),
          };
        },
        finish() {
          while (!search.step(1)) { /* drain */ }
          return search.snapshot();
        },
      };
      return search;
    }
    chooseMove(game) {
      const legal = game.getLegalMoves();
      if (!legal.length) return null;
      const scores = this.scoreMoves(game);
      this.lastScores = new Map([...scores].map(([k, v]) => [k, Math.round(v * 100) / 100]));
      const best = Math.max(...scores.values());
      const bestMoves = [...scores.entries()].filter(([, s]) => s === best).map(([k]) => k.split(",").map(Number));
      const chosen = choice(bestMoves);
      this.lastTree = {
        type: "minimax", depth: this.depth, nodes: this.nodesSearched, chosen,
        root: [...scores].map(([k, s]) => ({ move: k.split(",").map(Number), score: Math.round(s * 100) / 100, best: s === best })),
      };
      return chosen;
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
    /** Steppable search: step(n) runs n more simulations; snapshot() is the UI tree so far. */
    startSearch(game) {
      const self = this;
      this.nodesSearched = 0;
      const root = new MCTSNode(game.copy());
      let done = 0;
      const wr = (n) => (n.visits ? Math.round((n.wins / n.visits) * 100) / 100 : 0);
      let lastPath = [];
      const search = {
        root, total: this.simulations, get done() { return done; },
        step(n) {
          for (let k = 0; k < n && done < self.simulations; k++, done++) {
            let node = root;
            const path = [root];
            while (!node.untried.length && node.children.length) { node = self.select(node); path.push(node); }
            if (node.untried.length) { node = self.expand(node); path.push(node); }
            self.backpropagate(path, self.rollout(node.game));
            lastPath = path.slice(1).map((p) => p.move.slice());
          }
          return done >= self.simulations;
        },
        snapshot() {
          const most = root.children.length ? Math.max(...root.children.map((c) => c.visits)) : 0;
          const ordered = [...root.children].sort((a, b) => (a.move[0] - b.move[0]) || (a.move[1] - b.move[1]));
          return {
            type: "mcts", simulations: self.simulations, nodes: self.nodesSearched, done, total: self.simulations,
            last_path: lastPath,
            root: ordered.map((c) => ({
              move: c.move.slice(), visits: c.visits, win_rate: wr(c), best: c.visits === most && most > 0,
              children: [...c.children].sort((a, b) => b.visits - a.visits).slice(0, 4)
                .map((g) => ({ move: g.move.slice(), visits: g.visits, win_rate: wr(g) })),
            })),
          };
        },
        finish() { while (!search.step(128)) { /* drain */ } return search.snapshot(); },
      };
      return search;
    }
    chooseMove(game) {
      const legal = game.getLegalMoves();
      if (!legal.length) return null;
      const search = this.startSearch(game);
      search.finish();
      const root = search.root;
      const most = Math.max(...root.children.map((c) => c.visits));
      const best = choice(root.children.filter((c) => c.visits === most));
      this.lastScores = new Map(root.children.map((c) => [`${c.move[0]},${c.move[1]}`, Math.round((c.wins / c.visits) * 100) / 100]));
      this.lastVisits = new Map(root.children.map((c) => [`${c.move[0]},${c.move[1]}`, c.visits]));
      const wr = (n) => Math.round((n.wins / n.visits) * 100) / 100;
      this.lastTree = {
        type: "mcts", simulations: this.simulations, nodes: this.nodesSearched, chosen: best.move.slice(),
        root: [...root.children].sort((a, b) => b.visits - a.visits).map((c) => ({
          move: c.move.slice(), visits: c.visits, win_rate: wr(c), best: c === best,
          children: [...c.children].sort((a, b) => b.visits - a.visits).slice(0, 3)
            .map((g) => ({ move: g.move.slice(), visits: g.visits, win_rate: wr(g) })),
        })),
      };
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
      this.aiInsight = null;
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
    cpuMove(pre) {
      const game = this.game;
      if (!this.ai) bad("No CPU in a Player vs Player game.");
      if (game.gameOver) bad("The game is over.");
      if (game.currentPlayer !== game.player2) bad("It is not the CPU's turn.");

      let move;
      if (pre && pre.move) {                        // decided by a live search run in the page
        move = pre.move;
        this.aiTimeMs = pre.time_ms ?? null;
        this.aiScores = pre.scores || null;
        this.aiInsight = pre.insight ? Object.assign({}, pre.insight, { time_ms: this.aiTimeMs }) : null;
        if (!game.getLegalMoves().some(([r, c]) => r === move[0] && c === move[1])) bad("Illegal CPU move.");
      } else {
        const start = performance.now();
        move = this.ai.chooseMove(game);
        this.aiTimeMs = Math.round((performance.now() - start) * 10) / 10;
        if (!move) bad("The CPU has no legal move.");
        const scores = this.ai.lastScores || null;   // Minimax root scores / MCTS win rates
        this.aiScores = scores ? Object.fromEntries(scores) : null;
        this.aiInsight = this.ai.lastTree ? Object.assign({}, this.ai.lastTree, { time_ms: this.aiTimeMs }) : null;
      }
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
        ai_insight: this.aiInsight,
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
        if (path === "/api/cpu") return resolve(session.cpuMove(body));
        if (path === "/api/draw") return resolve(session.offerDraw(!!body.accept));
        throw new ApiError("Unknown endpoint.", 404);
      } catch (e) {
        reject(e instanceof ApiError ? e : new ApiError(e.message, 400));
      }
    });
  }

  /** Rebuild a Game from an API state object (board, queues, current). */
  function gameFromState(s) {
    const g = new Game();
    g.board.grid = s.board.map((row) => row.slice());
    g.player1.moves = s.queues.X.map((m) => m.slice());
    g.player2.moves = s.queues.O.map((m) => m.slice());
    g.currentPlayer = s.current === "X" ? g.player1 : g.player2;
    g.gameOver = !!s.game_over; g.winner = s.winner || null; g.draw = !!s.draw;
    return g;
  }

  const TicTacPro = { Board, Player, Game, RandomAI, RuleBasedAI, MinimaxAI, MCTS_AI, Session, localApi,
    gameFromState, localSession: () => session, LINES, MAX_DEPTH, MAX_SIMULATIONS };
  root.TicTacPro = TicTacPro;
  if (typeof module !== "undefined" && module.exports) module.exports = TicTacPro;
})(typeof window !== "undefined" ? window : globalThis);
