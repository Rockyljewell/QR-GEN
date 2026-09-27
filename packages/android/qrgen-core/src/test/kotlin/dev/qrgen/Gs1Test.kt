package dev.qrgen

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class Gs1Test {
    private val today = CalendarDate(2026, 9, 27)
    private val gs = GS1.GS

    @Test
    fun `SPEC test vector`() {
        val r = assertNotNull(GS1.parse("(01)09501101530003(17)250101(10)ABC123", today))
        assertEquals(mapOf("01" to "09501101530003", "17" to "250101", "10" to "ABC123"), r.values)
        assertEquals(listOf("01", "17", "10"), r.elements.map { it.ai })
        assertEquals("GTIN", r.element("01")?.title)
        assertEquals("USE BY or EXPIRY", r.element("17")?.title)
        assertEquals("BATCH/LOT", r.element("10")?.title)
        assertEquals("2025-01-01", r.element("17")?.date)
        assertEquals("2025-01-01", r.expiryDate)
        assertEquals("09501101530003", r.gtin)
        assertEquals("(01)09501101530003(17)250101(10)ABC123", r.toHri())
        assertEquals("09501101530003", parseGS1("(01)09501101530003(17)250101(10)ABC123")?.gtin)
    }

    @Test
    fun `raw element strings with GS separators and symbology identifiers`() {
        val expected = mapOf("01" to "09501101530003", "10" to "ABC123", "17" to "250101")
        assertEquals(expected, GS1.parse("0109501101530003" + "10ABC123" + gs + "17250101", today)?.values)
        assertEquals(expected, GS1.parse("]C10109501101530003" + "10ABC123" + gs + "17250101", today)?.values)
        assertEquals(expected, GS1.parse("]d2" + "0109501101530003" + "10ABC123" + gs + "17250101", today)?.values)
        assertEquals(expected, GS1.parse("]Q3" + "0109501101530003" + "10ABC123" + gs + "17250101", today)?.values)
        assertEquals(expected, GS1.parse("]e0" + "0109501101530003" + "17250101" + "10ABC123", today)?.values)
        assertEquals(expected, GS1.parse(gs + "0109501101530003" + "10ABC123" + gs + "17250101", today)?.values)
        // Predefined-length AIs need no separator; the last variable field runs to the end.
        assertEquals(expected, GS1.parse("0109501101530003" + "17250101" + "10ABC123", today)?.values)
        // A GS after a fixed-length field is tolerated.
        assertEquals(expected, GS1.parse("]C1" + "0109501101530003" + gs + "17250101" + gs + "10ABC123", today)?.values)
    }

    @Test
    fun `digital link URLs`() {
        val r = assertNotNull(GS1.parse("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101", today))
        assertEquals(mapOf("01" to "09501101530003", "10" to "ABC123", "17" to "250101"), r.values)
        assertEquals("2025-01-01", r.element("17")?.date)

        val custom = assertNotNull(GS1.parseDigitalLink("https://brand.example/products/01/9501101530003/21/X%2F7?linkType=gs1:pip&3103=000189", today))
        assertEquals("09501101530003", custom.gtin)
        assertEquals("9501101530003", custom.element("01")?.raw)
        assertEquals("X/7", custom.serial)
        assertEquals("X%2F7", custom.element("21")?.raw)
        assertEquals(0.189, custom.element("3103")?.number)
        assertEquals(null, custom["linkType"])

        assertEquals("09501101530003", GS1.parseDigitalLink("https://example.com/gtin/09501101530003/lot/B1")?.gtin)
        assertNull(GS1.parseDigitalLink("https://example.com/"))
        assertNull(GS1.parseDigitalLink("https://blog.example/2024/01/15/post"))
        assertNull(GS1.parseDigitalLink("https://example.com/01/abc"))
    }

    @Test
    fun `dates use the century rule and day 00 means end of month`() {
        assertEquals("2025-02-28", GS1.parse("(17)250200", today)?.element("17")?.date)
        assertEquals("2024-02-29", GS1.parse("(15)240200", today)?.element("15")?.date)
        assertEquals("1999-01-01", GS1.parse("(11)990101", today)?.element("11")?.date)
        assertEquals("2076-01-01", GS1.parse("(17)760101", today)?.element("17")?.date)
        assertEquals("2025-12-31", GS1.parse("(16)251231", today)?.element("16")?.date)
        assertEquals("2025-06-30", GS1.parse("(13)250600", today)?.element("13")?.date)
        assertNull(GS1.parse("(17)251301", today)?.element("17")?.date)
        assertEquals("2025-01-01T12:30", GS1.parse("(7003)2501011230", today)?.element("7003")?.date)
    }

    @Test
    fun `decimal AIs expose a number`() {
        val r = assertNotNull(GS1.parse("(01)09501101530003(3103)001250(3922)1999(3932)9781999(3202)000150(8005)000123", today))
        assertEquals(1.25, r.element("3103")?.number)
        assertEquals("NET WEIGHT (kg)", r.element("3103")?.title)
        assertEquals(19.99, r.element("3922")?.number)
        assertEquals(19.99, r.element("3932")?.number)
        assertEquals(1.5, r.element("3202")?.number)
        assertEquals("NET WEIGHT (lb)", r.element("3202")?.title)
        assertNull(r.element("8005")?.number)
        val raw = GS1.parse("0109501101530003" + "3103001250" + "3922" + "1999", today)
        assertEquals(1.25, raw?.element("3103")?.number)
        assertEquals(19.99, raw?.element("3922")?.number)
    }

    @Test
    fun `AI table covers the required identifiers`() {
        val ais = listOf(
            "00", "01", "02", "10", "11", "12", "13", "15", "16", "17", "20", "21", "22", "235", "240", "241", "242", "243",
            "250", "251", "253", "254", "255", "30", "3100", "3165", "3200", "3369", "37", "3900", "3919", "3955", "400",
            "401", "402", "403", "410", "417", "420", "427", "7003", "7004", "8003", "8004", "8005", "8006", "8007", "8008",
            "8012", "8013", "8017", "8018", "8020", "8200", "90", "91", "99",
        )
        for (ai in ais) assertNotNull(GS1.title(ai), "missing AI $ai")
        assertEquals("SSCC", GS1.title("00"))
        assertEquals("SERIAL", GS1.title("21"))
        assertEquals("PRODUCT URL", GS1.title("8200"))
    }

    @Test
    fun `long element strings with many AIs`() {
        val raw = "]C1" + "00106141411234567897" + "0209501101530003" + "37" + "24" + gs + "400" + "PO-7781" + gs +
            "7003" + "2512312359" + "8008" + "25010112" + gs + "421" + "840" + "95814" + gs + "91" + "INT-1"
        val r = assertNotNull(GS1.parse(raw, today))
        assertEquals("106141411234567897", r.sscc)
        assertEquals("24", r["37"])
        assertEquals("PO-7781", r["400"])
        assertEquals("2025-12-31T23:59", r.element("7003")?.date)
        assertEquals("2025-01-01T12:00", r.element("8008")?.date)
        assertEquals("84095814", r["421"])
        assertEquals("INT-1", r["91"])
    }

    @Test
    fun `non GS1 input returns null`() {
        assertNull(GS1.parse("hello world"))
        assertNull(GS1.parse(""))
        assertNull(GS1.parse("(ab)123"))
        assertNull(GS1.parse("(01)"))
        assertNull(GS1.parse("]C0hello"))
        assertNull(GS1.parse("https://example.com/"))
        assertNull(GS1.parse("123"))
        // Bare digits are only GS1 when they parse strictly.
        assertNull(GS1.parse("0109501101530"))
        assertNotNull(GS1.parse("0109501101530003"))
    }

    @Test
    fun `element string output for encoders`() {
        assertEquals(
            "0109501101530003" + "10ABC123" + gs + "17250101",
            GS1.toElementString("(01)09501101530003(10)ABC123(17)250101"),
        )
        assertEquals("0109501101530003" + "17250101" + "10ABC123", GS1.toElementString("(01)09501101530003(17)250101(10)ABC123"))
    }

    @Test
    fun `detect heuristic for scanned payloads`() {
        assertNotNull(GS1.detect("0109501101530003" + "10ABC", Symbology.CODE128, today))
        assertNotNull(GS1.detect("10ABC" + gs + "0109501101530003", Symbology.DATA_MATRIX, today))
        assertNull(GS1.detect("1000", Symbology.CODE128, today))
        assertNull(GS1.detect("0109501101530004", Symbology.CODE128, today))
        assertNull(GS1.detect("0109501101530003", Symbology.EAN13, today))
        assertEquals("09501101530003", GS1.detect("09501101530003", Symbology.DATABAR, today)?.gtin)
    }

    @Test
    fun `GTIN helpers`() {
        assertEquals(3, Gtin.checkDigit("0950110153000"))
        assertEquals(true, Gtin.isValid("5901234123457"))
        assertEquals(false, Gtin.isValid("5901234123458"))
        assertEquals("012345000065", Gtin.upceToUpca("01234565"))
        assertEquals("00012345678905", Gtin.toGtin14("012345678905"))
    }

    @Test
    fun `json shape`() {
        val json = GS1.parse("(01)09501101530003(17)250100", today)!!.toJson()
        assertEquals(
            """{"elements":[{"ai":"01","title":"GTIN","value":"09501101530003"},{"ai":"17","title":"USE BY or EXPIRY","value":"250100","date":"2025-01-31"}],"values":{"01":"09501101530003","17":"250100"}}""",
            json,
        )
    }
}
