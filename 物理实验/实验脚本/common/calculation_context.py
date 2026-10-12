"""Capture the existing generator's calculation at compose(), without saving a report."""
import contextlib, io, importlib.util, json, math, os, sys, tempfile
from pathlib import Path

class Captured(BaseException):
    def __init__(self, data): self.data=data

class NullDocument:
    def __init__(self,*args,**kwargs): pass
    def __getattr__(self,name): return lambda *args,**kwargs: None

def calculate(experiment):
    experiment=Path(experiment).resolve()
    sys.path.insert(0,str(experiment.parent))
    from common.data_io import load_data
    data=load_data(str(experiment/'data.json'))
    spec=importlib.util.spec_from_file_location('_context_generator',experiment/'generate.py')
    module=importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()):
        spec.loader.exec_module(module)
        module.DocxReportWriter=NullDocument
        def capture(_, values): raise Captured(values)
        module.compose=capture
        # Plots preceding compose are irrelevant to the numerical context.
        for name in list(vars(module)):
            if name.startswith('_plot') and callable(getattr(module,name)):
                setattr(module,name,lambda *args,**kwargs:None)
        with tempfile.TemporaryDirectory(prefix='lab-context-') as tmp:
            try: module._generate_docx(data,str(Path(tmp)/'unused.docx'))
            except Captured as result:
                values=dict(data); values.update(result.data)
                # Nested diagnostic objects need not be serialized to the AI.
                scalars={k:v for k,v in values.items() if isinstance(v,(str,int,float)) and not isinstance(v,bool)}
                if any(isinstance(v,float) and not math.isfinite(v) for v in scalars.values()):
                    raise ValueError('计算结果含非有限数值，请检查实验数据')
                return {'_kind':'generic','_inputs':data,**scalars}
    raise ValueError('未得到有效计算结果，请检查输入')

if __name__=='__main__':
    try: print(json.dumps(calculate(sys.argv[1]),ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(str(error),file=sys.stderr);sys.exit(1)
