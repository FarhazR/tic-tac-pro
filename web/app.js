/* Tic-Tac-Pro browser UI.
 * Three ways to play: two players on one device, versus the CPU, or an online
 * room (two devices). Local modes talk to the Python server in src/server.py
 * or, on a static host, to the in-browser engine in engine.js. Online rooms
 * always need the Python server (TTP_CONFIG.backend on a static host).
 */
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

  const CONFIG = window.TTP_CONFIG || {};
  const BACKEND = (CONFIG.backend || "").replace(/\/$/, "");

  // ---------------------------------------------------------------- session id (one game per tab)
  const SID_KEY = "ttp-sid";
  let sid = null;
  try { sid = sessionStorage.getItem(SID_KEY); } catch (e) { /* storage blocked */ }
  if (!sid) {
    sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "s" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(SID_KEY, sid); } catch (e) { /* ignore */ }
  }

  const settings = { mode: "pvp", difficulty: "minimax", depth: 3, simulations: 500 };
  let state = null;          // null = idle (no game on the board)
  let score = { X: 0, O: 0, draw: 0 };
  let busy = false;
  let animate = false;
  let lastAnimKey = null;    // "round:ply" of the last move already animated

  // ---------------------------------------------------------------- api
  // "remote": the Python server.  "local": engine.js, used on static hosts.
  let backend = "remote";

  async function request(url, body, extraHeaders) {
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: Object.assign({ "Content-Type": "application/json", "X-Session-Id": sid }, extraHeaders || {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; throw err; }
    return data;
  }

  async function api(path, body) {
    if (backend === "local") return window.TicTacPro.localApi(path, body);
    return request(path, body);
  }

  // ---------------------------------------------------------------- online rooms
  const ROOM_KEY = "ttp-room";
  const online = { code: null, token: null, role: null, name: null, view: null, timer: null, askedDraw: null, shownOver: null };
  const onlinePanel = $("#onlinePanel");
  const lobby = $("#lobby");
  const roomBox = $("#roomBox");
  const roomStatus = $("#roomStatus");
  const hostActions = $("#hostActions");
  const onlineError = $("#onlineError");
  const nameInput = $("#playerName");
  const codeInput = $("#joinCode");

  try {
    const saved = JSON.parse(sessionStorage.getItem(ROOM_KEY) || "null");
    if (saved && saved.code && saved.token) Object.assign(online, saved);
    const savedName = localStorage.getItem("ttp-name");
    if (savedName) nameInput.value = savedName;
  } catch (e) { /* ignore */ }

  function saveRoom() {
    try {
      if (online.code) sessionStorage.setItem(ROOM_KEY, JSON.stringify({ code: online.code, token: online.token, role: online.role, name: online.name }));
      else sessionStorage.removeItem(ROOM_KEY);
    } catch (e) { /* ignore */ }
  }

  function roomApi(path, body) {
    return request(BACKEND + path, body, { "X-Room-Token": online.token || "" });
  }

  const inRoom = () => settings.mode === "online" && !!online.code;

  function showOnlineError(msg) {
    onlineError.textContent = msg || "";
    onlineError.hidden = !msg;
  }

  async function createRoom() {
    const name = nameInput.value.trim();
    if (!name) { showOnlineError("Enter your name first."); nameInput.focus(); return; }
    try { localStorage.setItem("ttp-name", name); } catch (e) { /* ignore */ }
    try {
      const r = await roomApi("/api/rooms", { name });
      enterRoom(r);
    } catch (e) { showOnlineError(roomErrorText(e)); }
  }

  async function joinRoom() {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) { showOnlineError("Enter your name first."); nameInput.focus(); return; }
    if (code.length !== 6) { showOnlineError("Room codes are 6 characters."); codeInput.focus(); return; }
    try { localStorage.setItem("ttp-name", name); } catch (e) { /* ignore */ }
    try {
      const r = await roomApi(`/api/rooms/${code}/join`, { name });
      enterRoom(r);
    } catch (e) { showOnlineError(roomErrorText(e)); }
  }

  function roomErrorText(e) {
    if (e.status === 404 && /Unknown endpoint|not found/i.test(e.message)) return e.message;
    if (!e.status || e.status >= 500) return "Cannot reach the room server. Online rooms need the Python server (see README).";
    return e.message;
  }

  function enterRoom(r) {
    online.code = r.code; online.token = r.token; online.role = r.role; online.name = r.name;
    online.view = null; online.askedDraw = null; online.shownOver = null;
    saveRoom();
    showOnlineError("");
    state = null;
    logEl.innerHTML = "";
    log(`Room <b>${r.code}</b>: you are <b>${r.role}</b>.`);
    startPolling();
    render();
  }

  async function leaveRoom() {
    stopPolling();
    const code = online.code, token = online.token;
    online.code = online.token = online.role = online.name = null;
    online.view = null;
    saveRoom();
    state = null;
    hideOverlay();
    render();
    if (code) { try { await request(BACKEND + `/api/rooms/${code}/leave`, {}, { "X-Room-Token": token }); } catch (e) { /* room may be gone */ } }
  }

  function startPolling() {
    stopPolling();
    poll();
    online.timer = setInterval(poll, 1100);
  }

  function stopPolling() {
    if (online.timer) clearInterval(online.timer);
    online.timer = null;
  }

  let polling = false;
  async function poll() {
    if (!online.code || polling) return;
    polling = true;
    try {
      const view = await roomApi(`/api/rooms/${online.code}`);
      applyView(view);
    } catch (e) {
      if (e.status === 404 || e.status === 403 || e.status === 410) {
        showOnlineError("This room no longer exists.");
        stopPolling();
        online.code = online.token = null; saveRoom();
        state = null; render();
      }
    } finally {
      polling = false;
    }
  }

  function applyView(view) {
    online.view = view;
    showOnlineError("");
    if (view.status === "playing" || view.status === "closed") {
      state = view;
      score = view.score;
    } else {
      state = null;
      score = view.score;
    }
    render();

    // the other side offered a draw
    if (view.status === "playing" && view.pending_draw && view.pending_draw !== online.role && online.askedDraw !== view.version) {
      online.askedDraw = view.version;
      $("#drawText").textContent = `${view.players[view.pending_draw]} offers a draw. Do you accept?`;
      if (!drawDialog.open) {
        openDialog(drawDialog, async (value) => {
          try { applyView(await roomApi(`/api/rooms/${online.code}/draw`, { action: value === "accept" ? "accept" : "decline" })); }
          catch (e) { showOnlineError(roomErrorText(e)); }
        });
      }
    } else if (!view.pending_draw && drawDialog.open && settings.mode === "online") {
      drawDialog.close("decline");
    }

    // a rematch started elsewhere: close our result card
    if (view.status === "playing" && !view.game_over && !overlay.hidden) hideOverlay();

    // game over: show the result once per round
    if (view.status === "playing" && view.game_over && online.shownOver !== view.round) {
      online.shownOver = view.round;
      setTimeout(() => { if (online.view && online.view.game_over) showOverlay(online.view); }, 650);
    }
    if (view.status === "closed" && online.shownOver !== "closed") {
      online.shownOver = "closed";
      hideOverlay();
    }
  }

  $("#createRoom").addEventListener("click", createRoom);
  $("#joinRoom").addEventListener("click", joinRoom);
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") (codeInput.value ? joinRoom() : createRoom()); });
  $("#leaveRoom").addEventListener("click", leaveRoom);
  $("#acceptGuest").addEventListener("click", async () => {
    try { applyView(await roomApi(`/api/rooms/${online.code}/respond`, { accept: true })); } catch (e) { showOnlineError(roomErrorText(e)); }
  });
  $("#declineGuest").addEventListener("click", async () => {
    try { applyView(await roomApi(`/api/rooms/${online.code}/respond`, { accept: false })); } catch (e) { showOnlineError(roomErrorText(e)); }
  });
  $("#copyLink").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?room=${online.code}`;
    try { await navigator.clipboard.writeText(url); } catch (e) { prompt("Copy this link", url); }
    $("#copied").hidden = false;
    setTimeout(() => { $("#copied").hidden = true; }, 1500);
  });

  // ---------------------------------------------------------------- setup controls
  const modeBtns = Array.from(document.querySelectorAll("[data-mode]"));
  const diffBtns = Array.from(document.querySelectorAll("[data-difficulty]"));
  const depthInput = $("#depth");
  const simsSelect = $("#sims");

  function syncSetup() {
    const isOnline = settings.mode === "online";
    modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === settings.mode));
    diffBtns.forEach((b) => b.classList.toggle("active", b.dataset.difficulty === settings.difficulty));
    $("#difficultyField").hidden = settings.mode !== "pvc";
    $("#depthField").hidden = settings.difficulty !== "minimax";
    $("#simsField").hidden = settings.difficulty !== "mcts";
    depthInput.value = settings.depth;
    simsSelect.value = String(settings.simulations);

    onlinePanel.hidden = !isOnline;
    newGameBtn.hidden = isOnline;
    if (isOnline) {
      lobby.hidden = !!online.code;
      roomBox.hidden = !online.code;
      if (online.code) renderRoomBox();
    }

    const locked = isOnline ? !!online.code : !!(state && state.in_progress);
    modeBtns.forEach((b) => { b.disabled = locked; });
    diffBtns.forEach((b) => { b.disabled = locked; });
    depthInput.disabled = locked;
    simsSelect.disabled = locked;
    lockNote.hidden = !(locked && !isOnline);
    newGameBtn.textContent = !state ? "Start game" : locked ? "Restart" : "Play again";
  }

  function renderRoomBox() {
    const v = online.view;
    $("#roomCode").textContent = online.code;
    const waitingDot = '<span class="pill-wait"></span>';
    if (!v) { roomStatus.textContent = "Connecting…"; hostActions.hidden = true; return; }
    hostActions.hidden = true;
    if (v.status === "waiting") {
      roomStatus.innerHTML = online.role === "X"
        ? `${waitingDot}Share the code <b>${online.code}</b> or the invite link. Waiting for a second player…`
        : `${waitingDot}Waiting…`;
    } else if (v.status === "pending") {
      if (online.role === "X") {
        roomStatus.textContent = "";
        $("#applicant").textContent = v.players.O || "Someone";
        hostActions.hidden = false;
      } else {
        roomStatus.innerHTML = `${waitingDot}Waiting for <b>${v.players.X}</b> to accept you…`;
      }
    } else if (v.status === "playing") {
      roomStatus.innerHTML = `Playing <b>${v.players.X}</b> (X) vs <b>${v.players.O}</b> (O) · round ${v.round}. You are <b>${online.role}</b>.`;
    } else {
      roomStatus.innerHTML = `${v.message} Leave the room to start another.`;
    }
  }

  modeBtns.forEach((btn) => btn.addEventListener("click", () => {
    if (btn.disabled) return;
    settings.mode = btn.dataset.mode;
    if (settings.mode !== "online") { stopPolling(); state = null; }
    else if (online.code) { startPolling(); }
    render();
  }));
  diffBtns.forEach((btn) => btn.addEventListener("click", () => { settings.difficulty = btn.dataset.difficulty; syncSetup(); }));
  depthInput.addEventListener("change", () => {
    settings.depth = Math.max(1, Math.min(5, Number(depthInput.value) || 3));
    depthInput.value = settings.depth;
  });
  simsSelect.addEventListener("change", () => { settings.simulations = Number(simsSelect.value) || 500; });

  newGameBtn.addEventListener("click", () => {
    if (state && state.in_progress) {
      openDialog(restartDialog, (value) => { if (value === "restart") startGame(); });
      return;
    }
    startGame();
  });

  async function startGame() {
    if (busy) return;
    if (settings.mode === "online") {
      if (online.view && online.view.game_over) {
        try { applyView(await roomApi(`/api/rooms/${online.code}/rematch`, {})); hideOverlay(); }
        catch (e) { showOnlineError(roomErrorText(e)); }
      }
      return;
    }
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

  function myTurn() {
    if (!state || state.game_over) return false;
    if (state.mode === "online") return state.status === "playing" && state.current === online.role;
    return !state.cpu_to_move;
  }

  async function onCell(row, col) {
    if (busy || !state || !myTurn()) return;
    if (!state.legal_moves.some(([r, c]) => r === row && c === col)) return;
    busy = true;
    try {
      if (state.mode === "online") {
        const view = await roomApi(`/api/rooms/${online.code}/move`, { row, col });
        logMove(view.last_move);
        applyView(view);
      } else {
        state = await api("/api/move", { row, col });
        score = state.score;
        logMove(state.last_move);
        render();
        if (state.game_over) { finishGame(); }
        else if (state.cpu_to_move) { await cpuTurn(); }
      }
    } catch (e) {
      if (e.status === 404 && state.mode !== "online") { state = null; render(); }
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
    if (busy || !state || state.game_over) return;
    if (state.mode === "online") {
      if (state.pending_draw) return;
      try { applyView(await roomApi(`/api/rooms/${online.code}/draw`, { action: "offer" })); log("You offered a draw."); }
      catch (e) { showOnlineError(roomErrorText(e)); }
      return;
    }
    if (state.cpu_to_move) return;
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
    } else if (s.mode === "online") {
      title = s.winner === online.role ? "You win!" : `${s.players[s.winner]} wins!`;
      sub = `${lineName(s.winning_line)} after ${s.ply} ${s.ply === 1 ? "move" : "moves"}.`;
    } else {
      title = s.mode === "pvc" ? (s.winner === "X" ? "You win!" : "CPU wins!") : `Player ${s.winner} wins!`;
      sub = `${lineName(s.winning_line)} after ${s.ply} ${s.ply === 1 ? "move" : "moves"}.`;
    }
    $("#overlayTitle").textContent = title;
    $("#overlaySub").textContent = sub;
    $("#playAgain").textContent = s.mode === "online" ? "Rematch" : "Play again";
    overlay.hidden = false;
    void overlay.offsetWidth;
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
  function cpuLabel(s) {
    if (s.difficulty === "minimax") return `Minimax d${s.depth}`;
    if (s.difficulty === "mcts") return `MCTS ${s.simulations}`;
    return s.difficulty_name;
  }

  function describe(s) {
    if (s.mode === "pvp") return "two players";
    return `you (X) vs CPU ${cpuLabel(s)} (O)`;
  }

  function formatScore(s, value) {
    if (s.difficulty === "mcts") return `${Math.round(value * 100)}%`;
    return value > 0 ? `+${value}` : `${value}`;
  }

  function render() {
    syncSetup();
    renderScore();

    const idle = !state;
    const isOnline = !idle && state.mode === "online";
    boardEl.classList.toggle("idle", idle);
    boardEl.classList.toggle("locked", !idle && state.game_over);

    const last = idle ? null : state.last_move;
    const best = idle ? null : bestScore();
    const winCells = (!idle && state.winning_line) ? state.winning_line.map(([r, c]) => `${r},${c}`) : [];
    const animKey = idle ? null : `${state.round || 0}:${state.ply}`;
    const doAnimate = animate && !idle && animKey !== lastAnimKey && last;
    if (!idle) lastAnimKey = animKey;
    const turn = myTurn();

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
      if (legal && turn) cell.classList.add("legal");
      if (isCurrentOldest && !state.game_over) {
        cell.classList.add("expiring");
        cell.title = "Oldest symbol: it expires on this player’s next move";
      }
      if (winCells.includes(`${r},${c}`)) cell.classList.add("win");
      if (doAnimate && last.cell[0] === r && last.cell[1] === c && !state.winning_line) cell.classList.add("placed");
      cell.disabled = !turn || !legal;

      if (doAnimate && last.expired && last.expired[0] === r && last.expired[1] === c && !sym) {
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
          tag.textContent = formatScore(state, sc);
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
    if (settings.mode === "online" && online.code) {
      const v = online.view;
      const nx = v && v.players.X ? v.players.X : "Host";
      const no = v && v.players.O ? v.players.O : "waiting…";
      $("#nameX").textContent = online.role === "X" ? `${nx} (you)` : nx;
      $("#nameO").textContent = online.role === "O" ? `${no} (you)` : no;
    } else {
      $("#nameX").textContent = pvc ? "You" : "Player X";
      $("#nameO").textContent = pvc ? `CPU · ${cpuLabel(state)}` : "Player O";
    }

    // status
    statusEl.className = "status";
    if (idle) {
      if (settings.mode === "online") {
        const v = online.view;
        if (!online.code) statusEl.textContent = "Create a room or join one with a code.";
        else if (v && v.status === "pending" && online.role === "X") statusEl.textContent = `${v.players.O} wants to join. Accept above to start.`;
        else statusEl.textContent = "Waiting for the second player…";
      } else {
        statusEl.textContent = "Pick a mode and press Start.";
      }
    } else if (isOnline && state.status === "closed") {
      statusEl.textContent = state.message;
    } else if (state.game_over) {
      statusEl.classList.add("win");
      if (state.draw) statusEl.textContent = "Draw agreed. Game over.";
      else if (isOnline) statusEl.textContent = state.winner === online.role ? "You win!" : `${state.players[state.winner]} wins!`;
      else statusEl.textContent = state.message;
    } else if (!isOnline && state.cpu_to_move) {
      statusEl.classList.add("thinking");
      statusEl.innerHTML = `CPU is thinking<span class="dots"><i></i><i></i><i></i></span>`;
    } else if (isOnline) {
      const exp = state.expiring[state.current];
      if (state.pending_draw === online.role) {
        statusEl.classList.add("thinking");
        statusEl.textContent = "Draw offered. Waiting for an answer…";
      } else if (turn) {
        statusEl.textContent = exp ? `Your move. Your oldest symbol at (${exp[0]}, ${exp[1]}) expires next.` : "Your move.";
      } else {
        statusEl.classList.add("thinking");
        statusEl.innerHTML = `Waiting for ${state.players[state.current]}<span class="dots"><i></i><i></i><i></i></span>`;
      }
    } else {
      const who = pvc ? "Your move" : `Player ${state.current}’s move`;
      const exp = state.expiring[state.current];
      statusEl.textContent = exp ? `${who}. Your oldest symbol at (${exp[0]}, ${exp[1]}) expires next.` : `${who}.`;
    }

    drawBtn.disabled = idle || state.game_over || (isOnline ? (state.status !== "playing" || !!state.pending_draw) : state.cpu_to_move);
    scoresToggleWrap.hidden = !(pvc && (state.difficulty === "minimax" || state.difficulty === "mcts"));
    $("#scoresLabel").textContent = pvc && state.difficulty === "mcts" ? "MCTS win rates" : "Minimax scores";

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
    let who;
    if (m.by === "cpu") who = "CPU";
    else if (state && state.mode === "online") who = m.player === online.role ? "You" : (state.players[m.player] || `Player ${m.player}`);
    else who = state && state.mode === "pvc" ? "You" : `Player ${m.player}`;
    let text = `<b>${who}</b> ${m.player === "X" ? "✕" : "○"} (${m.cell[0]}, ${m.cell[1]})`;
    if (m.expired) text += ` · <b>(${m.expired[0]}, ${m.expired[1]}) expired</b>`;
    if (ms !== undefined && ms !== null) text += ` · ${ms} ms`;
    log(text);
  }

  // in online mode the opponent's moves arrive by polling; log them too
  let loggedPly = 0;
  const origApplyView = applyView;
  applyView = function (view) {
    if (view.status === "playing" && view.ply !== loggedPly) {
      if (view.last_move && view.last_move.player !== online.role && view.ply > loggedPly) logMove(view.last_move);
      loggedPly = view.ply;
    }
    if (view.ply === 0) loggedPly = 0;
    origApplyView(view);
  };

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
      backend = "remote";
      return;
    }
    const note = $("#backendNote");
    if (note) {
      note.textContent = backend === "remote"
        ? "Engine: Python server (src/server.py)"
        : "Engine: running in your browser (web/engine.js, a port of the Python engine)"
          + (BACKEND ? ` · online rooms via ${BACKEND}` : " · online rooms need the Python server");
    }
  }

  (async function boot() {
    await detectBackend();

    // ?room=CODE in the address: open the lobby with the code filled in
    const params = new URLSearchParams(location.search);
    const roomParam = (params.get("room") || "").toUpperCase();

    if (online.code) {
      settings.mode = "online";
      startPolling();
      render();
      animate = true;
      return;
    }
    if (roomParam) {
      settings.mode = "online";
      codeInput.value = roomParam;
      render();
      animate = true;
      nameInput.focus();
      return;
    }

    try {
      const data = await api("/api/state");
      score = data.score;
      if (data.in_progress) {
        state = data;
        settings.mode = data.mode;
        if (data.difficulty) settings.difficulty = data.difficulty;
        if (data.depth) settings.depth = data.depth;
        if (data.simulations) settings.simulations = data.simulations;
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
