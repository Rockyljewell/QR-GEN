// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { QRGenError, toQRGenError } from "./errors.js";
import type { CameraFacing } from "./types.js";

export type Resolution = "sd" | "hd" | "fhd" | "4k";

const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
  sd: { width: 640, height: 480 },
  hd: { width: 1280, height: 720 },
  fhd: { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
};

export interface CameraOptions {
  /** "back" (default), "front" or a MediaDeviceInfo.deviceId. */
  camera?: CameraFacing | (string & {});
  resolution?: Resolution;
}

export interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
  focusMode: string[];
}

type ExtendedCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
  focusMode?: string[];
};

/** Thin wrapper around getUserMedia with torch, zoom and camera switching. */
export class Camera {
  stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private facing: CameraFacing;
  private deviceId: string | undefined;
  private torchOn = false;
  private startToken = 0;
  private cancelMetadata: (() => void) | null = null;
  readonly resolution: Resolution;

  constructor(options: CameraOptions = {}) {
    const cam = options.camera ?? "back";
    this.facing = cam === "front" ? "front" : "back";
    this.deviceId = cam !== "front" && cam !== "back" ? cam : undefined;
    this.resolution = options.resolution ?? "hd";
  }

  /** Whether camera access is possible in this context at all. */
  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  /** List cameras. Labels are only filled in after permission was granted. */
  static async list(): Promise<MediaDeviceInfo[]> {
    if (!Camera.isSupported()) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  get isFront(): boolean {
    const s = this.track?.getSettings();
    if (s?.facingMode) return s.facingMode === "user";
    return this.facing === "front";
  }

  get isTorchOn(): boolean {
    return this.torchOn;
  }

  get videoSize(): { width: number; height: number } {
    return { width: this.video?.videoWidth ?? 0, height: this.video?.videoHeight ?? 0 };
  }

  get capabilities(): CameraCapabilities {
    const track = this.track;
    const caps = (track && typeof track.getCapabilities === "function" ? track.getCapabilities() : {}) as ExtendedCapabilities;
    return { torch: !!caps.torch, zoom: caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null, focusMode: caps.focusMode ?? [] };
  }

  private constraints(): MediaStreamConstraints {
    const res = RESOLUTIONS[this.resolution];
    const video: MediaTrackConstraints & { focusMode?: string } = {
      width: { ideal: res.width },
      height: { ideal: res.height },
      frameRate: { ideal: 30 },
    };
    if (this.deviceId) video.deviceId = { exact: this.deviceId };
    else video.facingMode = { ideal: this.facing === "front" ? "user" : "environment" };
    return { audio: false, video };
  }

  /** Open the camera and play it into `video`. */
  async start(video: HTMLVideoElement): Promise<void> {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      throw new QRGenError("insecure-context", "Camera access needs HTTPS (or http://localhost). Serve the page over a secure context.");
    }
    if (!Camera.isSupported()) throw new QRGenError("unsupported", "This browser does not support camera access (getUserMedia).");
    this.stop();
    const token = this.startToken;
    this.video = video;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(this.constraints());
      } catch (err) {
        if (token !== this.startToken) return;
        const e = toQRGenError(err);
        // A pinned device may have disappeared; retry with facing mode only.
        if (e.code !== "camera-not-found" || !this.deviceId) throw e;
        this.deviceId = undefined;
        stream = await navigator.mediaDevices.getUserMedia(this.constraints());
      }
      // Permission prompts cannot be aborted: dispose a late stream locally so it
      // cannot replace (or stop) a newer camera session.
      if (token !== this.startToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 1 && video.videoWidth) return resolve();
        const done = (err?: QRGenError) => {
          clearTimeout(timer);
          video.removeEventListener("loadedmetadata", loaded);
          video.removeEventListener("error", failed);
          if (this.cancelMetadata === cancel) this.cancelMetadata = null;
          if (err) reject(err);
          else resolve();
        };
        const loaded = () => done();
        const failed = () => done(new QRGenError("camera-in-use", "The camera video could not be loaded."));
        const cancel = () => done();
        const timer = setTimeout(() => done(new QRGenError("camera-in-use", "Timed out waiting for camera video.")), 20000);
        this.cancelMetadata = cancel;
        video.addEventListener("loadedmetadata", loaded);
        video.addEventListener("error", failed);
      });
      if (token !== this.startToken) return;
      await video.play();
      if (token !== this.startToken) return;
      await this.applyFocus();
      if (token === this.startToken) this.torchOn = false;
    } catch (err) {
      if (token !== this.startToken) return;
      this.stop();
      throw toQRGenError(err);
    }
  }

  private async applyFocus(): Promise<void> {
    const track = this.track;
    if (!track || !this.capabilities.focusMode.includes("continuous")) return;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
    } catch {
      // not supported
    }
  }

  stop(): void {
    this.startToken++;
    this.cancelMetadata?.();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.torchOn = false;
  }

  async setTorch(on: boolean): Promise<boolean> {
    const track = this.track;
    if (!track || !this.capabilities.torch) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      if (track !== this.track) return false;
      this.torchOn = on;
      return true;
    } catch {
      return false;
    }
  }

  async setZoom(zoom: number): Promise<boolean> {
    const track = this.track;
    const z = this.capabilities.zoom;
    if (!track || !z) return false;
    const value = Math.min(z.max, Math.max(z.min, zoom));
    try {
      await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  /** Switch between front and back cameras (or cycle through devices). */
  async switch(): Promise<void> {
    const video = this.video;
    const token = this.startToken;
    if (!video || !this.stream) return;
    const cams = await Camera.list();
    if (token !== this.startToken) return;
    const current = this.track?.getSettings().deviceId;
    if (cams.length > 2 && current) {
      const idx = cams.findIndex((c) => c.deviceId === current);
      this.deviceId = cams[(idx + 1) % cams.length]!.deviceId;
    } else {
      this.deviceId = undefined;
      this.facing = this.isFront ? "back" : "front";
    }
    await this.start(video);
  }
}
