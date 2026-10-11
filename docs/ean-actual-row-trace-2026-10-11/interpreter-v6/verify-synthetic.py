"""Synthetic file-only reconstruction probes; none are actual engine traces."""
from pathlib import Path
import copy, hashlib, json, struct
from interpret import Schedule, interpret_events, mapping, mapped_line, placement_memberships, verify_digit_bits, plain

fixture = json.loads((Path(__file__).parent/'collector-compare-schema-fixture.json').read_text(encoding='utf-8'))
checks = []
def checked(name, fn):
    fn(); checks.append({'name': name, 'passed': True})

def rejected(name, fn):
    try: fn()
    except (ValueError, KeyError, IndexError): checks.append({'name': name, 'passed': True}); return
    raise AssertionError('Expected rejection: ' + name)

def scheduling():
    s = Schedule({'scanWidth': 100, 'scanHeight': 320, 'rowStep': 10, 'maxLines': 15,
                  'minLineCount': 2, 'maxSymbols': 255, 'tryHarder': False, 'isPure': False})
    s.attempted({'rowNumber': 160, 'iteration': 0, 'checkRow': False, 'pendingCheckRows': [], 'scanWidth': 100})
    s.replace({'pendingCheckRows': [159, 161, 158, 162]})
    for row, remaining in [(162, [159,161,158]), (158,[159,161]), (161,[159]), (159,[])]:
        s.attempted({'rowNumber': row, 'iteration': 0, 'checkRow': True, 'pendingCheckRows': remaining, 'scanWidth': 100})
    s.attempted({'rowNumber': 150, 'iteration': 1, 'checkRow': False, 'pendingCheckRows': [], 'scanWidth': 100})
    s.attempted({'rowNumber': 170, 'iteration': 2, 'checkRow': False, 'pendingCheckRows': [], 'scanWidth': 100})
checked('middle-out-and-LIFO-check-rows', scheduling)

def pre_stack_bounds():
    s=Schedule({'scanWidth':100,'scanHeight':600,'rowStep':2,'maxLines':600,'minLineCount':2,'maxSymbols':1,'tryHarder':True,'isPure':False})
    s.i=300; s.stack=[1]
    s.out_of_bounds({'event':'schedule-out-of-bounds','proposedRow':600,'iteration':300,'pendingCheckRows':[1]})
    assert s.stack == [1] and s.reason == 'schedule-out-of-bounds'
checked('proposed-bounds-before-pending-pop', pre_stack_bounds)

def rejected_check():
    s=Schedule({'scanWidth':100,'scanHeight':320,'rowStep':10,'maxLines':15,'minLineCount':2,'maxSymbols':255,'tryHarder':False,'isPure':False})
    s.stack=[-1]
    s.out_of_bounds({'event':'check-row-out-of-bounds','proposedRow':-1})
    assert s.i==0 and s.stack==[]
checked('out-of-bounds-check-row-does-not-consume-normal-iteration', rejected_check)

checked('all-four-fullres-affine-maps', lambda: [
    (_ for _ in ()).throw(AssertionError('Mapping mismatch')) if mapping(100,64,20,r,v)!=expected else None
    for r,v,expected in [(False,False,(0,20,1,0)),(False,True,(99,20,-1,0)),(True,False,(20,63,0,-1)),(True,True,(20,0,0,1))]])
rejected('raw-line-outside-recorded-row', lambda: mapped_line([[10,2],[20,2],[20,2],[10,2]],{'originX':0,'originY':3,'xStep':1,'yStep':0},3))

item={'width':100,'height':80,'placements':[{'x':5,'y':10,'width':20,'height':30,'sourceIndex':0},{'x':5,'y':50,'width':20,'height':20,'sourceIndex':1}],'controlSpec':{'rotate':0}}
checked('same-payload-placement-identities-remain-distinct', lambda: (
    None if placement_memberships([[6,11],[23,11],[23,11],[6,11]],item)==[{'placementIndex':0,'sourceIndex':0}]
       and placement_memberships([[6,51],[23,51],[23,51],[6,51]],item)==[{'placementIndex':1,'sourceIndex':1}]
       else (_ for _ in ()).throw(AssertionError('Placement mismatch'))))
