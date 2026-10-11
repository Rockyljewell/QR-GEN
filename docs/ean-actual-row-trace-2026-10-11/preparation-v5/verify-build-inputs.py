"""File-only check on the diagnostic workflow checkout, before any build."""
import sys,json,hashlib,subprocess
from pathlib import Path
root,package=map(Path,sys.argv[1:3]);instrumented='--instrumented' in sys.argv[3:]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((package/'patch-metadata.json').read_text())
freeze=json.loads((package/'freeze-manifest.json').read_text())
for f in freeze['files']:
    assert sha(package/f['path'])==f['sha256'],f['path']
assert sha(package/'actual-row-trace.patch')==m['patchSha256']
for f in m['files']:
    assert sha(root/f['path'])==f['instrumentedSha256' if instrumented else 'baseSha256'],f['path']
for f in m['newFiles']:
    p=root/f['path']
    if instrumented:assert sha(p)==f['sha256'],f['path']
    else:assert not p.exists(),f['path']
changed=subprocess.check_output(['git','-C',str(root),'diff','--name-only'],text=True).splitlines()
assert set(changed)==({f['path'] for f in m['files']} if instrumented else set()),changed
untracked=subprocess.check_output(['git','-C',str(root),'ls-files','--others','--exclude-standard'],text=True).splitlines()
assert set(untracked)==({f['path'] for f in m['newFiles']} if instrumented else set()),untracked
print(json.dumps({'instrumented':instrumented,'sourceFilesVerified':len(m['files']),'recognitionCalls':0}))
