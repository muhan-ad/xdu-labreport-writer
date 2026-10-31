"""Separate CPython runtime reference using the same bundled algorithms, not an independent physics oracle."""
import argparse, contextlib, importlib.util, io, json, os, sys, tempfile
from pathlib import Path

root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--jobs');parser.add_argument('--sources',default='public/report-runtime/report-sources.json');args=parser.parse_args()
sources=json.loads((root/args.sources).read_text(encoding='utf-8'))
catalog=json.loads((root/'src/data/catalog.json').read_text(encoding='utf-8'))['experiments']
samples=json.loads((root/'tests/fixtures/measurements.json').read_text(encoding='utf-8'))
jobs=json.loads((root/args.jobs).read_text(encoding='utf-8')) if args.jobs else [dict(id=e['id'],sourceId=e['sourceId'],data=samples[e['id']]) for e in catalog]
results={}
previous=Path.cwd()
with tempfile.TemporaryDirectory(prefix='lab-context-reference-') as folder:
    base=Path(folder)
    for name,text in sources.items():
        file=base/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(text,encoding='utf-8')
    sys.path.insert(0,str(base))
    from common.calculation_context import calculate
    from common.data_io import load_data
    try:
        for exp in jobs:
            target=base/exp['sourceId'];(target/'data.json').write_text(json.dumps(exp['data']),encoding='utf-8')
            os.chdir(target)
            with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                if exp['sourceId']=='电容与高电阻的测量':
                    spec=importlib.util.spec_from_file_location('_reference_cap',target/'generate.py')
                    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                    values=module.calculation_context(load_data(str(target/'data.json')))
                else:values=calculate(target)
            results[exp['id']]=values
    finally:os.chdir(previous)
print(json.dumps(results,ensure_ascii=False,allow_nan=False))
