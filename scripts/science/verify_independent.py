"""Compare independent formula results against captured outputs, never derive an expectation from those outputs."""
import argparse,json,math,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from independent_formulas import references
from independent_uncertainty import references as uncertainty_references
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--context',default='artifacts/science-audit/python-context.json');parser.add_argument('--output',default='artifacts/science-audit/independent-results.json');args=parser.parse_args()
catalog=json.loads((root/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments'];samples=json.loads((root/'tests/fixtures/measurements.json').read_text(encoding='utf-8'));context=json.loads((root/args.context).read_text(encoding='utf-8-sig'));checks=[]
for exp in catalog:
    expected=references(exp['sourceId'],samples[exp['id']])+uncertainty_references(exp['sourceId'],samples[exp['id']])
    if not expected:raise AssertionError('no reference checks for '+exp['sourceId'])
    for key,value,unit,formula in expected:
        actual=context[exp['id']].get(key)
        # Only ideal circular-polarization amplitude is near zero in this fixture.
        absolute=1e-12 if key=='m45' and exp['sourceId']=='光的偏振特性测量（第二学期）' else 1e-18
        tolerance=absolute+1e-9*abs(value)
        good=isinstance(actual,(float,int)) and not isinstance(actual,bool) and math.isfinite(actual) and abs(actual-value)<=tolerance
        checks.append({'id':exp['id'],'name':exp['sourceId'],'quantity':key,'unit':unit,'formula':formula,'expected':value,'actual':actual,'absoluteTolerance':absolute,'relativeTolerance':1e-9,'pass':good,'absoluteDifference':abs(actual-value) if isinstance(actual,(float,int)) else None})
result={'scope':'Independent stdlib physical/formula oracle over simulated fixture inputs; selected primary quantities and eight experiments uncertainty models. Does not cover all uncertainty, outlier, plot or report-layout claims.','context':args.context,'experiments':len(catalog),'checks':checks,'passed':sum(c['pass'] for c in checks),'failed':sum(not c['pass'] for c in checks)}
out=root/args.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
for c in checks:
    if not c['pass']:print(c['name'],c['quantity'],'expected=',c['expected'],'actual=',c['actual'],'unit=',c['unit'])
print('Experiments:',len(catalog),'checks:',len(checks),'passed:',result['passed'],'failed:',result['failed'])
raise SystemExit(1 if result['failed'] else 0)
