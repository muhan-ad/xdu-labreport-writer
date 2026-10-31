"""Independent stdlib checks of selected course uncertainty models.

Expectations use only measurement inputs, never generator functions or outputs.
The small-sample factors below are the course's 68.3% convention (n>6: 1),
not a general statement about Student quantiles. Instrument limits are inputs.
"""
import math
from statistics import mean, stdev

SUPPORTED = {
    '刚体转动惯量的测量',
    '激光波长的测量', '薄透镜焦距的测量（凸透镜）',
    '薄透镜焦距的测量（凹透镜）', '灵敏电流计特性的测量',
    '电子元件伏安特性的测量',
    '直螺线管磁场分布的测量',
    '长度与体积的测量',
}


def equal_precision(values):
    """Course t*s/sqrt(n); only fixtures with no rejected observations here."""
    n = len(values)
    if n < 2:
        raise ValueError('at least two repeated measurements required')
    factor = 1 if n > 6 else {2: 1.84, 3: 1.32, 4: 1.20, 5: 1.14, 6: 1.11}[n]
    spread = stdev(values)
    if spread and any(abs(v-mean(values)) >= 3*factor*spread for v in values):
        raise ValueError('this uncertainty oracle requires a fixture without outliers')
    return factor*spread/math.sqrt(n)


def fit_uncertainty(x, y):
    """OLS covariance from centered sums; independent of shared regression.py."""
    n = len(x)
    if n != len(y) or n < 3:
        raise ValueError('at least three paired observations required')
    center = mean(x)
    ss = math.fsum((v-center)**2 for v in x)
    if not ss:
        raise ValueError('identical abscissas cannot be fitted')
    slope = math.fsum((a-center)*(b-mean(y)) for a, b in zip(x, y))/ss
    intercept = mean(y)-slope*center
    residual = math.sqrt(math.fsum((b-intercept-slope*a)**2 for a, b in zip(x, y))/(n-2))
    return slope, residual/math.sqrt(ss), residual*math.sqrt(1/n+center*center/ss)


