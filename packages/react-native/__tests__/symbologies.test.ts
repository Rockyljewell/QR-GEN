import {
  SYMBOLOGIES,
  SYMBOLOGY_GROUPS,
  SYMBOLOGY_IDS,
  fromVisionCameraCode,
  getSymbologyInfo,
  isLinearOnly,
  isSymbologyId,
  normalizeSymbologyKey,
  resolveSymbologies,
  resolveSymbology,
  resolveSymbologyGroup,
  symbologyName,
  toVisionCameraCodeTypes,
  visionCameraSupportedSymbologies,
} from '../src/symbologies';

describe('symbology table', () => {
  it('has the 26 SPEC ids in order', () => {
    expect(SYMBOLOGY_IDS).toEqual([
      'qr', 'micro-qr', 'rmqr', 'data-matrix', 'aztec', 'pdf417', 'micro-pdf417', 'maxicode',
      'ean13', 'ean8', 'upca', 'upce', 'isbn', 'code128', 'code39', 'code93', 'codabar', 'itf',
      'itf14', 'databar', 'databar-expanded', 'databar-limited', 'code32', 'pzn', 'telepen', 'dx-film-edge',
    ]);
  });

  it('has no alias collisions', () => {
    const keys = new Map<string, string>();
    for (const s of SYMBOLOGIES) {
      for (const k of [s.id, ...s.aliases].map(normalizeSymbologyKey)) {
        const owner = keys.get(k);
        if (owner) expect(owner).toBe(s.id);
        keys.set(k, s.id);
      }
    }
  });

  it('exposes names', () => {
    expect(getSymbologyInfo('qr').name).toBe('QR Code');
    expect(symbologyName('ean-13')).toBe('EAN-13');
    expect(symbologyName('itf')).toBe('Interleaved 2 of 5');
    expect(symbologyName('nope')).toBe('nope');
    expect(() => getSymbologyInfo('nope' as never)).toThrow(TypeError);
    expect(isSymbologyId('pdf417')).toBe(true);
    expect(isSymbologyId('pdf-417')).toBe(false);
  });
});

describe('resolveSymbology', () => {
  it.each([
    ['QRCode', 'qr'],
    ['qr-code', 'qr'],
    ['QR', 'qr'],
    ['qr', 'qr'],
    ['DataMatrix', 'data-matrix'],
    ['dm', 'data-matrix'],
    ['EAN', 'ean13'],
    ['jan', 'ean13'],
    ['GTIN-13', 'ean13'],
    ['ean-13', 'ean13'],
    ['UPC', 'upca'],
    ['upc-a', 'upca'],
    ['GS1-128', 'code128'],
    ['code-128', 'code128'],
    ['Code 3 of 9', 'code39'],
    ['NW-7', 'codabar'],
    ['I2of5', 'itf'],
    ['ITF-14', 'itf14'],
    ['RSS-14', 'databar'],
    ['RSS Expanded', 'databar-expanded'],
    ['pdf-417', 'pdf417'],
    ['Compact PDF417', 'pdf417'],
    ['MicroPDF417', 'micro-pdf417'],
    ['ISBN-13', 'isbn'],
    ['DX Film Edge', 'dx-film-edge'],
  ])('%s -> %s', (input, id) => {
    expect(resolveSymbology(input)).toBe(id);
  });

  it('returns null for unknown input and groups', () => {
    expect(resolveSymbology('foo')).toBeNull();
    expect(resolveSymbology('all')).toBeNull();
    expect(resolveSymbology('')).toBeNull();
  });

  it('resolves groups case-insensitively', () => {
    expect(resolveSymbologyGroup('1D')).toBe('1d');
    expect(resolveSymbologyGroup('Retail')).toBe('retail');
    expect(resolveSymbologyGroup('qr')).toBeNull();
  });
});

