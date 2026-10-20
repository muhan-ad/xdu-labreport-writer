/* 官网要求核对：2026-10-17。此表不含测量值。 */
(function(root){ const catalog={
  "RLC电路的稳态特性研究实验": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/rlcatoxqfof.pdf",
    "pages": "2",
    "description": "两张：X=f/kHz，Y=I/mA；X=f/kHz，Y=φ/rad",
    "note": "幅频图须标通频带；由UR/R换算电流，相位用B/A计算并处理正负。输入Ui须恒定，不应以Ui作为幅频图纵轴。官网要求在坐标纸作图，软件可复现同一坐标与标记。",
    "charts": [
      {
        "id": "amplitude",
        "title": "幅频特性",
        "xLabel": "f / kHz",
        "yLabel": "I / mA"
      },
      {
        "id": "phase",
        "title": "相频特性",
        "xLabel": "f / kHz",
        "yLabel": "φ / rad"
      }
    ]
  },
  "三棱镜顶角的测量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/alzztpmz.pdf",
    "pages": "2",
    "description": "默认不生成数据关系图",
    "note": "官网要求详细计算顶角、绝对和相对不确定度；不把“度”和“分”互作坐标。可选测量组号—顶角散点仅为扩展。",
    "charts": []
  },
  "低电阻的测量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/aozpmz.pdf",
    "pages": "1–2",
    "description": "默认不生成；可选X=L/mm，Y=Rx/Ω",
    "note": "官网规定各长度正反向处理、计算Rx/L、电阻率和不确定度，没有规定拟合图。若保留扩展图，先求正反向平均并换算Rx；不要把直径数组作为横轴。",
    "charts": []
  },
  "光栅光谱的测量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/altc2.pdf",
    "pages": "2",
    "description": "默认不生成数据关系图",
    "note": "重要纠正：绿光1次、2次、3次是−1/+1级的三次重复测量，不是第1/2/3级。官网要求光栅常数、不确定度、黄1/黄2波长、最高级次的计算。撤回现有数据可直接做k—sinθ拟合的建议；只有额外采集真实不同级次才可扩展。",
    "charts": []
  },
  "光的偏振特性测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/ahaofmz2.pdf",
    "pages": "2",
    "description": "直角坐标：X=cos²θ（无量纲），Y=P/mW",
    "note": "官网明确使用光功率本身。第一版建议默认扣Pmin应撤回；若实验操作已经调零，直接画其记录值，不再次扣最低值。先保留自由截距拟合用于检验零点，过原点是理想关系，不能为验证成功强制约束。图上保留原始点。",
    "charts": [
      {
        "id": "malus",
        "title": "马吕斯定律验证",
        "xLabel": "cos²θ",
        "yLabel": "P / mW"
      }
    ]
  },
  "光的偏振特性测量（第二学期）": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/ahaofmz2.pdf",
    "pages": "2–3",
    "description": "一张三系列极坐标：极角θ/°，极径P/mW；α=0°、30°、45°",
    "note": "官网要求三个表格画在同一张极坐标图，最好不同颜色。应保留当前专用预设；不能改成三组互作X/Y，也不能对三组分别重新扣最小值。0°至360°、每15°一个点。",
    "charts": [
      {
        "id": "polar",
        "title": "三组光功率极坐标",
        "xLabel": "极角 θ / °",
        "yLabel": "极径 P / mW"
      }
    ]
  },
  "刚体转动惯量的测量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/ashmzaapyafz3.pdf",
    "pages": "1",
    "description": "默认不生成数据关系图",
    "note": "要求计算盘和环的转动惯量及不确定度。原矩阵一列混有长度与周期，不能以第1次列对第2次列绘图。可选重复测量图应按物理量分开。",
    "charts": []
  },
  "劈尖干涉": {
    "status": "入口无资料",
    "source": "https://wlsyzx.xidian.edu.cn/expe/experiment.html?id=22",
    "pages": "—",
    "description": "暂不确定学校必画图；理论可选X=真实条纹级次k，Y=xk/mm",
    "note": "目录22标题是透射式劈尖，files为空；应用当前方法不能仅凭同名认定与官网透射装置完全一致。保留理论建议，等待该课程要求后再定默认。",
    "charts": []
  },
  "声速的测量（水中）": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/bypmz.pdf",
    "pages": "1–2",
    "description": "默认不生成；可选每种方法各画X=点序号，Y=L/mm",
    "note": "同一份文件明确覆盖空气/水中，上一版“官网水中资料覆盖不足”的表述在本入口下不成立。两方法各自处理，不能L1对L2。空气每种方法12组、水中10组是此文件的记录规范，不作为本次改数据长度的授权。",
    "charts": []
  },
  "声速的测量（空气）": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/bypmz.pdf",
    "pages": "1–2",
    "description": "默认不生成；可选每种方法各画X=点序号，Y=L/mm",
    "note": "官网以逐差法计算波长、声速及不确定度，没有要求把两组L互作坐标。步骤明确记录正、负斜率直线状态，不能把这些相邻状态统一当作整波长；扩展图须按真实状态间隔换算。",
    "charts": []
  },
  "平凸透镜曲率半径的测量": {
    "status": "入口无资料",
    "source": "https://wlsyzx.xidian.edu.cn/expe/experiment.html?id=23",
    "pages": "—",
    "description": "暂不确定学校必画图；理论可选X=暗环级次m，Y=Dm²/mm²",
    "note": "目录23标题是透射式牛顿环，files为空；应用当前暗环/反射条件需另核对，不能把反射暗环规则无条件当官网透射实验规定。D=|右−左|，平方后可用于曲率半径线性分析，这是原理建议。",
    "charts": []
  },
  "扭摆法测量钢丝切变模量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/ghmmzaalz3.pdf",
    "pages": "1–2",
    "description": "默认不生成数据关系图",
    "note": "要求计算切变模量、误差分析和结果置信区间；现有空盘/加环的重复计时不应互作坐标。可选“次数—周期”用于检查，不能假装多种惯量标定实验。",
    "charts": []
  },
  "拉伸法测量钢丝杨氏弹性模量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/gammzzallfflz3.pdf",
    "pages": "1–2",
    "description": "默认不生成；可选X=加载质量/kg，Y=平均标尺读数/cm",
    "note": "官网要求逐差数据处理、模量、误差和结果表示，未列必画图。扩展图按实际0至7kg等载荷序列与平均标尺读数配对，不能拿钢丝直径重复读数作横轴；载荷来自真实记录/确认。",
    "charts": []
  },
  "激光波长的测量": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/yacydnamzoamz3.pdf",
    "pages": "1",
    "description": "默认不生成；可选X=测量次数，Y=λ/nm",
    "note": "官网要求每50条纹记录镜位，连续8组，计算波长、相对误差、不确定度和标准形式，没有必画图。镜位l₁对l₂不是波长关系预设；有真实累计条纹数才可另作N—镜移图。",
    "charts": []
  },
  "灵敏电流计特性的测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/ojomt3.pdf",
    "pages": "2",
    "description": "X=U/V，Y=R/Ω，直线拟合",
    "note": "官网要求R—U曲线并由截距读内阻、斜率求电流常数。因此应交换当前R→U默认，并保持与报告现有R=kU+b算法一致；要展示截距，不能强制过原点。",
    "charts": [
      {
        "id": "galvanometer",
        "title": "R—U定偏关系",
        "xLabel": "U / V",
        "yLabel": "R / Ω"
      }
    ]
  },
  "理想气体状态方程": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/oflaofjq3.pdf",
    "pages": "20–21",
    "description": "两张：X=1/P（kPa⁻¹），Y=V′/mL；X=T/K，Y=P/kPa",
    "note": "要求文件第2页指定参看主讲义，已追查第20页的数据处理与第21页报告标准。恒温V′—1/P图由斜率求n、截距求零差体积；恒容P—T图由斜率求R。P需为绝对压强、T为热力学温度，不是直接ΔP或℃。",
    "charts": [
      {
        "id": "boyle",
        "title": "恒温V′—1/P",
        "xLabel": "1/P / kPa⁻¹",
        "yLabel": "V′ / mL"
      },
      {
        "id": "charles",
        "title": "恒容P—T",
        "xLabel": "T / K",
        "yLabel": "P / kPa"
      }
    ]
  },
  "电子偏转特性的测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/oblpay2.pdf",
    "pages": "3",
    "description": "三张：X=Vdx/V、Vdy/V、Im/mA；各自Y=D/mm",
    "note": "官网明确每图叠加1000V、800V两系列并求斜率；900V虽记录但不是该数据处理条款指定的系列，不能默认混入。矩阵必须按加速电压的行取数据。磁偏转表含±12mm点，当前schema范围可能不同，另作数据结构核对，不能擅自补点。",
    "charts": [
      {
        "id": "electric_x",
        "title": "X轴电偏转",
        "xLabel": "Udx / V",
        "yLabel": "D / mm"
      },
      {
        "id": "electric_y",
        "title": "Y轴电偏转",
        "xLabel": "Udy / V",
        "yLabel": "D / mm"
      },
      {
        "id": "magnetic",
        "title": "磁偏转",
        "xLabel": "Im / mA",
        "yLabel": "D / mm"
      }
    ]
  },
  "电子元件伏安特性的测量": {
    "status": "目录无对应项目",
    "source": "https://wlsyzx.xidian.edu.cn/expe/index.html",
    "pages": "—",
    "description": "原理建议：X=元件实测端电压U/V，Y=I/mA",
    "note": "本目录没有该项，不能借用自组单臂电桥。电阻、灯泡、二极管分图；后两者不全域线性拟合。官网强制格式未核实。",
    "charts": []
  },
  "电容与高电阻的测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/aaomtmzocazz.pdf",
    "pages": "1",
    "description": "高阻一图：X=t/s，Y=ln[Q/(1 μC)]（无量纲）",
    "note": "官网记作lnQ—t，要求用软件绘制、给出直线方程并由斜率算高阻。用Q的μC数值取ln与该写法一致。比较法电容部分是不同充电电压下的QN、Qx，并非同条件重复值；QN—Qx可作扩展比较图，但不是本要求规定的主图。对非正Q不得填小正数凑对数。",
    "charts": [
      {
        "id": "discharge",
        "title": "放电法高阻",
        "xLabel": "t / s",
        "yLabel": "ln[Q / (1 μC)]"
      }
    ]
  },
  "电表的改装与校准": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/otpjtala3.pdf",
    "pages": "3",
    "description": "两张：X=Ix/mA，Y=Is−Ix/mA；X=Ux/V，Y=Us−Ux/V",
    "note": "关键纠正：官网要求横轴是改装表示值，纵轴是修正值“标准－改装”；第一版建议“标准表示值横轴、改装－标准纵轴”不符合本要求。按校准点连接曲线，不默认线性拟合，也不只画改装表对标准表的y=x图。",
    "charts": [
      {
        "id": "ammeter",
        "title": "电流表校正",
        "xLabel": "Ix / mA",
        "yLabel": "Is−Ix / mA"
      },
      {
        "id": "voltmeter",
        "title": "电压表校正",
        "xLabel": "Ux / V",
        "yLabel": "Us−Ux / V"
      }
    ]
  },
  "直螺线管磁场分布的测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/aammtsqpb3.pdf",
    "pages": "1–3",
    "description": "磁场分布图：X=x/mm（−200～+200），Y=B/T或mT",
    "note": "官网规定对称曲线。标定电流—电流计偏转不能替代磁场分布主图。先求平均偏转并按标定转换B；若负侧由对称性生成，要标清为镜像延拓，不标成负侧独立实测。原点按讲义取螺线管中心。",
    "charts": [
      {
        "id": "solenoid",
        "title": "螺线管轴向磁场分布",
        "xLabel": "x / mm",
        "yLabel": "B / T"
      }
    ]
  },
  "薄透镜焦距的测量（凸透镜）": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/tyzoxmz.pdf",
    "pages": "3–5",
    "description": "默认不生成数据关系图",
    "note": "第一学期固定物距下多次测像距，按等精度处理；共轭法求平均焦距。没有要求1/u—1/v图，当前数据也不是多物距系统扫描，上一版该图只可列扩展，不能作默认。",
    "charts": []
  },
  "薄透镜焦距的测量（凹透镜）": {
    "status": "要求文件未列关系图",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/tyzoxmz.pdf",
    "pages": "2、4–5",
    "description": "默认不生成数据关系图",
    "note": "第二学期按自准法及物像法计算焦距、不确定度；物像法取平均。不能直接用两项光具座位置互相拟合，也不为画线性图擅自生成不同虚物距。",
    "charts": []
  },
  "衍射光强分布的测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/astcafadpmz3.pdf",
    "pages": "1",
    "description": "X=x/mm（可注明相对中心），Y=I/I₀（无量纲）",
    "note": "官网明确先计算相对光强并绘制分布，读取1、2级亮纹位置和强度、1至3级暗纹间距。上一版保留原始I作默认纵轴不够符合要求，应改为相对量，I₀取中央主极大光强并注明。用散点和曲线，不做全范围直线拟合。",
    "charts": [
      {
        "id": "diffraction",
        "title": "相对光强分布",
        "xLabel": "x / mm",
        "yLabel": "I / I₀"
      }
    ]
  },
  "重力加速度的测量": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/bh3.pdf",
    "pages": "1",
    "description": "主图X=h/cm，Y=T/s",
    "note": "必须绘制摆轴距质心距离与摆动周期的关系；计时t=10T，纵轴用平均单周期。h²—hT²仅为扩展线性化，不应替换官网主图或用两次计时列互作坐标。",
    "charts": [
      {
        "id": "pendulum",
        "title": "复摆周期—距质心距离",
        "xLabel": "h / cm",
        "yLabel": "T / s"
      }
    ]
  },
  "长度与体积的测量": {
    "status": "目录无对应项目",
    "source": "https://wlsyzx.xidian.edu.cn/expe/index.html",
    "pages": "—",
    "description": "暂不设默认关系图",
    "note": "本目录没有该项，保留尺寸与体积数据处理表；不同尺寸不应硬配成关系曲线。是否另有指定图须其他正式讲义确认。",
    "charts": []
  },
  "霍尔效应实验": {
    "status": "规定关系，作图坐标未完全明定",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/zcje2.pdf",
    "pages": "1；另参主讲义20、22",
    "description": "建议优先：X=Im/mA，Y=UH/mV；X=I/mA，Y=UH/mV；B—Im、B—I另作辅助",
    "note": "内容文件明确研究霍尔输出电压随励磁/工作电流的变化；主讲义记录表还要求计算B，并写明软件绘图，但未逐项指定B图或UH图。故优先按实验内容给UH两图，B两图保留为辅助而非唯一强制图。按仅工作电流换向的表格UH=(|U1|+|U2|)/2处理。",
    "charts": [
      {
        "id": "hall_im",
        "title": "霍尔电压—励磁电流",
        "xLabel": "Im / mA",
        "yLabel": "UH / mV"
      },
      {
        "id": "hall_i",
        "title": "霍尔电压—工作电流",
        "xLabel": "I / mA",
        "yLabel": "UH / mV"
      },
      {
        "id": "field_im",
        "title": "辅助：磁场—励磁电流",
        "xLabel": "Im / mA",
        "yLabel": "B / T"
      },
      {
        "id": "field_i",
        "title": "辅助：磁场—工作电流",
        "xLabel": "I / mA",
        "yLabel": "B / T"
      }
    ]
  },
  "静电场的模拟": {
    "status": "明确要求",
    "source": "https://wlsyzx.xidian.edu.cn/expe/expe/zobhs.pdf",
    "pages": "1–3",
    "description": "三张：同轴空间x—y图、X=ln(r/cm)与Y=U′r/Ua图、平行线电极空间x—y图",
    "note": "两张场图均含等势线及不少于6条标方向电场线；同轴归一化电位实验、理论关系画在同图。极坐标记录先按实际θ、r转为x/y；空间轴等比例，不把不同角度半径列互作坐标。",
    "charts": [
      {
        "id": "coax",
        "title": "同轴电缆等势线与电场线",
        "xLabel": "x / cm",
        "yLabel": "y / cm"
      },
      {
        "id": "potential",
        "title": "归一化电位—ln r",
        "xLabel": "ln[r / (1 cm)]",
        "yLabel": "U′r / Ua"
      },
      {
        "id": "parallel",
        "title": "平行线电极等势线与电场线",
        "xLabel": "x / cm",
        "yLabel": "y / cm"
      }
    ]
  }
}; if(typeof module==='object' && module.exports)module.exports=catalog; else root.LabChartPresets=catalog; })(typeof window!=='undefined'?window:globalThis);
