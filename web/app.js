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
  const rematchBtn = $("#rematchBtn");
  const newGameBtn = $("#newGame");
  const lockNote = $("#lockNote");
  const scoresToggleWrap = $("#scoresToggleWrap");
  const showScores = $("#showScores");
  const drawDialog = $("#drawDialog");
  const restartDialog = $("#restartDialog");
  const overlay = $("#overlay");
  const toastEl = $("#toast");

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

  // ---------------------------------------------------------------- sounds (Web Audio, no files)
  const Sound = (() => {
    let ctx = null;
    let muted = false;
    try { muted = localStorage.getItem("ttp-muted") === "1"; } catch (e) { /* ignore */ }

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function tone(freq, start, dur, type, gain) {
      const c = ensure();
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime + start);
      g.gain.setValueAtTime(0.0001, c.currentTime + start);
      g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
      o.connect(g).connect(c.destination);
      o.start(c.currentTime + start);
      o.stop(c.currentTime + start + dur + 0.02);
    }
    const PATTERNS = {
      x:    [[523, 0, 0.09, "square", 0.05], [659, 0.07, 0.12, "square", 0.05]],
      o:    [[392, 0, 0.11, "triangle", 0.09], [330, 0.08, 0.16, "triangle", 0.09]],
      win:  [[523, 0, 0.14, "triangle", 0.1], [659, 0.12, 0.14, "triangle", 0.1], [784, 0.24, 0.14, "triangle", 0.1], [1047, 0.36, 0.4, "triangle", 0.12]],
      lose: [[392, 0, 0.18, "sawtooth", 0.05], [349, 0.16, 0.18, "sawtooth", 0.05], [311, 0.32, 0.18, "sawtooth", 0.05], [262, 0.48, 0.5, "sawtooth", 0.06]],
      draw: [[440, 0, 0.16, "triangle", 0.08], [440, 0.22, 0.3, "triangle", 0.08]],
      join: [[880, 0, 0.08, "sine", 0.08], [1175, 0.09, 0.18, "sine", 0.08]],
      expire: [[220, 0, 0.2, "sine", 0.06]],
    };
    return {
      play(kind) {
        if (muted || !PATTERNS[kind]) return;
        try { PATTERNS[kind].forEach((p) => tone(...p)); } catch (e) { /* audio blocked */ }
      },
      toggle() {
        muted = !muted;
        try { localStorage.setItem("ttp-muted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
        if (!muted) ensure();
        return muted;
      },
      get muted() { return muted; },
      unlock() { ensure(); },
    };
  })();

  const soundBtn = $("#soundBtn");
  function renderSoundBtn() {
    soundBtn.classList.toggle("muted", Sound.muted);
    soundBtn.setAttribute("aria-pressed", String(!Sound.muted));
    $("#soundLabel").textContent = Sound.muted ? "Sound off" : "Sound on";
  }
  soundBtn.addEventListener("click", () => { Sound.toggle(); renderSoundBtn(); if (!Sound.muted) Sound.play("x"); });
  document.addEventListener("pointerdown", () => Sound.unlock(), { once: true });
  renderSoundBtn();

  function playMoveSound(move) {
    if (!move) return;
    Sound.play(move.player === "X" ? "x" : "o");
    if (move.expired) setTimeout(() => Sound.play("expire"), 140);
  }

  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

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

  // rooms live on the page's own server when one serves the page, else on the configured backend
  const roomsBase = () => (backend === "remote" ? "" : BACKEND);

  function roomApi(path, body) {
    return request(roomsBase() + path, body, { "X-Room-Token": online.token || "" });
  }

  const opponentName = (v) => (v && v.players[online.role === "X" ? "O" : "X"]) || "Your opponent";

  function showOnlineError(msg) {
    onlineError.textContent = msg || "";
    onlineError.hidden = !msg;
  }

  async function createRoom() {
    const name = nameInput.value.trim();
    if (!name) { showOnlineError("Enter your name first."); nameInput.focus(); return; }
    try { localStorage.setItem("ttp-name", name); } catch (e) { /* ignore */ }
    try { enterRoom(await roomApi("/api/rooms", { name })); }
    catch (e) { showOnlineError(roomErrorText(e)); }
  }

  async function joinRoom() {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) { showOnlineError("Enter your name first."); nameInput.focus(); return; }
    if (code.length !== 6) { showOnlineError("Room codes are 6 characters."); codeInput.focus(); return; }
    try { localStorage.setItem("ttp-name", name); } catch (e) { /* ignore */ }
    try { enterRoom(await roomApi(`/api/rooms/${code}/join`, { name })); }
    catch (e) { showOnlineError(roomErrorText(e)); }
  }

  function roomErrorText(e) {
    if (e.status === 404 && /Unknown endpoint|not found/i.test(e.message)) return e.message;
    if (!e.status || e.status >= 500) return "Cannot reach the room server right now. It may be waking up; try again in a minute.";
    return e.message;
  }

  function enterRoom(r) {
    online.code = r.code; online.token = r.token; online.role = r.role; online.name = r.name;
    online.view = null; online.askedDraw = null; online.shownOver = null;
    saveRoom();
    showOnlineError("");
    state = null;
    logEl.innerHTML = "";
    loggedPly = 0;
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
    if (code) { try { await request(roomsBase() + `/api/rooms/${code}/leave`, {}, { "X-Room-Token": token }); } catch (e) { /* room may be gone */ } }
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
      applyView(await roomApi(`/api/rooms/${online.code}`));
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

  let loggedPly = 0;

  function applyView(view) {
    const prev = online.view;
    // nothing changed since the last poll: do not touch the DOM (no flicker)
    if (prev && prev.version === view.version && prev.status === view.status) return;

    const opp = opponentName(view);
    if (prev) {
      // the other side wants in
      if (prev.status === "waiting" && view.status === "pending" && online.role === "X") {
        Sound.play("join");
        log(`<b>${view.players.O}</b> wants to join.`);
      }
      if (prev.status === "pending" && view.status === "playing") log(`<b>${view.players.X}</b> vs <b>${view.players.O}</b>: game on.`);
      // draw offers
      if (!prev.pending_draw && view.pending_draw && view.pending_draw !== online.role) log(`<b>${opp}</b> offers a draw.`);
      if (prev.pending_draw === online.role && !view.pending_draw) {
        if (view.game_over && view.draw) log(`<b>${opp}</b> accepted your draw offer.`);
        else { log(`<b>${opp}</b> declined your draw offer.`); toast(`${opp} declined the draw.`); }
      }
      // opponent's moves (ours are logged where we make them)
      if (view.status === "playing" && view.ply > loggedPly && view.last_move && view.last_move.player !== online.role) {
        logMove(view.last_move);
        playMoveSound(view.last_move);
      }
      if (prev.round !== view.round && view.round > 1) log(`Round ${view.round} started.`);
      if (view.status === "closed" && prev.status !== "closed") toast(view.message);
    }
    if (view.status === "playing") loggedPly = view.ply;
    if (view.ply === 0) loggedPly = 0;

    online.view = view;
    showOnlineError("");
    score = view.score;
    state = (view.status === "playing" || view.status === "closed") ? view : null;
    render();

    // the other side offered a draw: ask
    if (view.status === "playing" && view.pending_draw && view.pending_draw !== online.role && online.askedDraw !== view.version) {
      online.askedDraw = view.version;
      $("#drawText").textContent = `${view.players[view.pending_draw]} offers a draw. Do you accept?`;
      if (!drawDialog.open) {
        openDialog(drawDialog, async (value) => {
          const accept = value === "accept";
          try {
            log(`You ${accept ? "accepted" : "declined"} the draw.`);
            applyView(await roomApi(`/api/rooms/${online.code}/draw`, { action: accept ? "accept" : "decline" }));
          } catch (e) { showOnlineError(roomErrorText(e)); }
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
  rematchBtn.addEventListener("click", startGame);

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
    hostActions.hidden = true;
    if (!v) { roomStatus.textContent = "Connecting…"; return; }
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
        try { hideOverlay(); applyView(await roomApi(`/api/rooms/${online.code}/rematch`, {})); }
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
        playMoveSound(view.last_move);
        loggedPly = view.ply;
        applyView(view);
      } else {
        state = await api("/api/move", { row, col });
        score = state.score;
        logMove(state.last_move);
        playMoveSound(state.last_move);
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

  const nextFrame = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Run a search step by step, redrawing the insight panel as it grows.
   *  Returns the final snapshot. Takes ~1.4 s whatever the budget. */
  async function liveSearch(ai, game, kind) {
    const search = ai.startSearch(game);
    const frames = 36;
    const batch = Math.max(1, Math.ceil(search.total / frames));
    let finished = false;
    let computeMs = 0;
    while (!finished) {
      const t0 = performance.now();
      finished = search.step(batch);
      computeMs += performance.now() - t0;
      const snap = search.snapshot();
      snap.live = true; snap.replica = kind === "replica";
      renderInsight(snap);
      await nextFrame(32);
    }
    const snap = search.snapshot();
    snap.compute_ms = Math.round(computeMs * 10) / 10;
    return snap;
  }

  async function cpuTurn() {
    statusEl.className = "status thinking";
    statusEl.innerHTML = `CPU is thinking<span class="dots"><i></i><i></i><i></i></span>`;
    const T = window.TicTacPro;
    const searchable = T && (state.difficulty === "mcts" || state.difficulty === "minimax");

    if (searchable && backend === "local") {
      // the live search IS the CPU's decision
      const session = T.localSession();
      const snap = await liveSearch(session.ai, session.game, "real");
      const time_ms = snap.compute_ms;
      const ai = session.ai;
      let move, scores;
      if (snap.type === "mcts") {
        const most = Math.max(...snap.root.map((c) => c.visits));
        const bests = snap.root.filter((c) => c.visits === most);
        move = bests[Math.floor(Math.random() * bests.length)].move;
        scores = Object.fromEntries(snap.root.map((c) => [`${c.move[0]},${c.move[1]}`, c.win_rate]));
      } else {
        const best = Math.max(...snap.root.map((c) => c.score));
        const bests = snap.root.filter((c) => c.score === best);
        move = bests[Math.floor(Math.random() * bests.length)].move;
        scores = Object.fromEntries(snap.root.map((c) => [`${c.move[0]},${c.move[1]}`, c.score]));
      }
      snap.chosen = move;
      ai.lastTree = snap;
      state = await api("/api/cpu", { move, scores, insight: snap, time_ms });
    } else if (searchable && backend === "remote") {
      // the server decides; the page animates a replica of the same search for the visual
      const ai = state.difficulty === "mcts" ? new T.MCTS_AI(state.simulations) : new T.MinimaxAI(state.depth);
      const pending = api("/api/cpu", {});
      await liveSearch(ai, T.gameFromState(state), "replica");
      state = await pending;
      if (state.ai_insight) state.ai_insight.replica_shown = true;
    } else {
      await nextFrame(420);
      state = await api("/api/cpu", {});
    }
    score = state.score;
    logMove(state.last_move, state.ai_time_ms);
    playMoveSound(state.last_move);
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

  function outcomeFor(s) {
    if (s.draw) return "draw";
    if (s.mode === "online") return s.winner === online.role ? "win" : "lose";
    if (s.mode === "pvc") return s.winner === "X" ? "win" : "lose";
    return "win";
  }

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
    const outcome = outcomeFor(s);
    Sound.play(outcome);
    if (outcome === "win") confetti();
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

  // ---------------------------------------------------------------- AI insight
  const insightEl = $("#insight");
  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs, text) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderInsight(liveSnap) {
    const ins = liveSnap || (state && state.ai_insight);
    if (!ins || !state || state.mode !== "pvc") { insightEl.hidden = true; return; }
    insightEl.hidden = false;
    const isMcts = ins.type === "mcts";
    insightEl.classList.toggle("live", !!ins.live);
    if (ins.live) {
      $("#insightMeta").textContent = isMcts
        ? `simulation ${ins.done} / ${ins.total}`
        : `move ${ins.done} / ${ins.total} · ${ins.nodes} nodes`;
    } else {
      $("#insightMeta").textContent = `${ins.nodes} nodes · ${ins.time_ms} ms`;
    }
    const replicaNote = ins.replica || ins.replica_shown ? " Shown live from a browser replica of the search; the server made the actual decision." : "";
    $("#insightSub").textContent = (isMcts
      ? `MCTS, ${ins.simulations} simulations. Bars: share of simulations spent on each move; the CPU plays the most-visited one.`
      : `Minimax, depth ${ins.depth}, alpha-beta. Bars: root score of each move; the CPU plays the highest.`) + replicaNote;

    const bars = $("#insightBars");
    bars.innerHTML = "";
    const root = ins.root || [];
    let widths;
    if (isMcts) {
      const total = root.reduce((a, n) => a + n.visits, 0) || 1;
      widths = root.map((n) => n.visits / total);
    } else {
      const vals = root.filter((n) => n.score !== null && n.score !== undefined).map((n) => n.score);
      const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 0;
      widths = root.map((n) => (n.score === null || n.score === undefined) ? 0 : (hi === lo ? 0.6 : 0.08 + 0.92 * (n.score - lo) / (hi - lo)));
    }
    root.forEach((n, i) => {
      const pending = !isMcts && (n.score === null || n.score === undefined);
      const row = document.createElement("div");
      row.className = "ibar" + (n.best ? " best" : "") + (!isMcts && !pending && n.score < 0 ? " neg" : "") + (pending ? " pending" : "");
      const id = document.createElement("span"); id.className = "cell-id"; id.textContent = `(${n.move[0]},${n.move[1]})`;
      const track = document.createElement("div"); track.className = "track";
      const fill = document.createElement("div"); fill.className = "fill"; fill.style.width = `${Math.max(2, widths[i] * 100)}%`;
      track.appendChild(fill);
      const val = document.createElement("span"); val.className = "val";
      val.textContent = isMcts ? `${Math.round(n.win_rate * 100)}% · ${n.visits} sims` : pending ? "…" : (n.score > 0 ? `+${n.score}` : `${n.score}`);
      row.append(id, track, val);
      bars.appendChild(row);
    });

    $("#insightTreeWrap").hidden = !isMcts;
    if (isMcts) {
      if (ins.live) $("#insightTreeWrap").open = true;
      renderTree(ins);
    }
  }

  function renderTree(ins) {
    const svg = $("#insightTree");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const root = ins.root;
    const W = 640, H = 300;
    const n = root.length || 1;
    const colW = W / n;
    const rootX = W / 2, rootY = 28, childY = 128, grandY = 236;
    const maxV = Math.max(...root.map((c) => c.visits), 1);
    const radius = (v, base, span) => base + span * Math.sqrt(v / maxV);

    const label = (x, y, text, cls, size) => {
      const t = svgEl("text", { x, y, "text-anchor": "middle", "font-size": size || 10, "font-weight": 800,
        "font-family": "Nunito, Segoe UI, sans-serif", fill: cls === "light" ? "#ffffff" : "#1f2937" }, text);
      svg.appendChild(t);
    };

    // links first (behind nodes)
    root.forEach((c, i) => {
      const cx = colW * (i + 0.5);
      svg.appendChild(svgEl("line", { x1: rootX, y1: rootY, x2: cx, y2: childY, stroke: c.best ? "#1a5fd0" : "#cfd6e3", "stroke-width": c.best ? 2.5 : 1.5 }));
      (c.children || []).forEach((g, j) => {
        const k = (c.children.length - 1) / 2;
        const gx = cx + (j - k) * Math.min(colW / 3.2, 22);
        svg.appendChild(svgEl("line", { x1: cx, y1: childY, x2: gx, y2: grandY, stroke: "#dfe5ef", "stroke-width": 1 }));
      });
    });

    // root
    svg.appendChild(svgEl("circle", { cx: rootX, cy: rootY, r: 14, fill: "#0f1d33" }));
    label(rootX, rootY + 4, "root", "light", 9);

    // children + grandchildren
    root.forEach((c, i) => {
      const cx = colW * (i + 0.5);
      const r = radius(c.visits, 7, 16);
      svg.appendChild(svgEl("circle", { cx, cy: childY, r, fill: c.best ? "#1a5fd0" : "#e6ebf5", stroke: c.best ? "#124aa6" : "#c3cad8", "stroke-width": 1.5 }));
      label(cx, childY + r + 12, `(${c.move[0]},${c.move[1]})`, "", 10);
      label(cx, childY + r + 24, `${Math.round(c.win_rate * 100)}% · ${c.visits}`, "", 9);
      (c.children || []).forEach((g, j) => {
        const k = (c.children.length - 1) / 2;
        const gx = cx + (j - k) * Math.min(colW / 3.2, 22);
        const gr = Math.max(3, radius(g.visits, 2, 9));
        svg.appendChild(svgEl("circle", { cx: gx, cy: grandY, r: gr, fill: "#f2994a", opacity: 0.85 }));
      });
      if (c.children && c.children.length) label(cx, grandY + 24, c.children.map((g) => `(${g.move[0]},${g.move[1]})`).join(" "), "", 8);
    });
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
    rematchBtn.hidden = !(isOnline && state.status === "playing" && state.game_over);
    scoresToggleWrap.hidden = !(pvc && (state.difficulty === "minimax" || state.difficulty === "mcts"));
    $("#scoresLabel").textContent = pvc && state.difficulty === "mcts" ? "MCTS win rates" : "Minimax scores";

    renderQueue("#queueX", idle ? [] : state.queues.X);
    renderQueue("#queueO", idle ? [] : state.queues.O);
    if (!(state && state.cpu_to_move)) renderInsight();   // a live search is drawing it meanwhile
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
    else if (settings.mode === "online" && online.code) who = m.player === online.role ? "You" : ((online.view && online.view.players[m.player]) || `Player ${m.player}`);
    else who = state && state.mode === "pvc" ? "You" : `Player ${m.player}`;
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

  // ---------------------------------------------------------------- status pills
  function setPill(id, cls, text) {
    const pill = $(id);
    pill.className = "pill " + cls;
    pill.querySelector("span").textContent = text;
  }

  async function detectBackend() {
    try {
      const res = await fetch("/api/health", { headers: { "X-Session-Id": sid } });
      const data = res.ok ? await res.json() : null;
      backend = data && data.ok && !data.local ? "remote" : "local";
    } catch (e) {
      backend = "local";
    }
    if (backend === "local" && !window.TicTacPro) backend = "remote";
    setPill("#enginePill", "ok", backend === "remote" ? "Engine: server" : "Engine: in your browser");

    // online rooms: same origin when the server serves the page, else the configured backend
    const roomsUrl = (backend === "remote" ? "" : BACKEND) + "/api/health";
    if (backend === "local" && !BACKEND) { setPill("#roomsPill", "off", "Online rooms: not configured"); return; }
    setPill("#roomsPill", "warn", "Online rooms: connecting…");
    try {
      const res = await fetch(roomsUrl, { headers: { "X-Session-Id": sid } });
      const data = res.ok ? await res.json() : null;
      if (data && data.ok) setPill("#roomsPill", "ok", `Online rooms: ready${data.rooms === "postgres" ? " · shared database" : ""}`);
      else setPill("#roomsPill", "warn", "Online rooms: unavailable");
    } catch (e) {
      setPill("#roomsPill", "warn", "Online rooms: waking up, try again in a minute");
    }
  }

  // ---------------------------------------------------------------- boot
  (async function boot() {
    const backendReady = detectBackend();

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

    await backendReady;
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
