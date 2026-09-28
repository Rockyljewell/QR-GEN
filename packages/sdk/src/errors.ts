// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import type { QRGenErrorCode } from "./types.js";

export class QRGenError extends Error {
  readonly code: QRGenErrorCode;
  override readonly cause?: unknown;

  constructor(code: QRGenErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "QRGenError";
    this.code = code;
    this.cause = cause;
  }

  toJSON(): { code: QRGenErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/** Convert getUserMedia and other DOM errors to a QRGenError. */
export function toQRGenError(err: unknown): QRGenError {
  if (err instanceof QRGenError) return err;
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = (err as { message?: string } | null)?.message ?? String(err);
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new QRGenError("camera-permission-denied", "Camera permission was denied. Allow camera access in your browser or app settings and try again.", err);
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return new QRGenError("camera-not-found", "No matching camera was found on this device.", err);
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new QRGenError("camera-in-use", "The camera is in use by another application or could not be started.", err);
    default:
      return new QRGenError("unknown", message || "Unknown error", err);
  }
}
