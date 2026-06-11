"""Tests for the chamber-camera handshake + framing helpers (no real socket)."""

import struct

import pytest

from app.camera import BOUNDARY, CameraClient, _recv_exact, build_auth_payload


def test_auth_payload_layout():
    p = build_auth_payload("12345678", username="bblp")
    assert len(p) == 80
    assert struct.unpack("<I", p[:4])[0] == 0x40
    assert struct.unpack("<I", p[4:8])[0] == 0x3000
    assert p[16:48].rstrip(b"\x00") == b"bblp"
    assert p[48:80].rstrip(b"\x00") == b"12345678"


class _FakeSock:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    def recv(self, n):
        return self.chunks.pop(0) if self.chunks else b""


def test_recv_exact_accumulates_across_chunks():
    assert _recv_exact(_FakeSock([b"ab", b"cde", b"f"]), 6) == b"abcdef"


def test_recv_exact_raises_when_stream_closes():
    with pytest.raises(ConnectionError):
        _recv_exact(_FakeSock([]), 4)


def _seed_frame(cam, data, at=1.0):
    """Drop a frame straight into the buffer (bypassing the network reader)."""
    cam._frame = data
    cam._frame_at = at


def test_mjpeg_frames_emits_one_multipart_chunk_per_new_frame():
    cam = CameraClient("host", "code", enabled=False)
    _seed_frame(cam, b"jpegdata")
    gen = cam.mjpeg_frames(timeout=0.01)
    chunk = next(gen)
    gen.close()

    expected_head = (
        f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: 8\r\n\r\n".encode()
    )
    assert chunk.startswith(expected_head)
    assert chunk.endswith(b"jpegdata\r\n")


def test_mjpeg_frames_stops_when_client_stops():
    cam = CameraClient("host", "code", enabled=False)
    cam._stop = True
    with pytest.raises(StopIteration):
        next(cam.mjpeg_frames(timeout=0.01))
