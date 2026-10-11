// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

/**
 * Serializes a source change with frame-state mutations. A frame keeps the generation of the
 * analyzer that accepted it, including while its result waits for delivery on another thread.
 * Resetting state and advancing the generation must be one operation: a check followed by an
 * unlocked tracker update could otherwise restore old-source tracks after the reset.
 */
internal class SourceSession {
    private val lock = Any()
    private var generation = 0L
    private var publishedTracks = false

    fun capture(): Long = synchronized(lock) { generation }

    fun isCurrent(source: Long): Boolean = synchronized(lock) { source == generation }

    fun advance(reset: () -> Unit): Long = synchronized(lock) {
        generation++
        reset()
        generation
    }

    fun runIfCurrent(source: Long, action: () -> Unit): Boolean = synchronized(lock) {
        if (source != generation) return@synchronized false
        action()
        true
    }

    /** Record delivery before calling user code, which can synchronously stop or rebind. */
    fun recordTrackDelivery(source: Long, hasTracks: Boolean): Boolean = runIfCurrent(source) {
        publishedTracks = hasTracks
    }

    fun hasPublishedTracks(): Boolean = synchronized(lock) { publishedTracks }

    /**
     * Consume a pending clear before invoking its listener. Repeated invalidations retain the
     * pending clear, but a listener that stops in response cannot trigger another clear event.
     */
    fun takeTrackClear(source: Long): Boolean = synchronized(lock) {
        if (source != generation || !publishedTracks) return@synchronized false
        publishedTracks = false
        true
    }
}