describe('resolveSymbologies', () => {
  it('defaults to all', () => {
    expect(resolveSymbologies()).toEqual([...SYMBOLOGY_IDS]);
    expect(resolveSymbologies(null)).toEqual([...SYMBOLOGY_IDS]);
    expect(resolveSymbologies([])).toEqual([...SYMBOLOGY_IDS]);
    expect(resolveSymbologies('')).toEqual([...SYMBOLOGY_IDS]);
  });

  it('expands groups and de-duplicates in order of first appearance', () => {
    expect(resolveSymbologies(['QR', 'retail', 'ean'])).toEqual([
      'qr', 'ean13', 'ean8', 'upca', 'upce', 'isbn', 'databar', 'databar-expanded', 'databar-limited',
    ]);
    expect(resolveSymbologies(['2d'])).toEqual([...SYMBOLOGY_GROUPS.matrix]);
    expect(resolveSymbologies(['industrial'])).toEqual(['code128', 'code39', 'code93', 'codabar', 'itf', 'itf14', 'data-matrix']);
    expect(resolveSymbologies(['gs1'])).toEqual(['code128', 'data-matrix', 'qr', 'databar', 'databar-expanded', 'databar-limited']);
  });

  it('accepts a comma separated string', () => {
    expect(resolveSymbologies('qr, ean-13,pdf417')).toEqual(['qr', 'ean13', 'pdf417']);
  });

  it('drops unknown ids silently', () => {
    expect(resolveSymbologies(['qr', 'nope', 42 as unknown as string])).toEqual(['qr']);
    expect(resolveSymbologies(['nope'])).toEqual([]);
  });

  it('detects linear-only sets', () => {
    expect(isLinearOnly(resolveSymbologies(['1d']))).toBe(true);
    expect(isLinearOnly(resolveSymbologies(['ean13', 'qr']))).toBe(false);
    expect(isLinearOnly([])).toBe(false);
  });

  it('linear and matrix groups partition all', () => {
    const union = new Set([...SYMBOLOGY_GROUPS.linear, ...SYMBOLOGY_GROUPS.matrix]);
    expect(union.size).toBe(SYMBOLOGY_IDS.length);
  });
});

describe('vision-camera mapping', () => {
  const ios = { os: 'ios', version: '17.4' };
  const oldIos = { os: 'ios', version: '15.1' };
  const android = { os: 'android', version: 34 };

  it('maps ids to code types on iOS', () => {
    expect(toVisionCameraCodeTypes(['qr', 'ean13', 'pdf417', 'data-matrix'], ios)).toEqual(['qr', 'ean-13', 'pdf-417', 'data-matrix']);
    expect(toVisionCameraCodeTypes(['itf'], ios)).toEqual(['itf', 'itf-14']);
    expect(toVisionCameraCodeTypes(['databar', 'databar-expanded', 'databar-limited'], ios)).toEqual([
      'gs1-data-bar', 'gs1-data-bar-expanded', 'gs1-data-bar-limited',
    ]);
  });

  it('maps every group to the 14 base types plus DataBar on iOS', () => {
    expect(new Set(toVisionCameraCodeTypes(['all'], ios))).toEqual(
      new Set([
        'qr', 'data-matrix', 'aztec', 'pdf-417', 'ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128', 'code-39', 'code-93',
        'codabar', 'itf', 'itf-14', 'gs1-data-bar', 'gs1-data-bar-expanded', 'gs1-data-bar-limited',
      ]),
    );
  });

  it('drops types that need iOS 15.4 on older iOS', () => {
    const types = toVisionCameraCodeTypes(['all'], oldIos);
    expect(types).not.toContain('codabar');
    expect(types).not.toContain('gs1-data-bar');
    expect(types).toContain('itf-14');
  });

  it('uses the ML Kit set on Android', () => {
    const types = toVisionCameraCodeTypes(['all'], android);
    expect(new Set(types)).toEqual(
      new Set(['qr', 'data-matrix', 'aztec', 'pdf-417', 'ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128', 'code-39', 'code-93', 'codabar', 'itf']),
    );
    expect(toVisionCameraCodeTypes(['itf14'], android)).toEqual(['itf']);
    expect(toVisionCameraCodeTypes(['databar'], android)).toEqual([]);
  });

  it('silently drops ids vision-camera cannot read', () => {
    expect(toVisionCameraCodeTypes(['micro-qr', 'maxicode', 'qr', 'telepen'], ios)).toEqual(['qr']);
    expect(toVisionCameraCodeTypes(['rmqr'], android)).toEqual([]);
  });

  it('de-duplicates code types (isbn and ean13 both use ean-13)', () => {
    expect(toVisionCameraCodeTypes(['ean13', 'isbn'], android)).toEqual(['ean-13']);
  });

  it('reports supported symbologies per platform', () => {
    expect(visionCameraSupportedSymbologies(android)).toEqual([
      'qr', 'data-matrix', 'aztec', 'pdf417', 'ean13', 'ean8', 'upca', 'upce', 'isbn', 'code128', 'code39', 'code93', 'codabar', 'itf', 'itf14',
    ]);
    expect(visionCameraSupportedSymbologies(ios)).toContain('databar-limited');
    expect(visionCameraSupportedSymbologies(oldIos)).not.toContain('codabar');
  });
});

