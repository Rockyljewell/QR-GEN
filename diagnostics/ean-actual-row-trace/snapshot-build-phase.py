"""Copy every actual CMake cache/flags/link file below a supplied build root."""
from pathlib import Path
import sys,hashlib,json,shutil
root=Path(sys.argv[1]).resolve(strict=True);out=Path(sys.argv[2]).resolve()
assert not out.exists(),'Phase evidence must be new'
assert root!=out and root not in out.parents and out not in root.parents,'Overlapping evidence/build roots'
files=[]
for p in sorted(root.rglob('*')):
    assert not p.is_symlink(),'Symlink in build root: '+str(p)
    if p.is_file() and p.name in {'CMakeCache.txt','flags.make','link.txt'}:
        assert root in p.resolve().parents,p
        b=p.read_bytes();rel=p.relative_to(root);dest=out/rel
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
        files.append({'path':rel.as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
assert any(x['path'].endswith('CMakeCache.txt') for x in files),'No actual CMake cache found'
assert any(x['path'].endswith('flags.make') for x in files),'No actual compiler flags found'
(out/'phase-manifest.json').write_text(json.dumps({'scope':'Exact file-only phase snapshot','files':files},indent=2)+'\n')
print(json.dumps({'phase':out.name,'files':len(files),'recognitionCalls':0}))
