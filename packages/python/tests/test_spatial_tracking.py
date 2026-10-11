# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Observed-record association tests; these do not establish physical identity."""
from __future__ import annotations

import copy
import math
import random
from dataclasses import replace

import pytest

from qrgen_sdk import Barcode, BatchTracker, Point, Quad, Size
from qrgen_sdk.tracking import tracking_id


def code(x=0, y=0, *, data="same", symbology="qr", width=40, height=40, size=Size(1280, 720)):
    return Barcode(data, symbology, symbology_name="Test code", timestamp=0, frame_size=size,
                   location=Quad(Point(x, y), Point(x + width, y), Point(x + width, y + height), Point(x, y + height)))


def snapshot(tracker):
    state = vars(tracker).copy()
    state["_clock"] = tracker._clock._explicit
    return copy.deepcopy(state)


def test_default_still_aggregates_equal_payloads_but_spatial_is_opt_in():
    records = [code(0), code(600)]
    default = BatchTracker(500)
    tracked = default.update(records, 0)
    assert len(tracked) == 1 and tracked[0].id == tracking_id("qr", "same")
    assert tracked[0].count == 1
    spatial = BatchTracker(500, spatial=True)
    observed = spatial.update(records, 0)
    assert len(observed) == 2 and len({item.id for item in observed}) == 2
    assert all(isinstance(item.id, str) and item.count == 1 for item in observed)
    assert spatial.added == observed


@pytest.mark.parametrize("positions", [(80, 210), (210, 80)])
def test_whole_frame_matching_preserves_cardinality_in_greedy_counterexample(positions):
    tracker = BatchTracker(spatial=True)
    initial = tracker.update([code(0), code(100)], 0)
    assert tracker.update([code(x) for x in positions], 30)
    assert tracker.added == []
    assert {item.location.top_left.x: item.id for item in tracker.tracked} == {80: initial[0].id, 210: initial[1].id}
    assert [item.count for item in tracker.tracked] == [2, 2]


def test_minimizes_total_movement_after_cardinality():
    tracker = BatchTracker(spatial=True)
    initial = tracker.update([code(0), code(100)], 0)
    later = tracker.update([code(120), code(80)], 30)
    assert {item.location.top_left.x: item.id for item in later} == {80: initial[0].id, 120: initial[1].id}


def test_equal_distance_ties_use_creation_order_even_after_tenth_string_id():
    def run(order):
        tracker = BatchTracker(spatial=True)
        initial = tracker.update([code(50, 50) for _ in range(12)], 0)
        tracker.update([code(50, y) for y in order], 30)
        matched = {item.location.top_left.y: item.id for item in tracker.tracked if item.count == 2}
        assert set(matched.values()) == {initial[0].id, initial[1].id}
        return matched
    assert run([0, 100]) == run([100, 0])


def test_tuple_grouping_and_payload_symbology_distance_gates():
    tracker = BatchTracker(spatial=True)
    # Artificial field strings protect exact tuple grouping, without relying on key delimiters.
    first = tracker.update([code(data="a\0b"), code(data="b", symbology="qr\0a"), code(500, data="other")], 0)
    later = tracker.update([code(data="b", symbology="qr\0a"), code(data="a\0b"), code(500, data="other")], 30)
    assert [item.id for item in later] == [item.id for item in first]
    tracker.update([code(121, data="a\0b"), code(data="a\0b", symbology="code128")], 60)
    assert len(tracker.added) == 2


def test_zero_jump_allows_exact_centers_and_linear_geometry():
    tracker = BatchTracker(spatial=True, max_jump=0)
    first = tracker.update([code(height=0)], 0)[0]
    assert tracker.update([code(height=0)], 10)[0].id == first.id
    tracker.update([code(1, height=0)], 20)
    assert len(tracker.added) == 1


def test_expiry_clear_and_hash_collisions_never_reuse_spatial_ids(monkeypatch):
    monkeypatch.setattr("qrgen_sdk.tracking.tracking_id", lambda *_: "collision")
    tracker = BatchTracker(500, spatial=True)
    first = tracker.update([code(0), code(600)], 0)
    assert len({item.id for item in first}) == 2
    at_boundary = tracker.update([code(0)], 500)
    assert at_boundary[0].id == first[0].id and tracker.removed == []
    after = tracker.update([code(600)], 501)
    assert tracker.removed == [first[1]] and tracker.added[0].id not in {item.id for item in first}
    ids = {item.id for item in after + first}
    tracker.clear()
    fresh = tracker.update([code(0)], 502)[0]
    assert fresh.id not in ids and fresh.count == 1 and fresh.first_seen == 502


