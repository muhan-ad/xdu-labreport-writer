"""官网图组：只读测量数据，确定性派生坐标；不写回 data.json。"""
import importlib.util
import math
from pathlib import Path


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{label}未填写或不是有限数值')
    return float(value)


def positive(data, key):
    v = number(data.get(key), key)
    if v <= 0:
        raise ValueError(f'{key}必须大于0')
    return v


def paired(data, keys, minimum=2):
    arrays = [data.get(k) for k in keys]
    if any(not isinstance(a, list) for a in arrays):
        raise ValueError('请填写：' + '、'.join(keys))
    if len({len(a) for a in arrays}) != 1:
        raise ValueError('同组字段长度不匹配：' + '、'.join(keys))
    rows = []
    for i, row in enumerate(zip(*arrays), 1):
        if all(v in (None, '') for v in row):
            continue
        rows.append([number(v, f'{k}第{i}点') for k, v in zip(keys, row)])
    if len(rows) < minimum:
        raise ValueError(f'{keys[0]}至少需要{minimum}组完整数据')
    return list(map(list, zip(*rows)))


def matrix_rows(data, key, cols):
    raw = data.get(key)
    if not isinstance(raw, list):
        raise ValueError(f'{key}不是表格')
    rows = []
    for i, row in enumerate(raw, 1):
        if not isinstance(row, list) or len(row) != cols:
            raise ValueError(f'{key}第{i}行应为{cols}列')
        if all(v in (None, '') for v in row):
            continue
        rows.append([number(v, f'{key}第{i}行第{j}列') for j, v in enumerate(row, 1)])
    if len(rows) < 2:
        raise ValueError(f'{key}至少需要两行完整数据')
    return rows


def series(x, y, label='实验数据', fit=False):
    return dict(x=x, y=y, label=label, fit=fit)


def spec(key, title, xlabel, ylabel, items, note='', **extras):
    return dict(id=key, title=title, xlabel=xlabel, ylabel=ylabel, series=items, note=note, **extras)


def experiment_module(root, name):
    # 只读取随应用发布的生成脚本，绝不导入用户数据目录里的代码。
    path = Path(root) / name / 'generate.py'
    module_spec = importlib.util.spec_from_file_location('_official_' + name, path)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


