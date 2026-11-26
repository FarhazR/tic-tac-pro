/* Tic-Tac-Pro browser UI. Talks to the Python server in src/server.py. */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const boardEl = $("#board");
  const statusEl = $("#status");
  const logEl = $("#log");
  const drawBtn = $("#offerDraw");
  const newGameBtn = $("#newGame");
  const lockNote = $("#lockNote");
  const scoresToggleWrap = $("#scoresToggleWrap");
  const showScores = $("#showScores");
  const drawDialog = $("#drawDialog");
  const restartDialog = $("#restartDialog");
  const overlay = $("#overlay");

  // ---------------------------------------------------------------- session id (one game per tab)
  const SID_KEY = "ttp-sid";
  let sid = null;
  try { sid = sessionStorage.getItem(SID_KEY); } catch (e) { /* storage blocked */ }
  if (!sid) {
    sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "s" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(SID_KEY, sid); } catch (e) { /* ignore */ }
  }

  const settings = { mode: "pvp", difficulty: "minimax", depth: 3 };
  let state = null;          // null = idle (no game on the board)
  let score = { X: 0, O: 0, draw: 0 };
  let busy = false;
  let animate = false;

  // ---------------------------------------------------------------- api
  // "remote": the Python server in src/server.py.  "local": the JavaScript port
  // in engine.js, used on static hosts (no server) or when the server is down.
  let backend = "remote";

  async function api(path, body) {
    if (backend === "local") return window.TicTacPro.localApi(path, body);
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": sid },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { const err = new Error(data.error || "Request failed"); err.status = res.status; throw err; }
    return data;
  }

  // ---------------------------------------------------------------- setup controls
  const modeBtns = Array.from(document.querySelectorAll("[data-mode]"));
  const diffBtns = Array.from(document.querySelectorAll("[data-difficulty]"));
  const depthInput = $("#depth");

  function syncSetup() {
    modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === settings.mode));
    diffBtns.forEach((b) => b.classList.toggle("active", b.dataset.difficulty === settings.difficulty));
    $("#difficultyField").hidden = settings.mode !== "pvc";
    $("#depthField").style.visibility = settings.difficulty === "minimax" ? "visible" : "hidden";
    depthInput.value = settings.depth;

    const locked = !!(state && state.in_progress);
    modeBtns.concat(diffBtns).forEach((b) => { b.disabled = locked; });
    depthInput.disabled = locked;
    lockNote.hidden = !locked;
    newGameBtn.textContent = !state ? "Start game" : locked ? "Restart" : "Play again";
  }

  modeBtns.forEach((btn) => btn.addEventListener("click", () => { settings.mode = btn.dataset.mode; syncSetup(); }));
  diffBtns.forEach((btn) => btn.addEventListener("click", () => { settings.difficulty = btn.dataset.difficulty; syncSetup(); }));
  depthInput.addEventListener("change", () => {
    settings.depth = Math.max(1, Math.min(5, Number(depthInput.value) || 3));
    depthInput.value = settings.depth;
  });

  newGameBtn.addEventListener("click", () => {
    if (state && state.in_progress) {
      openDialog(restartDialog, (value) => { if (value === "restart") startGame(); });
      return;
    }
    startGame();
  });

  async function startGame() {
    if (busy) return;
    busy = true;
    hideOverlay();
    try {
      settings.depth = Math.max(1, Math.min(5, Number(depthInput.value) || 3));
      state = await api("/api/new", settings);
      score = state.score;
      animate = true;
      logEl.innerHTML = "";
      log(`New game: ${describe(state)}.`);
      render();
    } catch (e) {
      flash(e.message);
    } finally {
      busy = false;
    }
  }

  showScores.addEventListener("change", render);

  // ---------------------------------------------------------------- board
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";
      cell.disabled = true;
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.setAttribute("aria-label", `row ${r}, column ${c}`);
      cell.addEventListener("click", () => onCell(r, c));
      boardEl.appendChild(cell);
      cells.push(cell);
    }
  }

  async function onCell(row, col) {
    if (busy || !state || state.game_over || state.cpu_to_move) return;
    if (!state.legal_moves.some(([r, c]) => r === row && c === col)) return;
    busy = true;
    try {
      state = await api("/api/move", { row, col });
      score = state.score;
      logMove(state.last_move);
      render();
      if (state.game_over) { finishGame(); }
      else if (state.cpu_to_move) { await cpuTurn(); }
    } catch (e) {
      if (e.status === 404) { state = null; render(); }
      flash(e.message);
    } finally {
      busy = false;
      render();
    }
  }

  async function cpuTurn() {
    statusEl.className = "status thinking";
    statusEl.innerHTML = `CPU is thinking<span class="dots"><i></i><i></i><i></i></span>`;
    await new Promise((r) => setTimeout(r, 420));
    state = await api("/api/cpu", {});
    score = state.score;
    logMove(state.last_move, state.ai_time_ms);
    render();
    if (state.game_over) finishGame();
  }

  function finishGame() {
    setTimeout(() => showOverlay(state), 650);
  }

  // ---------------------------------------------------------------- draw offers
  drawBtn.addEventListener("click", async () => {
    if (busy || !state || state.game_over || state.cpu_to_move) return;
    if (state.mode === "pvc") {
      state = await api("/api/draw", { accept: false });
      log(`You offer a draw. <b>CPU declines.</b>`);
      render();
      return;
    }
    const offerer = state.current;
    const responder = offerer === "X" ? "O" : "X";
    $("#drawText").textContent = `Player ${offerer} offers a draw. Player ${responder}, do you accept?`;
    openDialog(drawDialog, async (value) => {
      const accept = value === "accept";
      state = await api("/api/draw", { accept });
      score = state.score;
      log(`Player ${offerer} offers a draw. Player ${responder} <b>${accept ? "accepts" : "declines"}.</b>`);
      render();
      if (state.game_over) finishGame();
    });
  });

  function openDialog(dialog, onClose) {
    dialog.returnValue = "";
    dialog.showModal();
    dialog.addEventListener("close", function handler() {
      dialog.removeEventListener("close", handler);
      onClose(dialog.returnValue);
    });
  }

  // ---------------------------------------------------------------- overlay
  const COLORS = ["#1a5fd0", "#7fb0ff", "#f2994a", "#ffd166", "#ffffff", "#2ec4b6"];

  function showOverlay(s) {
    overlay.className = "overlay " + (s.draw ? "draw" : s.winner.toLowerCase());
    $("#bigSym").textContent = s.draw ? "=" : s.winner;
    let title, sub;
    if (s.draw) {
      title = "It’s a draw";
      sub = "Both players agreed to stop.";
    } else {
      const who = s.mode === "pvc" ? (s.winner === "X" ? "You win!" : "CPU wins!") : `Player ${s.winner} wins!`;
      title = who;
      sub = `${lineName(s.winning_line)} after ${s.ply} ${s.ply === 1 ? "move" : "moves"}.`;
    }
    $("#overlayTitle").textContent = title;
    $("#overlaySub").textContent = sub;
    overlay.hidden = false;
    void overlay.offsetWidth;            // restart animations
    overlay.classList.add("show");
    if (!s.draw) confetti();
  }

  function hideOverlay() {
    overlay.classList.remove("show");
    overlay.hidden = true;
    $("#confetti").innerHTML = "";
  }

  function confetti() {
    const box = $("#confetti");
    box.innerHTML = "";
    const n = window.innerWidth < 600 ? 50 : 90;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = COLORS[i % COLORS.length];
      p.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      p.style.animationDelay = 0.35 + Math.random() * 0.8 + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      p.style.width = 6 + Math.random() * 8 + "px";
      p.style.height = 10 + Math.random() * 10 + "px";
      box.appendChild(p);
    }
  }

  $("#playAgain").addEventListener("click", startGame);
  $("#closeOverlay").addEventListener("click", hideOverlay);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) hideOverlay(); });

  function lineName(line) {
    if (!line) return "Three in a row";
    const rows = new Set(line.map((c) => c[0]));
    const cols = new Set(line.map((c) => c[1]));
    if (rows.size === 1) return ["Top row", "Middle row", "Bottom row"][line[0][0]];
    if (cols.size === 1) return ["Left column", "Middle column", "Right column"][line[0][1]];
    return line.some((c) => c[0] === 0 && c[1] === 0) ? "Diagonal" : "Anti-diagonal";
  }

  // ---------------------------------------------------------------- render
  function describe(s) {
    if (s.mode === "pvp") return "two players";
    const d = s.difficulty === "minimax" ? `Minimax (depth ${s.depth})` : s.difficulty_name;
    return `you (X) vs CPU ${d} (O)`;
  }

  function render() {
    syncSetup();
    renderScore();

    const idle = !state;
    boardEl.classList.toggle("idle", idle);
    boardEl.classList.toggle("locked", !idle && state.game_over);

    const last = idle ? null : state.last_move;
    const best = idle ? null : bestScore();
    const winCells = (!idle && state.winning_line) ? state.winning_line.map(([r, c]) => `${r},${c}`) : [];

    cells.forEach((cell) => {
      const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
      cell.className = "cell";
      cell.textContent = "";
      cell.title = "";
      if (idle) { cell.disabled = true; return; }

      const sym = state.board[r][c].trim();
      const legal = state.legal_moves.some(([lr, lc]) => lr === r && lc === c);
      const exp = state.expiring[state.current];
      const isCurrentOldest = sym === state.current && exp && exp[0] === r && exp[1] === c;

      cell.textContent = sym;
      if (sym) cell.classList.add(sym.toLowerCase());
      if (legal && !state.game_over && !state.cpu_to_move) cell.classList.add("legal");
      if (isCurrentOldest && !state.game_over) {
        cell.classList.add("expiring");
        cell.title = "Oldest symbol: it expires on this player’s next move";
      }
      if (winCells.includes(`${r},${c}`)) cell.classList.add("win");
      if (animate && last && last.cell[0] === r && last.cell[1] === c && !state.winning_line) cell.classList.add("placed");
      cell.disabled = state.game_over || state.cpu_to_move || !legal;

      if (animate && last && last.expired && last.expired[0] === r && last.expired[1] === c && !sym) {
        const ghost = document.createElement("span");
        ghost.className = `ghost ${last.player.toLowerCase()}`;
        ghost.textContent = last.player;
        cell.appendChild(ghost);
      }

      if (showScores.checked && state.ai_scores) {
        const sc = state.ai_scores[`${r},${c}`];
        if (sc !== undefined) {
          const tag = document.createElement("span");
          tag.className = "score" + (sc === best ? " best" : "");
          tag.textContent = sc > 0 ? `+${sc}` : `${sc}`;
          cell.appendChild(tag);
        }
      }
    });

    // players
    const px = $("#playerX"), po = $("#playerO");
    px.classList.toggle("active", !idle && !state.game_over && state.current === "X");
    po.classList.toggle("active", !idle && !state.game_over && state.current === "O");
    px.classList.toggle("winner", !idle && state.winner === "X");
    po.classList.toggle("winner", !idle && state.winner === "O");
    const pvc = !idle && state.mode === "pvc";
    $("#nameX").textContent = pvc ? "You" : "Player X";
    $("#nameO").textContent = pvc ? `CPU · ${state.difficulty === "minimax" ? "Minimax d" + state.depth : state.difficulty_name}` : "Player O";

    // status
    statusEl.className = "status";
    if (idle) {
      statusEl.textContent = "Pick a mode and press Start.";
    } else if (state.game_over) {
      statusEl.classList.add("win");
      statusEl.textContent = state.draw ? "Draw agreed. Game over." : state.message;
    } else if (state.cpu_to_move) {
      statusEl.classList.add("thinking");
      statusEl.innerHTML = `CPU is thinking<span class="dots"><i></i><i></i><i></i></span>`;
    } else {
      const who = pvc ? "Your move" : `Player ${state.current}’s move`;
      const exp = state.expiring[state.current];
      statusEl.textContent = exp ? `${who}. Your oldest symbol at (${exp[0]}, ${exp[1]}) expires next.` : `${who}.`;
    }

    drawBtn.disabled = idle || state.game_over || state.cpu_to_move;
    scoresToggleWrap.hidden = !(pvc && state.difficulty === "minimax");

    renderQueue("#queueX", idle ? [] : state.queues.X);
    renderQueue("#queueO", idle ? [] : state.queues.O);
  }

  function renderScore() {
    for (const [id, n] of [["#scoreX", score.X], ["#scoreO", score.O]]) {
      const em = $(id);
      em.textContent = n;
      em.nextSibling.textContent = n === 1 ? " win" : " wins";
    }
    $("#scoreDraw").textContent = score.draw;
    $("#scoreDraw").nextSibling.textContent = score.draw === 1 ? "draw" : "draws";
  }

  function bestScore() {
    if (!state.ai_scores) return null;
    return Math.max(...Object.values(state.ai_scores));
  }

  function renderQueue(sel, moves) {
    const chips = document.querySelector(`${sel} .chips`);
    chips.innerHTML = "";
    if (!moves.length) {
      const e = document.createElement("span");
      e.className = "chip empty";
      e.textContent = "none yet";
      chips.appendChild(e);
      return;
    }
    moves.forEach(([r, c], i) => {
      const chip = document.createElement("span");
      const oldest = i === 0 && moves.length === 3;
      chip.className = "chip" + (oldest ? " oldest" : "");
      chip.textContent = `(${r}, ${c})`;
      if (oldest) chip.title = "oldest: expires next";
      chips.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------- log
  function logMove(m, ms) {
    if (!m) return;
    const who = m.by === "cpu" ? "CPU" : (state && state.mode === "pvc" ? "You" : `Player ${m.player}`);
    let text = `<b>${who}</b> ${m.player === "X" ? "✕" : "○"} (${m.cell[0]}, ${m.cell[1]})`;
    if (m.expired) text += ` · <b>(${m.expired[0]}, ${m.expired[1]}) expired</b>`;
    if (ms !== undefined && ms !== null) text += ` · ${ms} ms`;
    log(text);
  }

  function log(html) {
    const placeholder = logEl.querySelector(".muted");
    if (placeholder) placeholder.remove();
    const p = document.createElement("p");
    p.innerHTML = html;
    logEl.prepend(p);
  }

  function flash(msg) {
    statusEl.className = "status error";
    statusEl.textContent = msg;
  }

  // ---------------------------------------------------------------- boot
  async function detectBackend() {
    try {
      const res = await fetch("/api/health", { headers: { "X-Session-Id": sid } });
      const data = res.ok ? await res.json() : null;
      backend = data && data.ok && !data.local ? "remote" : "local";
    } catch (e) {
      backend = "local";
    }
    if (backend === "local" && !window.TicTacPro) {
      backend = "remote";                 // engine.js missing: keep trying the server
      return;
    }
    const note = $("#backendNote");
    if (note) {
      note.textContent = backend === "remote"
        ? "Engine: Python server (src/server.py)"
        : "Engine: running in your browser (web/engine.js, a port of the Python engine)";
    }
  }

  (async function boot() {
    await detectBackend();
    try {
      const data = await api("/api/state");
      score = data.score;
      if (data.in_progress) {
        state = data;
        settings.mode = data.mode;
        if (data.difficulty) settings.difficulty = data.difficulty;
        if (data.depth) settings.depth = data.depth;
        log("Game restored.");
      }
    } catch (e) {
      if (e.status !== 404 && !(e instanceof SyntaxError)) {
        render();
        flash("Cannot reach the game server. Start it with: python run.py");
        return;
      }
    }
    render();
    animate = true;
  })();
})();
