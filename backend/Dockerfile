# Small, current Python base image. Digest-pinned (like the socket-proxy in
# compose) so a rebuild is reproducible; bump the digest deliberately.
FROM python:3.12-slim@sha256:d764629ce0ddd8c71fd371e9901efb324a95789d2315a47db7e4d27e78f1b0e9

WORKDIR /app

# System library for reading comic archives (CBZ/CBR/CB7 = zip/rar/7z) via the
# libarchive-c binding — one lib covers every format (see app/comics.py).
# Also installs the Ookla speedtest CLI (the ISP monitor shells out to it; see
# app/speedtest.py). The base has no curl, so we add curl + ca-certificates,
# pull the pinned 1.2.0 linux-x86_64 tarball, verify its SHA256 before trusting
# it (supply-chain guard), then extract the binary into /usr/local/bin.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libarchive13 curl ca-certificates \
    && curl -fsSL -o /tmp/speedtest.tgz https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz \
    && echo "5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7  /tmp/speedtest.tgz" | sha256sum -c - \
    && tar xz -C /usr/local/bin -f /tmp/speedtest.tgz speedtest \
    && rm /tmp/speedtest.tgz \
    && speedtest --version \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (in their own layer) so Docker caches them and only
# reinstalls when the requirements change — not on every code edit. We install
# from the fully-pinned requirements.lock (reproducible rebuilds); requirements.txt
# rides along as the commented source of intent (see its header to regenerate).
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock

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
