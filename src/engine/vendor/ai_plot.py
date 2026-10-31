"""Matplotlib AI plot adapter for a disposable, offline WASM Worker.

AST/import checks reduce accidental capabilities; they are not an OS sandbox.
This must not be used to run AI code in the host Python or a privileged page.
"""
import ast, builtins, contextlib, io, json, math
from pathlib import Path

IMPORTS={'math','statistics','json','numpy','matplotlib','matplotlib.pyplot',
         'matplotlib.ticker','matplotlib.colors','matplotlib.patches',
         'matplotlib.collections','matplotlib.transforms','pandas','scipy',
         'scipy.optimize','scipy.interpolate','scipy.stats','scipy.signal',
         'scipy.integrate','scipy.special','scipy.linalg','scipy.ndimage'}
FORBIDDEN={'js','pyodide','sys','os','builtins','ctypes','ctypeslib','f2py','testing',
           'subprocess','socket','urllib','requests','importlib','multiprocessing',
           'eval','exec','compile','globals','locals','vars','getattr','setattr','delattr',
           'breakpoint','input','help','exit','quit','memoryview'}
FILE_METHODS={'savefig','imsave','imread','load','loadtxt','genfromtxt','fromfile','tofile',
              'memmap','save','savez','savez_compressed','dump','to_csv','to_json','read_csv',
              'io','read_excel','read_json','read_pickle','read_html','read_sql','read_sql_query',
              'read_sql_table','read_parquet','read_feather','read_hdf','read_orc','read_sas',
              'read_spss','read_stata','read_xml','read_fwf','read_table','read_clipboard',
              'to_excel','to_pickle','to_html','to_sql','to_parquet','to_feather','to_hdf',
              'to_orc','to_stata','to_xml','to_clipboard','loadmat','savemat'}

def validate(code):
    if not isinstance(code,str) or not code.strip() or len(code)>30000:raise ValueError('绘图代码为空或超过 30000 字')
    try:tree=ast.parse(code,filename='ai_plot.py')
    except SyntaxError as error:raise ValueError(f'绘图代码第 {error.lineno} 行语法错误：{error.msg}') from None
    for node in ast.walk(tree):
        if isinstance(node,(ast.Global,ast.Nonlocal,ast.ClassDef)):raise ValueError('绘图代码不支持全局声明或类定义')
        if isinstance(node,ast.Name) and (node.id.startswith('_') or node.id in FORBIDDEN):raise ValueError('绘图代码包含不支持的能力：'+node.id)
        if isinstance(node,ast.Name) and node.id in FILE_METHODS and node.id!='save':raise ValueError('绘图代码不支持直接文件接口：'+node.id)
        json_load=isinstance(node,ast.Attribute) and node.attr=='load' and isinstance(node.value,ast.Name) and node.value.id=='json'
        if isinstance(node,ast.Attribute) and (node.attr.startswith('_') or node.attr in FORBIDDEN or node.attr in FILE_METHODS and not json_load):raise ValueError('绘图代码不支持此属性或文件接口：'+node.attr)
        if isinstance(node,ast.Import):
            for item in node.names:
                if item.name not in IMPORTS:raise ValueError('本机绘图暂不支持模块：'+item.name)
                if item.asname and (item.asname.startswith('_') or item.asname in FORBIDDEN):raise ValueError('绘图模块别名无效')
        if isinstance(node,ast.ImportFrom):
            if node.level or node.module not in IMPORTS:raise ValueError('绘图模块不在允许范围内')
            if any(item.name.startswith('_') or item.name=='*' or item.name in FORBIDDEN or item.name in FILE_METHODS or (item.asname and (item.asname.startswith('_') or item.asname in FORBIDDEN or item.asname in FILE_METHODS)) for item in node.names):raise ValueError('绘图模块成员无效')
    return tree

class LimitedLog(io.StringIO):
    def write(self,text):
        if self.tell()+len(text)>16000:raise ValueError('绘图输出日志过长')
        return super().write(text)

