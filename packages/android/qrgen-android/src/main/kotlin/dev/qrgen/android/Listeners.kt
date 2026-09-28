// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.QRGenException
import dev.qrgen.TrackedBarcode

/** Receives newly scanned codes (SPEC `scan` event). Called on the main thread. */
public fun interface OnScanListener {
    public fun onScan(barcodes: List<Barcode>)
}

/** Receives every live track in batch mode, once per analysed frame (SPEC `track` event). Main thread. */
public fun interface OnTrackListener {
    public fun onTrack(tracked: List<TrackedBarcode>)
}

/** Receives errors with a SPEC error code (SPEC `error` event). Main thread. */
public fun interface OnErrorListener {
    public fun onError(error: QRGenException)
}

/** Called when the camera is bound and frames are being analysed (SPEC `ready` event). Main thread. */
public fun interface OnReadyListener {
    public fun onReady()
}

/** Result callback for [QRGen.scanImageAsync]. Exactly one of the arguments is non-null. Main thread. */
public fun interface ImageScanCallback {
    public fun onResult(barcodes: List<Barcode>?, error: QRGenException?)
}
