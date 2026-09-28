// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AamvaTest {
    /** The SPEC §3.3 test vector (fictional data). */
    private val spec = "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\n" +
        "DBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\n" +
        "DAK958140000\nDCGUSA\n\rZCZCAA\r"

    @Test
    fun `SPEC test vector`() {
        val r = assertNotNull(AAMVA.parse(spec, CalendarDate(2025, 6, 1)))
        assertEquals("JANE", r.firstName)
        assertEquals("SAMPLE", r.lastName)
        assertEquals("Q", r.middleName)
        assertEquals("", r.suffix)
        assertEquals("JANE Q SAMPLE", r.fullName)
        assertEquals("1990-01-31", r.dateOfBirth)
        assertEquals("2028-01-31", r.expiryDate)
        assertEquals("2020-02-01", r.issueDate)
        assertEquals("F", r.sex)
        assertEquals("95814", r.postalCode)
        assertEquals("CA", r.state)
        assertEquals("SACRAMENTO", r.city)
        assertEquals("123 MAIN ST", r.street)
        assertEquals("USA", r.country)
        assertEquals("D1234567", r.documentNumber)
        assertEquals("BRO", r.eyeColor)
        assertEquals("065 IN", r.height)
        assertEquals("636014", r.issuerId)
        assertEquals(10, r.aamvaVersion)
        assertEquals(0, r.jurisdictionVersion)
        assertEquals("DL", r.documentType)
        assertEquals(35, r.age)
        assertEquals(false, r.isExpired)
        assertEquals(false, r.isUnder21)
        assertEquals("D1234567", r.fields["DAQ"])
        assertEquals("SAMPLE", r.fields["DCS"])
        assertEquals("A", r.fields["ZCA"])
        assertEquals(r, parseAAMVA(spec)?.copy(age = 35, isExpired = false, isUnder21 = false))
    }

    @Test
    fun `age, expiry and under 21 follow the injected date`() {
        val birthdayEve = AAMVA.parse(spec, CalendarDate(2011, 1, 30))!!
        assertEquals(20, birthdayEve.age)
        assertEquals(true, birthdayEve.isUnder21)
        val birthday = AAMVA.parse(spec, CalendarDate(2011, 1, 31))!!
        assertEquals(21, birthday.age)
        assertEquals(false, birthday.isUnder21)
        assertEquals(false, AAMVA.parse(spec, CalendarDate(2028, 1, 31))!!.isExpired)
        assertEquals(true, AAMVA.parse(spec, CalendarDate(2028, 2, 1))!!.isExpired)
    }

    @Test
    fun `Canadian cards use CCYYMMDD`() {
        val data = "@\n\u001e\rANSI 636012080002DL00410120ZO01610010DLDAQA1234-56789-01234\nDCSDOE\nDACJOHN\nDADMICHAEL\n" +
            "DBB19850315\nDBA20300315\nDBD20250315\nDBC1\nDAJON\nDAKM5V 2T6\nDCGCAN\n\rZOZOAX\r"
        val r = assertNotNull(AAMVA.parse(data, CalendarDate(2026, 1, 1)))
        assertEquals("1985-03-15", r.dateOfBirth)
        assertEquals("2030-03-15", r.expiryDate)
        assertEquals("2025-03-15", r.issueDate)
        assertEquals("M", r.sex)
        assertEquals("M5V 2T6", r.postalCode)
        assertEquals("CAN", r.country)
        assertEquals("ON", r.state)
        assertEquals("JOHN MICHAEL DOE", r.fullName)
        assertEquals(8, r.aamvaVersion)
        assertEquals(40, r.age)
    }

    @Test
    fun `dates fall back to the plausible layout`() {
        // No DCG and a US state, but the date is only valid as CCYYMMDD.
        val data = "@\n\u001e\rANSI 636015090101DL00310100DLDAQ1\nDCSX\nDACY\nDBB19991231\nDAJTX\n\r"
        val r = assertNotNull(AAMVA.parse(data, CalendarDate(2026, 1, 1)))
        assertEquals("1999-12-31", r.dateOfBirth)
        assertEquals(1, r.jurisdictionVersion)
        assertEquals("USA", r.country)
    }

    @Test
    fun `legacy version 1 with DAA full name`() {
        val data = "@\n\u001e\rANSI 6360000101DL00290100DLDAQ12345678\nDAASMITH,JOHN,A\nDBB19700102\nDBA20200102\n" +
            "DAG1 ELM ST\nDAIAUSTIN\nDAJTX\nDAK78701\nDBCM\n\r"
        val r = assertNotNull(AAMVA.parse(data, CalendarDate(2026, 1, 1)))
        assertEquals(1, r.aamvaVersion)
        assertEquals("SMITH", r.lastName)
        assertEquals("JOHN", r.firstName)
        assertEquals("A", r.middleName)
        assertEquals("JOHN A SMITH", r.fullName)
        assertEquals("1970-01-02", r.dateOfBirth)
        assertEquals("2020-01-02", r.expiryDate)
        assertEquals(true, r.isExpired)
        assertEquals("78701", r.postalCode)
        assertEquals("M", r.sex)
    }

    @Test
    fun `ID cards, ZIP+4 and placeholder names`() {
        val data = "@\n\u001e\rANSI 636020100001ID00310150IDDAQ99\nDCSROE\nDACRICHARD\nDADNONE\nDCUJR\nDBB07041976\n" +
            "DBA07042030\nDBC9\nDAK100011234\nDAJNY\n\r"
        val r = assertNotNull(AAMVA.parse(data, CalendarDate(2026, 1, 1)))
        assertEquals("ID", r.documentType)
        assertEquals("", r.middleName)
        assertEquals("JR", r.suffix)
        assertEquals("RICHARD ROE JR", r.fullName)
        assertEquals("X", r.sex)
        assertEquals("10001-1234", r.postalCode)
    }

    @Test
    fun `payloads without a usable header still parse`() {
        val data = "DLDAQD7654321\nDCSDOE\nDACJANE\nDBB02291992\nDBA02282030\nDAJWA\n"
        val r = assertNotNull(AAMVA.parse(data, CalendarDate(2026, 1, 1)))
        assertEquals("DL", r.documentType)
        assertEquals("1992-02-29", r.dateOfBirth)
        assertEquals("", r.issuerId)
        assertEquals(0, r.aamvaVersion)
    }

    @Test
    fun `non AAMVA input returns null`() {
        assertNull(AAMVA.parse(""))
        assertNull(AAMVA.parse("hello world"))
        assertNull(AAMVA.parse("@\n\u001e\rANSI 63"))
        assertNull(AAMVA.parse("https://example.com"))
        assertTrue(AAMVA.looksLikeAamva(spec))
    }

    @Test
    fun `json output`() {
        val json = AAMVA.parse(spec, CalendarDate(2025, 6, 1))!!.toJson()
        assertTrue(json.startsWith("""{"issuerId":"636014","aamvaVersion":10,"jurisdictionVersion":0,"documentType":"DL","firstName":"JANE""""))
        assertTrue(json.contains(""""age":35,"isExpired":false,"isUnder21":false,"fields":{"DAQ":"D1234567""""))
    }
}
