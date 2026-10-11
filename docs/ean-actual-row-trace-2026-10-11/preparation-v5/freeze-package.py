"""Freeze this new preparation package after fixture-plan verification; no recognition."""
from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
out=HERE/'freeze-manifest.json'
assert not out.exists(),'Do not overwrite an existing frozen package'
plan=json.loads((HERE/'frozen-plan.json').read_text())
for f in plan['files']:
    b=(HERE/f['path']).read_bytes()
    assert sha(b)==f['sha256'] and len(b)==f['bytes'],f['path']
files=[]
for p in sorted(HERE.rglob('*')):
    if p.is_file() and '__pycache__' not in p.parts:
        assert not p.is_symlink(),p
        b=p.read_bytes();files.append({'path':p.relative_to(HERE).as_posix(),'bytes':len(b),'sha256':sha(b)})
manifest={'schemaVersion':1,'scope':'Immutable instrumentation preparation. No C++ compilation or recognition performed.',
          'planSha256':sha((HERE/'frozen-plan.json').read_bytes()),'files':files,
          'preparationCounts':{'rasters':len(plan['inputs']),'profiles':len(plan['profiles']),'readerImports':0,'recognitionCalls':0}}
out.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({'manifestSha256':sha(out.read_bytes()),'listedFiles':len(files),'planSha256':manifest['planSha256'],'recognitionCalls':0}))
