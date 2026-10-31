"""Prepare and verify deterministic sensitivity cases, not real user data."""
import argparse
import copy
import json
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from independent_uncertainty import SUPPORTED, references

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT/'artifacts/science-audit'
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['prepare', 'verify'])
parser.add_argument('--context')
parser.add_argument('--output')
args = parser.parse_args()
jobs_file = OUTPUT/'uncertainty-jobs.json'
if args.action == 'prepare':
    catalog = json.loads((ROOT/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments']
    samples = json.loads((ROOT/'tests/fixtures/measurements.json').read_text(encoding='utf-8'))
    jobs = []
    for exp in catalog:
        name = exp['sourceId']
        if name not in SUPPORTED:
            continue
        for mode in ('constant-or-perfect', 'perturbed', 'scaled'):
            d = copy.deepcopy(samples[exp['id']])
            if name == '刚体转动惯量的测量':
                if mode == 'scaled':
                    for key in ('instrument_delta_ruler','instrument_delta_timer','instrument_delta_balance'):d[key]*=3
                else:
                    for row in (0,1,2,3):
                        base=math.fsum(d['measurements'][row])/len(d['measurements'][row])
                        step=0 if mode=='constant-or-perfect' else (0.001 if row==2 else 0.01)
                        d['measurements'][row]=[base+(i-2)*step for i in range(5)]
            elif name == '直螺线管磁场分布的测量':
                if mode == 'constant-or-perfect':
                    d['I0_ma'] = [100,100,100]
                    d['dm1_cm'] = d['dm2_cm'] = [15,15,15]
                    d['instrument_delta_ammeter_a'] = 1e-9  # valid positive limit, ruler-dominated case
                elif mode == 'perturbed':
                    d['dm1_cm'] = [14.8,15,15.2]
                    d['dm2_cm'] = [15.2,15.1,15]
                else:
                    d['instrument_delta_ammeter_a'] *= 3
                    d['instrument_delta_scale_mm'] *= 3
            elif name == '长度与体积的测量':
                if mode == 'scaled':
                    for key in ('dl_inst','dd_inst','dd_shi_inst','dx_inst'):d[key]*=3
                else:
                    for key,base in [('D',8),('d_shi',2)]:d[key]=[base+(0 if mode=='constant-or-perfect' else (i-2)*0.001) for i in range(5)]
                    for start,end,width in [('X0','X1',20),('Y0','Y1',1)]:
                        d[start]=[10]*5;d[end]=[10+width+(0 if mode=='constant-or-perfect' else (i-2)*0.001) for i in range(5)]
            elif name == '激光波长的测量':
                if mode == 'constant-or-perfect':
                    d['measurements'] = [[i,i+0.015625] for i in range(8)]
                elif mode == 'perturbed':
                    d['measurements'] = [[i,i+0.015625+(-1)**i*0.0001] for i in range(8)]
                else:
                    d['N'] *= 2
                    d['instrument_delta_inst_mm'] *= 3
            elif name.startswith('薄透镜焦距'):
                if mode == 'scaled':
                    d['instrument_delta_instrument'] *= 3
                else:
                    d['f_auto'] = [15+(0 if mode == 'constant-or-perfect' else (-1)**i*0.1) for i in range(8)]
                    if 'v' in d:
                        d['v'] = [30+(0 if mode == 'constant-or-perfect' else (-1)**i*0.2) for i in range(8)]
                    else:
                        d['x6'] = [9+(0 if mode == 'constant-or-perfect' else (-1)**i*0.01) for i in range(8)]
                        d['x7'] = [24]*8
            else:
                x = list(range(1,11))
                noise = [1,-2,2,-2,1,1,-2,2,-2,1]
                scale = {'constant-or-perfect':0,'perturbed':1,'scaled':4}[mode]
                if name == '灵敏电流计特性的测量':
                    d['U'] = x
                    d['R'] = [400*v-27+scale*e for v,e in zip(x,noise)]
                else:
                    d['t1_u'] = x
                    d['t1_i'] = [10*v+scale*e for v,e in zip(x,noise)]
            # Validate scope before running either production runtime.
            assert references(name,d)
            jobs.append(dict(id=exp['id']+'-'+mode, experimentId=exp['id'], sourceId=name, data=d, mode=mode))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    jobs_file.write_text(json.dumps(jobs,ensure_ascii=False),encoding='utf-8')
    print('Prepared',len(jobs),'uncertainty sensitivity cases')
else:
    if not args.context or not args.output:
        parser.error('verification requires --context and --output')
    contexts = json.loads((ROOT/args.context).read_text(encoding='utf-8-sig'))
    jobs = json.loads(jobs_file.read_text(encoding='utf-8'))
    assert set(contexts) == {j['id'] for j in jobs}, 'case coverage mismatch'
    checks = []
    for job in jobs:
        for key,value,unit,formula in references(job['sourceId'],job['data']):
            actual = contexts[job['id']].get(key)
            # Exact straight lines can leave tiny roundoff residuals in OLS.
            # The dimensional floor is much smaller than all perturbed cases.
            floor = 1e-18 if unit == 'A/mm' else 1e-11
            tolerance = floor+abs(value)*1e-9
            valid = isinstance(actual,(int,float)) and not isinstance(actual,bool) and math.isfinite(actual)
            passed = valid and abs(actual-value) <= tolerance
            checks.append(dict(case=job['id'],name=job['sourceId'],mode=job['mode'],quantity=key,unit=unit,formula=formula,expected=value,actual=actual,tolerance=tolerance,passed=passed))
    result = dict(scope='Eight explicit course uncertainty models; simulated perfect, perturbed and scaled inputs in actual calculation contexts',cases=len(jobs),checks=checks,passed=sum(c['passed'] for c in checks),failed=sum(not c['passed'] for c in checks))
    (ROOT/args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    for check in checks:
        if not check['passed']:
            print(check['name'],check['mode'],check['quantity'],check['expected'],check['actual'])
    print('Uncertainty cases:',len(jobs),'checks:',len(checks),'failed:',result['failed'])
    raise SystemExit(bool(result['failed']))