describe('fromVisionCameraCode', () => {
  const all = resolveSymbologies(['all']);

  it('maps plain types', () => {
    expect(fromVisionCameraCode('qr', 'hello', all)).toEqual({ symbology: 'qr', data: 'hello' });
    expect(fromVisionCameraCode('pdf-417', 'x', all)).toEqual({ symbology: 'pdf417', data: 'x' });
    expect(fromVisionCameraCode('gs1-data-bar-limited', '0100012345678905', all)).toEqual({ symbology: 'databar-limited', data: '0100012345678905' });
    expect(fromVisionCameraCode('unknown', 'x', all)).toBeNull();
  });

  it('only returns requested symbologies', () => {
    expect(fromVisionCameraCode('qr', 'hello', ['ean13'])).toBeNull();
  });

  it('refines EAN-13 into ISBN and UPC-A', () => {
    expect(fromVisionCameraCode('ean-13', '9780306406157', all)).toEqual({ symbology: 'isbn', data: '9780306406157' });
    expect(fromVisionCameraCode('ean-13', '9780306406157', ['ean13'])).toEqual({ symbology: 'ean13', data: '9780306406157' });
    expect(fromVisionCameraCode('ean-13', '0036000291452', all)).toEqual({ symbology: 'upca', data: '036000291452' });
    expect(fromVisionCameraCode('ean-13', '0036000291452', ['ean13'])).toEqual({ symbology: 'ean13', data: '0036000291452' });
    expect(fromVisionCameraCode('ean-13', '4006381333931', ['upca'])).toBeNull();
    expect(fromVisionCameraCode('ean-13', '4006381333931', ['isbn'])).toBeNull();
  });

  it('converts UPC-A to EAN-13 when only EAN-13 was requested', () => {
    expect(fromVisionCameraCode('upc-a', '036000291452', ['upca'])).toEqual({ symbology: 'upca', data: '036000291452' });
    expect(fromVisionCameraCode('upc-a', '036000291452', ['ean13'])).toEqual({ symbology: 'ean13', data: '0036000291452' });
  });

  it('refines ITF into ITF-14', () => {
    expect(fromVisionCameraCode('itf', '15400141288763', all)).toEqual({ symbology: 'itf14', data: '15400141288763' });
    expect(fromVisionCameraCode('itf', '15400141288763', ['itf'])).toEqual({ symbology: 'itf', data: '15400141288763' });
    expect(fromVisionCameraCode('itf', '123456', ['itf14'])).toBeNull();
    expect(fromVisionCameraCode('itf-14', '15400141288763', ['itf'])).toEqual({ symbology: 'itf', data: '15400141288763' });
    expect(fromVisionCameraCode('itf-14', '15400141288763', all)).toEqual({ symbology: 'itf14', data: '15400141288763' });
  });
});