rotated={**item,'width':80,'height':100,'controlSpec':{'rotate':90}}
checked('saved-clockwise90-placement-map', lambda: None if placement_memberships([[68,6],[68,23],[68,23],[68,6]],rotated)==[{'placementIndex':0,'sourceIndex':0}] else (_ for _ in ()).throw(AssertionError('Rotated placement mismatch')))

bits=[struct.unpack('<I',struct.pack('<f',.25))[0]]*20
checked('exact-float32-score-bits',lambda:verify_digit_bits({'patternCount':20,'variances':[.25]*20,'varianceFloat32Bits':bits}))
rejected('float32-score-bit-mismatch',lambda:verify_digit_bits({'patternCount':20,'variances':[.26]*20,'varianceFloat32Bits':bits}))
checked('recorded-own-array-multiplicity',lambda: None if plain({'$kind':'Array','$properties':{'0':'same','1':'same','length':2}})==['same','same'] else (_ for _ in ()).throw(AssertionError('Deduplication')))

def synthetic_group_case():
    events=[]
    def event(name,**fields):
        events.append({'event':name,'seq':len(events)+1,'pass':1,'rowId':row_id,'rowNumber':number,'rotate':False,'reverse':reverse,**fields})
    row_id=0; number=-1; reverse=False
    event('oned-pass-begin',scanWidth=100,scanHeight=64,rowStep=2,maxLines=15,maxSymbols=1,minLineCount=2,tryHarder=False,isPure=False)
    def line(y):return [[10,y],[30,y],[30,y],[10,y]]
    def row(y,i,check,pending):
        nonlocal row_id,number,reverse
        row_id+=1;number=y;reverse=False
        event('row-attempt',iteration=i,checkRow=check,pendingCheckRows=pending,scanWidth=100)
        event('row-binarizer',rotation=0,threshold=100,histogram=[100]+[0]*31,luminanceWidth=100,luminanceHeight=64)
        event('row-runs',runs=[10,20,70])
    def direction(v):
        nonlocal reverse
        reverse=v
        event('row-direction',originX=99 if v else 0,originY=number,xStep=-1 if v else 1,yStep=0,layerWidth=100,layerHeight=64)
    def attempt(n,valid):
        event('decode-attempt',attempt=n,reader=0)
        event('ean-dispatch',readEAN13=True,readUPCA=False,readEAN8=False,readUPCE=False)
        event('decode-return',format=1 if valid else 0,valid=valid,error=False,rawPosition=line(number) if valid else [[0,0]]*4,bytes=[49]*13 if valid else [])
        if valid:event('collector-candidate',position=line(number),lineCount=1)
        else:event('collector-reject-invalid',format=0);event('cursor-advance')
    row(32,0,False,[]);direction(False);attempt(1,True)
    event('collector-insert',group=1,index=0,bytes=[49]*13,format=1,position=line(32),lineCount=1)
    event('check-rows-replaced',pendingCheckRows=[31,33]);event('cursor-advance')
    direction(True);attempt(2,False)
    row(33,0,True,[31]);direction(False);attempt(3,True)
    record=copy.deepcopy(fixture['records']['match']); record['seq']=len(events)+1
    assert record['rowId']==row_id and record['rowNumber']==number and record['attempt']==3
    events.append(record)
    event('collector-merge',group=1,index=0,supportBefore=1,positionBefore=line(32),incomingPosition=line(33))
    merged=line(32)[:2]+line(33)[2:]
    event('collector-merged',group=1,supportAfter=2,positionAfter=merged)
    event('oned-budget-exit',maxSymbols=1,groupsBeforePrune=1,pendingCheckRows=[31],iteration=0)
    event('oned-search-end',groupsBeforePrune=1,pendingCheckRows=[31])
    event('collector-output',group=1,index=0,lineCount=2,position=merged,bytes=[49]*13,format=1)
    event('orientation-gate',horizontalCount=1,maxSymbols=1,tryRotate=True,willRotate=False)
    event('reader-sorted-output',index=0,position=merged,format=1,lineCount=2)
    event('global-candidate',ordinal=0,position=merged,format=1,lineCount=2)
    event('global-insert',index=0,budgetBefore=1)
    result=interpret_events(events,{'id':'synthetic/max1','inputKey':'synthetic','options':{'tryHarder':False,'maxNumberOfSymbols':1}}, {'id':'synthetic','width':100,'height':64})
    assert len(result['groups'])==1 and len(result['groups'][0]['contributions'])==2
    assert result['passes'][0]['exitReason']=='oned-budget-exit' and result['globalInsertCount']==1
    return events
