# Tic-Tac-Pro web UI — runs on Hugging Face Spaces (Docker) or any container host.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir "psycopg[binary]>=3.1"
COPY src ./src
COPY web ./web
COPY run.py ./

# Spaces run containers as a non-root user.
RUN useradd -m -u 1000 user
USER user

ENV HOST=0.0.0.0 \
    PORT=7860 \
    PYTHONUNBUFFERED=1

EXPOSE 7860
CMD ["python", "run.py", "--no-browser"]
