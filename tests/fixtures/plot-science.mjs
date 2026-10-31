export const scienceData={x:[0,1,1,2,3],y:[1,2.9,3.1,5,7]};
export const scienceCode=`import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from scipy.interpolate import CubicSpline
from scipy.stats import linregress
from scipy.integrate import simpson
from scipy.signal import savgol_filter
from scipy.linalg import solve
from scipy.special import expit
from scipy.ndimage import gaussian_filter1d
df=pd.DataFrame(DATA).groupby("x",as_index=False).mean()
x=df["x"].to_numpy()
y=df["y"].to_numpy()
def line(x,a,b):
    return a*x+b
params,covariance=curve_fit(line,x,y)
if abs(params[0]-2)>1e-8 or abs(params[1]-1)>1e-8:
    raise ValueError("curve_fit numeric mismatch")
if abs(linregress(x,y).slope-2)>1e-8 or abs(CubicSpline(x,y)(0.5)-2)>1e-8:
    raise ValueError("regression/interpolation mismatch")
if abs(simpson(y,x=x)-12)>1e-8 or abs(expit(0)-0.5)>1e-8:
    raise ValueError("integration/special mismatch")
if not np.allclose(solve([[2.,0.],[0.,4.]],[4.,8.]),[2.,2.]):
    raise ValueError("linalg mismatch")
if not np.allclose(savgol_filter(y,3,1),y) or not np.all(np.isfinite(gaussian_filter1d(y,1))):
    raise ValueError("signal/ndimage mismatch")
fig,ax=plt.subplots(figsize=(6,4))
ax.plot(x,y,"o",label="Grouped data")
ax.plot(x,line(x,*params),label="Fit")
ax.set_xlabel("x")
ax.set_ylabel("y")
save(fig,"fig1.png")
caption("fig1.png","图1 分组数据与拟合曲线")`;
