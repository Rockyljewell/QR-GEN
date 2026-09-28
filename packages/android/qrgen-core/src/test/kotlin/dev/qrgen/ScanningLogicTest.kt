// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DuplicateFilterTest {
    private fun code(data: String, s: Symbology = Symbology.QR) = Barcode(data, s)

    @Test
    fun `window suppresses repeats until it elapses since the last report`() {
        val f = DuplicateFilter(1000)
        assertTrue(f.accept(code("A"), now = 0))
        assertFalse(f.accept(code("A"), now = 500))
        assertFalse(f.accept(code("A"), now = 999))
        assertTrue(f.accept(code("A"), now = 1000))
        assertFalse(f.accept(code("A"), now = 1500))
        assertTrue(f.accept(code("B"), now = 1500))
        assertTrue(f.accept(code("A", Symbology.CODE128), now = 1500), "different symbology is a different code")
    }

    @Test
    fun `zero reports every frame`() {
        val f = DuplicateFilter(ScannerOptions.REPORT_EVERY_FRAME)
        repeat(5) { assertTrue(f.accept(code("A"), now = it.toLong())) }
        assertEquals(2, f.filter(listOf(code("A"), code("A")), now = 10).size)
    }

    @Test
    fun `minus one reports once per session`() {
        val f = DuplicateFilter(ScannerOptions.REPORT_ONCE_PER_SESSION)
        assertTrue(f.accept(code("A"), now = 0))
        assertFalse(f.accept(code("A"), now = 1_000_000))
        f.reset()
        assertTrue(f.accept(code("A"), now = 1_000_001))
    }

    @Test
    fun `filter keeps order and removes in-frame duplicates`() {
        val f = DuplicateFilter(1000)
        val out = f.filter(listOf(code("A"), code("B"), code("A"), code("C")), now = 0)
        assertEquals(listOf("A", "B", "C"), out.map { it.data })
        assertEquals(listOf("D"), f.filter(listOf(code("A"), code("D")), now = 10).map { it.data })
    }

    @Test
    fun `history is pruned`() {
        val f = DuplicateFilter(100)
        for (i in 0 until 300) f.accept(code("c$i"), now = i.toLong())
        assertTrue(f.size < 300)
    }
}

class BarcodeTrackerTest {
    private fun at(data: String, x: Float, y: Float, size: Float = 100f, s: Symbology = Symbology.QR) =
        Barcode(data, s, location = Quad.fromRect(x, y, x + size, y + size))

    @Test
    fun `ids are stable while codes move`() {
        val t = BarcodeTracker()
        val u1 = t.update(listOf(at("A", 0f, 0f), at("B", 500f, 0f)), now = 0)
        assertEquals(listOf(1, 2), u1.tracked.map { it.id })
        assertEquals(2, u1.added.size)
        val u2 = t.update(listOf(at("B", 520f, 10f), at("A", 15f, 5f)), now = 33)
        assertEquals(mapOf("A" to 1, "B" to 2), u2.tracked.associate { it.data to it.id })
        assertTrue(u2.added.isEmpty())
        val a = u2.tracked.first { it.data == "A" }
        assertEquals(2, a.count)
        assertEquals(0, a.firstSeen)
        assertEquals(33, a.lastSeen)
        assertEquals(15f, a.location.topLeft.x)
    }

    @Test
    fun `identical codes are told apart by position`() {
        val t = BarcodeTracker()
        t.update(listOf(at("SAME", 0f, 0f), at("SAME", 400f, 0f)), now = 0)
        val u = t.update(listOf(at("SAME", 410f, 5f), at("SAME", 8f, 4f)), now = 40)
        val byId = u.tracked.associate { it.id to it.location.topLeft.x }
        assertEquals(8f, byId[1])
        assertEquals(410f, byId[2])
    }

    @Test
    fun `tracks unseen for more than 500 ms are dropped`() {
        val t = BarcodeTracker()
        t.update(listOf(at("A", 0f, 0f)), now = 0)
        assertEquals(1, t.update(emptyList(), now = 400).tracked.size, "kept while within the window")
        assertEquals(1, t.update(emptyList(), now = 500).tracked.size, "500 ms is still within the window")
        val gone = t.update(emptyList(), now = 501)
        assertTrue(gone.tracked.isEmpty())
        assertEquals(listOf(1), gone.removed.map { it.id })
        val back = t.update(listOf(at("A", 0f, 0f)), now = 600)
        assertEquals(listOf(2), back.tracked.map { it.id }, "a code that re-appears later gets a new id")
    }

