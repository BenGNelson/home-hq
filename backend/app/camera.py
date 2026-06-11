"""
Bambu P1S chamber camera — authenticated JPEG stream over TLS.

The P1 series doesn't expose RTSP. Instead it opens a TLS socket on port 6000:
the client sends an 80-byte auth payload (a small header + the "bblp" username +
the LAN access code), and the printer then streams a sequence of JPEG frames,
each prefixed by a 16-byte header whose first 4 bytes are the frame's byte
length. We read those frames and keep the latest one in memory.

To avoid fighting Bambu Studio's own live view (the printer allows few camera
connections), the reader only holds the socket open *while the UI is actually
asking for frames*: every read of the latest frame (single-shot or streaming)
bumps a timestamp, and the reader disconnects after `idle_timeout` seconds with
no interest, then sleeps until asked again.

Two ways to consume frames: `get_frame()` hands back the latest JPEG for a
single request, and `mjpeg_frames()` yields a multipart MJPEG stream that pushes
each new frame as it arrives (smoother than re-fetching, one connection). A
threading.Condition lets the streamer block until the reader posts a new frame.

Host + access code come from config/.env — nothing here is host-specific.
"""

from __future__ import annotations

import logging
import socket
import ssl
import struct
import threading
import time
from collections.abc import Iterator

log = logging.getLogger("home-hq.camera")

_USERNAME = "bblp"
_HEADER_LEN = 16
# Multipart boundary for the MJPEG (multipart/x-mixed-replace) response; the
# router advertises the same token in the Content-Type so browsers swap frames.
BOUNDARY = "frame"


def build_auth_payload(access_code: str, username: str = _USERNAME) -> bytes:
    """The 80-byte handshake: 16-byte header + 32-byte user + 32-byte code."""
    payload = bytearray()
    payload += struct.pack("<I", 0x40)  # payload length marker (64)
    payload += struct.pack("<I", 0x3000)
    payload += struct.pack("<I", 0)
    payload += struct.pack("<I", 0)
    payload += username.encode("ascii").ljust(32, b"\x00")
    payload += access_code.encode("ascii").ljust(32, b"\x00")
    return bytes(payload)


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("camera stream closed")
        buf += chunk
    return bytes(buf)


class CameraClient:
    def __init__(
        self,
        host: str,
        access_code: str,
        port: int = 6000,
        enabled: bool = False,
        idle_timeout: int = 10,
    ):
        self._host = host
        self._access_code = access_code
        self._port = port
        self._idle_timeout = idle_timeout
        self._configured = bool(enabled and host and access_code)

        # Condition guards the frame buffer AND signals streamers when a fresh
        # frame lands, so mjpeg_frames() can block instead of busy-polling.
        self._cond = threading.Condition()
        self._frame: bytes | None = None
        self._frame_at: float | None = None
        self._last_access = 0.0
        self._wake = threading.Event()
        self._stop = False
        self._thread: threading.Thread | None = None

    @property
    def configured(self) -> bool:
        return self._configured

    # --- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if not self._configured:
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="bambu-camera")
        self._thread.start()

    def stop(self) -> None:
        self._stop = True
        self._wake.set()
        with self._cond:
            self._cond.notify_all()  # release any blocked MJPEG streamers

    # --- read side ---------------------------------------------------------

    def get_frame(self) -> tuple[bytes | None, float | None]:
        """Latest JPEG (+ its timestamp). Bumps interest so the reader connects."""
        self._poke()
        with self._cond:
            return self._frame, self._frame_at

    def mjpeg_frames(self, timeout: float = 8.0) -> Iterator[bytes]:
        """Yield multipart MJPEG chunks, pushing each new frame as it arrives.

        Bumps interest every iteration so the reader stays connected while a
        client is watching. Blocks on the Condition until a frame newer than the
        last one sent appears (or `timeout` elapses, which loops to re-assert
        interest as a keepalive). The generator naturally ends when the client
        disconnects — the next `yield` raises and the threadpool unwinds it.
        """
        head = f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ".encode()
        last_sent = 0.0
        while not self._stop:
            self._poke()
            with self._cond:
                self._cond.wait_for(
                    lambda: self._stop or (self._frame_at or 0.0) > last_sent,
                    timeout=timeout,
                )
                frame, frame_at = self._frame, self._frame_at
            if self._stop or frame is None or frame_at is None or frame_at <= last_sent:
                continue  # timed out with no new frame — re-assert interest
            last_sent = frame_at
            yield head + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"

    def _poke(self) -> None:
        """Register interest so the reader connects / stays connected."""
        self._last_access = time.time()
        self._wake.set()

    def _idle(self) -> bool:
        return (time.time() - self._last_access) > self._idle_timeout

    # --- background reader -------------------------------------------------

    def _run(self) -> None:
        while not self._stop:
            if self._idle():
                # Nobody's watching — drop any stale frame and wait to be asked.
                with self._cond:
                    self._frame = None
                    self._frame_at = None
                self._wake.wait(timeout=30)
                self._wake.clear()
                continue
            try:
                self._stream()
            except Exception as exc:  # network dependent; retry after a beat
                log.info("camera: stream error: %s", exc)
                time.sleep(2)

    def _stream(self) -> None:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        raw = socket.create_connection((self._host, self._port), timeout=5)
        try:
            sock = ctx.wrap_socket(raw, server_hostname=self._host)
        except Exception:
            raw.close()
            raise
        try:
            sock.sendall(build_auth_payload(self._access_code))
            log.info("camera: connected to %s:%s", self._host, self._port)
            sock.settimeout(10)
            while not self._stop and not self._idle():
                header = _recv_exact(sock, _HEADER_LEN)
                size = struct.unpack("<I", header[:4])[0]
                if size <= 0 or size > 8_000_000:  # sanity guard
                    raise ValueError(f"implausible frame size {size}")
                data = _recv_exact(sock, size)
                with self._cond:
                    self._frame = data
                    self._frame_at = time.time()
                    self._cond.notify_all()  # wake any MJPEG streamers
        finally:
            sock.close()
            log.info("camera: disconnected")


# Process-wide singleton, wired up in app lifespan (main.py).
_camera: CameraClient | None = None


def init_camera(
    host: str,
    access_code: str,
    port: int = 6000,
    enabled: bool = False,
    idle_timeout: int = 10,
) -> CameraClient:
    global _camera
    _camera = CameraClient(host, access_code, port, enabled, idle_timeout)
    return _camera


def get_camera() -> CameraClient | None:
    return _camera
