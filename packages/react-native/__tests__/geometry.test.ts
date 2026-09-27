import { createBarcode, normalizeBarcode, quadrilateralBounds, quadrilateralFromRect } from '../src/barcode';
import { withAlpha } from '../src/color';
import { createQRGenError, isQRGenErrorCode, mapVisionCameraErrorCode, toQRGenError } from '../src/errors';
import {
  applyTransform,
  defaultViewfinderRect,
  frameToViewTransform,
  needsSwap,
  orderQuadrilateral,
  quadrilateralToView,
  uprightFrameSize,
  viewRectToFrame,
} from '../src/geometry';
import { resolveSymbologies } from '../src/symbologies';
import { convertVisionCameraCodes, selectBarcodes } from '../src/visionCameraAdapter';

describe('frame to view mapping', () => {
  it('swaps landscape sensor frames for portrait views', () => {
    expect(needsSwap({ width: 1920, height: 1080 }, { width: 390, height: 844 })).toBe(true);
    expect(needsSwap({ width: 1080, height: 1920 }, { width: 390, height: 844 })).toBe(false);
    expect(needsSwap({ width: 1920, height: 1080 }, { width: 844, height: 390 })).toBe(false);
    expect(needsSwap({ width: 1920, height: 1080 }, null)).toBe(false);
    expect(uprightFrameSize({ width: 1920, height: 1080 }, { width: 390, height: 844 })).toEqual({ width: 1080, height: 1920 });
  });

  it('handles the aspect-fill crop (cover)', () => {
    // 1080x1920 frame (9:16) into a 390x844 view (taller than 9:16): scale by height, crop the sides.
    const t = frameToViewTransform({ width: 1080, height: 1920 }, { width: 390, height: 844 });
    expect(t.scale).toBeCloseTo(844 / 1920);
    const displayedWidth = 1080 * t.scale;
    expect(t.offsetX).toBeCloseTo((390 - displayedWidth) / 2);
    expect(t.offsetY).toBeCloseTo(0);
    // The frame center maps to the view center.
    const c = applyTransform({ x: 540, y: 960 }, t);
    expect(c.x).toBeCloseTo(195);
    expect(c.y).toBeCloseTo(422);
    // The frame's left edge is outside the view (cropped).
    expect(applyTransform({ x: 0, y: 0 }, t).x).toBeLessThan(0);
  });

  it('handles contain (letterbox)', () => {
    const t = frameToViewTransform({ width: 1000, height: 1000 }, { width: 400, height: 800 }, { resizeMode: 'contain' });
    expect(t.scale).toBeCloseTo(0.4);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo(200);
  });

  it('mirrors for the front camera and keeps corner roles', () => {
    const t = frameToViewTransform({ width: 100, height: 100 }, { width: 100, height: 100 }, { mirrored: true });
    const q = quadrilateralToView(quadrilateralFromRect({ x: 10, y: 20, width: 30, height: 40 }), t);
    expect(q.topLeft).toEqual({ x: 60, y: 20 });
    expect(q.topRight).toEqual({ x: 90, y: 20 });
    expect(quadrilateralBounds(q)).toEqual({ x: 60, y: 20, width: 30, height: 40 });
  });

  it('inverts view rectangles back to frame pixels', () => {
    const t = frameToViewTransform({ width: 1080, height: 1920 }, { width: 390, height: 844 });
    const frameRect = { x: 100, y: 200, width: 300, height: 400 };
    const q = quadrilateralToView(quadrilateralFromRect(frameRect), t);
    const back = viewRectToFrame(quadrilateralBounds(q), t);
    expect(back.x).toBeCloseTo(100);
    expect(back.y).toBeCloseTo(200);
    expect(back.width).toBeCloseTo(300);
    expect(back.height).toBeCloseTo(400);
  });

  it('orders corner points clockwise from the top-left', () => {
    const q = orderQuadrilateral([
      { x: 90, y: 90 },
      { x: 10, y: 10 },
      { x: 10, y: 90 },
      { x: 90, y: 10 },
    ]);
    expect(q).toEqual({ topLeft: { x: 10, y: 10 }, topRight: { x: 90, y: 10 }, bottomRight: { x: 90, y: 90 }, bottomLeft: { x: 10, y: 90 } });
    expect(orderQuadrilateral([{ x: 5, y: 7 }, { x: 1, y: 2 }])).toEqual({
      topLeft: { x: 1, y: 2 }, topRight: { x: 5, y: 2 }, bottomRight: { x: 5, y: 7 }, bottomLeft: { x: 1, y: 7 },
    });
  });

  it('computes default viewfinder rectangles', () => {
    const frame = defaultViewfinderRect({ width: 400, height: 800 }, 'frame');
    expect(frame.width).toBeCloseTo(272);
    expect(frame.width).toBe(frame.height);
    expect(frame.x + frame.width / 2).toBeCloseTo(200);
    const line = defaultViewfinderRect({ width: 400, height: 800 }, 'line');
    expect(line.width).toBeGreaterThan(line.height);
  });
});