    @Test
    fun `box overlap absorbs a misread`() {
        val t = BarcodeTracker()
        t.update(listOf(at("ABC", 100f, 100f)), now = 0)
        val u = t.update(listOf(at("ABD", 105f, 102f)), now = 30)
        assertEquals(1, u.tracked.single().id)
        assertEquals("ABD", u.tracked.single().data)
        assertTrue(u.added.isEmpty())
        // Far away: a new track, not a match.
        val v = t.update(listOf(at("XYZ", 900f, 900f)), now = 60)
        assertEquals(listOf(1, 2), v.tracked.map { it.id })
    }

    @Test
    fun `codes without a location match by data only`() {
        val t = BarcodeTracker()
        t.update(listOf(Barcode("A", Symbology.EAN13)), now = 0)
        val u = t.update(listOf(Barcode("A", Symbology.EAN13), Barcode("B", Symbology.EAN13)), now = 10)
        assertEquals(mapOf("A" to 1, "B" to 2), u.tracked.associate { it.data to it.id })
        t.reset()
        assertTrue(t.tracked.isEmpty())
        assertEquals(3, t.update(listOf(Barcode("A", Symbology.EAN13)), now = 20).tracked.single().id)
    }

    @Test
    fun `tracked barcode json`() {
        val t = BarcodeTracker()
        val tracked = t.update(listOf(at("A", 0f, 0f)), now = 7).tracked.single()
        val json = tracked.toJson()
        assertTrue(json.contains(""""data":"A","symbology":"qr""""))
        assertTrue(json.endsWith(""""id":1,"firstSeen":7,"lastSeen":7,"count":1}"""))
    }
}

class GeometryAndOptionsTest {
    @Test
    fun `fill center maps frame to view and back`() {
        val t = FrameTransform(480, 640, 1080, 2340)
        assertEquals(2340f / 640f, t.scale)
        val c = t.frameToView(Point(240f, 320f))
        assertEquals(540f, c.x, 0.01f)
        assertEquals(1170f, c.y, 0.01f)
        val back = t.viewToFrame(c)
        assertEquals(240f, back.x, 0.01f)
        assertEquals(320f, back.y, 0.01f)
        val visible = t.visibleFrameRegion
        assertTrue(visible.left > 0f && visible.right < 480f, "sides are cropped")
        assertEquals(0f, visible.top)
        assertEquals(640f, visible.bottom)
    }

    @Test
    fun `fit center letterboxes and mirroring flips x`() {
        val fit = FrameTransform(1280, 720, 1000, 1000, FrameTransform.ScaleType.FIT_CENTER)
        assertEquals(1000f / 1280f, fit.scale)
        assertEquals(0f, fit.offsetX)
        assertEquals((1000f - 720f * fit.scale) / 2f, fit.offsetY)
        val m = FrameTransform(100, 100, 100, 100, mirrored = true)
        assertEquals(Point(90f, 20f), m.frameToView(Point(10f, 20f)))
        assertEquals(Point(10f, 20f), m.viewToFrame(Point(90f, 20f)))
    }

    @Test
    fun `scan area maps from the view into the frame`() {
        val t = FrameTransform(720, 1280, 1080, 1920)
        val box = t.scanAreaToFrame(ScanArea.centered(0.5f, 0.25f))
        assertEquals(180f, box.left, 0.01f)
        assertEquals(540f, box.right, 0.01f)
        assertEquals(480f, box.top, 0.01f)
        assertEquals(800f, box.bottom, 0.01f)
    }

    @Test
    fun `rotation to upright`() {
        assertEquals(Point(480f, 0f), FrameTransform.rotateToUpright(Point(0f, 0f), 90, 640, 480))
        assertEquals(Point(640f, 480f), FrameTransform.rotateToUpright(Point(0f, 0f), 180, 640, 480))
        assertEquals(Point(0f, 640f), FrameTransform.rotateToUpright(Point(0f, 0f), 270, 640, 480))
        assertEquals(Size(480, 640), FrameTransform.uprightSize(640, 480, 90))
        assertEquals(Size(640, 480), FrameTransform.uprightSize(640, 480, 180))
    }

    @Test
    fun `quad helpers`() {
        val q = Quad.fromRect(0f, 0f, 10f, 10f)
        assertEquals(Point(5f, 5f), q.center)
        assertEquals(100f, q.area)
        assertEquals(0, q.orientation)
        assertEquals(1f, q.overlap(q))
        assertEquals(0f, q.overlap(Quad.fromRect(20f, 20f, 30f, 30f)))
        val rotated = Quad(Point(10f, 0f), Point(10f, 10f), Point(0f, 10f), Point(0f, 0f))
        assertEquals(90, rotated.orientation)
    }

    @Test
    fun `scanner option defaults follow SPEC section 4`() {
        val o = ScannerOptions()
        assertEquals(Symbology.ALL, o.symbologies)
        assertEquals(ScannerOptions.Mode.CONTINUOUS, o.mode)
        assertEquals(1000L, o.duplicateFilter)
        assertTrue(o.beep && o.vibrate && !o.torch)
        assertEquals(ScannerOptions.Camera.BACK, o.camera)
        assertEquals(ScannerOptions.Viewfinder.FRAME, o.resolvedViewfinder)
        assertEquals(1, o.resolvedMaxResults)
        assertTrue(o.scanArea.isFull)
        assertEquals(20, o.copy(mode = ScannerOptions.Mode.BATCH).resolvedMaxResults)
        assertEquals(ScannerOptions.Viewfinder.LINE, o.copy(symbologies = Symbology.resolve("retail")).resolvedViewfinder)
        assertEquals(ScannerOptions.Viewfinder.NONE, o.copy(viewfinder = ScannerOptions.Viewfinder.NONE).resolvedViewfinder)
    }

    @Test
    fun `scanner options from bridge maps`() {
        val o = ScannerOptions.fromMap(
            mapOf(
                "symbologies" to "qr,ean13", "mode" to "single", "beep" to "0", "vibrate" to false,
                "camera" to "front", "duplicateFilter" to -1, "maxResults" to "3",
                "scanArea" to mapOf("x" to 0.1, "y" to 0.2, "width" to 0.8, "height" to 0.5),
            ),
        )
        assertEquals(setOf(Symbology.QR, Symbology.EAN13), o.symbologies)
        assertEquals(ScannerOptions.Mode.SINGLE, o.mode)
        assertFalse(o.beep)
        assertFalse(o.vibrate)
        assertEquals(ScannerOptions.Camera.FRONT, o.camera)
        assertEquals(-1L, o.duplicateFilter)
        assertEquals(3, o.resolvedMaxResults)
        assertEquals(ScanArea(0.1f, 0.2f, 0.8f, 0.5f), o.scanArea)
        assertEquals("device-7", ScannerOptions.fromMap(mapOf("camera" to "device-7")).cameraId)
        val built = ScannerOptions.builder().symbologies("linear").mode(ScannerOptions.Mode.BATCH).torch(true).build()
        assertEquals(Symbology.LINEAR, built.symbologies)
        assertTrue(built.torch)
        assertTrue(o.toJson().startsWith("""{"symbologies":["qr","ean13"],"mode":"single""""))
    }

    @Test
    fun `barcode json matches SPEC section 2`() {
        val b = Barcode(
            data = "https://example.com",
            symbology = Symbology.QR,
            rawBytes = "https://example.com".toByteArray(),
            location = Quad(Point(10f, 10f), Point(90f, 10f), Point(90f, 90f), Point(10f, 90f)),
            frameSize = Size(1280, 720),
            ecLevel = "M",
            symbologyIdentifier = "]Q1",
            timestamp = 1735689600000,
        )
        assertEquals(
            """{"data":"https://example.com","symbology":"qr","symbologyName":"QR Code","rawBytes":"aHR0cHM6Ly9leGFtcGxlLmNvbQ==",""" +
                """"contentType":"text","isGS1":false,"location":{"topLeft":{"x":10,"y":10},"topRight":{"x":90,"y":10},""" +
                """"bottomRight":{"x":90,"y":90},"bottomLeft":{"x":10,"y":90}},"frameSize":{"width":1280,"height":720},""" +
                """"orientation":0,"ecLevel":"M","symbologyIdentifier":"]Q1","timestamp":1735689600000}""",
            b.toJson(),
        )
        assertEquals(b, b.copy())
        assertEquals(b.hashCode(), b.copy().hashCode())
        assertFalse(b == b.copy(rawBytes = ByteArray(0)))
        assertEquals("https://example.com", String(Base64Codec.decode(b.rawBytesBase64)))
        assertEquals("", Base64Codec.encode(ByteArray(0)))
        assertEquals("YQ==", Base64Codec.encode("a".toByteArray()))
        assertEquals("YWI=", Base64Codec.encode("ab".toByteArray()))
        assertEquals("""{"code":"camera-permission-denied","message":"no"}""", QRGenException(ErrorCode.CAMERA_PERMISSION_DENIED, "no").toJson())
    }

    @Test
    fun `calendar date helpers`() {
        assertEquals("2024-02-29", CalendarDate(2024, 2, 29).toString())
        assertEquals(null, CalendarDate.of(2023, 2, 29))
        assertEquals(35, CalendarDate(1990, 1, 31).yearsUntil(CalendarDate(2025, 6, 1)))
        assertEquals(CalendarDate(2025, 1, 2), CalendarDate.parse("2025-01-02"))
    }
}