def chart_specs(name, data, scripts_root, preset_id='all'):
    """按实验输出多图定义；specific ID只验证该图依赖，不要求其他图数据。"""
    specs = []
    wants = lambda key: preset_id in ('all', key)
    if name == 'RLC电路的稳态特性研究实验':
        if wants('amplitude'):
            rows = matrix_rows(data, 't1', 3)
            resistance = positive(data, 'R')
            f, ui, vr = map(list, zip(*rows))
            if any(v <= 0 for v in f + ui):
                raise ValueError('幅频频率及输入幅值必须大于0')
            if len(set(f)) != len(f):
                raise ValueError('幅频频率点重复，请先核对测量记录')
            current = [1000 * abs(v) / resistance for v in vr]
            module = experiment_module(scripts_root, name)
            # 与报告共用半功率交点算法，未覆盖两侧时不杜撰通频带。
            ordered = sorted(zip(f, current))
            _, f1, f2 = module._find_bandwidth([p[0] for p in ordered], [p[1] for p in ordered])
            note = '输入幅值应保持恒定；I=1000 UR/R（R以Ω计）。'
            if max(ui) - min(ui) > 0.02 * max(ui):
                note += '本组输入幅值变化超过2%，请核对恒幅条件。'
            note += ('两侧半功率点未完整覆盖，暂不标通频带。' if f1 is None or f2 is None
                     else f'半功率频率为{f1:.5g}、{f2:.5g} kHz，通频带{f2-f1:.5g} kHz。')
            specs.append(spec('amplitude', 'RLC串联电路幅频特性', 'f / kHz', 'I / mA', [series(f, current)], note,
                              half_power=max(current)/math.sqrt(2), bandwidth=[f1, f2]))
        if wants('phase'):
            rows = matrix_rows(data, 't2', 3)
            f0 = positive(data, 'f0p')
            f, a, b = map(list, zip(*rows))
            phi = []
            for i, (freq, av, bv) in enumerate(rows, 1):
                if freq <= 0 or av <= 0 or abs(bv) > av:
                    raise ValueError(f'相频第{i}点需满足f>0、A>0、|B|≤A')
                phi.append((0 if math.isclose(freq, f0, rel_tol=0, abs_tol=1e-9) else (-1 if freq < f0 else 1)) * math.asin(abs(bv)/av))
            specs.append(spec('phase', 'RLC串联电路相频特性', 'f / kHz', 'φ / rad', [series(f, phi)], 'φ按总电压相对电流的相位约定：低于谐振为负，高于谐振为正。', zero=True))
    elif name == '光的偏振特性测量':
        x, p = paired(data, ['cos2_values', 'p_values'])
        if any(not 0 <= v <= 1 for v in x) or any(v < 0 for v in p):
            raise ValueError('cos²θ须在0～1之间，光功率不得为负')
        specs.append(spec('malus', '马吕斯定律验证', 'cos²θ', 'P / mW', [series(x, p, fit=True)],
                          '直接使用记录的光功率，不再扣除最小值；含截距拟合用于观察零点偏差，不强制过原点。'))
    elif name == '光的偏振特性测量（第二学期）':
        from common.polarization import compute
        # 原有专用计算完整验证25×3数据，保留同一角度零点。
        compute(data)
        powers = data['power_mw']
        theta = [math.radians(i * 15) for i in range(25)]
        specs.append(spec('polar', '第二学期偏振光三组光功率极坐标图', 'θ / °', 'P / mW',
                          [series(theta, [row[j] for row in powers], f'α={alpha}°') for j, alpha in enumerate((0, 30, 45))],
                          '三组共用径向标尺；极径为光功率，不是电场振幅，不分别扣除各组最小值。', polar=True))
    elif name == '电容与高电阻的测量':
        t, q = paired(data, ['t_values', 'q_values'])
        if any(v <= 0 for v in q):
            raise ValueError('放电电量Q必须大于0才能取对数，请核对零值或负值')
        specs.append(spec('discharge', '高电阻放电法对数关系', 't / s', 'ln[Q / (1 μC)]',
                          [series(t, [math.log(v) for v in q], fit=True)], 'Q按μC记录，以1 μC为对数参考量；由拟合斜率求高阻。'))
    elif name == '衍射光强分布的测量':
        x, intensity = paired(data, ['x', 'I'])
        if any(v < 0 for v in intensity) or max(intensity) <= 0:
            raise ValueError('光强须非负，且中央主极大光强必须大于0')
        peak = max(intensity)
        specs.append(spec('diffraction', '单缝衍射相对光强分布', 'x / mm', 'I / I₀',
                          [series(x, [v/peak for v in intensity])], 'I₀取本组中央主极大的实测光强；连线仅引导视线，未用插值点替代暗纹读数。'))
    elif name == '灵敏电流计特性的测量':
        u, r = paired(data, ['U', 'R'])
        specs.append(spec('galvanometer', '灵敏电流计定偏法R—U关系', 'U / V', 'R / Ω', [series(u, r, fit=True)],
                          'R=kU+b；表头内阻Rg=−b，电流常数由斜率求得，不能强制过原点。'))
    elif name == '电表的改装与校准':
        for key, keys, unit, symbol, title in [('ammeter', ['i_x','i_s'],'mA','I','电流表校正曲线'), ('voltmeter',['u_x','u_s'],'V','U','电压表校正曲线')]:
            if wants(key):
                x, standard = paired(data, keys)
                specs.append(spec(key, title, f'{symbol}x / {unit}', f'Δ{symbol}x= {symbol}s−{symbol}x / {unit}',
                                  [series(x, [s-v for v,s in zip(x,standard)])], '横轴为改装表示值；修正值=标准表示值−改装表示值，保留符号。', zero=True))
    elif name == '电子偏转特性的测量':
        for key, xkey, ykey, xlabel, title in [('electric_x','Udx','D_x','Udx / V','X轴电偏转特性'), ('electric_y','Udy','D_y','Udy / V','Y轴电偏转特性'), ('magnetic','Im','D_m','Im / mA','磁偏转特性')]:
            if not wants(key): continue
            raw = data.get(xkey)
            if not isinstance(raw, list) or len(raw) != 3:
                raise ValueError(f'{xkey}须为1000/900/800V三行，按行读取')
            items = []
            for row, voltage in [(0,1000),(2,800)]:
                x, y = paired({'x':raw[row], 'y':data.get(ykey)}, ['x','y'])
                items.append(series(x,y,f'加速电压{voltage} V',True))
            specs.append(spec(key,title,xlabel,'D / mm',items,'按官网处理要求叠加1000V、800V两系列；900V原始记录保留，不自动混入拟合。'))
    elif name == '理想气体状态方程':
        p0 = positive(data, 'p0')
        if wants('boyle'):
            v, dp = paired(data,['ta_v','ta_dp'])
            if any(p0+d <= 0 for d in dp) or any(a <= 0 for a in v):
                raise ValueError('等温过程的绝对压强和可视体积必须大于0')
            specs.append(spec('boyle','恒温过程V′—1/P关系','1/P / kPa⁻¹','V′ / mL',
                              [series([1/(p0+d) for d in dp],v,fit=True)],'P=P₀+ΔP；保留截距以估计零差体积。'))
        if wants('charles'):
            t, dp = paired(data,['tb_t','tb_dp'])
            if any(v <= -273.15 for v in t) or any(p0+d <= 0 for d in dp):
                raise ValueError('热力学温度及绝对压强必须大于0')
            items=[series([v+273.15 for v in t],[p0+d for d in dp],'升温',True)]
            cooling=data.get('cool_t') or []; cp=data.get('cool_dp') or []
            if any(v not in (None,'') for v in cooling+cp):
                ct,cdp=paired({'t':cooling,'p':cp},['t','p'])
                if any(v <= -273.15 for v in ct) or any(p0+d <= 0 for d in cdp): raise ValueError('降温过程温度或压强无效')
                items.append(series([v+273.15 for v in ct],[p0+d for d in cdp],'降温'))
            specs.append(spec('charles','恒容过程P—T关系','T / K','P / kPa',items,'T=t+273.15，P=P₀+ΔP；升温和降温独立显示。'))
    elif name == '霍尔效应实验':
        for key,prefix,xkey,xlabel,title in [('hall_im','t1','t1_im','Im / mA','霍尔电压与励磁电流'),('hall_i','t2','t2_i','I / mA','霍尔电压与工作电流'),('field_im','t1','t1_im','Im / mA','磁感应强度与励磁电流'),('field_i','t2','t2_i','I / mA','磁感应强度与工作电流')]:
            # B图为辅助图，不包含在默认全部主图中。
            if preset_id=='all' and key.startswith('field_'):continue
            if not wants(key):continue
            x,u1,u2=paired(data,[xkey,prefix+'_u1',prefix+'_u2'])
            y=[(abs(a)+abs(b))/2 for a,b in zip(u1,u2)]
            note='按仅工作电流换向的记录，UH=(|U1|+|U2|)/2；不据电压大小判断N/P型。'
            ylabel='UH / mV'
            if key.startswith('field_'):
                kh=positive(data,'kh'); currents=[positive(data,'i_work')]*len(x) if prefix=='t1' else x
                if any(v<=0 for v in currents):raise ValueError('换算B时工作电流必须大于0')
                y=[u/(kh*i) for u,i in zip(y,currents)];ylabel='B / T'
                note+='辅助图：B=UH/(KH I)，mV/mA换算相消。'
            specs.append(spec(key,title,xlabel,ylabel,[series(x,y,fit=key!='field_i')],note, constant=key=='field_i'))
    elif name == '重力加速度的测量':
        raw=data.get('trials'); pivot=data.get('pivot'); count=len(pivot) if isinstance(pivot,list) else 0
        if not isinstance(raw,list) or len(raw)!=count or count<2:raise ValueError('支点与逐孔计时行数不匹配')
        hraw=data.get('h') or []; t_given=data.get('T_avg') or []; x=[]; y=[]
        cm=data.get('cm_position')
        for i,row in enumerate(raw):
            if not isinstance(row,list):raise ValueError(f'第{i+1}孔计时不是数组')
            times=[number(v,f'第{i+1}孔计时') for v in row if v not in (None,'')]
            if not times:raise ValueError(f'第{i+1}孔缺少10周期计时')
            period=sum(times)/len(times)/10
            if period<=0:raise ValueError('周期必须大于0')
            # 以报告采用的记录单周期优先；没有记录时才由10周期求均值。
            if i<len(t_given) and t_given[i] not in (None,''):period=number(t_given[i],f'T_avg第{i+1}孔')
            if i<len(hraw) and hraw[i] not in (None,''):distance=abs(number(hraw[i],f'h第{i+1}孔'))
            elif cm not in (None,''):distance=abs(number(pivot[i],f'pivot第{i+1}孔')-number(cm,'质心位置'))
            else:raise ValueError(f'第{i+1}孔缺少h或质心位置')
            if distance<=0 or period<=0:raise ValueError('h及周期T必须大于0')
            x.append(distance);y.append(period)
        specs.append(spec('pendulum','复摆周期与悬点距质心距离','h / cm','T / s',[series(x,y)],'使用单周期T；无记录单周期时，由同孔10周期计时均值除以10得到。连线仅引导视线。'))
    elif name == '直螺线管磁场分布的测量':
        i,dm1,dm2=paired(data,['I0_ma','dm1_cm','dm2_cm'])
        mutual=positive(data,'M_mH')/1000
        dm=[(a+b)/2*10 for a,b in zip(dm1,dm2)]
        if any(v<=0 for v in i+dm):raise ValueError('标定电流与平均偏转须大于0')
        from common import outlier_test
        kept=outlier_test([mutual*a/1000/b for a,b in zip(i,dm)])['kept']
        rkb=sum(kept)/len(kept)
        x,left,right=paired(data,['x_mm','d_left_cm','d_right_cm'])
        n=positive(data,'n_coil');area=positive(data,'S_m2')
        # 官网打开/闭合电流取平均磁通变化，不是反转电流的2B。
        b=[rkb*((a+c)/2*10)/(n*area) for a,c in zip(left,right)]
        if any(v<0 for v in x):raise ValueError('本预设接收中心至正侧的实测位置；负侧按对称性延拓，请勿混入两侧实测')
        specs.append(spec('solenoid','直螺线管轴向磁场分布','x / mm','B / T',
                          [series(x,b,'正侧实测'), series([-v for v in x],[v for v in b],'负侧对称延拓')],
                          '负侧由对称性延拓，不是独立实测；中心x=0。RKb采用与报告相同的坏值检验后均值。', xlim=[-200,200]))
    elif name == '静电场的模拟':
        module=experiment_module(scripts_root,name); result=module._compute(data)
        if wants('coax'):
            items=[]
            for level,row in zip(module.COAX_LEVELS,result['coax_radii']):
                angles=[math.radians(v) for v in module.ANGLES]
                xs=[r*math.cos(a) for r,a in zip(row,angles)]; ys=[r*math.sin(a) for r,a in zip(row,angles)]
                items.append(series(xs+[xs[0]],ys+[ys[0]],f'{level} V'))
            specs.append(spec('coax','同轴电缆等势线与电场线','x / cm','y / cm',items,'点为实测等势点；连接用于描绘等势线，箭头按同轴电极边界模型指向低电势。', equal=True,coax=result))
        if wants('potential'):
            specs.append(spec('potential','同轴电缆归一化电位与半径对数关系','ln[r / (1 cm)]','U′r / Ua',
                              [series(result['ln_r'],result['u_r_ua'],fit=True)], '实验拟合与理论关系同图；对数中r的参考单位为cm。', theory=[result['theory_slope'],result['theory_intercept']]))
        if wants('parallel'):
            specs.append(spec('parallel','平行线电极等势线与电场线','x / cm','y / cm',[], '等势线采用全部实测点；模型或数据异常时不强行绘制电场方向。', equal=True,parallel=result))
    else:
        raise ValueError('本实验尚无已核实的官网专用图组，可手动选择字段或使用自定义图表')
    if not specs:raise ValueError('本实验不存在所选的图表方案，请重新选择')
    return specs


