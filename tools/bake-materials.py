from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates,gaussian_filter

base=Path(__file__).resolve().parents[1]
out=base/'dist/assets'
paths=sorted((base/'upload').glob('*.png'))
# Name, sheet, cell (row-major), where this scanned material appears.
entries=[('asphalt',5,0),('roadpatch',1,4),('dockslab',1,8),('curb',5,3),('drain',5,8),('panel',5,7),('steel',5,5),('pebble',5,6),('bricks',10,2),('shutter',2,2),('concrete',10,0),('cement',2,3),('rime',3,1),('blackMetal',3,0),('rubber',3,4),('grate',14,7),('painted',10,5),('wood',11,6),('railbed',11,5),('crate',12,5),('cable',12,6),('barrel',12,4),('rivets',12,0),('greenHull',12,8),('redPaint',12,2),('tread',12,3),('canvas',12,7),('seaWall',9,1),('wetStone',9,5),('stoneWall',8,2),('stoneMoss',8,5),('darkRock',0,0),('quarry',13,4),('moss',4,6),('weeds',6,3),('bank',7,0),('paint',10,1),('sand',9,7),('chip',13,5),('matte',3,5)]
tile=400; cols=8;rows=(len(entries)+cols-1)//cols
sheet=Image.new('RGB',(cols*tile,rows*tile)); info=[]; handles={}
for i,(name,j,cell) in enumerate(entries):
 if j not in handles: handles[j]=Image.open(paths[j]).convert('RGB')
 src=handles[j];w,h=src.size;c=cell%3;r=cell//3
 img=src.crop((round(w*c/3)+4,round(h*r/3)+4,round(w*(c+1)/3)-4,round(h*(r+1)/3)-4)).resize((tile,tile),Image.Resampling.LANCZOS)
 if name=='panel':
  l=np.asarray(img.convert('L')).astype(float); l=np.uint8(np.clip((l-170)*.83+213,70,253));img=Image.fromarray(l).convert('RGB')
 sheet.paste(img,(i%cols*tile,i//cols*tile));info.append({'name':name,'source':paths[j].name,'cell':cell+1})
sheet.save(out/'materials.webp',quality=89,method=5)
(out/'materials.json').write_text(json.dumps({'tile':tile,'columns':cols,'layers':info},ensure_ascii=False,separators=(',',':')))
# A seamless hemispherical sky. Project cloud layers onto horizontal planes, then light
# their density fields from a low sun. The runtime adds the solar disc in linear light.
w,h=2560,640
az=np.linspace(-np.pi,np.pi,w,endpoint=False)[None,:]; elev=(np.arange(h)[:,None]+.5)/h*np.pi/2
cx=np.sin(az)*np.cos(elev);cz=-np.cos(az)*np.cos(elev);cy=np.broadcast_to(np.sin(elev),cx.shape)
sun=np.array([-.66,.28,-.70]);sun/=np.linalg.norm(sun);dot=cx*sun[0]+cy*sun[1]+cz*sun[2];glow=np.clip(dot,0,1)**5
hMix=1-np.exp(-cy*3.5); horizon=np.array([202,201,185]); sky=np.array([62,123,149]);rgb=horizon+(sky-horizon)*hMix[...,None];rgb=rgb+glow[...,None]*np.array([44,23,4])*(1-.62*cy[...,None]);
rng=np.random.default_rng(281)
texture=rng.random((512,512),dtype=np.float32)
def noise(x,y,seed):
 return map_coordinates(texture,[np.remainder(y+seed*37,512),np.remainder(x-seed*71,512)],order=1,mode='grid-wrap',prefilter=False)
def fbm(x,y,seed,octs):
 a=.5;s=0
 for k in range(octs):
  s+=a*noise(x,y,seed+k);x,y=1.64*x+.98*y,-.98*x+1.64*y;a*=.51
 return s
for high,seed in [(True,7),(False,34)]:
 u=cx/np.maximum(.03,cy+.038);v=cz/np.maximum(.03,cy+.038)
 if high:
  u,v=u*2.2+v*.9,v*5.8; dens=fbm(u,v,seed,7);mask=np.clip((dens-.445)*2.8,0,.59)*np.clip(cy*9,0,1); cloud=np.array([213,221,213])
 else:
  u,v=u*2.0+16,v*1.85+34;warp=fbm(u*.38,v*.38,8,4);dens=fbm(u+warp*3,v-warp*4,seed,8);mask=np.clip((dens-.482)*7.0,0,.96);mask=mask*mask*(3-2*mask)*np.clip(cy*16,0,1);shade=fbm(u-.16,v-.14,seed,6); light=np.clip(.74-(shade-.4)*1.8+np.maximum(0,dens-shade)*2.0,0,1); cloud=np.array([117,139,147])+light[...,None]*np.array([113,91,58])+glow[...,None]*np.array([15,6,0]);
 rgb=rgb*(1-mask[...,None])+cloud*mask[...,None]
Image.fromarray(np.uint8(np.clip(rgb,0,255))).save(out/'marine-sky.webp',quality=90,method=5)
print(len(entries),'materials',sheet.size,'from',len({j for _,j,_ in entries}),'atlases')