checked('synthetic-insert-merge-support-budget-and-output-history', synthetic_group_case)
events=synthetic_group_case()
next(e for e in events if e['event']=='collector-merged')['supportAfter']=3
rejected('merge-support-counter-drift',lambda:interpret_events(events,{'id':'synthetic','inputKey':'synthetic','options':{'tryHarder':False,'maxNumberOfSymbols':1}},{'id':'synthetic','width':100,'height':64}))


# The event records below come from the separately source-bound schema fixture.
# This is a reconstruction probe, not an engine/transport conformance claim.
def schema_keys():
    common=set(fixture['expectedCommonKeys']); hook=set(fixture['expectedHookKeys'])
    for name,record in fixture['records'].items():
        assert set(record)==common|hook and 'result' not in record
        assert type(record['decision']) is bool
    assert fixture['records']['match']['decision'] is True
    assert fixture['records']['mismatch']['decision'] is False
checked('pinned-producer-fixture-fields-and-bool-types',schema_keys)

def fixture_failure(change):
    events=synthetic_group_case()
    record=next(e for e in events if e['event']=='collector-compare')
    change(record)
    return interpret_events(events,{'id':'synthetic','inputKey':'synthetic','options':{'tryHarder':False,'maxNumberOfSymbols':1}},
                            {'id':'synthetic','width':100,'height':64})
rejected('legacy-result-only-collector-record-is-rejected',lambda:fixture_failure(lambda e:e.update(result=e.pop('decision'))))
rejected('numeric-decision-is-rejected',lambda:fixture_failure(lambda e:e.update(decision=1)))
rejected('false-decision-cannot-authorize-merge',lambda:fixture_failure(lambda e:e.update(decision=False)))

