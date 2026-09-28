// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ContentParserTest {
    private fun parse(s: String) = ContentParser.parse(s)

    @Test
    fun urls() {
        assertEquals(ParsedContent.Url("https://example.com/a?b=c"), parse("https://example.com/a?b=c"))
        assertEquals(ParsedContent.Url("HTTP://EXAMPLE.COM"), parse("HTTP://EXAMPLE.COM"))
        assertEquals(ParsedContent.Url("https://www.example.com"), parse("www.example.com"))
        assertEquals(ParsedContent.Url("ftp://files.example.com/x"), parse("ftp://files.example.com/x"))
        assertEquals(ParsedContent.Url("https://example.com"), parse("MEBKM:TITLE:Example;URL:https\\://example.com;;"))
        assertEquals("url", parse("https://example.com").type)
    }

    @Test
    fun `gs1 digital link`() {
        val c = assertIs<ParsedContent.Gs1DigitalLink>(parse("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101"))
        assertEquals("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101", c.url)
        assertEquals(mapOf("01" to "09501101530003", "10" to "ABC123", "17" to "250101"), c.gs1.values)
        assertEquals("gs1-digital-link", c.type)
    }

    @Test
    fun emails() {
        assertEquals(ParsedContent.Email("hi@example.com", "Hello there", "Hi"), parse("mailto:hi@example.com?subject=Hello%20there&body=Hi"))
        assertEquals(ParsedContent.Email("a@example.com,b@example.com"), parse("mailto:a@example.com?to=b@example.com"))
        assertEquals(ParsedContent.Email("hi@example.com", "Hello", "World; ok"), parse("MATMSG:TO:hi@example.com;SUB:Hello;BODY:World\\; ok;;"))
        assertEquals(ParsedContent.Email("jane.doe+tag@example.co.uk"), parse("jane.doe+tag@example.co.uk"))
    }

    @Test
    fun `phone and sms`() {
        assertEquals(ParsedContent.Phone("+15551234567"), parse("tel:+15551234567"))
        assertEquals(ParsedContent.Sms("+15551234567", "Hello world"), parse("sms:+15551234567?body=Hello%20world"))
        assertEquals(ParsedContent.Sms("+15551234567", "Hello there: friend"), parse("SMSTO:+15551234567:Hello there: friend"))
        assertEquals(ParsedContent.Sms("+15551234567", null), parse("smsto:+15551234567"))
    }

    @Test
    fun wifi() {
        assertEquals(
            ParsedContent.Wifi("My;Net", "p:ss\\word", "WPA", true),
            parse("WIFI:T:WPA;S:My\\;Net;P:p\\:ss\\\\word;H:true;;"),
        )
        assertEquals(ParsedContent.Wifi("Cafe", null, "nopass", false), parse("WIFI:S:Cafe;;"))
        assertEquals(ParsedContent.Wifi("Quoted Net", "secret", "WEP", false), parse("WIFI:S:\"Quoted Net\";T:WEP;P:\"secret\";;"))
        assertEquals(ParsedContent.Wifi("Home, sweet", "a,b", "SAE", false), parse("wifi:T:SAE;S:Home\\, sweet;P:a\\,b;H:false;;"))
    }

    @Test
    fun geo() {
        assertEquals(ParsedContent.Geo(37.786971, -122.399677, 15.0, "Moscone Center"), parse("geo:37.786971,-122.399677,15?q=Moscone+Center"))
        assertEquals(ParsedContent.Geo(48.2010, 16.3695), parse("GEO:48.2010,16.3695;crs=wgs84;u=35"))
        assertEquals(ParsedContent.Text("geo:200,0"), parse("geo:200,0"))
    }

    @Test
    fun vcard() {
        val card = """
            BEGIN:VCARD
            VERSION:3.0
            N:Doe;Jane;Q;Dr.;
            FN:Dr. Jane Q Doe
            ORG:Example Inc.;R&D
            TITLE:CTO
            TEL;TYPE=CELL:+1 555 0100
            item1.TEL;TYPE=WORK:+1 555 0101
            EMAIL;TYPE=INTERNET:jane@example.com
            URL:https://example.com
            ADR;TYPE=WORK:;;1 Main St;Springfield;IL;62701;USA
            NOTE:Line one\nLine two\, with comma and a very long line that is fol
             ded here
            END:VCARD
        """.trimIndent()
        val c = assertIs<ParsedContent.Contact>(parse(card))
        assertEquals("Dr. Jane Q Doe", c.name)
        assertEquals("Example Inc., R&D", c.organization)
        assertEquals("CTO", c.title)
        assertEquals(listOf("+1 555 0100", "+1 555 0101"), c.phones)
        assertEquals(listOf("jane@example.com"), c.emails)
        assertEquals(listOf("https://example.com"), c.urls)
        assertEquals("1 Main St, Springfield, IL, 62701, USA", c.address)
        assertEquals("Line one\nLine two, with comma and a very long line that is folded here", c.note)
        assertEquals("vcard", c.format)

        val noFn = assertIs<ParsedContent.Contact>(parse("BEGIN:VCARD\r\nVERSION:2.1\r\nN:Smith;John;;;\r\nTEL:+44 20 7946 0000\r\nEND:VCARD"))
        assertEquals("John Smith", noFn.name)
        val qp = assertIs<ParsedContent.Contact>(parse("BEGIN:VCARD\nVERSION:2.1\nFN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:J=C3=BCrgen\nEND:VCARD"))
        assertEquals("Jürgen", qp.name)
    }

    @Test
    fun mecard() {
        val c = assertIs<ParsedContent.Contact>(parse("MECARD:N:Doe,John;TEL:+15551234;EMAIL:john@example.com;URL:https\\://ex.com;ADR:1 Main St,Springfield;NOTE:Hi\\;there;ORG:ACME;;"))
        assertEquals("John Doe", c.name)
        assertEquals(listOf("+15551234"), c.phones)
        assertEquals(listOf("john@example.com"), c.emails)
        assertEquals(listOf("https://ex.com"), c.urls)
        assertEquals("1 Main St, Springfield", c.address)
        assertEquals("Hi;there", c.note)
        assertEquals("ACME", c.organization)
        assertEquals("mecard", c.format)
    }

    @Test
    fun event() {
        val e = parse("BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:QRGen launch\nDTSTART:20250101T090000Z\nDTEND;TZID=Europe/Paris:20250101T1000\nLOCATION:Online\nDESCRIPTION:Kickoff\\, all hands\nEND:VEVENT\nEND:VCALENDAR")
        assertEquals(ParsedContent.Event("QRGen launch", "2025-01-01T09:00:00Z", "2025-01-01T10:00:00", "Online", "Kickoff, all hands"), e)
        assertEquals(ParsedContent.Event("Day", "2025-03-01", null, null, null), parse("BEGIN:VEVENT\nSUMMARY:Day\nDTSTART;VALUE=DATE:20250301\nEND:VEVENT"))
    }

    @Test
    fun payments() {
        assertEquals(
            ParsedContent.Payment("epc", null, "Red Cross of Belgium", "BE72000000001616", "BPOTBEB1", 1.0, "EUR", "Urgency fund"),
            parse("BCD\n002\n1\nSCT\nBPOTBEB1\nRed Cross of Belgium\nBE72000000001616\nEUR1\nCHAR\n\nUrgency fund\n"),
        )
        assertEquals(
            ParsedContent.Payment("bitcoin", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "QRGen", amount = 0.01, currency = "BTC", reference = "Donation"),
            parse("bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.01&label=QRGen&message=Donation"),
        )
        assertEquals(
            ParsedContent.Payment("ethereum", "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7", amount = 2.014, currency = "ETH"),
            parse("ethereum:0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7@1?value=2.014e18"),
        )
        assertEquals(
            ParsedContent.Payment("upi", "merchant@upi", "QRGen Store", amount = 10.5, currency = "INR", reference = "Order 42"),
            parse("upi://pay?pa=merchant@upi&pn=QRGen%20Store&am=10.50&cu=INR&tn=Order%2042"),
        )
        assertEquals(ParsedContent.Payment("other", "LQTpS3VaYTjCr4s9Y1t5zbeY26zevf7Fb3"), parse("litecoin:LQTpS3VaYTjCr4s9Y1t5zbeY26zevf7Fb3"))
    }

    @Test
    fun products() {
        assertEquals(ParsedContent.Product("05901234123457", "ean13", true), parse("5901234123457"))
        assertEquals(ParsedContent.Product("05901234123458", "ean13", false), parse("5901234123458"))
        assertEquals(ParsedContent.Product("09780306406157", "isbn", true), parse("9780306406157"))
        assertEquals(ParsedContent.Product("00036000291452", "upca", true), parse("036000291452"))
        assertEquals(ParsedContent.Product("00000096385074", "ean8", true), parse("96385074"))
        assertEquals(ParsedContent.Product("10012345678902", "gtin14", true), parse("10012345678902"))
        assertEquals(ParsedContent.Product("00012345000065", "upce", true), ContentParser.parse("01234565", Symbology.UPCE))
        assertEquals(ParsedContent.Text("12345"), parse("12345"))
    }

    @Test
    fun `gs1 and aamva`() {
        val g = assertIs<ParsedContent.Gs1>(parse("(01)09501101530003(17)250101(10)ABC123"))
        assertEquals("ABC123", g.gs1.batch)
        assertIs<ParsedContent.Gs1>(parse("]C10109501101530003" + "10ABC"))
        assertIs<ParsedContent.Gs1>(parse("0109501101530003" + "10ABC" + GS1.GS + "21XYZ"))
        assertIs<ParsedContent.Gs1>(parse("010950110153000317250101"))
        assertIs<ParsedContent.Gs1>(ContentParser.parse(Barcode("0109501101530003", Symbology.CODE128, isGS1 = true)))
        val aamva = "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDBB01311990\nDBA01312028\n\r"
        val a = assertIs<ParsedContent.Aamva>(parse(aamva))
        assertEquals("JANE", a.aamva.firstName)
    }

    @Test
    fun `plain text and never throws`() {
        assertEquals(ParsedContent.Text("hello world"), parse("hello world"))
        assertEquals(ParsedContent.Text(""), parse(""))
        assertEquals(ParsedContent.Text("mailto"), parse("mailto"))
        assertEquals("text", parse("WIFI:").type)
        for (s in listOf("sms:", "geo:", "tel:", "BEGIN:VCARD", "MECARD:", "bitcoin:", "upi://pay", "BCD\n", "(", "]C1", "\u001d")) {
            parse(s) // must not throw
        }
    }

    @Test
    fun `json shape omits absent optional fields`() {
        assertEquals("""{"type":"email","to":"a@b.co"}""", parse("mailto:a@b.co").toJson())
        assertEquals("""{"type":"wifi","ssid":"x","security":"nopass","hidden":false}""", parse("WIFI:S:x;;").toJson())
        assertEquals("""{"type":"geo","latitude":1.5,"longitude":2}""", parse("geo:1.5,2").toJson())
        assertEquals("""{"type":"text","text":"hi \"there\"\n"}""", ParsedContent.Text("hi \"there\"\n").toJson())
        assertEquals("""{"type":"product","gtin":"05901234123457","kind":"ean13","checksumValid":true}""", parseContent("5901234123457").toJson())
    }
}