def test_spatial_ids_do_not_encode_payload_text_or_depend_on_hashing(monkeypatch):
    def forbidden_hash(*_):
        raise AssertionError("spatial identity must not encode/hash payloads")
    monkeypatch.setattr("qrgen_sdk.tracking.tracking_id", forbidden_hash)
    tracker = BatchTracker(spatial=True)
    first = tracker.update([code(data="valid"), code(600, data="text\ud800")], 0)
    assert len({item.id for item in first}) == 2
    again = tracker.update([code(601, data="text\ud800"), code(1, data="valid")], 30)
    assert [item.id for item in again] == [item.id for item in first]
    assert again[1].data == "text\ud800" and again[1].count == 2


def test_empty_frames_expire_before_reappearance():
    tracker = BatchTracker(500, spatial=True)
    first = tracker.update([code()], 0)[0]
    assert tracker.update([], 500) == [first]
    assert tracker.update([], 501) == [] and tracker.removed == [first]
    returning = tracker.update([code()], 502)[0]
    assert returning.id != first.id and returning.count == 1


@pytest.mark.parametrize("blank_first", [False, True])
def test_frame_size_reset_removes_history_once_with_or_without_a_detection(blank_first):
    tracker = BatchTracker(spatial=True)
    first = tracker.update([code()], 0)[0]
    size = Size(720, 1280)
    if blank_first:
        assert tracker.update([], 30, frame_size=size) == []
        assert tracker.removed == [first]
        assert tracker.update([], 40, frame_size=size) == [] and tracker.removed == []
    returning = tracker.update([code(size=size)], 50)[0]
    assert returning.id != first.id and returning.count == 1 and returning.first_seen == 50
    assert tracker.removed == ([] if blank_first else [first])


def test_latest_metadata_and_export_are_preserved():
    tracker = BatchTracker(spatial=True)
    original = tracker.update([code()], 0)[0]
    latest = replace(code(5), raw_bytes=b"\x00\xff", content_type="binary", is_gs1=True,
                     ec_level="H", symbology_identifier="]Q3", orientation=90, timestamp=123)
    tracked = tracker.update([latest], 100)[0]
    expected = latest.to_dict()
    expected.update(id=original.id, firstSeen=0, lastSeen=100, count=2)
    assert tracked.to_dict() == expected


BAD_RECORDS = [
    Barcode("missing geometry", "qr"),
    replace(code(), location=None),
    replace(code(), location=Quad(None, Point(0, 0), Point(1, 0), Point(0, 0))),
    code(width=0, height=0),
    code(float("nan")), code(float("inf")),
    replace(code(), location=Quad(Point(True, 0), Point(40, 0), Point(40, 40), Point(0, 40))),
    code(-1e308, width=math.inf), code(0, width=1e308),
    code(size=Size(0, 0)), code(size=Size(-1, 720)), code(size=Size(1.5, 720)),
    replace(code(), data=[]), replace(code(), frame_size=None),
]


@pytest.mark.parametrize("bad", BAD_RECORDS)
def test_invalid_late_record_does_not_consume_clock_reset_expiry_ids_or_events(bad):
    tracker = BatchTracker(spatial=True)
    tracker.update([code()], 0)
    before = snapshot(tracker)
    # Omitted time would also switch away from the injected clock if validation were late.
    with pytest.raises(ValueError):
        tracker.update(iter([code(600), bad]))
    assert snapshot(tracker) == before


@pytest.mark.parametrize("size", [Size(0, 0), Size(True, 1), Size(float("inf"), 1), Size(1.5, 1), (1280, 720)])
def test_invalid_explicit_size_is_atomic_even_on_an_empty_frame(size):
    tracker = BatchTracker(spatial=True)
    tracker.update([code()], 0)
    before = snapshot(tracker)
    with pytest.raises(ValueError):
        tracker.update([], 501, frame_size=size)
    assert snapshot(tracker) == before


def test_mixed_or_mismatched_frame_sizes_and_raising_iterable_are_atomic():
    tracker = BatchTracker(spatial=True)
    tracker.update([code()], 0)
    before = snapshot(tracker)
    for records, size in [([code(), code(size=Size(720, 1280))], None), ([code()], Size(720, 1280))]:
        with pytest.raises(ValueError):
            tracker.update(records, 501, frame_size=size)
        assert snapshot(tracker) == before
    def broken():
        yield code(600)
        raise RuntimeError("frame source failed")
    with pytest.raises(RuntimeError, match="frame source failed"):
        tracker.update(broken())
    assert snapshot(tracker) == before
    with pytest.raises((TypeError, ValueError)):
        tracker.update([code()], object())
    assert snapshot(tracker) == before


@pytest.mark.parametrize("jump", [-1, math.nan, math.inf, -math.inf, True, None, "3"])
def test_invalid_jump_is_rejected(jump):
    with pytest.raises(ValueError, match="max_jump"):
        BatchTracker(spatial=True, max_jump=jump)


