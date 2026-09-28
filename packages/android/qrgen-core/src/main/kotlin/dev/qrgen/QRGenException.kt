// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

/** Error codes shared by every QRGen platform (SPEC §4). */
public enum class ErrorCode(public val id: String) {
    CAMERA_PERMISSION_DENIED("camera-permission-denied"),
    CAMERA_NOT_FOUND("camera-not-found"),
    CAMERA_IN_USE("camera-in-use"),
    INSECURE_CONTEXT("insecure-context"),
    ENGINE_LOAD_FAILED("engine-load-failed"),
    UNSUPPORTED("unsupported"),
    UNKNOWN("unknown"),
    ;

    override fun toString(): String = id

    public companion object {
        @JvmStatic
        public fun fromId(id: String): ErrorCode = entries.firstOrNull { it.id == id } ?: UNKNOWN
    }
}

/**
 * An error with a SPEC error [code]. Delivered to `onError` listeners and thrown by APIs
 * such as [Generator.generate] for unsupported symbologies.
 */
public open class QRGenException @JvmOverloads constructor(
    public val code: ErrorCode,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause) {
    /** The SPEC `error` event payload: `{ "code": ..., "message": ... }`. */
    public fun toMap(): Map<String, Any?> = linkedMapOf("code" to code.id, "message" to (message ?: ""))

    public fun toJson(): String = Json.stringify(toMap())

    override fun toString(): String = "QRGenException(${code.id}): $message"
}

/** Thrown when a symbology is not supported by the requested operation on this platform. */
public class UnsupportedSymbologyException(
    public val symbology: Symbology,
    operation: String,
) : QRGenException(
    ErrorCode.UNSUPPORTED,
    "Symbology '${symbology.id}' is not supported for $operation on this platform",
)
