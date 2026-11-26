"""Start Tic-Tac-Pro in the browser: one process serves the UI and the game API.

    python run.py                          # http://127.0.0.1:8000, opens your browser
    python run.py --port 9000              # another port
    python run.py --no-browser             # just serve
    python run.py --host 0.0.0.0 --port 7860 --no-browser   # container / Hugging Face

The PORT environment variable, when set, is the default port.
"""
import argparse
import os
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from src.server import serve  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Run the Tic-Tac-Pro web UI.")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    args = parser.parse_args()

    shown_host = "127.0.0.1" if args.host in ("0.0.0.0", "") else args.host
    url = f"http://{shown_host}:{args.port}/"
    if not args.no_browser:
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()
    serve(args.host, args.port)


if __name__ == "__main__":
    main()
