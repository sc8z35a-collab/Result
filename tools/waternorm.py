from PIL import Image
import numpy as np
from pathlib import Path
r=np.random.default_rng(841);n=512;x,z=np.meshgrid(np.arange(n)*2*np.pi/n,np.arange(n)*2*np.pi/n);dx=np.zeros_like(x);dz=dx.copy()
for i in range(140):
 kx=int(r.integers(-12,13));kz=int(r.integers(2,30));a=r.uniform(.15,.65)*np.exp(-kz/25);wave=np.cos(kx*x+kz*z+r.uniform(0,2*np.pi));dx+=a*kx/18*wave;dz+=a*kz/18*wave
im=np.uint8(np.clip(np.stack([dx/(dx.std()*2.7),dz/(dz.std()*2.7),np.zeros_like(dx)],axis=2)*115+128,0,255));Image.fromarray(im).save(Path(__file__).resolve().parents[1]/'dist/assets/waves.webp',quality=93)
