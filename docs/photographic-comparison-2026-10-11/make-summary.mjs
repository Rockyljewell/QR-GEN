// Compact evidence builder. Does not launch a browser or decoder.
import{readFileSync,writeFileSync,existsSync}from'node:fs';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const metadataDir=dirname(fileURLToPath(import.meta.url));const outputDir=process.env.QRGEN_COMPARISON_OUTPUT??metadataDir;
const read=name=>JSON.parse(readFileSync(join(outputDir,name),'utf8'));
const manifest=JSON.parse(readFileSync(join(metadataDir,'corpus-manifest.json'),'utf8'));
const prepared=JSON.parse(readFileSync(join(metadataDir,'fixture-preparation.json'),'utf8'));
const proof=JSON.parse(readFileSync(join(metadataDir,'qrgen-build-proof.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');const assetSets={};const diagnosticSets={};
function diagnosticReference(value){if(!value)return null;const digest=hash(JSON.stringify(value));diagnosticSets[digest]=value;return digest;}
function compact(row){
 let assetSetSha256;
 if(row.loadedLocalAssets){const assets=[...row.loadedLocalAssets].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);assetSetSha256=hash(JSON.stringify(assets));assetSets[assetSetSha256]=assets;}
 const item=manifest.cases.find(c=>c.id===row.caseId);
 return{caseId:row.caseId,vendor:row.vendor,status:row.status,negative:row.negative,exactPayloadVisible:row.exactPayloadVisible,
  observedPayload:row.visiblePayload,visibleResult:row.visibleResult,visiblePayloads:row.visiblePayloads,visibleItemCount:row.visibleItemCount,
  staticRepeatedQuantity:row.visiblePageDiagnostic?.match(/\bQty (\d+)\b/)?.[1],
  publicSettings:{preset:item.publicUi[row.vendor].preset,sdkVersion:row.sdkVersion,selectedSymbologies:row.selectedSymbologies,colorInverted:row.colorInverted,extendedSymbolCounts:row.extendedSymbolCounts,inversionSetting:row.inversionSetting},
  publicUi:{configurationCompleted:row.configurationCompleted,expandedListByKeyboard:row.expandedListByKeyboard,clearActivation:row.clearActivation,itemsImmediatelyAfterClear:row.itemsImmediatelyAfterClear,resumeActivation:row.resumeActivation,readinessGate:row.readinessGate,readyForObservation:row.uiReadyForObservation},
  observationStartedAt:row.observationStartedAt,observationEndedAt:row.observationEndedAt,observedAt:row.observedAt,
  readyDiagnosticsSha256:diagnosticReference(row.readyDiagnostics),endDiagnosticsSha256:diagnosticReference(row.diagnostics),loadedAssetSetSha256:assetSetSha256,
  visiblePageDiagnostic:!row.exactPayloadVisible?row.visiblePageDiagnostic:undefined,
  pageErrors:row.pageErrors,consoleErrors:row.consoleErrors,error:row.error,errorCategory:row.errorCategory,blocker:row.blocker};
}
function run(name,runner){
 if(!existsSync(join(outputDir,name)))return null;const data=read(name);
 const totals=data.results.reduce((a,r)=>{const key=r.vendor+':'+r.status;a[key]=(a[key]??0)+1;return a;},{});
 return{rawReportSha256:hash(readFileSync(join(outputDir,name))),rawReportFile:name,usedRunnerSha256:existsSync(join(outputDir,runner))?hash(readFileSync(join(outputDir,runner))):null,
  status:data.status,error:data.error,startedAt:data.startedAt,completedAt:data.completedAt,browser:data.browser,environment:data.environment,qrgenDemoUrl:data.source.qrgenUrl,scanditDemoUrl:data.source.scanditUrl,scanditAvailablePresetIds:data.scanditAvailablePresetIds,
  protocolAmendment:data.protocolAmendment,totals,observations:data.results.map(compact)};
}
const original=run('public-photo-comparison.json','public-photo-comparison.mjs');const followup=run('public-photo-comparison-readiness-followup.json','public-photo-readiness-followup.mjs');
const report={schemaVersion:1,generatedAt:new Date().toISOString(),purpose:'Exact-input public-demo observations, without latency, decoder or stability parity claims',
 source:{qrgenSourceCommit:proof.sourceCommit,actualLoadedSiteAssets:'Each QR-GEN observation refers to a hash-addressed asset set, checked against the unchanged pinned build.',buildProofFile:'qrgen-build-proof.json',standaloneSdkAssetUsedByDemo:false,scanditPublicDemo:'https://websdk.demos.scandit.com/',scanditDisplayedSdkVersion:'v.8.6.1',corpusRepository:manifest.repository,corpusCommit:manifest.commit,selectionFrozenAt:manifest.selectionFrozenAt,selectionSha256:prepared.selectionSha256,manifestSha256:hash(readFileSync(join(metadataDir,'corpus-manifest.json'))),fixturePreparationSha256:hash(readFileSync(join(metadataDir,'fixture-preparation.json'))),cameraHelperSha256:prepared.helperSha256},
 conditions:{sameCameraInputPerCase:true,width:640,height:480,frameRate:'30:1',staticFrames:30,positiveCases:16,negativeControlCases:4,selectedFormats:['QR','Data Matrix','PDF417','EAN-13','Code 128'],freshContextPerCaseAndVendor:true},
 limitations:[...manifest.limitations,
 'Original positives were observed for up to 20 seconds after live-video readiness; one exact PDF417 observation started before QR-GEN initialization completed. Exact output validates that positive, not a decode-time comparison.',
 'Original effective QR-GEN options/ROI were not sampled; visible selected formats were recorded. The separate follow-up samples public resolved options and geometry without changing those settings.',
 'QR-GEN continuous mode derives an aiming ROI from its viewfinder; Scandit internal ROI is not inspected. Same camera files and selected formats do not imply matched decoder regions, modes, settings or maximum capability.',
 'Scandit negative outcomes mean no visible outputs observed after configured UI/Clear/Resume and live video, not proof of active proprietary SDK decoding or a false-positive-free result.',
 'Scandit Qty counts can repeat one static payload and do not represent multiple physical items.',
 'The aborted asset-URL setup report is excluded from all aggregates. Follow-up is separate and does not revise the original aggregate.',
 'Page and console errors are recorded; private SDK error state is not inspected. Physical phone testing is unexecuted.'],
 cases:manifest.cases.map(item=>({id:item.id,expected:item.expected,negative:!!item.negative,conditions:item.conditions,conditionAuthority:item.conditionAuthority,imagePath:item.image.path,imageSha256:item.image.sha256,groundTruthSha256:item.groundTruth?.sha256,testDefinitionSha256:prepared.cases.find(c=>c.id===item.id).testDefinition.sha256,y4mSha256:prepared.cases.find(c=>c.id===item.id).fixture.y4mSha256})),
 original,readinessFollowup:followup,loadedAssetSets:assetSets,diagnosticSets};
writeFileSync(join(outputDir,'photographic-comparison-2026-10-11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({original:original?.status,originalRows:original?.observations.length,followup:followup?.status,followupRows:followup?.observations.length,assetSets:Object.keys(assetSets).length}));
