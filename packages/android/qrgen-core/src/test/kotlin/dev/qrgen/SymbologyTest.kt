// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SymbologyTest {
    @Test
    fun `ids match the SPEC table`() {
        assertEquals(
            listOf(
                "qr", "micro-qr", "rmqr", "data-matrix", "aztec", "pdf417", "micro-pdf417", "maxicode",
                "ean13", "ean8", "upca", "upce", "isbn", "code128", "code39", "code93", "codabar", "itf",
                "itf14", "databar", "databar-expanded", "databar-limited", "code32", "pzn", "telepen", "dx-film-edge",
            ),
            Symbology.entries.map { it.id },
        )
        assertEquals("QR Code", Symbology.QR.displayName)
        assertEquals("Code 32 (Italian Pharmacode)", Symbology.CODE32.displayName)
    }

    @ParameterizedTest
    @CsvSource(
        "QRCode,qr", "qr-code,qr", "QR,qr", "qr,qr", "Micro QR Code,micro-qr", "micro_qr,micro-qr",
        "rMQR,rmqr", "rmqrcode,rmqr", "DataMatrix,data-matrix", "DM,data-matrix", "data-matrix,data-matrix",
        "AztecCode,aztec", "compactpdf417,pdf417", "PDF-417,pdf417", "MicroPDF417,micro-pdf417", "MaxiCode,maxicode",
        "EAN,ean13", "JAN,ean13", "GTIN-13,ean13", "EAN-8,ean8", "gtin8,ean8", "UPC,upca", "UPC-A,upca", "UPC_E,upce",
        "ISBN-13,isbn", "GS1-128,code128", "EAN128,code128", "Code 3 of 9,code39", "code93,code93", "NW-7,codabar",
        "Interleaved 2 of 5,itf", "I2of5,itf", "ITF-14,itf14", "RSS-14,databar", "DataBar Omni,databar",
        "RSS Expanded,databar-expanded", "DATABAR_EXPANDED,databar-expanded", "RSS Limited,databar-limited",
        "code32,code32", "PZN,pzn", "Telepen,telepen", "DX Film Edge,dx-film-edge",
    )
    fun `aliases resolve case and punctuation insensitively`(input: String, expected: String) {
        assertEquals(expected, Symbology.fromName(input)?.id)
        assertEquals(setOf(expected), Symbology.resolve(input).map { it.id }.toSet())
    }

    @Test
    fun `groups expand per SPEC`() {
        assertEquals(Symbology.entries.toSet(), Symbology.resolve("all"))
        assertEquals(
            "ean13 ean8 upca upce isbn code128 code39 code93 codabar itf itf14 databar databar-expanded databar-limited code32 pzn telepen dx-film-edge",
            Symbology.resolve("linear").joinToString(" ") { it.id },
        )
        assertEquals(Symbology.resolve("linear"), Symbology.resolve("1D"))
        assertEquals(
            "qr micro-qr rmqr data-matrix aztec pdf417 micro-pdf417 maxicode",
            Symbology.resolve("matrix").joinToString(" ") { it.id },
        )
        assertEquals(Symbology.resolve("matrix"), Symbology.resolve("2d"))
        assertEquals(
            setOf("ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited"),
            Symbology.resolve("retail").map { it.id }.toSet(),
        )
        assertEquals(
            setOf("code128", "code39", "code93", "codabar", "itf", "itf14", "data-matrix"),
            Symbology.resolve("Industrial").map { it.id }.toSet(),
        )
        assertEquals(
            setOf("code128", "data-matrix", "qr", "databar", "databar-expanded", "databar-limited"),
            Symbology.resolve("GS1").map { it.id }.toSet(),
        )
    }

    @Test
    fun `resolve mixes ids and groups, ignores unknown names, defaults to all`() {
        val set = Symbology.resolve(listOf("qr", "retail", "nonsense"))
        assertTrue(Symbology.QR in set && Symbology.EAN13 in set && Symbology.DATABAR in set)
        assertFalse(Symbology.CODE128 in set)
        assertEquals(Symbology.ALL, Symbology.resolve(emptyList()))
        assertEquals(setOf(Symbology.QR, Symbology.EAN13), Symbology.resolve("qr,ean13"))
        assertEquals(listOf("nonsense"), Symbology.unknownNames(listOf("qr", "nonsense", "retail")))
        assertTrue(Symbology.resolve("nonsense").isEmpty())
        assertNull(Symbology.fromName("retail"))
    }

    @Test
    fun `linear flags and default viewfinder helper`() {
        assertTrue(Symbology.allLinear(Symbology.resolve("retail")))
        assertFalse(Symbology.allLinear(Symbology.resolve("qr", "ean13")))
        assertFalse(Symbology.allLinear(emptySet()))
        assertTrue(Symbology.PDF417 in Symbology.MATRIX)
    }

    @Test
    fun `refine disambiguates UPC-A, ISBN and ITF-14`() {
        val retail = Symbology.resolve("ean13", "upca", "isbn")
        assertEquals(RefinedSymbology(Symbology.ISBN, "9780306406157"), Symbology.refine(Symbology.EAN13, "9780306406157", retail))
        assertEquals(RefinedSymbology(Symbology.EAN13, "9780306406157"), Symbology.refine(Symbology.EAN13, "9780306406157", setOf(Symbology.EAN13)))
        assertNull(Symbology.refine(Symbology.EAN13, "5901234123457", setOf(Symbology.ISBN)))
        assertEquals(RefinedSymbology(Symbology.UPCA, "036000291452"), Symbology.refine(Symbology.EAN13, "0036000291452", retail))
        assertEquals(RefinedSymbology(Symbology.EAN13, "0036000291452"), Symbology.refine(Symbology.UPCA, "036000291452", setOf(Symbology.EAN13)))
        assertEquals(RefinedSymbology(Symbology.UPCA, "036000291452"), Symbology.refine(Symbology.UPCA, "036000291452", retail))
        assertNull(Symbology.refine(Symbology.UPCA, "036000291452", setOf(Symbology.QR)))
        assertEquals(RefinedSymbology(Symbology.ITF14, "10012345678902"), Symbology.refine(Symbology.ITF, "10012345678902", Symbology.ALL))
        assertEquals(RefinedSymbology(Symbology.ITF, "1234567890"), Symbology.refine(Symbology.ITF, "1234567890", Symbology.ALL))
        assertEquals(RefinedSymbology(Symbology.ITF, "10012345678902"), Symbology.refine(Symbology.ITF, "10012345678902", setOf(Symbology.ITF)))
        assertEquals(RefinedSymbology(Symbology.QR, "x"), Symbology.refine(Symbology.QR, "x", Symbology.ALL))
        assertNull(Symbology.refine(Symbology.QR, "x", setOf(Symbology.EAN13)))
    }

    @Test
    fun `AIM identifiers`() {
        assertEquals("]Q1", Symbology.QR.aimIdentifier())
        assertEquals("]Q3", Symbology.QR.aimIdentifier(gs1 = true))
        assertEquals("]C1", Symbology.CODE128.aimIdentifier(gs1 = true))
        assertEquals("]d2", Symbology.DATA_MATRIX.aimIdentifier(gs1 = true))
        assertEquals("]E0", Symbology.EAN13.aimIdentifier())
        assertEquals("", Symbology.TELEPEN.aimIdentifier())
    }
}
