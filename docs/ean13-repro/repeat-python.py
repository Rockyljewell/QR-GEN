"""Read-only two-fixture upstream probe. Reports go to temp or output env."""
from pathlib import Path
from datetime import datetime, timezone
import os, tempfile, json, hashlib, importlib.metadata
from PIL import Image
import zxingcpp
try:
    from qrgen_sdk import scan
except ImportError:
    scan = None
root = Path(__file__).resolve().parent
output = Path(os.environ['QRGEN_REPRO_OUTPUT_DIR']).resolve() if os.environ.get('QRGEN_REPRO_OUTPUT_DIR') else Path(tempfile.mkdtemp(prefix='qrgen-ean13-repro-'))
if output == root:
    raise ValueError('Choose an output directory outside the reproduction package')
output.mkdir(parents=True, exist_ok=True)
manifest = json.loads((root/'fixtures.json').read_text(encoding='utf-8'))
def checksum(text):
    return text.isascii() and text.isdigit() and len(text) in (12,13) and (int(text[-1])+sum(int(c)*(3 if i%2==0 else 1) for i,c in enumerate(reversed(text[:-1]))))%10 == 0
def raw(result):
    position = result.position
    return {'text':result.text,'format':str(result.format),'valid':result.valid,'error':str(result.error) if result.error else None,'position':{name:{'x':getattr(position,name).x,'y':getattr(position,name).y} for name in ('top_left','top_right','bottom_right','bottom_left')},'bytesHex':result.bytes.hex(),'checksumValid':checksum(result.text)}
def summary(values):
    unique = {json.dumps(value,sort_keys=True) for value in values}
    return {'repetitions':len(values),'stable':len(unique)==1,'unique':[json.loads(value) for value in sorted(unique)]}
report = {'scope':'Static two-fixture diagnostic; no public-demo wrong-payload observation','recordedAt':datetime.now(timezone.utc).isoformat(),'zxingCppVersion':importlib.metadata.version('zxing-cpp'),'runs':[]}
for item in manifest['fixtures']:
    path = root/item['local']
    if hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError('Fixture hash mismatch: '+item['local'])
    with Image.open(path) as source:
        rgba = source.convert('RGBA')
    white = Image.new('RGBA', rgba.size, (255,255,255,255))
    image = Image.alpha_composite(white,rgba).convert('RGB')
    rgba.close()
    white.close()
    try:
        for hard in (False,True):
            opts = {'try_rotate':hard,'try_downscale':hard,'try_invert':False,'binarizer':zxingcpp.Binarizer.LocalAverage,'text_mode':zxingcpp.TextMode.HRI,'ean_add_on_symbol':zxingcpp.EanAddOnSymbol.Ignore,'return_errors':False}
            raw_results, sdk_results = [], []
            for repeat in range(5):
                raw_results.append(list(map(raw,zxingcpp.read_barcodes(image,formats=zxingcpp.BarcodeFormat.EAN13,**opts))))
                if scan:
                    sdk_results.append([{'data':b.data,'symbology':b.symbology,'checksumValid':checksum(b.data)} for b in scan(path,symbologies=['ean13'],try_harder=hard,max_results=1)])
            report['runs'].append({'pipeline':item['pipeline'],'sha256':item['sha256'],'width':image.width,'height':image.height,'truth':item['truth'],'options':{key:str(value) if key in ('binarizer','text_mode','ean_add_on_symbol') else value for key,value in opts.items()},'raw':summary(raw_results),'sdk':summary(sdk_results) if scan else None})
    finally:
        image.close()
path = output/'python-results.json'
path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'report':str(path),'version':report['zxingCppVersion'],'runs':len(report['runs']),'scope':report['scope']}))