def references(name, data):
    out = []
    def put(key, value, unit, formula):
        out.append((key, value, unit, formula))
    if name not in SUPPORTED:
        return out
    if name == '刚体转动惯量的测量':
        # Course script treats the balance input as an already-used mass
        # uncertainty, while ruler/timer inputs are uniform limits. This
        # comparison checks that stated model, not its experimental validity.
        rows=data['measurements']; limits=[data['instrument_delta_ruler']]*2+[data['instrument_delta_timer'],data['instrument_delta_ruler']]
        labels=['r','R','T0','H']; values=[]
        for label,row,limit in zip(labels,rows[:4],limits):
            ua=equal_precision(row);ub=limit/math.sqrt(3);combined=math.hypot(ua,ub);values.append(combined)
            put('u_'+label+'A',ua,'s' if label=='T0' else 'cm','t*s/sqrt(n), no removed observations')
            put('u_'+label+'B',ub,'s' if label=='T0' else 'cm','instrument limit / sqrt(3)')
            put('u_'+label,combined,'s' if label=='T0' else 'cm','hypot(type A, type B)')
        r,R,T0,H=(mean(row) for row in rows[:4]);ur,uR,uT0,uH=values
        mass=data['m0_g']/1000;um=data['instrument_delta_balance']/1000
        inertia=data['instrument_g']*(r/100)*(R/100)*mass*T0*T0/(4*math.pi**2*(H/100))
        relative=math.sqrt((um/mass)**2+(ur/r)**2+(uR/R)**2+(uH/H)**2+(2*uT0/T0)**2)
        put('u_m0',um,'kg','balance input converted g→kg under current course model')
        put('rel_u_I0',relative,'1','quadrature of mass, r, R, H and twice period relative uncertainties')
        put('u_I0',inertia*relative,'kg m²','I0 times combined relative uncertainty')
    elif name == '长度与体积的测量':
        # Treat instrument limits as user-supplied; zero corrections are fixed.
        # These test cases intentionally contain no rejected observations.
        diameter = mean(data['D'])-data['d0_card']
        thickness = mean(data['d_shi'])-data['d0']
        lx = [abs(b-a) for a,b in zip(data['X0'],data['X1'])]
        ly = [abs(b-a) for a,b in zip(data['Y0'],data['Y1'])]
        ux = math.hypot(equal_precision(lx),math.sqrt(2/3)*data['dx_inst'])
        uy = math.hypot(equal_precision(ly),math.sqrt(2/3)*data['dx_inst'])
        ud = math.hypot(equal_precision(data['d_shi']),data['dd_shi_inst']/math.sqrt(3))
        uD = math.hypot(equal_precision(data['D']),data['dd_inst']/math.sqrt(3))
        ul = data['dl_inst']/math.sqrt(3)
        length,width=data['L'],data['W'];mx,my=mean(lx),mean(ly)
        area=length*width-math.pi*diameter**2/4-mx*my
        uvolume=math.sqrt((width*thickness*ul)**2+(length*thickness*ul)**2+
                          (math.pi*diameter*thickness*uD/2)**2+
                          (my*thickness*ux)**2+(mx*thickness*uy)**2+(area*ud)**2)
        for key,value,unit,formula in [
          ('uL',ul,'mm','length instrument limit / sqrt(3)'),
          ('uD',uD,'mm','hypot(repeated diameter type A, caliper limit / sqrt(3))'),
          ('ud',ud,'mm','hypot(repeated thickness type A, micrometer limit / sqrt(3))'),
          ('uLx',ux,'mm','hypot(repeated length differences type A, sqrt(2/3) microscope limit)'),
          ('uLy',uy,'mm','hypot(repeated width differences type A, sqrt(2/3) microscope limit)'),
          ('uV',uvolume,'mm³','independent derivatives of (L*W - π*D²/4 - lx*ly)*d')]:put(key,value,unit,formula)
    elif name == '直螺线管磁场分布的测量':
        # Preserve the existing course model: M, n and S are fixed; the three
        # calibration type-B components are combined as RMS, without changing
        # its assumed correlations. Each ruler INPUT is a single reading.
        m = data['M_mH']/1000
        ruler = data['instrument_delta_scale_mm']/10/math.sqrt(3)
        current = data['instrument_delta_ammeter_a']/math.sqrt(3)
        values, variances = [], []
        for milliamps, left, right in zip(data['I0_ma'], data['dm1_cm'], data['dm2_cm']):
            distance = (left+right)/2
            value = m*(milliamps/1000)/(10*distance)
            values.append(value)
            variances.append((m/(10*distance)*current)**2 + 2*(value/(2*distance)*ruler)**2)
        ua = equal_precision(values)
        ub = math.sqrt(mean(variances))
        combined = math.hypot(ua, ub)
        center = (data['d_left_cm'][0]+data['d_right_cm'][0])/2
        factor = 10*center/(data['n_coil']*data['S_m2'])
        field = mean(values)*factor
        ruler_mean = ruler/math.sqrt(2)
        field_a = factor*ua
        field_b = math.hypot(factor*ub, field*ruler_mean/center)
        put('u_dm_single_cm', ruler, 'cm', 'single ruler limit(mm)/10/sqrt(3)')
        put('u_dm_mean_cm', ruler_mean, 'cm', 'two independent readings averaged: u_single/sqrt(2) exactly once')
        put('u_A_RKb', ua, 'C ohm/mm', 't*s(RKb)/sqrt(3)')
        put('u_B_RKb', ub, 'C ohm/mm', 'RMS of analytical propagation in I0, d1 and d2, each supplied with single-reading u')
        put('u_RKb', combined, 'C ohm/mm', 'hypot(u_A_RKb,u_B_RKb)')
        put('u_B_center_A', field_a, 'T', '10*mean(center readings)/(n*S)*u_A_RKb')
        put('u_B_center_B', field_b, 'T', 'hypot(10*center/(n*S)*u_B_RKb,B*u_mean/center)')
        put('u_B_center', math.hypot(field_a, field_b), 'T', 'hypot(type-A field component,type-B field component)')
    elif name == '激光波长的测量':
        ua = equal_precision([abs(b-a) for a, b in data['measurements']])
        ub = data['instrument_delta_inst_mm']/math.sqrt(3)
        uc = math.hypot(ua, ub)
        put('u_A', ua, 'mm', 't*s(displacement)/sqrt(n)')
        put('u_B', ub, 'mm', 'user instrument limit/sqrt(3)')
        put('u_d', uc, 'mm', 'hypot(u_A,u_B)')
        put('u_lam', 2*uc/data['N'], 'mm', '|d(lambda)/d(displacement)|*u_d = 2*u_d/N')
        put('u_lam_nm', 2*uc/data['N']*1e6, 'nm', 'u_lambda_mm*10^6')
    elif name.startswith('薄透镜焦距'):
        ub = data['instrument_delta_instrument']/math.sqrt(3)
        ua = equal_precision(data['f_auto'])
        put('u_auto', math.hypot(ua, ub), 'cm', 'hypot(t*s(f_auto)/sqrt(n),limit/sqrt(3))')
        if name.endswith('（凸透镜）'):
            uav = equal_precision(data['v'])
            uv = math.hypot(uav, ub)
            put('uA_auto', ua, 'cm', 't*s(f_auto)/sqrt(n)')
            put('uB_auto', ub, 'cm', 'limit/sqrt(3)')
            put('uA_v', uav, 'cm', 't*s(v)/sqrt(n)')
            put('uB_v', ub, 'cm', 'limit/sqrt(3)')
            put('u_v', uv, 'cm', 'hypot(uA_v,uB_v)')
            put('u_f_uv', data['u']**2/(data['u']+mean(data['v']))**2*uv,
                'cm', 'fixed-object-distance course model: u^2*u(v)/(u+mean(v))^2')
        else:
            uagap = equal_precision([abs(b-a) for a, b in zip(data['x6'], data['x7'])])
            ubgap = math.sqrt(2)*ub
            put('uA_ca', uagap, 'cm', 't*s(position difference)/sqrt(n)')
            put('uB_ca', ubgap, 'cm', 'independent two-position errors: sqrt(2)*limit/sqrt(3)')
            put('u_ca', math.hypot(uagap, ubgap), 'cm', 'hypot(uA_ca,uB_ca)')
    elif name == '灵敏电流计特性的测量':
        k, uk, ub = fit_uncertainty(data['U'], data['R'])
        ki = data['rs']/(data['r1']*data['d']*k)
        put('u_k', uk, 'ohm/V', 'sqrt(SSE/(n-2)/Sxx)')
        put('u_b', ub, 'ohm', 'sqrt(SSE/(n-2)*(1/n+mean(U)^2/Sxx))')
        put('u_Rg', ub, 'ohm', 'Rg=-intercept; u(Rg)=u(intercept)')
        put('u_Ki', abs(ki/k)*uk, 'A/mm', '|d(Ki)/d(k)|*u(k), other inputs fixed')
    elif name == '电子元件伏安特性的测量':
        k, uk, ub = fit_uncertainty(data['t1_u'], data['t1_i'])
        put('u_k1', uk, 'mA/V', 'sqrt(SSE/(n-2)/Sxx)')
        put('u_b1', ub, 'mA', 'sqrt(SSE/(n-2)*(1/n+mean(U)^2/Sxx))')
        put('u_R1_fit', 1000*uk/(k*k), 'ohm', '|d(1000/k)/d(k)|*u(k), mA to A')
    return out
