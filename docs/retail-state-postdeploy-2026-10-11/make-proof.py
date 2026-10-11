import argparse, hashlib, json, tarfile
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('directory',type=Path)
args=parser.parse_args(); root=args.directory.resolve()
metadata=json.loads((root/'artifact-metadata.json').read_text(encoding='utf-8-sig'))
deployment=json.loads((root/'deployment-check-01.json').read_text(encoding='utf-8-sig'))
artifact=next(a for a in metadata['artifacts'] if a['name']=='github-pages')
assert deployment['databaseId']==38152103868
assert deployment['headSha']=='6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b'
assert deployment['conclusion']=='success' and deployment['status']=='completed'
assert artifact['workflow_run']['head_sha']==deployment['headSha']
assert artifact['workflow_run']['id']==deployment['databaseId']
archive=root/'artifact.tar'; assets={}
with tarfile.open(archive) as tar:
    for member in tar:
        if member.isfile():
            name=member.name.removeprefix('./')
            if name.endswith(('.js','.wasm','.html')):
                raw=tar.extractfile(member).read()
                assets['/QR-GEN/'+name]={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
proof={'revision':deployment['headSha'],'deploymentRun':deployment['databaseId'],'deploymentConclusion':deployment['conclusion'],'deploymentUrl':deployment['url'],'artifactId':artifact['id'],'artifactName':artifact['name'],'artifactZipDigestAsReportedByGitHub':artifact['digest'],'artifactTarSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'artifactTarBytes':archive.stat().st_size,'assets':assets}
(root/'proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'assets':len(assets),'artifactId':artifact['id'],'tarSha256':proof['artifactTarSha256'],'sdkSha256':assets['/QR-GEN/sdk/qrgen.js']['sha256']}))