def test_constructor_policy_is_read_only():
    tracker = BatchTracker(spatial=True)
    before = snapshot(tracker)
    with pytest.raises(AttributeError):
        tracker.spatial = False
    with pytest.raises(AttributeError):
        tracker.max_jump = -1
    with pytest.raises(AttributeError):
        tracker.max_association_work = 1
    assert snapshot(tracker) == before
    with pytest.raises(ValueError):
        BatchTracker(spatial="false")


def test_finite_large_center_does_not_overflow_summation():
    tracker = BatchTracker(spatial=True)
    record = code(1e308, width=1e292, height=0)
    first = tracker.update([record], 0)[0]
    assert tracker.update([record], 1)[0].id == first.id


def test_monotonic_expiry_and_mixed_clock_transition_preserve_python_policy(monkeypatch):
    wall, elapsed = [10000], [0.0]
    monkeypatch.setattr("qrgen_sdk.tracking.now_ms", lambda: wall[0])
    monkeypatch.setattr("qrgen_sdk.tracking.time.monotonic", lambda: elapsed[0])
    tracker = BatchTracker(500, spatial=True)
    first = tracker.update([code()])[0]
    wall[0], elapsed[0] = 5000, .5
    assert tracker.update([]) == [first]
    wall[0], elapsed[0] = 90000, .501
    assert tracker.update([]) == [] and tracker.removed == [first]
    current = tracker.update([code()])[0]
    # Transition to injected time uses the retained epoch timestamp age.
    assert tracker.update([code()], now_ms=90500)[0].id == current.id
    assert tracker.update([], now_ms=91001) == []


def test_assignment_matches_independent_exhaustive_small_scene_oracle():
    randomizer = random.Random(20261011)
    for _ in range(150):
        previous = [code(randomizer.randrange(300), randomizer.randrange(300)) for _ in range(randomizer.randint(1, 4))]
        current = [code(randomizer.randrange(300), randomizer.randrange(300)) for _ in range(randomizer.randint(1, 4))]
        best = [-1, math.inf]
        def visit(index, used, count, movement):
            if index == len(current):
                if count > best[0] or (count == best[0] and movement < best[1]):
                    best[:] = [count, movement]
                return
            visit(index + 1, used, count, movement)
            a = current[index].location.center
            for old, record in enumerate(previous):
                b = record.location.center
                distance = math.hypot(a.x - b.x, a.y - b.y)
                if old not in used and distance <= 120:
                    visit(index + 1, used | {old}, count + 1, movement + distance)
        visit(0, set(), 0, 0)
        tracker = BatchTracker(spatial=True)
        initial = {item.id: item for item in tracker.update(previous, 0)}
        tracker.update(current, 30)
        matched = [item for item in tracker.tracked if item.count == 2]
        distance = sum(math.hypot(item.location.center.x - initial[item.id].location.center.x,
                                  item.location.center.y - initial[item.id].location.center.y) for item in matched)
        assert len(matched) == best[0]
        assert distance == pytest.approx(best[1])


