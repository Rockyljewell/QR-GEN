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
    this.video = video;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(this.constraints());
    } catch (err) {
      const e = toQRGenError(err);
      // A pinned device may have disappeared; retry with facing mode only.
      if (e.code === "camera-not-found" && this.deviceId) {
        this.deviceId = undefined;
        this.stream = await navigator.mediaDevices.getUserMedia(this.constraints()).catch((e2) => {
          throw toQRGenError(e2);
        });
      } else {
        throw e;
      }
    }
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1 && video.videoWidth) return resolve();
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    try {
      await video.play();
    } catch (err) {
      // Autoplay of a muted inline video should always be allowed; surface anything else.
      if ((err as { name?: string }).name !== "AbortError") throw toQRGenError(err);
    }
    await this.applyFocus();
    this.torchOn = false;
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
    if (!this.video) return;
    const cams = await Camera.list();
    const current = this.track?.getSettings().deviceId;
    if (cams.length > 2 && current) {
      const idx = cams.findIndex((c) => c.deviceId === current);
      this.deviceId = cams[(idx + 1) % cams.length]!.deviceId;
    } else {
      this.deviceId = undefined;
      this.facing = this.isFront ? "back" : "front";
    }
    await this.start(this.video);
  }
}