def render(code,data,out_dir):
    tree=validate(code)
    if not isinstance(data,dict):raise ValueError('绘图数据格式无效')
    payload=json.dumps(data,ensure_ascii=False,allow_nan=False)
    if len(payload.encode())>400000:raise ValueError('绘图数据过大')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from PIL import Image
    folder=Path(out_dir);folder.mkdir(parents=True,exist_ok=True)
    captions={};saved=[];total_bytes=0
    def save(fig,name='fig1.png',dpi=150):
        if name!=f'fig{len(saved)+1}.png' or len(saved)>=8:raise ValueError('最多保存八张图，按顺序命名 fig1.png 至 fig8.png')
        image=folder/name
        if not isinstance(dpi,(int,float)) or isinstance(dpi,bool) or not math.isfinite(dpi) or dpi<50 or dpi>200:raise ValueError('绘图 dpi 应在 50～200 之间')
        width,height=fig.get_size_inches()
        if not (0<width<=10 and 0<height<=7):raise ValueError('图表尺寸不能超过 10×7 英寸')
        fig.savefig(str(image),dpi=dpi,bbox_inches='tight',facecolor='white')
        saved.append(image)
        return str(image)
    def caption(name,text):
        if name not in {f'fig{i}.png' for i in range(1,9)} or not isinstance(text,str) or not text.strip() or len(text)>200:raise ValueError('请为 fig1.png 至 fig8.png 提供不超过 200 字的图注')
        captions[name]=text.strip()
    def read_data(path,mode='r',**kwargs):
        if str(path)!=str(folder/'data.json') or mode not in ('r','rt'):raise ValueError('只能读取 DATA_FILE 中的当前测量数据')
        return io.StringIO(payload)
    def allowed_import(name,globals=None,locals=None,fromlist=(),level=0):
        if level or name not in IMPORTS:raise ImportError('本机绘图不支持此模块：'+name)
        return builtins.__import__(name,globals,locals,fromlist,level)
    safe={key:getattr(builtins,key) for key in ('abs','all','any','bool','dict','enumerate','filter','float','int','isinstance','len','list','map','max','min','next','pow','print','range','reversed','round','set','slice','sorted','str','sum','tuple','zip','Exception','ValueError','TypeError','KeyError','ZeroDivisionError')}
    safe.update({'__import__':allowed_import,'open':read_data})
    namespace={'__builtins__':safe,'__name__':'ai_plot','DATA':json.loads(payload),
               'DATA_FILE':str(folder/'data.json'),'OUT_DIR':str(folder),'plt':plt,'save':save,'caption':caption}
    log=LimitedLog()
    try:
        with matplotlib.rc_context({'font.sans-serif':['Lab Maker SC','DejaVu Sans'],'axes.unicode_minus':False,'text.usetex':False}):
            with contextlib.redirect_stdout(log),contextlib.redirect_stderr(log):
                exec(compile(tree,'ai_plot.py','exec'),namespace,namespace)
        if not saved:raise ValueError('绘图代码未调用 save(fig, "fig1.png")')
        images=[]
        for image in saved:
            if image.name not in captions:raise ValueError(f'绘图代码未提供 caption("{image.name}", "图注")')
            size=image.stat().st_size;total_bytes+=size
            if size>8*1024*1024 or total_bytes>32*1024*1024:raise ValueError('单图超过 8 MB 或图组超过 32 MB')
            with Image.open(image) as png:
                if png.format!='PNG' or png.width>2200 or png.height>1600:raise ValueError('图表格式或像素尺寸无效')
                png.verify()
            images.append({'path':str(image),'name':captions[image.name]})
        if set(captions)!={image.name for image in saved}:raise ValueError('存在未保存图片的图注')
        return {**images[0],'images':images,'log':log.getvalue()}
    except BaseException:
        for image in folder.glob('fig*.png'):image.unlink(missing_ok=True)
        raise
    finally:plt.close('all')
