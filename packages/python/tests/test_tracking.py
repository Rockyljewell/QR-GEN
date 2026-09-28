# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from qrgen_sdk import Barcode, BatchTracker, DuplicateFilter
from qrgen_sdk.tracking import tracking_id


def _code(data: str, symbology: str = "qr") -> Barcode:
    return Barcode(data=data, symbology=symbology)


def test_duplicate_filter_window():
    f = DuplicateFilter(1000)
    assert f.accept(_code("a"), now_ms=0)
    assert not f.accept(_code("a"), now_ms=999)
    assert f.accept(_code("b"), now_ms=999)
    assert f.accept(_code("a", "ean13"), now_ms=999)  # different symbology
    assert f.accept(_code("a"), now_ms=1000)
    assert not f.accept(_code("a"), now_ms=1500)


def test_duplicate_filter_every_frame():
    f = DuplicateFilter(0)
    assert all(f.accept(_code("a"), now_ms=t) for t in range(5))


def test_duplicate_filter_once_per_session():
    f = DuplicateFilter(-1)
    assert f.accept(_code("a"), now_ms=0)
    assert not f.accept(_code("a"), now_ms=10_000_000)
    f.reset()
    assert f.accept(_code("a"), now_ms=10_000_001)


def test_duplicate_filter_batch_helper():
    f = DuplicateFilter(1000)
    assert [b.data for b in f.filter([_code("a"), _code("b"), _code("a")], now_ms=0)] == ["a", "b"]
    assert f.filter([_code("a")], now_ms=10) == []


def test_tracker_stable_ids_counts_and_timeout():
    t = BatchTracker(500)
    first = t.update([_code("a"), _code("b")], now_ms=0)
    assert [x.data for x in first] == ["a", "b"]
    assert [x.data for x in t.added] == ["a", "b"]
    ids = {x.data: x.id for x in first}
    assert ids["a"] == tracking_id("qr", "a") and ids["a"] != ids["b"]

    second = t.update([_code("a")], now_ms=300)
    assert {x.data: x.id for x in second} == ids
    a = next(x for x in second if x.data == "a")
    assert (a.first_seen, a.last_seen, a.count) == (0, 300, 2)
    assert t.added == [] and t.removed == []

    third = t.update([_code("a")], now_ms=600)  # b unseen for 600 ms -> dropped
    assert [x.data for x in third] == ["a"]
    assert [x.data for x in t.removed] == ["b"]

    fourth = t.update([], now_ms=1000)  # a last seen at 600, 400 ms ago -> kept
    assert [x.data for x in fourth] == ["a"]
    assert t.update([], now_ms=1101) == []


def test_tracker_to_dict_and_dedupe_within_frame():
    t = BatchTracker()
    tracked = t.update([_code("x"), _code("x")], now_ms=5)
    assert len(tracked) == 1
    payload = tracked[0].to_dict()
    assert payload["id"] == tracking_id("qr", "x")
    assert (payload["firstSeen"], payload["lastSeen"], payload["count"]) == (5, 5, 1)
    assert payload["symbology"] == "qr" and payload["symbologyName"] == "QR Code"
    t.clear()
    assert t.tracked == []
