# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import datetime as dt
import json

import pytest

from qrgen_sdk import parse_aamva


def test_spec_vector(aamva_vector):
    result = parse_aamva(aamva_vector, today=dt.date(2026, 1, 15))
    assert result["firstName"] == "JANE"
    assert result["lastName"] == "SAMPLE"
    assert result["middleName"] == "Q"
    assert result["fullName"] == "JANE Q SAMPLE"
    assert result["dateOfBirth"] == "1990-01-31"
    assert result["expiryDate"] == "2028-01-31"
    assert result["issueDate"] == "2020-02-01"
    assert result["sex"] == "F"
    assert result["postalCode"] == "95814"
    assert result["state"] == "CA"
    assert result["city"] == "SACRAMENTO"
    assert result["street"] == "123 MAIN ST"
    assert result["country"] == "USA"
    assert result["documentNumber"] == "D1234567"
    assert result["documentType"] == "DL"
    assert result["issuerId"] == "636014"
    assert result["aamvaVersion"] == 10
    assert result["jurisdictionVersion"] == 0
    assert result["eyeColor"] == "BRO"
    assert result["height"] == "065 IN"
    assert result["age"] == 35
    assert result["isExpired"] is False
    assert result["isUnder21"] is False
    assert result["fields"]["DAQ"] == "D1234567"
    assert result["fields"]["DCS"] == "SAMPLE"
    assert result["fields"]["ZCA"] == "A"


def test_spec_keys_are_camel_case(aamva_vector):
    keys = set(parse_aamva(aamva_vector))
    assert keys == {
        "issuerId", "aamvaVersion", "jurisdictionVersion", "documentType", "firstName", "middleName", "lastName",
        "suffix", "fullName", "dateOfBirth", "issueDate", "expiryDate", "sex", "documentNumber", "street", "city",
        "state", "postalCode", "country", "eyeColor", "height", "age", "isExpired", "isUnder21", "fields",
    }
    json.dumps(parse_aamva(aamva_vector))


def test_injectable_today(aamva_vector):
    before_birthday = parse_aamva(aamva_vector, today=dt.date(2011, 1, 30))
    assert before_birthday["age"] == 20
    assert before_birthday["isUnder21"] is True
    on_birthday = parse_aamva(aamva_vector, today=dt.date(2011, 1, 31))
    assert on_birthday["age"] == 21
    assert on_birthday["isUnder21"] is False
    assert parse_aamva(aamva_vector, today=dt.date(2028, 1, 31))["isExpired"] is False
    assert parse_aamva(aamva_vector, today=dt.date(2028, 2, 1))["isExpired"] is True


def _card(body: str, iin: str = "636012", version: str = "09", kind: str = "DL") -> str:
    return "@\n\x1e\rANSI %s%s0001%s00310000%s%s\r" % (iin, version, kind, kind, body)


def test_canada_dates_and_postal_code():
    data = _card("DAQA1234-56789-01234\nDCSDOE\nDACJOHN\nDBB19851224\nDBA20300101\nDBD20250101\nDBC1\nDAJON\nDAKM5V 3L9\nDCGCAN")
    result = parse_aamva(data, today=dt.date(2026, 1, 1))
    assert result["country"] == "CAN"
    assert result["dateOfBirth"] == "1985-12-24"
    assert result["expiryDate"] == "2030-01-01"
    assert result["sex"] == "M"
    assert result["postalCode"] == "M5V 3L9"
    assert result["age"] == 40


def test_canada_detected_from_issuer_without_dcg():
    data = _card("DAQX1\nDCSDOE\nDACJOHN\nDBB19851224", iin="636028")
    assert parse_aamva(data)["country"] == "CAN"
    assert parse_aamva(data)["dateOfBirth"] == "1985-12-24"


def test_zip_plus_four_and_sex_x():
    data = _card("DAQ1\nDCSDOE\nDACALEX\nDBB07041976\nDBC9\nDAK981011234\nDCGUSA", iin="636045")
    result = parse_aamva(data)
    assert result["postalCode"] == "98101-1234"
    assert result["sex"] == "X"
    assert result["dateOfBirth"] == "1976-07-04"


def test_id_card_document_type():
    data = _card("DAQ99\nDCSROE\nDACRICHARD\nDBB02291992", kind="ID")
    result = parse_aamva(data)
    assert result["documentType"] == "ID"
    assert result["dateOfBirth"] == "1992-02-29"


def test_legacy_daa_full_name_version_1():
    data = "@\n\x1e\rANSI 6360000101DL00290100DLDAQ1234\nDAASMITH,JOHN,PAUL\nDBB19700101\nDBA20200101\nDAG1 ELM\r"
    result = parse_aamva(data, today=dt.date(2026, 1, 1))
    assert result["aamvaVersion"] == 1
    assert result["firstName"] == "JOHN"
    assert result["middleName"] == "PAUL"
    assert result["lastName"] == "SMITH"
    assert result["fullName"] == "JOHN PAUL SMITH"
    assert result["dateOfBirth"] == "1970-01-01"
    assert result["isExpired"] is True


def test_legacy_dct_given_names():
    data = _card("DAQ1\nDCSDOE\nDCTJANE,MARIE\nDBB01011990", version="03")
    result = parse_aamva(data)
    assert (result["firstName"], result["middleName"], result["lastName"]) == ("JANE", "MARIE", "DOE")


def test_bad_designator_offsets_still_parse():
    data = "@\n\x1e\rANSI 636014100001DL99999999DLDAQX9\nDCSLEE\nDACAMY\nDBB05051995\nDCGUSA\r"
    result = parse_aamva(data)
    assert result["documentNumber"] == "X9"
    assert result["firstName"] == "AMY"


def test_missing_dates_give_none():
    result = parse_aamva(_card("DAQ1\nDCSDOE\nDACJO"))
    assert result["dateOfBirth"] == ""
    assert result["age"] is None
    assert result["isExpired"] is None
    assert result["isUnder21"] is None


@pytest.mark.parametrize("data", ["", "hello world", "@", None, 123, "ANSI 636014", "(01)09501101530003"])
def test_not_aamva(data):
    assert parse_aamva(data) is None