def render_specs(specs, output_path, scripts_root):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.sans-serif':['Microsoft YaHei','SimHei','DejaVu Sans'],'axes.unicode_minus':False})
    images=[]
    for i,s in enumerate(specs):
        path=Path(output_path) if i==0 else Path(output_path).with_name(Path(output_path).stem+f'_{i+1}.png')
        path.parent.mkdir(parents=True,exist_ok=True)
        fig,ax=plt.subplots(figsize=(7.2,5.3),subplot_kw={'projection':'polar'} if s.get('polar') else {})
        if s.get('parallel') or s.get('coax'):
            module=experiment_module(scripts_root,'静电场的模拟')
            plt.close(fig)
            def save_field(figure, target):
                for axes in figure.axes:
                    axes.set_title(''); axes.set_aspect('equal',adjustable='box')
                figure.savefig(target,dpi=160,bbox_inches='tight',facecolor='white');plt.close(figure)
            # 共用报告的场线算法，只替换本次模块实例的保存回调。
            module._save_figure=save_field
            if s.get('parallel'):
                module._plot_parallel(s['parallel'],str(path))
                s['note']+=' '+ '；'.join(s['parallel']['warnings'])
            else:module._plot_coax(s['coax'],str(path))
            images.append(dict(path=str(path),title=s['title'],caption=s['title'],note=s['note'],id=s['id']))
            continue
        for series_index,item in enumerate(s['series']):
            color=plt.rcParams['axes.prop_cycle'].by_key()['color'][series_index % 10]
            x=np.asarray(item['x'],dtype=float);y=np.asarray(item['y'],dtype=float)
            if s.get('polar'):
                ax.plot(x,y,'o-',markersize=3,color=color,label=item['label'])
            elif item['fit']:
                if len(x)<3 or len(set(x))<2:raise ValueError(f"{s['title']}线性拟合至少需要3点及不同横坐标")
                a,b=np.polyfit(x,y,1);xx=np.array([min(x),max(x)])
                ax.scatter(x,y,s=24,color=color,label=item['label'])
                ax.plot(xx,a*xx+b,color=color,label=f'y={a:.5g}x{b:+.5g}')
            else:
                order=np.arange(len(x)) if s.get('equal') else np.argsort(x,kind='stable')
                ax.plot(x[order],y[order],'o-',markersize=3,color=color,label=item['label'])
        if s.get('theory'):
            a,b=s['theory'];x=s['series'][0]['x'];xx=np.array([min(x),max(x)])
            ax.plot(xx,a*xx+b,'--',label='理论关系')
        if s.get('coax'):
            r=s['coax']
            for angle in np.linspace(0,2*math.pi,8,endpoint=False):
                ax.annotate('',xy=(r['r_b']*math.cos(angle),r['r_b']*math.sin(angle)),xytext=(r['r_a']*math.cos(angle),r['r_a']*math.sin(angle)),arrowprops=dict(arrowstyle='->',color='#888'))
        if s.get('half_power') is not None:
            ax.axhline(s['half_power'],linestyle='--',color='#888',label='Imax/√2')
            a,b=s['bandwidth']
            if a is not None and b is not None:
                ax.axvspan(a,b,alpha=.12,color='#2b8a52',label='通频带')
        if s.get('zero'):ax.axhline(0,color='#999',lw=.8)
        if s.get('constant'):
            y=s['series'][0]['y'];ax.axhline(sum(y)/len(y),linestyle='--',label='均值')
        if s.get('equal'):ax.set_aspect('equal',adjustable='box')
        if s.get('xlim'):ax.set_xlim(*s['xlim'])
        def label(value):
            return value.replace('I₀', '$I_0$').replace('kPa⁻¹', r'$\mathrm{kPa}^{-1}$')
        if s.get('polar'):
            ax.set_ylim(bottom=0)
            ax.text(-.10,1.08,label(s['ylabel']),transform=ax.transAxes)
            ax.legend(fontsize=8,loc='upper left',bbox_to_anchor=(1.13,1.08))
        else:ax.set_xlabel(label(s['xlabel']));ax.set_ylabel(label(s['ylabel']))
        ax.grid(alpha=.22)
        if not s.get('polar'):ax.legend(fontsize=8)
        fig.tight_layout()
        fig.savefig(path,dpi=160,bbox_inches='tight');plt.close(fig)
        images.append(dict(path=str(path),title=s['title'],caption=s['title'],note=s['note'],id=s['id']))
    return images
