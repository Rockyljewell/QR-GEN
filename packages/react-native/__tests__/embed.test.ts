import { DEFAULT_EMBED_URL, buildCommandMessage, buildCommandScript, buildEmbedUrl, parseEmbedMessage } from '../src/embed';

const sample = {
  data: 'https://example.com',
  symbology: 'qr',
  symbologyName: 'QR Code',
  rawBytes: 'aHR0cHM6Ly9leGFtcGxlLmNvbQ==',
  contentType: 'text',
  isGS1: false,
  location: {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 90, y: 10 },
    bottomRight: { x: 90, y: 90 },
    bottomLeft: { x: 10, y: 90 },
  },
  frameSize: { width: 1280, height: 720 },
  orientation: 0,
  ecLevel: 'M',
  symbologyIdentifier: ']Q1',
  timestamp: 1735689600000,
};

describe('buildEmbedUrl', () => {
  it('uses the hosted page by default', () => {
    expect(DEFAULT_EMBED_URL).toBe('https://rockyljewell.github.io/QR-GEN/embed/');
    expect(buildEmbedUrl(undefined)).toBe(DEFAULT_EMBED_URL);
  });

  it('matches the SPEC example', () => {
    expect(
      buildEmbedUrl(undefined, { symbologies: ['qr', 'ean13'], mode: 'single', beep: true, vibrate: true, camera: 'back', viewfinder: 'frame' }),
    ).toBe('https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single&beep=1&vibrate=1&camera=back&viewfinder=frame');
  });

  it('writes every option', () => {
    const url = buildEmbedUrl('https://example.com/embed/', {
      duplicateFilter: -1,
      torch: false,
      scanArea: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 },
      maxResults: 20,
      beep: false,
    });
    expect(url).toBe('https://example.com/embed/?duplicateFilter=-1&beep=0&torch=0&scanArea=0.1,0.2,0.8,0.5&maxResults=20');
  });

  it('keeps an existing query string and hash, and encodes values', () => {
    expect(buildEmbedUrl('https://example.com/e/?lang=de#top', { mode: 'batch', camera: 'id with space' })).toBe(
      'https://example.com/e/?lang=de&mode=batch&camera=id%20with%20space#top',
    );
    expect(buildEmbedUrl('https://example.com/e/?', { mode: 'batch' })).toBe('https://example.com/e/?mode=batch');
  });

  it('skips empty symbology lists', () => {
    expect(buildEmbedUrl(undefined, { symbologies: [' ', ''] })).toBe(DEFAULT_EMBED_URL);
  });
});

describe('parseEmbedMessage', () => {
  it('parses ready', () => {
    expect(parseEmbedMessage('{"source":"qrgen","version":1,"type":"ready"}')).toEqual({ type: 'ready', version: 1 });
  });

  it('parses scan messages from a JSON string', () => {
    const msg = parseEmbedMessage(JSON.stringify({ source: 'qrgen', version: 1, type: 'scan', barcodes: [sample] }));
    expect(msg).toEqual({ type: 'scan', version: 1, barcodes: [sample] });
  });

  it('accepts objects and fills defaults', () => {
    const msg = parseEmbedMessage({ source: 'qrgen', type: 'scan', barcodes: [{ data: '123', symbology: 'EAN-13' }, { nope: true }] });
    expect(msg?.type).toBe('scan');
    if (msg?.type !== 'scan') throw new Error('expected scan');
    expect(msg.version).toBe(1);
    expect(msg.barcodes).toHaveLength(1);
    const b = msg.barcodes[0]!;
    expect(b.symbology).toBe('ean13');
    expect(b.symbologyName).toBe('EAN-13');
    expect(b.contentType).toBe('text');
    expect(b.rawBytes).toBe('');
    expect(b.location.topLeft).toEqual({ x: 0, y: 0 });
    expect(typeof b.timestamp).toBe('number');
  });

  it('parses track messages', () => {
    const msg = parseEmbedMessage({
      source: 'qrgen',
      version: 1,
      type: 'track',
      tracked: [{ ...sample, id: 7, firstSeen: 1, lastSeen: 2, count: 3 }, { ...sample, data: 'b' }],
    });
    if (msg?.type !== 'track') throw new Error('expected track');
    expect(msg.tracked[0]).toMatchObject({ id: '7', firstSeen: 1, lastSeen: 2, count: 3 });
    expect(msg.tracked[1]).toMatchObject({ id: 'qr:b', count: 1, firstSeen: sample.timestamp });
  });

  it('parses errors and normalizes unknown codes', () => {
    expect(parseEmbedMessage({ source: 'qrgen', version: 1, type: 'error', code: 'camera-permission-denied', message: 'Denied' })).toEqual({
      type: 'error',
      version: 1,
      error: { code: 'camera-permission-denied', message: 'Denied' },
    });
    const unknown = parseEmbedMessage({ source: 'qrgen', type: 'error', code: 'weird' });
    expect(unknown).toMatchObject({ type: 'error', error: { code: 'unknown' } });
  });

  it('ignores foreign, malformed and unknown messages', () => {
    expect(parseEmbedMessage('not json')).toBeNull();
    expect(parseEmbedMessage('{"source":"other","type":"scan"}')).toBeNull();
    expect(parseEmbedMessage({ source: 'qrgen-host', type: 'start' })).toBeNull();
    expect(parseEmbedMessage({ source: 'qrgen', type: 'something' })).toBeNull();
    expect(parseEmbedMessage({ source: 'qrgen' })).toBeNull();
    expect(parseEmbedMessage(null)).toBeNull();
    expect(parseEmbedMessage([1, 2])).toBeNull();
    expect(parseEmbedMessage('"qrgen"')).toBeNull();
  });

  it('tolerates a scan message without barcodes', () => {
    expect(parseEmbedMessage({ source: 'qrgen', type: 'scan' })).toEqual({ type: 'scan', version: 1, barcodes: [] });
  });
});

describe('commands', () => {
  it('builds the injectJavaScript snippet', () => {
    expect(buildCommandScript({ type: 'start' })).toBe('window.qrgen && window.qrgen.command({"type":"start"}); true;');
    expect(buildCommandScript({ type: 'torch', value: true })).toBe('window.qrgen && window.qrgen.command({"type":"torch","value":true}); true;');
  });

  it('builds the postMessage form', () => {
    expect(JSON.parse(buildCommandMessage({ type: 'pause' }))).toEqual({ source: 'qrgen-host', type: 'pause' });
  });
});
