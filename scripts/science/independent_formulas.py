"""Independent dimensional/formula oracle. Only stdlib + explicit measurement input.
Never imports report generators, calculation_context, NumPy or their result objects.
Each returned tuple is (exported key, expected value, report unit, reference formula).
Covers selected primary quantities, not the complete uncertainty/outlier/plot analysis.
"""
import math
from statistics import mean
PI=math.pi
R_GAS=6.02214076e23*1.380649e-23  # exact SI defining constants N_A*k_B

def line(x,y):
    mx,my=mean(x),mean(y);sxx=sum((v-mx)**2 for v in x)
    slope=sum((a-mx)*(b-my) for a,b in zip(x,y))/sxx
    return slope,my-slope*mx

def solve3(a,b):
    m=[list(row)+[value] for row,value in zip(a,b)]
    for col in range(3):
        pivot=max(range(col,3),key=lambda j:abs(m[j][col]));m[col],m[pivot]=m[pivot],m[col]
        div=m[col][col];m[col]=[v/div for v in m[col]]
        for row in range(3):
            if row!=col:
                div=m[row][col];m[row]=[x-div*y for x,y in zip(m[row],m[col])]
    return [row[-1] for row in m]

def references(name,d):
    out=[]
    def put(key,value,unit,formula):out.append((key,value,unit,formula))
    if name=='刚体转动惯量的测量':
        r,R,T0,H,a,b,T=map(mean,d['measurements']);r,R,H,a,b=[v/100 for v in (r,R,H,a,b)];m0=d['m0_g']/1000;m=d['m_g']/1000
        factor=d['instrument_g']*r*R/(4*PI**2*H)
        put('I0',factor*m0*T0*T0,'kg m²','m0*g*r*R*T0²/(4π²H), cm→m and g→kg')
        put('I_exp',factor*((m0+m)*T*T-m0*T0*T0),'kg m²','g*r*R*((m0+m)*T²-m0*T0²)/(4π²H)')
        put('I_theory',m*(a*a+b*b)/8,'kg m²','m*(d²+D²)/8')
    elif name=='扭摆法测量钢丝切变模量':
        T0=mean(d['t_disk'])/30;T=mean(d['t_ring'])/30;wire=(mean(d['d_horiz']+d['d_vert'])-d['d_zero'])/1000
        G=16*PI*(d['l_mm']/1000)*(d['m_g']/1000)*((d['D1_mm']/1000)**2+(d['D2_mm']/1000)**2)/(wire**4*(T*T-T0*T0))
        put('T0',T0,'s','mean(30T_disk)/30');put('T',T,'s','mean(30T_ring)/30');put('G',G,'Pa','16π*l*m*(D1²+D2²)/(d⁴*(T²-T0²))')
    elif name=='拉伸法测量钢丝杨氏弹性模量':
        n=[(a+b)/2 for a,b in zip(d['ni_zheng'],d['ni_jian'])];delta=mean(n[i+4]-n[i] for i in range(4));wire=(mean(d['d_shi'])-d['d_0'])/1000
        young=8*4*d['instrument_g']*d['L']*d['H']/(PI*wire**2*(d['D']/1000)*(delta/100))
        put('delta_n_a',delta,'cm','mean(n[i+4]-n[i]), each n=mean(load,unload)');put('Y',young/1e11,'10¹¹ Pa','8*Δm*g*L*H/(π*d²*D*Δn), Δm=4 kg')
    elif name=='重力加速度的测量':
        periods=d.get('T_avg') or [mean(row)/10 for row in d['trials']];pairs=sorted(zip(d['h'],periods));minimum=min(periods);idx=next(i for i,(_,t) in enumerate(pairs) if t==minimum)
        level=(minimum+min(max(t for _,t in pairs[:idx]),max(t for _,t in pairs[idx+1:])))/2
        roots=[]
        for (a,ta),(b,tb) in zip(pairs,pairs[1:]):
            if min(ta,tb)<level<max(ta,tb):roots.append(a+(b-a)*(level-ta)/(tb-ta))
        if len(roots)!=2:raise ValueError('reference fixture requires two unique intersections')
        length=sum(roots)/100;g=4*PI**2*length/level**2
        put('T0',level,'s','midpoint of overlapping branch period ranges');put('l_m',length,'m','sum of the two linear T-h intersections, cm→m');put('g_calc',g,'m/s²','4π²*(h1+h2)/T0²')
    elif name in ('三棱镜顶角的测量','光栅光谱的测量'):
        rows=d.get('readings',d.get('angles'));angles=[]
        for row in rows:
            x=[row[j]+row[j+1]/60 for j in (0,2,4,6)];diff=lambda a,b:abs((a-b+180)%360-180)
            angles.append((diff(x[2],x[0])+diff(x[3],x[1]))/4)
        if name=='三棱镜顶角的测量':put('alpha_mean',mean(angles),'degree','mean((wrapped reflected-angle differences)/4)')
        else:
            phi=mean(angles[2:]);spacing=d['lambda_green']/math.sin(math.radians(phi));put('phi_green_mean',phi,'degree','mean green line diffraction angles (last three rows)');put('d_nm',spacing,'nm','λ_green/sin(phi), first diffraction order');put('kmax_theory',math.floor(spacing/d['lambda_green']),'order','floor(d/λ_green)')
    elif name=='光的偏振特性测量':
        dark=d['p_values'][d['cos2_values'].index(0)];slope,intercept=line(d['cos2_values'],[p-dark for p in d['p_values']]);put('slope',slope,'measured power','OLS of dark-corrected P-P(90°) against cos²θ');put('intercept',intercept,'measured power','dark-corrected mean power - slope*mean(cos²θ)')
    elif name=='光的偏振特性测量（第二学期）':
        design=[[1,math.cos(math.radians(2*i*15)),math.sin(math.radians(2*i*15))] for i in range(len(d['power_mw'])-1)];matrix=[[sum(row[j]*row[k] for row in design) for k in range(3)] for j in range(3)]
        for col,key in enumerate(('m0','m30','m45')):
            rhs=[sum(row[j]*power[col] for row,power in zip(design,d['power_mw'][:-1])) for j in range(3)];a,b,c=solve3(matrix,rhs);put(key,math.hypot(b,c)/a,'1','24-angle harmonic OLS, 360° closure excluded; modulation=hypot(B,C)/A')
    elif name=='劈尖干涉':
        x=d['x_k'];beta=mean(x[i+4]-x[i] for i in range(4))/40;put('s',beta,'mm','four-pair successive differences divided by 40 fringes');put('d_bar',d['wavelength_nm']*1e-6*(d['X2']-d['X1'])/(2*beta),'mm','λ*L/(2β), nm→mm')
    elif name=='平凸透镜曲率半径的测量':
        diam=[b-a for a,b in zip(d['d_left'],d['d_right'])];radii=[(diam[i]**2-diam[i+5]**2)/(4*5*d['wavelength_nm']*1e-6) for i in range(5)];put('R_bar',mean(radii),'mm','mean((D_m²-D_(m-5)²)/(4*5*λ)), nm→mm')
    elif name=='激光波长的测量':
        delta=mean(b-a for a,b in d['measurements']);wavelength=2*delta/d['N']*1e6;put('lam_bar_nm',wavelength,'nm','2*mean(micrometer displacement)/fringe count, mm→nm');put('eta',abs(wavelength-d['lambda0_nm'])/d['lambda0_nm']*100,'%','100*abs(λ-λ0)/λ0')
    elif name=='薄透镜焦距的测量（凸透镜）':
        put('f_auto_bar',mean(d['f_auto']),'cm','mean autocollimation focal distances');put('f_uv_bar',mean(d['u']*v/(d['u']+v) for v in d['v']),'cm','mean(u*v/(u+v))');put('f_conj_mean',mean(((screen-d['x0'])**2-(b-a)**2)/(4*(screen-d['x0'])) for screen,a,b in d['conjugate']),'cm','mean((D²-distance_between_lens_positions²)/(4D))')
    elif name=='薄透镜焦距的测量（凹透镜）':
        put('f_auto_bar',mean(d['f_auto']),'cm','mean convex-reference autocollimation');put('f_ca_abs_bar',mean(abs(a-b) for a,b in zip(d['x6'],d['x7'])),'cm','mean absolute autocollimation screen/lens separation');put('f_im_bar',mean((screen1-lens)*(screen2-lens)/((screen1-lens)-(screen2-lens)) for screen1,lens,screen2 in d['concave']),'cm','mean(u*v/(u-v)), signed virtual-object lens equation')
    elif name=='衍射光强分布的测量':
        x,y=d['x'],d['I'];center=x[y.index(max(y))];points=[]
        for i in range(1,len(x)-1):
            if y[i]<=y[i-1] and y[i]<=y[i+1] and y[i]<max(y)*.05:
                xx=x[i-1:i+2];yy=y[i-1:i+2];a,b,c=solve3([[1,v,v*v] for v in xx],yy);vertex=-b/(2*c);points.append(vertex)
        left=sorted((v for v in points if v<center),reverse=True);right=sorted(v for v in points if v>center);widths=[2*(k+1)*d['lambda_nm']*1e-6*d['L']/(b-a) for k,(a,b) in enumerate(zip(left[:3],right[:3]))];put('a_mean',mean(widths),'mm','mean(2*k*λ*L/(x_right-x_left)), quadratic dark-fringe interpolation')
    elif name=='RLC电路的稳态特性研究实验':
        f=1/(2*PI*math.sqrt(d['L']*1e-3*d['C']*1e-6))/1000;put('f0',f,'kHz','1/(2πsqrt(L*C)), mH→H, μF→F, Hz→kHz');put('eta',abs(d['f0p']-f)/f*100,'%','100*abs(measured f0 - unrounded theoretical f0)/theoretical f0')
        freq=[row[0] for row in d['t1']];current=[row[2]/d['R']*1000 for row in d['t1']];peak=max(current);threshold=peak/math.sqrt(2);cross=[]
        for i in range(len(freq)-1):
            if (current[i]-threshold)*(current[i+1]-threshold)<0:cross.append(freq[i]+(freq[i+1]-freq[i])*(threshold-current[i])/(current[i+1]-current[i]))
        put('i_max',peak,'mA','max(U_R/R), A→mA');put('q',f/(cross[1]-cross[0]),'1','theoretical resonance frequency / interpolated half-power bandwidth')
    elif name=='低电阻的测量':
        diameter=mean(d['d']);resistance=[(a+b)/2*d['R_3']/d['R_1'] for a,b in zip(d['R_n_zheng'],d['R_n_fan'])];rho=[PI*(diameter/1000)**2*r/(4*l/1000) for r,l in zip(resistance,d['L'])];put('R_x_a',mean(resistance)*1000,'mΩ','mean(Rn_forward+Rn_reverse)/2 * R3/R1, Ω→mΩ');put('rho_a',mean(rho)/1e-8,'10⁻⁸ Ω m','mean(π*d²*Rx/(4L)), d/L mm→m')
    elif name=='灵敏电流计特性的测量':
        k,b=line(d['U'],d['R']);put('Rg',-b,'Ω','negative OLS intercept of R against U');put('Ki',d['rs']/(d['r1']*d['d']*k),'A/mm','Rs/(R1*deflection*OLS slope)')
    elif name=='电子偏转特性的测量':
        for axis,key in [('x','Udx'),('y','Udy')]:
            for index,voltage in [(0,1000),(2,800)]:put('e'+axis+'_'+str(voltage),line(d[key][index],d['D_'+axis])[0],'mm/V','OLS deflection against voltage, specified first/third acceleration rows')
        for index,voltage in [(0,1000),(2,800)]:put('dm_'+str(voltage),line(d['Im'][index],d['D_m'])[0],'mm/mA','OLS magnetic deflection against measured current')
    elif name=='电子元件伏安特性的测量':
        slope,intercept=line(d['t1_u'],d['t1_i']);put('R1_fit',1000/slope,'Ω','1000 / OLS(I_mA against U_V)');put('b1',intercept,'mA','OLS current intercept')
    elif name=='电容与高电阻的测量':
        put('c_x_bar',d['c_n']*mean(x/n for x,n in zip(d['q_x'],d['q_n'])),'μF','Cn*mean(Qx/Qn)');t,q=d['t_values'],d['q_values'];slope=(math.log(q[-1])-math.log(q[0]))/(t[-1]-t[0]);put('r_mohm',-1/(slope*d['c_n']),'MΩ','-1/(Cn*d(lnQ)/dt), two-point graph method');fit=line(t,[math.log(v) for v in q])[0];put('r_fit_mohm',-1/(fit*d['c_n']),'MΩ','-1/(Cn*OLS slope of lnQ against t)')
    elif name=='电表的改装与校准':
        resistance=mean(d['rg']);put('rg_mean',resistance,'Ω','mean measured meter resistance');put('r_s_calc',resistance/9,'Ω','Rg/(10-1), original 0.1 mA movement to 1 mA range');put('r_h_calc',1/.0001-resistance,'Ω','1 V / 0.1 mA - Rg')
    elif name=='直螺线管磁场分布的测量':
        rk=mean(d['M_mH']*1e-3*(current/1000)/((a+b)/2*10) for current,a,b in zip(d['I0_ma'],d['dm1_cm'],d['dm2_cm']));B=rk*((d['d_left_cm'][0]+d['d_right_cm'][0])/2*10)/(d['n_coil']*d['S_m2']);theory=4*PI*1e-7*d['N']*(d['I_mA']/1000)/math.sqrt(d['l_m']**2+4*(d['r0_cm']/100)**2)
        put('RKb_mean',rk,'C Ω/mm','mean(M*I0/dm), mH→H, mA→A, cm→mm');put('B_exp_center',B,'T','RKb*center deflection/(n*S)');put('B0_theory',theory,'T','μ0*N*I/sqrt(l²+4r²), mA→A and cm→m');put('E_rel',abs(B-theory)/theory*100,'%','100*abs(Bmeasured-Btheory)/Btheory')
    elif name=='霍尔效应实验':
        b=[(a-c)/2/(d['kh']*current) for a,c,current in zip(d['t2_u1'],d['t2_u2'],d['t2_i'])];put('b2_mean',mean(b),'T','mean((U_positive-U_negative)/(2*KH*I_work)), mV and mA cancel');fields=[(a-c)/2/(d['kh']*d['i_work']) for a,c in zip(d['t1_u1'],d['t1_u2'])];put('k',line([v/1000 for v in d['t1_im']],fields)[0],'T/A','OLS B against magnet current, mA→A')
    elif name=='静电场的模拟':
        x=[math.log(mean(row)) for row in d['coax_radii']];y=[(i+1)/d['u_a'] for i in range(len(x))];slope,intercept=line(x,y);put('slope',slope,'1','OLS U/Ua against ln(r)');put('intercept',intercept,'1','OLS normalized voltage intercept');put('theory_slope',-1/math.log(d['r_b']/d['r_a']),'1','-1/ln(rb/ra)')
    elif name in ('声速的测量（水中）','声速的测量（空气）'):
        wavelengths=[2*mean(row[i+6]-row[i] for i in range(6))/6 for row in (d['L1'],d['L2'])]
        for i,w in enumerate(wavelengths,1):put('lambda'+str(i),w,'mm','2*mean(L[i+6]-L[i])/6');put('v'+str(i),d['f']*w,'m/s','frequency_kHz * wavelength_mm')
        put('v_avg',d['f']*mean(wavelengths),'m/s','f*mean(two wavelengths)')
    elif name=='理想气体状态方程':
        pressure=[d['p0']+p for p in d['ta_dp']];intercept=(d['ta_v'][-1]-d['ta_v'][0])/(1/pressure[-1]-1/pressure[0]);dead=intercept/pressure[0]-d['ta_v'][0];amount=intercept*1e-3/(R_GAS*(d['t_iso']+273.15));iso_slope=(d['tb_dp'][-1]-d['tb_dp'][0])/(d['tb_t'][-1]-d['tb_t'][0])
        put('V0',dead,'mL','two graph endpoints: V_visible = nRT/P - V_dead');put('n_mmol',amount*1000,'mmol','isothermal graph slope /(R*T), kPa*mL→J');put('R_exp',iso_slope*(d['vp']+dead)*1e-3/amount,'J/(mol K)','heating-curve endpoint dP/dT*(V_visible+V_dead)/n')
    elif name=='长度与体积的测量':
        diameter=mean(d['D'])-d['d0_card'];thickness=mean(d['d_shi'])-d['d0'];a=mean(x1-x0 for x0,x1 in zip(d['X0'],d['X1']));b=mean(y1-y0 for y0,y1 in zip(d['Y0'],d['Y1']));volume=(d['L']*d['W']-PI*diameter**2/4-a*b)*thickness
        put('d_corrected',thickness,'mm','mean micrometer reading - zero reading');put('D_corrected',diameter,'mm','mean caliper diameter - zero reading');put('V',volume,'mm³','(L*W - circular-hole area - rectangular-slot area)*corrected thickness')
    else:raise ValueError('independent reference not defined: '+name)
    return out
