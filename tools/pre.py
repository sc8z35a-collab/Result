from pathlib import Path
from PIL import Image
import json, numpy as np
p=Path(__file__).resolve().parent;assets=p.parent/'dist/assets';info=json.loads((assets/'materials.json').read_text());im=Image.open(assets/'materials.webp');s=info['tile'];cols=info['columns'];
for i,l in enumerate(info['layers']):
 x=i%cols*s;y=i//cols*s;im.crop((x,y,x+s,y+s)).save(p/(l['name']+'.png'))
sky=Image.open(assets/'marine-sky.webp');w=sky.width;hem=sky.transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((w,w//4),Image.Resampling.LANCZOS);env=Image.new('RGB',(w,w//2),'#9baba7');env.paste(hem,(0,0));env.save(p/'sky-env.jpg',quality=94)
