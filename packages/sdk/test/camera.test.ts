// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Camera } from "../src/camera";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function stream() {
  const track = { stop: vi.fn(), getSettings: () => ({}), getCapabilities: () => ({}) };
  return { track, media: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}

function video(ready = true) {
  return Object.assign(new EventTarget(), {
    readyState: ready ? 1 : 0, videoWidth: ready ? 640 : 0,
    srcObject: null, setAttribute: vi.fn(), play: vi.fn().mockResolvedValue(undefined),
  }) as unknown as HTMLVideoElement;
}

describe("Camera lifecycle", () => {
  const getUserMedia = vi.fn();
  beforeEach(() => {
    getUserMedia.mockReset();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("releases permission granted after stop", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);
    const camera = new Camera();
    const target = video();
    const starting = camera.start(target);
    camera.stop();
    const late = stream();
    pending.resolve(late.media);
    await starting;
    expect(late.track.stop).toHaveBeenCalledOnce();
    expect(camera.stream).toBeNull();
    expect(target.srcObject).toBeNull();
    expect(target.play).not.toHaveBeenCalled();
  });

  it("keeps only the newest concurrent start", async () => {
    const pending = deferred<MediaStream>();
    const old = stream();
    const current = stream();
    getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current.media);
    const camera = new Camera();
    const target = video();
    const first = camera.start(target);
    await camera.start(target);
    pending.resolve(old.media);
    await first;
    expect(camera.stream).toBe(current.media);
    expect(target.srcObject).toBe(current.media);
    expect(old.track.stop).toHaveBeenCalledOnce();
    expect(current.track.stop).not.toHaveBeenCalled();
    camera.stop();
  });

  it("settles startup when stopped before metadata arrives", async () => {
    const current = stream();
    getUserMedia.mockResolvedValue(current.media);
    const camera = new Camera();
    let settled = false;
    const starting = camera.start(video(false)).then(() => { settled = true; });
    await vi.waitFor(() => expect(camera.stream).toBe(current.media));
    camera.stop();
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });
    await starting;
    expect(current.track.stop).toHaveBeenCalledOnce();
  });

  it("releases the stream after playback fails", async () => {
    const current = stream();
    getUserMedia.mockResolvedValue(current.media);
    const camera = new Camera();
    const target = video();
    vi.mocked(target.play).mockRejectedValue(new Error("play failed"));
    await expect(camera.start(target)).rejects.toMatchObject({ message: "play failed" });
    expect(current.track.stop).toHaveBeenCalledOnce();
    expect(camera.stream).toBeNull();
    expect(target.srcObject).toBeNull();
  });

  it("times out and cleans up if metadata never arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const current = stream();
      getUserMedia.mockResolvedValue(current.media);
      const camera = new Camera();
      const target = video(false);
      const checked = expect(camera.start(target)).rejects.toMatchObject({ code: "camera-in-use" });
      await vi.advanceTimersByTimeAsync(20000);
      await checked;
      expect(current.track.stop).toHaveBeenCalledOnce();
      expect(target.srcObject).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reopen the camera if stopped during device enumeration", async () => {
    const current = stream();
    getUserMedia.mockResolvedValue(current.media);
    const pending = deferred<MediaDeviceInfo[]>();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: () => pending.promise } });
    const camera = new Camera();
    await camera.start(video());
    const switching = camera.switch();
    camera.stop();
    pending.resolve([]);
    await switching;
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(camera.stream).toBeNull();
  });
});
