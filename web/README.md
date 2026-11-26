---
title: Tic-Tac-Pro
emoji: ⭕
colorFrom: blue
colorTo: indigo
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Tic-Tac-Toe where your oldest symbol expires. Play the Minimax AI.
---

# Tic-Tac-Pro (static build)

This folder is the browser version of Tic-Tac-Pro. It runs entirely in the
browser: `engine.js` is a port of the Python game engine and AI players, so
the page needs no server and can be hosted as a free **Static Space** on
Hugging Face or on any static host.

Rules: each player keeps at most three symbols; a fourth move removes the
oldest one; the win is checked after the removal.

Source and tests: the `tic-tac-pro` repository (Python engine in `src/`,
cross-check of this port in `tests/test_js_engine.py`).