@pytest.mark.parametrize("count", [20, 255])
def test_bounded_dense_groups_preserve_every_record_and_retained_backlog(count):
    # Large offline workloads explicitly raise the conservative association budget.
    tracker = BatchTracker(spatial=True, max_association_work=100_000_000 if count == 255 else 250_000)
    size = Size(40000, 40000)
    def group(offset):
        return [code(offset + (i % 17) * 60, (i // 17) * 60, size=size) for i in range(count)]
    first = tracker.update(group(0), 0)
    second = tracker.update(group(10000), 20)
    assert len(second) == count * 2 and len(tracker.added) == count
    third = tracker.update(group(10001), 40)
    assert len(third) == count * 2 and tracker.added == []
    assert len({item.id for item in third}) == count * 2
    assert sum(item.count == 2 for item in third) == count
    expired = tracker.update(group(10002), 501)
    assert len(expired) == count and {item.id for item in tracker.removed} == {item.id for item in first}


@pytest.mark.parametrize("limit", [0, -1, True, False, 1.5, math.inf, math.nan, None, "250000"])
def test_association_work_limit_requires_a_positive_integer(limit):
    with pytest.raises(ValueError, match="max_association_work must be a positive integer"):
        BatchTracker(spatial=True, max_association_work=limit)


def test_default_dense_rejection_precedes_matrix_allocation_and_all_mutation(monkeypatch):
    tracker = BatchTracker(spatial=True)
    initial = tracker.update([code() for _ in range(51)], 0)  # New-only groups cost zero.
    before = snapshot(tracker)
    def forbidden_association(*_):
        raise AssertionError("over-budget frames must not allocate an association matrix")
    monkeypatch.setattr("qrgen_sdk.tracking._associate", forbidden_association)
    with pytest.raises(ValueError, match="265302 exceeds max_association_work=250000"):
        tracker.update([code() for _ in range(51)], 10)
    assert snapshot(tracker) == before and tracker.tracked == initial


def test_association_exact_budget_boundary_and_conservative_out_of_gate_columns():
    exact = BatchTracker(spatial=True, max_association_work=16)
    initial = exact.update([code(), code(600)], 0)
    assert [item.id for item in exact.update([code(1), code(601)], 10)] == [item.id for item in initial]
    below = BatchTracker(spatial=True, max_association_work=15)
    below.update([code(), code(600)], 0)
    before = snapshot(below)
    # Both old columns count even though neither is within the movement gate.
    with pytest.raises(ValueError, match="work 16 exceeds"):
        below.update([code(10000), code(10600)], 10)
    assert snapshot(below) == before
    single = BatchTracker(spatial=True, max_association_work=2)
    single.update([code(), code(600)], 0)
    with pytest.raises(ValueError, match="work 3 exceeds"):
        single.update([code()], 10)


def test_work_sums_exact_payload_groups_before_any_group_is_associated(monkeypatch):
    tracker = BatchTracker(spatial=True, max_association_work=31)
    records = [code(data="a\0b"), code(600, data="a\0b"),
               code(data="b", symbology="qr\0a"), code(600, data="b", symbology="qr\0a")]
    tracker.update(records, 0)
    before = snapshot(tracker)
    def forbidden_association(*_):
        raise AssertionError("the sum must be checked before any group is associated")
    monkeypatch.setattr("qrgen_sdk.tracking._associate", forbidden_association)
    with pytest.raises(ValueError, match="work 32 exceeds"):
        tracker.update(records, 10)
    assert snapshot(tracker) == before


@pytest.mark.parametrize("reset", ["expiry", "resize", "new-payload"])
def test_nonassociated_groups_do_not_spend_work_on_expired_or_other_coordinate_history(reset):
    tracker = BatchTracker(500, spatial=True, max_association_work=1)
    first = tracker.update([code() for _ in range(51)], 0)
    size = Size(720, 1280) if reset == "resize" else Size(1280, 720)
    current = [code(data="new" if reset == "new-payload" else "same", size=size) for _ in range(51)]
    result = tracker.update(current, 501 if reset == "expiry" else 10)
    assert len(tracker.added) == 51 and len({item.id for item in result}) == len(result)
    assert tracker.removed == ([] if reset == "new-payload" else first)


def test_budget_clock_preview_preserves_transition_on_rejection_and_uses_timestamp_age(monkeypatch):
    wall, elapsed = [100], [1000.0]
    monkeypatch.setattr("qrgen_sdk.tracking.now_ms", lambda: wall[0])
    monkeypatch.setattr("qrgen_sdk.tracking.time.monotonic", lambda: elapsed[0])
    tracker = BatchTracker(500, spatial=True, max_association_work=15)
    first = tracker.update([code(), code(600)], 0)
    before = snapshot(tracker)
    with pytest.raises(ValueError, match="work 16 exceeds"):
        tracker.update([code(), code(600)])  # Would switch to default clock; age 100 survives.
    assert snapshot(tracker) == before and tracker._clock._explicit is True
    # On a later transition call these tracks would expire, so they incur no work.
    wall[0] = 501
    fresh = tracker.update([code(), code(600)])
    assert tracker.removed == first and tracker._clock._explicit is False
    assert not {item.id for item in fresh} & {item.id for item in first}
    before = snapshot(tracker)
    with pytest.raises(ValueError, match="work 16 exceeds"):
        tracker.update([code(), code(600)], 100)  # Rollback into injected time retains history.
    assert snapshot(tracker) == before and tracker._clock._explicit is False
    fresh_again = tracker.update([code(), code(600)], 1002)
    assert tracker.removed == fresh and tracker._clock._explicit is True
    assert not {item.id for item in fresh_again} & {item.id for item in fresh}


def test_default_payload_aggregation_ignores_association_budget_and_geometry():
    tracker = BatchTracker(max_association_work=1)
    records = [Barcode("same", "qr") for _ in range(255)]
    first = tracker.update(records, 0)[0]
    again = tracker.update(records, 10)
    assert len(again) == 1 and again[0].id == first.id and again[0].count == 2


def test_source_reset_removals_survive_invalid_update_and_new_only_frame_has_no_assignment_charge():
    tracker = BatchTracker(spatial=True, max_association_work=1)
    previous = tracker.update([code()], 0)[0]
    tracker._reset_spatial()
    before = snapshot(tracker)
    with pytest.raises(ValueError):
        tracker.update([Barcode("bad", "qr")])
    assert snapshot(tracker) == before
    assert len(tracker.update([code() for _ in range(51)], 10)) == 51
    assert tracker.removed == [previous] and len(tracker.added) == 51