describe('convertVisionCameraCodes', () => {
  const requested = resolveSymbologies(['all']);

  it('converts Android (ML Kit) codes: upright coordinates, swapped frame size', () => {
    const [b] = convertVisionCameraCodes(
      [{ type: 'qr', value: 'hello', frame: { x: 100, y: 200, width: 50, height: 60 }, corners: [{ x: 150, y: 200 }, { x: 150, y: 260 }, { x: 100, y: 260 }, { x: 100, y: 200 }] }],
      { width: 1280, height: 720 },
      { requested, platform: { os: 'android' }, viewSize: { width: 390, height: 844 }, timestamp: 42 },
    );
    expect(b).toMatchObject({
      data: 'hello',
      symbology: 'qr',
      symbologyName: 'QR Code',
      rawBytes: '',
      contentType: 'text',
      isGS1: false,
      frameSize: { width: 720, height: 1280 },
      orientation: 0,
      ecLevel: '',
      symbologyIdentifier: '',
      timestamp: 42,
    });
    expect(b!.location).toEqual({ topLeft: { x: 100, y: 200 }, topRight: { x: 150, y: 200 }, bottomRight: { x: 150, y: 260 }, bottomLeft: { x: 100, y: 260 } });
  });

  it('converts iOS (AVFoundation) codes: normalized by the landscape frame, scaled to upright', () => {
    // vision-camera iOS multiplies normalized coordinates by the landscape video dimensions.
    const [b] = convertVisionCameraCodes(
      [{ type: 'ean-13', value: '4006381333931', frame: { x: 0.25 * 1920, y: 0.5 * 1080, width: 0.5 * 1920, height: 0.1 * 1080 } }],
      { width: 1920, height: 1080 },
      { requested, platform: { os: 'ios', version: '17.4' }, viewSize: { width: 390, height: 844 }, timestamp: 1 },
    );
    expect(b!.symbology).toBe('ean13');
    expect(b!.frameSize).toEqual({ width: 1080, height: 1920 });
    expect(b!.location.topLeft.x).toBeCloseTo(0.25 * 1080);
    expect(b!.location.topLeft.y).toBeCloseTo(0.5 * 1920);
    expect(b!.location.bottomRight.x).toBeCloseTo(0.75 * 1080);
    expect(b!.location.bottomRight.y).toBeCloseTo(0.6 * 1920);
  });

  it('drops codes without value, of unknown type or not requested, and refines UPC-A', () => {
    const list = convertVisionCameraCodes(
      [
        { type: 'qr' },
        { type: 'qr', value: '' },
        { type: 'unknown', value: 'x' },
        { type: 'code-128', value: 'abc' },
        { type: 'ean-13', value: '0036000291452' },
      ],
      { width: 100, height: 100 },
      { requested: resolveSymbologies(['upca', 'qr']), platform: { os: 'ios' } },
    );
    expect(list.map((b) => [b.symbology, b.data])).toEqual([['upca', '036000291452']]);
  });

  it('presents DataBar in GS1 HRI form', () => {
    const [b] = convertVisionCameraCodes([{ type: 'gs1-data-bar', value: '0100012345678905' }], { width: 10, height: 10 }, { requested, platform: { os: 'ios' } });
    expect(b).toMatchObject({ data: '(01)00012345678905', contentType: 'gs1', isGS1: true, symbology: 'databar' });
  });
});

