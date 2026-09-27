from __future__ import annotations

import datetime as dt

import pytest

from qrgen_sdk import parse_gs1
from qrgen_sdk.parsers.gs1 import AI_TABLE, GS, format_hri, is_gs1_digital_link, lookup_ai, to_element_string


def _by_ai(result):
    return {e["ai"]: e for e in result["elements"]}


def test_spec_vector(gs1_vector, today):
    result = parse_gs1(gs1_vector, today=today)
    assert result["values"] == {"01": "09501101530003", "17": "250101", "10": "ABC123"}
    elements = _by_ai(result)
    assert elements["01"]["title"] == "GTIN"
    assert elements["17"]["title"] == "USE BY or EXPIRY"
    assert elements["10"]["title"] == "BATCH/LOT"
    assert elements["17"]["date"] == "2025-01-01"
    assert [e["ai"] for e in result["elements"]] == ["01", "17", "10"]


def test_raw_with_gs_and_symbology_identifier(today):
    for prefix in ("]C1", "]d2", "]Q3", "]e0", ""):
        data = prefix + "0109501101530003" + "10ABC123" + GS + "17250101"
        result = parse_gs1(data, today=today)
        assert result is not None, prefix
        assert result["values"] == {"01": "09501101530003", "10": "ABC123", "17": "250101"}


def test_raw_leading_fnc1_and_escaped_gs(today):
    assert parse_gs1(GS + "0109501101530003", today=today)["values"] == {"01": "09501101530003"}
    assert parse_gs1("10ABC<GS>17250101", today=today)["values"] == {"10": "ABC", "17": "250101"}


def test_fixed_length_ais_need_no_separator(today):
    result = parse_gs1("00123456789012345675" "0109501101530003" "11240229" "3103000195", today=today)
    assert result["values"]["00"] == "123456789012345675"
    elements = _by_ai(result)
    assert elements["11"]["date"] == "2024-02-29"
    assert elements["3103"]["number"] == pytest.approx(0.195)


def test_day_zero_means_last_day_of_month(today):
    elements = _by_ai(parse_gs1("(17)240200(15)250400(16)231200", today=today))
    assert elements["17"]["date"] == "2024-02-29"  # leap year
    assert elements["15"]["date"] == "2025-04-30"
    assert elements["16"]["date"] == "2023-12-31"


def test_invalid_date_has_no_iso_value(today):
    elements = _by_ai(parse_gs1("(17)251332", today=today))
    assert "date" not in elements["17"]


def test_century_window():
    today = dt.date(2026, 6, 1)
    assert _by_ai(parse_gs1("(11)990101", today=today))["11"]["date"] == "1999-01-01"
    assert _by_ai(parse_gs1("(17)760101", today=today))["17"]["date"] == "2076-01-01"
    assert _by_ai(parse_gs1("(17)770101", today=today))["17"]["date"] == "1977-01-01"


@pytest.mark.parametrize(
    "data,ai,number",
    [
        ("(3103)000195", "3103", 0.195),
        ("(3100)000195", "3100", 195),
        ("(3922)1299", "3922", 12.99),
        ("(3932)97812345", "3932", 123.45),  # ISO 4217 currency 978 = EUR
        ("(3202)001250", "3202", 12.5),
        ("(3302)012345", "3302", 123.45),
        ("(3955)012345", "3955", 0.12345),
        ("(3941)0250", "3941", 25.0),
    ],
)
def test_decimal_ais(data, ai, number):
    element = _by_ai(parse_gs1(data))[ai]
    assert element["number"] == pytest.approx(number)


def test_integer_decimal_value_is_int():
    assert isinstance(_by_ai(parse_gs1("(3100)000195"))["3100"]["number"], int)


def test_digital_link(today):
    url = "https://id.gs1.org/01/09501101530003/10/ABC123?17=250101"
    result = parse_gs1(url, today=today)
    assert result["values"] == {"01": "09501101530003", "10": "ABC123", "17": "250101"}
    assert _by_ai(result)["17"]["date"] == "2025-01-01"


def test_digital_link_custom_domain_short_gtin_and_encoding(today):
    url = "https://brand.example.com/products/01/9501101530003/21/SN%2F42?3103=000195&linkType=gs1:pip"
    result = parse_gs1(url, today=today)
    elements = _by_ai(result)
    assert elements["01"]["value"] == "09501101530003"
    assert elements["01"]["raw"] == "9501101530003"
    assert elements["21"]["value"] == "SN/42"
    assert elements["3103"]["number"] == pytest.approx(0.195)
    assert "linkType" not in result["values"]


def test_digital_link_other_primary_keys():
    assert parse_gs1("https://example.com/414/9501101530003/254/A1")["values"] == {"414": "9501101530003", "254": "A1"}
    assert parse_gs1("https://example.com/00/123456789012345675")["values"] == {"00": "123456789012345675"}


def test_digital_link_rejects_plain_urls():
    assert parse_gs1("https://example.com/") is None
    assert parse_gs1("https://example.com/01/notdigits") is None
    assert parse_gs1("https://example.com/about/us") is None
    assert is_gs1_digital_link("https://id.gs1.org/01/09501101530003")
    assert not is_gs1_digital_link("https://example.com")


@pytest.mark.parametrize(
    "data",
    [
        "",
        "hello",
        "(01)123",  # GTIN too short
        "(01)0950110153000A",  # GTIN not numeric
        "(10)" + "A" * 21,  # lot too long
        "(555) 123-4567",  # looks like a phone number, AI 555 does not exist
        "0109501101530003(",  # garbage after fixed field
        "12345",
        None,
        12345,
    ],
)
def test_invalid_input_returns_none(data):
    assert parse_gs1(data) is None


def test_ai_table_coverage():
    required = (
        ["00", "01", "02", "10", "11", "12", "13", "15", "16", "17", "20", "21", "22", "235", "240", "241", "242", "243",
         "250", "251", "253", "254", "255", "30", "37", "400", "401", "402", "403", "7003", "7004", "8003", "8004",
         "8005", "8006", "8007", "8008", "8012", "8013", "8017", "8018", "8020", "8200", "90"]
        + ["41%d" % n for n in range(8)]
        + ["42%d" % n for n in range(8)]
        + ["9%d" % n for n in range(1, 10)]
        + ["31%d%d" % (a, n) for a in range(7) for n in range(10)]
        + ["3%d%d%d" % (b, a, n) for b in (2, 3, 4, 5, 6) for a in range(10) for n in range(10)
           if "3%d%d" % (b, a) not in ("338", "339", "358", "359")]
        + ["39%d%d" % (a, n) for a in range(6) for n in range(10)]
    )
    missing = [ai for ai in required if ai not in AI_TABLE]
    assert missing == []
    assert lookup_ai("01").fixed_length == 14
    assert lookup_ai("10").fixed_length is None
    assert lookup_ai("10").max_length == 20
    assert lookup_ai("3103").decimals == 3


def test_prefix_free_table():
    keys = sorted(AI_TABLE)
    for a in keys:
        for b in keys:
            if a != b:
                assert not b.startswith(a), (a, b)


def test_round_trip_helpers(gs1_vector):
    result = parse_gs1(gs1_vector)
    assert format_hri(result) == gs1_vector
    raw = to_element_string(result)
    assert raw == "01095011015300031725010110ABC123"
    assert parse_gs1(raw)["values"] == result["values"]
    result2 = parse_gs1("(10)ABC(21)XYZ")
    assert to_element_string(result2) == "10ABC" + GS + "21XYZ"
