// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
package dev.qrgen.abi

import dev.qrgen.Barcode
import dev.qrgen.BarcodeTracker
import dev.qrgen.DuplicateFilter
import dev.qrgen.Symbology
import java.io.File
import kotlin.reflect.KFunction

fun main() {
    val loaded = File(DuplicateFilter::class.java.protectionDomain.codeSource.location.toURI())
    check(loaded.canonicalPath == File(System.getProperty("qrgen.expectedCore")).canonicalPath)
    val code = Barcode("legacy-kotlin", Symbology.QR, timestamp = 1_800_000_000_000)
    val filter = DuplicateFilter(windowMs = 1000)
    check(filter.accept(code, now = -1000))
    check(!filter.accept(code, now = -1))
    check(filter.accept(code, now = 0))
    check(DuplicateFilter().accept(code)) // Old compiler-generated $default bridge.
    check(DuplicateFilter().accept(Symbology.QR, "pair"))
    check(DuplicateFilter().filter(listOf(code)).size == 1)
    val adapted: (Barcode) -> Boolean = DuplicateFilter()::accept
    check(adapted(code))
    val bound: (Barcode, Long) -> Boolean = DuplicateFilter()::accept
    check(bound(code, 0))
    val unbound: (DuplicateFilter, Barcode, Long) -> Boolean = DuplicateFilter::accept
    check(unbound(DuplicateFilter(), code, 0))
    val reference: (Barcode, Long) -> Boolean = DuplicateFilter()::accept
    @Suppress("UNCHECKED_CAST")
    val reflected = reference as KFunction<Boolean>
    check(reflected.parameters.single { it.name == "now" }.isOptional)
    check(reflected.callBy(mapOf(reflected.parameters.single { it.name == "barcode" } to code)))
    val tracker = BarcodeTracker(maxAgeMs = 500) // Old partial/default-mask constructor.
    val first = tracker.update(listOf(code), now = 0).tracked.single()
    check(tracker.update(emptyList(), now = 500).tracked.single() == first)
    check(tracker.update(emptyList(), now = 501).removed.single() == first)
    check(first.firstSeen == 0L && first.lastSeen == 0L && first.barcode.timestamp == code.timestamp)
    check(BarcodeTracker().update(listOf(code)).tracked.size == 1)
    val adaptedUpdate: (List<Barcode>) -> BarcodeTracker.Update = BarcodeTracker()::update
    check(adaptedUpdate(listOf(code)).tracked.size == 1)
    println("CLOCK_ABI_CLIENT kotlin passed; loaded=$loaded")
}