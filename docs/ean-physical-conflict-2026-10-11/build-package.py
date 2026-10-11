"""Package immutable feasibility records. No engine imports/calls or source edits."""
from pathlib import Path
from PIL import Image
import hashlib, json, gzip, io, shutil

HERE=Path(__file__).resolve().parent
SOURCE=HERE.parent
ART=SOURCE.parent
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_bytes())
original_inventory_bytes=(SOURCE/'inventory.json').read_bytes()
assert sha(original_inventory_bytes)=='95a86fc29bdb2e0a7a18dd83a1dbfe729ae3ff13fcd2e9e99ceab8f23e6daa9a'
inventory=json.loads(original_inventory_bytes)
def verify_original():
    for e in inventory['files']:
        b=(SOURCE/e['path']).read_bytes()
        assert len(b)==e['bytes'] and sha(b)==e['sha256'],e['path']
    assert sha((SOURCE/'inventory.json').read_bytes())==sha(original_inventory_bytes)
verify_original()
assert len(inventory['files'])==19
def write(path,bytes):
    p=HERE/path
    assert not p.exists(),'Refusing existing packaged file '+path
    p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(bytes)
def json_write(path,value):write(path,(json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode())
uncompressed={}
for original,target in [('results.json','records/results.json.gz'),('complete-trace-and-limit-evidence.json','records/complete-trace-and-limit-evidence.json.gz'),('study.mjs','archived-audit-code/study.mjs.gz'),('complete-trace-evidence.mjs','archived-audit-code/complete-trace-evidence.mjs.gz')]:
    b=(SOURCE/original).read_bytes();write(target,gzip.compress(b,compresslevel=9,mtime=0));uncompressed[target]={'uncompressedBytes':len(b),'uncompressedSha256':sha(b),'originalFile':original}
write('original-inventory.json',original_inventory_bytes)
orig_hashes={e['path']:{'bytes':e['bytes'],'sha256':e['sha256']} for e in inventory['files']}
orig_hashes['inventory.json']={'bytes':len(original_inventory_bytes),'sha256':sha(original_inventory_bytes)}
json_write('original-evidence-hashes.json',{'scope':'Original frozen snapshot identities. Not every original file is redistributed; inspection HTML and photographs are excluded.','originalFiles':orig_hashes,'byteExactGzipRecords':uncompressed})

qrgen_checkout=Path(load(SOURCE/'plan.json')['inputs']['sdk']['path']).parents[3]
def tokenize(v):
    if isinstance(v,str):
        v=v.replace(str(ART),'${ARTIFACT_ROOT}').replace(str(ART).replace('\\','/'),'${ARTIFACT_ROOT}')
        v=v.replace(str(qrgen_checkout),'${QRGEN_CHECKOUT}').replace(str(qrgen_checkout).replace('\\','/'),'${QRGEN_CHECKOUT}')
        return v
    if isinstance(v,list):return [tokenize(x) for x in v]
    if isinstance(v,dict):return {k:tokenize(x) for k,x in v.items()}
    return v
plan_bytes=(SOURCE/'plan.json').read_bytes();plan=json.loads(plan_bytes)
trace_bytes=Path(plan['inputs']['rowTrace']['path']).read_bytes();assert sha(trace_bytes)==plan['inputs']['rowTrace']['sha256'];trace=json.loads(trace_bytes)
json_write('derived-trace-source-provenance.json',{'scope':'Derived header extraction explaining the provenance of accepted-row diagnostics; not a newly instrumented actual-engine schedule.','originalRowTraceSha256':sha(trace_bytes),'originalRowTraceBytes':len(trace_bytes),'originalHeader':{k:trace[k] for k in ['recordedAt','cppCommit','readerVersion','wasmSha256','scope','options']},'caseIds':[c['id'] for c in trace['cases']]})
json_write('derived-portable-plan.json',{'scope':'Derived path-tokenized view, not original frozen plan bytes or an executable replay configuration.','originalPlanSha256':sha(plan_bytes),'originalPlanBytes':len(plan_bytes),'pathTokens':{'${ARTIFACT_ROOT}':'Original frozen diagnostic artifact cache root; original identities and hashes are retained.','${QRGEN_CHECKOUT}':'Existing SDK checkout/dependencies used by the original artifact-only study.'},'plan':tokenize(plan)})
control_bytes=(SOURCE/'control-rasters.json').read_bytes();controls=json.loads(control_bytes)
portable=tokenize(controls)
for c in portable['controls']:c['path']='controls/'+c['id']+'.png'
json_write('derived-control-rasters.json',{'scope':'Derived portable control manifest with package-relative PNG paths; not original predecode manifest bytes.','originalControlManifestSha256':sha(control_bytes),'originalControlManifestBytes':len(control_bytes),'planSha256RefersTo':'Original frozen plan.json, not derived-portable-plan.json','manifest':portable})
pixels=[]
for c in controls['controls']:
    b=(SOURCE/'controls'/f"{c['id']}.png").read_bytes();assert sha(b)==c['pngSha256']
    with Image.open(io.BytesIO(b)) as image:
        rgba=image.convert('RGBA');assert rgba.size==(c['width'],c['height']);assert sha(rgba.tobytes())==c['rgbaSha256']
    write('controls/'+c['id']+'.png',b)
    pixels.append({'id':c['id'],'width':c['width'],'height':c['height'],'pngSha256':sha(b),'rgbaSha256':c['rgbaSha256'],'passed':True})
json_write('packaging-control-pixel-verification.json',{'scope':'Retrospective packaging check of all nine retained generated control PNGs with Pillow; no SDK or barcode decoder execution.','pillowVersion':__import__('PIL').__version__,'controls':pixels,'failures':0})
license_inputs={
    'QR-GEN-LICENSE.txt':ART/'staged-sdk-study-v1/baseline/LICENSE',
    'QR-GEN-NOTICE.txt':ART/'staged-sdk-study-v1/baseline/NOTICE',
    'ZXING-LICENSE.txt':ART/'ean-cpp-source-trace/review-package/ZXING-LICENSE.txt',
    'ZXING-NOTICE.txt':ART/'ean-cpp-source-trace/review-package/ZXING-NOTICE.txt',
    'ZXING-REUSE-dep5.txt':ART/'ean-cpp-source-trace/review-package/ZXING-REUSE-dep5.txt',
}
licenses=[]
for name,source in license_inputs.items():
    b=source.read_bytes();write('licenses/'+name,b);licenses.append({'file':'licenses/'+name,'bytes':len(b),'sha256':sha(b),'originalSource':tokenize(str(source))})
json_write('license-provenance.json',{'scope':'Runner/control-composition code follows QR-GEN Apache-2.0. Existing numerical geometry/trace observations and omitted photo identities are attributed to the pinned ZXing source; no upstream implementation binary or photograph is distributed here. Generated barcode payloads are fixed test identifiers.','files':licenses})
verify_original()
files=[]
for p in sorted(HERE.rglob('*')):
    if not p.is_file() or p.name=='package-manifest.json':continue
    rel=p.relative_to(HERE).as_posix();b=p.read_bytes();r={'path':rel,'bytes':len(b),'sha256':sha(b)}
    if rel in uncompressed:r.update(uncompressed[rel])
    files.append(r)
json_write('package-manifest.json',{'scope':'Compact descriptive/refutation evidence only; original frozen nineteen-file snapshot remains unchanged. No engine calls performed by packaging.','originalInventorySha256':sha(original_inventory_bytes),'originalPlanSha256':sha(plan_bytes),'files':files})
print(json.dumps({'files':len(files),'bytes':sum(f['bytes'] for f in files),'packageManifestSha256':sha((HERE/'package-manifest.json').read_bytes()),'originalNineteenFilesUnchanged':True,'engineCalls':0}))
