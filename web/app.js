/* Tic-Tac-Pro browser UI. Talks to the Python server in src/server.py. */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const boardEl = $("#board");
  const statusEl = $("#status");
  const logEl = $("#log");
  const drawBtn = $("#offerDraw");
  const scoresToggleWrap = $("#scoresToggleWrap");
  const showScores = $("#showScores");
  const dialog = $("#drawDialog");

  const settings = { mode: "pvp", difficulty: "minimax", depth: 3 };
  let state = null;
  let busy = false;
  let animate = false;   // off for the first render after a page load

  // ---------------------------------------------------------------- api
  async function api(path, body) {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ---------------------------------------------------------------- setup
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.mode = btn.dataset.mode;
      document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b === btn));
      $("#difficultyField").hidden = settings.mode !== "pvc";
    });
  });
  document.querySelectorAll("[data-difficulty]").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.difficulty = btn.dataset.difficulty;
      document.querySelectorAll("[data-difficulty]").forEach((b) => b.classList.toggle("active", b === btn));
      $("#depthField").style.visibility = settings.difficulty === "minimax" ? "visible" : "hidden";
    });
  });
  $("#newGame").addEventListener("click", async () => {
    settings.depth = Number($("#depth").value) || 3;
    logEl.innerHTML = "";
    try {
      state = await api("/api/new", settings);
      log(`New game: ${describe(state)}.`);
      render();
    } catch (e) { flash(e.message); }
  });
  showScores.addEventListener("change", render);

  // ---------------------------------------------------------------- board
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.setAttribute("aria-label", `row ${r}, column ${c}`);
      cell.addEventListener("click", () => onCell(r, c));
      boardEl.appendChild(cell);
    }
  }

  async function onCell(row, col) {
    if (busy || !state || state.game_over || state.cpu_to_move) return;
    if (!state.legal_moves.some(([r, c]) => r === row && c === col)) return;
    busy = true;
    try {
      state = await api("/api/move", { row, col });
      logMove(state.last_move);
      render();
      if (state.cpu_to_move) await cpuTurn();
    } catch (e) {
      flash(e.message);
    } finally {
      busy = false;
      render();
    }
  }

  async function cpuTurn() {
    statusEl.textContent = `CPU (${state.cpu_symbol}) is thinking…`;
    statusEl.className = "status thinking";
    await new Promise((r) => setTimeout(r, 350));
    state = await api("/api/cpu", {});
    logMove(state.last_move, state.ai_time_ms);
    render();
  }

  // ---------------------------------------------------------------- draw
  drawBtn.addEventListener("click", async () => {
    if (busy || !state || state.game_over || state.cpu_to_move) return;
    if (state.mode === "pvc") {
      state = await api("/api/draw", { accept: false });
      log(`Player X offers a draw. <b>CPU declines.</b>`);
      render();
      return;
    }
    const offerer = state.current;
    const responder = offerer === "X" ? "O" : "X";
    $("#drawText").textContent = `Player ${offerer} offers a draw. Player ${responder}, do you accept?`;
    dialog.returnValue = "";
    dialog.showModal();
    dialog.addEventListener("close", async function handler() {
      dialog.removeEventListener("close", handler);
      const accept = dialog.returnValue === "accept";
      state = await api("/api/draw", { accept });
      log(`Player ${offerer} offers a draw. Player ${responder} <b>${accept ? "accepts" : "declines"}.</b>`);
      render();
    });
  });

  // ---------------------------------------------------------------- render
  function describe(s) {
    if (s.mode === "pvp") return "Player vs Player";
    const d = s.difficulty === "minimax" ? `Minimax (depth ${s.depth})` : s.difficulty_name;
    return `Player (X) vs CPU ${d} (O)`;
  }

  function render() {
    if (!state) return;
    const last = state.last_move;
    const best = bestScore();

    boardEl.querySelectorAll(".cell").forEach((cell) => {
      const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
      const sym = state.board[r][c].trim();
      const legal = state.legal_moves.some(([lr, lc]) => lr === r && lc === c);
      const expiringX = state.expiring.X && state.expiring.X[0] === r && state.expiring.X[1] === c;
      const expiringO = state.expiring.O && state.expiring.O[0] === r && state.expiring.O[1] === c;
      const isCurrentOldest = (sym === "X" && expiringX && state.current === "X")
        || (sym === "O" && expiringO && state.current === "O");

      cell.className = "cell";
      cell.textContent = sym;
      if (sym) cell.classList.add(sym.toLowerCase());
      if (legal) cell.classList.add("legal");
      if (isCurrentOldest && !state.game_over) cell.classList.add("expiring");
      if (animate && last && last.cell[0] === r && last.cell[1] === c) cell.classList.add("placed");
      cell.disabled = state.game_over || state.cpu_to_move || !legal;
      cell.title = isCurrentOldest ? "oldest symbol: expires on this player's next move" : "";

      if (animate && last && last.expired && last.expired[0] === r && last.expired[1] === c && !sym) {
        const ghost = document.createElement("span");
        ghost.className = `ghost ${last.player.toLowerCase()}`;
        ghost.textContent = last.player;
        cell.appendChild(ghost);
      }

      if (showScores.checked && state.ai_scores) {
        const s = state.ai_scores[`${r},${c}`];
        if (s !== undefined) {
          const tag = document.createElement("span");
          tag.className = "score" + (s === best ? " best" : "");
          tag.textContent = s > 0 ? `+${s}` : `${s}`;
          cell.appendChild(tag);
        }
      }
    });

    // status
    statusEl.className = "status";
    if (state.game_over) {
      statusEl.classList.add("win");
      statusEl.textContent = state.draw ? "Draw agreed. Game over." : state.message;
    } else if (state.cpu_to_move) {
      statusEl.classList.add("thinking");
      statusEl.textContent = `CPU (${state.cpu_symbol}) is thinking…`;
    } else {
      const who = state.mode === "pvc" ? "Your move (X)" : `Player ${state.current} to move`;
      const exp = state.expiring[state.current];
      statusEl.textContent = exp ? `${who}. Oldest symbol at (${exp[0]}, ${exp[1]}) will expire.` : `${who}.`;
    }

    drawBtn.disabled = state.game_over || state.cpu_to_move;
    scoresToggleWrap.hidden = !(state.mode === "pvc" && state.difficulty === "minimax");

    renderQueue("#queueX", state.queues.X);
    renderQueue("#queueO", state.queues.O);
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
      chip.className = "chip" + (i === 0 && moves.length === 3 ? " oldest" : "");
      chip.textContent = `(${r}, ${c})`;
      if (i === 0 && moves.length === 3) chip.title = "oldest: expires next";
      chips.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------- log
  function logMove(m, ms) {
    if (!m) return;
    const who = m.by === "cpu" ? `CPU (${m.player})` : `Player ${m.player}`;
    let text = `<b>${who}</b> plays (${m.cell[0]}, ${m.cell[1]})`;
    if (m.expired) text += `, <b>(${m.expired[0]}, ${m.expired[1]}) expires</b>`;
    if (ms !== undefined && ms !== null) text += ` · ${ms} ms`;
    log(text + ".");
  }

  function log(html) {
    const p = document.createElement("p");
    p.innerHTML = html;
    logEl.prepend(p);
  }

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.className = "status";
  }

  // ---------------------------------------------------------------- boot
  (async function boot() {
    try {
      state = await api("/api/state");
      log(`Current game: ${describe(state)}.`);
      render();
      animate = true;
    } catch (e) {
      flash("Cannot reach the game server. Start it with: python run.py");
    }
  })();
})();
