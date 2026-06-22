# Small, current Python base image.
FROM python:3.12-slim

WORKDIR /app

# System library for reading comic archives (CBZ/CBR/CB7 = zip/rar/7z) via the
# libarchive-c binding — one lib covers every format (see app/comics.py).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libarchive13 \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (in their own layer) so Docker caches them and only
# reinstalls when requirements.txt changes — not on every code edit.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code.
COPY app ./app

# Liveness: hit the app's own health endpoint so a wedged-but-running process
# (uvicorn up, app deadlocked) is marked unhealthy. The base image has no
# guaranteed curl, so probe with the stdlib (urllib) instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health', timeout=4).status==200 else 1)"

# Run the API. 0.0.0.0 so it's reachable from outside the container.
# The port is fixed at 8000 inside the container; compose maps it to the host.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