describe('selectBarcodes', () => {
  const at = (data: string, x: number, y: number) =>
    createBarcode({ data, symbology: 'qr', frameSize: { width: 100, height: 100 }, location: quadrilateralFromRect({ x: x - 1, y: y - 1, width: 2, height: 2 }) });

  it('keeps the codes closest to the center, in original order', () => {
    const list = [at('corner', 5, 5), at('center', 50, 50), at('near', 60, 55)];
    expect(selectBarcodes(list, { maxResults: 1 }).map((b) => b.data)).toEqual(['center']);
    expect(selectBarcodes(list, { maxResults: 2 }).map((b) => b.data)).toEqual(['center', 'near']);
    expect(selectBarcodes(list, {}).map((b) => b.data)).toEqual(['corner', 'center', 'near']);
  });

  it('filters by scan area', () => {
    const list = [at('left', 10, 50), at('right', 90, 50)];
    expect(selectBarcodes(list, { scanArea: { x: 0.5, y: 0, width: 0.5, height: 1 } }).map((b) => b.data)).toEqual(['right']);
  });
});

describe('barcode helpers', () => {
  it('fills defaults', () => {
    const b = createBarcode({ data: 'x', symbology: 'code128', timestamp: 5 });
    expect(b).toMatchObject({ symbologyName: 'Code 128', rawBytes: '', contentType: 'text', isGS1: false, orientation: 0, timestamp: 5 });
  });

  it('normalizes JSON and rejects invalid input', () => {
    expect(normalizeBarcode({ data: 'x' })).toBeNull();
    expect(normalizeBarcode({ symbology: 'qr' })).toBeNull();
    expect(normalizeBarcode('x')).toBeNull();
    expect(normalizeBarcode({ data: 'x', symbology: 'future-code', contentType: 'weird' })).toMatchObject({ symbology: 'future-code', contentType: 'text' });
    expect(normalizeBarcode({ data: 'x', symbology: 'qr', contentType: 'gs1' })).toMatchObject({ isGS1: true });
  });
});

describe('errors', () => {
  it('maps vision-camera error codes', () => {
    expect(mapVisionCameraErrorCode('permission/camera-permission-denied')).toBe('camera-permission-denied');
    expect(mapVisionCameraErrorCode('device/no-device')).toBe('camera-not-found');
    expect(mapVisionCameraErrorCode('device/camera-already-in-use')).toBe('camera-in-use');
    expect(mapVisionCameraErrorCode('code-scanner/code-type-not-supported')).toBe('unsupported');
    expect(mapVisionCameraErrorCode('code-scanner/cannot-load-model')).toBe('engine-load-failed');
    expect(mapVisionCameraErrorCode('capture/unknown')).toBe('unknown');
    expect(mapVisionCameraErrorCode(undefined)).toBe('unknown');
  });

  it('converts thrown values', () => {
    expect(toQRGenError({ code: 'device/no-device', message: 'none' })).toEqual({ code: 'camera-not-found', message: 'none' });
    expect(toQRGenError({ code: 'camera-in-use', message: 'busy' })).toEqual({ code: 'camera-in-use', message: 'busy' });
    expect(toQRGenError(new Error('boom'), 'engine-load-failed')).toEqual({ code: 'engine-load-failed', message: 'boom' });
    expect(toQRGenError('text').code).toBe('unknown');
    expect(createQRGenError('nope').code).toBe('unknown');
    expect(createQRGenError('unsupported').message.length).toBeGreaterThan(0);
    expect(isQRGenErrorCode('insecure-context')).toBe(true);
  });
});

describe('withAlpha', () => {
  it('converts hex colors', () => {
    expect(withAlpha('#2EC1CE', 0.2)).toBe('rgba(46, 193, 206, 0.2)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });
});
