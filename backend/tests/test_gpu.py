"""Tests for the GPU stats summarizer (pure, no real file)."""

from app.routers.gpu import _STALE_AFTER_SECONDS, summarize

NOW = 1_000_000.0

GPU = {
    "name": "NVIDIA GeForce GTX 1080",
    "utilization_percent": 23,
    "memory_used_mb": 2048,
    "memory_total_mb": 8192,
    "temperature_c": 41,
    "encoder_sessions": 2,
    "power_watts": 95.5,
}


def test_unavailable_when_host_reports_no_gpu():
    assert summarize({"updated": NOW, "available": False}, now=NOW) == {"available": False}


def test_unavailable_when_missing_file_shape():
    assert summarize({}, now=NOW) == {"available": False}


def test_unavailable_when_available_but_no_gpus():
    assert summarize({"available": True, "updated": NOW, "gpus": []}, now=NOW) == {
        "available": False
    }


def test_shapes_a_gpu_and_computes_memory_percent():
    out = summarize({"available": True, "updated": NOW - 10, "gpus": [GPU]}, now=NOW)
    assert out["available"] is True
    assert out["stale"] is False
    g = out["gpus"][0]
    assert g["name"] == "NVIDIA GeForce GTX 1080"
    assert g["utilization_percent"] == 23
    assert g["memory_percent"] == 25.0  # 2048 / 8192
    assert g["encoder_sessions"] == 2


def test_marks_old_snapshots_stale():
    out = summarize(
        {"available": True, "updated": NOW - _STALE_AFTER_SECONDS - 1, "gpus": [GPU]},
        now=NOW,
    )
    assert out["stale"] is True


def test_missing_memory_fields_leave_percent_none():
    gpu = {**GPU, "memory_used_mb": None, "memory_total_mb": None}
    out = summarize({"available": True, "updated": NOW, "gpus": [gpu]}, now=NOW)
    assert out["gpus"][0]["memory_percent"] is None


def test_zero_total_memory_does_not_divide_by_zero():
    gpu = {**GPU, "memory_total_mb": 0}
    out = summarize({"available": True, "updated": NOW, "gpus": [gpu]}, now=NOW)
    assert out["gpus"][0]["memory_percent"] is None