def false_then_insert_then_true_merge():
    events=synthetic_group_case()
    cut=next(i for i,e in enumerate(events) if e['event']=='collector-compare')
    events=events[:cut]
    # A different incoming payload cannot match group 1, so the real false
    # fixture must authorize a new group, never a merge.
    events[-2]['bytes']=[50]*13
    false_record=copy.deepcopy(fixture['records']['mismatch']); false_record['seq']=len(events)+1
    events.append(false_record)
    def line(y):return [[10,y],[30,y],[30,y],[10,y]]
    def add(name, row=33, row_id=2, attempt=3, reverse=False, **fields):
        events.append({'schema':1,'event':name,'seq':len(events)+1,'pass':1,'rowId':row_id,'attempt':attempt,
                       'candidate':0,'reader':0,'rowNumber':row,'rotate':False,'reverse':reverse,**fields})
    add('collector-insert',group=2,index=1,bytes=[50]*13,format=1,position=line(33),lineCount=1)
    add('cursor-advance')
    add('row-direction',reverse=True,originX=99,originY=33,xStep=-1,yStep=0,layerWidth=100,layerHeight=64)
    add('decode-attempt',attempt=4)
    add('decode-return',attempt=4,format=0,valid=False,error=False,rawPosition=[[0,0]]*4,bytes=[])
    add('collector-reject-invalid',attempt=4,format=0);add('cursor-advance',attempt=4)
    add('row-attempt',row=31,row_id=3,attempt=4,iteration=0,checkRow=True,pendingCheckRows=[],scanWidth=100)
    add('row-binarizer',row=31,row_id=3,attempt=4,rotation=0,threshold=100,histogram=[100]+[0]*31,luminanceWidth=100,luminanceHeight=64)
    add('row-runs',row=31,row_id=3,attempt=4,runs=[10,20,70])
    add('row-direction',row=31,row_id=3,attempt=4,originX=0,originY=31,xStep=1,yStep=0,layerWidth=100,layerHeight=64)
    add('decode-attempt',row=31,row_id=3,attempt=5)
    add('decode-return',row=31,row_id=3,attempt=5,format=1,valid=True,error=False,rawPosition=line(31),bytes=[49]*13)
    add('collector-candidate',row=31,row_id=3,attempt=5,position=line(31),lineCount=1)
    true_record=copy.deepcopy(fixture['records']['match'])
    true_record.update(seq=len(events)+1,rowId=3,rowNumber=31,attempt=5,incomingPosition=line(31))
    events.append(true_record)
    add('collector-merge',row=31,row_id=3,attempt=5,group=1,index=0,supportBefore=1,positionBefore=line(32),incomingPosition=line(31))
    merged=line(32)[:2]+line(31)[2:]
    add('collector-merged',row=31,row_id=3,attempt=5,group=1,supportAfter=2,positionAfter=merged)
    add('oned-budget-exit',row=31,row_id=3,attempt=5,maxSymbols=1,groupsBeforePrune=2,pendingCheckRows=[],iteration=0)
    add('oned-search-end',row=31,row_id=3,attempt=5,groupsBeforePrune=2,pendingCheckRows=[])
    add('collector-drop-support',row=31,row_id=3,attempt=5,group=2,index=1,lineCount=1,required=2)
    add('collector-output',row=31,row_id=3,attempt=5,group=1,index=0,lineCount=2,position=merged,bytes=[49]*13,format=1)
    add('orientation-gate',row=31,row_id=3,attempt=5,horizontalCount=1,maxSymbols=1,tryRotate=True,willRotate=False)
    add('reader-sorted-output',row=31,row_id=3,attempt=5,index=0,position=merged,format=1,lineCount=2)
    add('global-candidate',row=31,row_id=3,attempt=5,ordinal=0,position=merged,format=1,lineCount=2)
    add('global-insert',row=31,row_id=3,attempt=5,index=0,budgetBefore=1)
    result=interpret_events(events,{'id':'synthetic/false-insert-true-merge','inputKey':'synthetic','options':{'tryHarder':False,'maxNumberOfSymbols':1}},
                            {'id':'synthetic','width':100,'height':64})
    assert [a['comparisons'] for a in result['attempts'] if a['comparisons']]==[
        [{'seq':false_record['seq'],'group':1,'result':False}],[{'seq':true_record['seq'],'group':1,'result':True}]]
    assert len(result['groups'])==2
    assert len(result['groups'][0]['contributions'])==2 and result['groups'][0]['output']['lineCount']==2
    assert result['groups'][1]['terminalReason']=='insufficient-support' and len(result['groups'][1]['contributions'])==1
    assert result['globalInsertCount']==1
checked('actual-field-false-inserts-and-true-merges-distinct-groups',false_then_insert_then_true_merge)

print(json.dumps({'scope':'Synthetic file-only probes; not actual engine traces, builds or decoding.',
                  'checks':checks,'fixtureSha256':hashlib.sha256((Path(__file__).parent/'collector-compare-schema-fixture.json').read_bytes()).hexdigest(),
                  'analysisCodeSha256':hashlib.sha256((Path(__file__).parent/'interpret.py').read_bytes()).hexdigest(),
                  'readerImports':0,'recognitionCalls':0}))
