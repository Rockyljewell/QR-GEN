"""Shared pytest fixtures."""

from __future__ import annotations

import datetime as dt

import pytest

#: SPEC section 3.3 AAMVA test vector (fictional data).
AAMVA_VECTOR = (
    "@\n\x1e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\n"
    "DBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\n"
    "DAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r"
)

#: SPEC section 3.2 GS1 test vector.
GS1_VECTOR = "(01)09501101530003(17)250101(10)ABC123"


@pytest.fixture
def aamva_vector() -> str:
    return AAMVA_VECTOR


@pytest.fixture
def gs1_vector() -> str:
    return GS1_VECTOR


@pytest.fixture
def today() -> dt.date:
    return dt.date(2026, 1, 15)
