"""Bake the wharf's photo materials into the existing WebGL/software atlas.

Run from any directory: python tools/bake_port.py
To import replacement 3x3 PNG boards: python tools/bake_port.py --import-boards DIR
The editable WebPs live outside dist; the game requests only materials.webp.
"""
import argparse
import json
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'dist/assets'
SOURCES = ROOT / 'production-assets/port-sources'
BAKE = ROOT / 'production-assets/bake'
SIZE = 400
BOARDS = {
    'cistern': '古い貯水槽の9種素材アトラス-2.png',
    'salvage': '山間採石場の9種素材テクスチャ-3.png',
    'gantry': '工業素材テクスチャ9分割アトラス-3.png',
    'cladding': '建築素材の質感9分割ボード-2.png',
    'heritage': '建築素材の質感九選-4.png',
    'limestone': '石灰岩洞窟の9種素材アトラス-1.png',
    'vehicle': '自動車・交通素材の質感コラージュ-2.png',
    'shore': '自然の地表を集めた3×3テクスチャグリッド-5.png',
    'verge': '自然の地表テクスチャ9種_grid-1.png',
    'fabric': '質感素材の3×3マクロテクスチャグリッド-4.png',
}
RESAMPLE = Image.Resampling.LANCZOS


@lru_cache(None)
def board(key):
    return Image.open(SOURCES / (key + '.webp')).convert('RGB')


def cell(key, number):
    im = board(key)
    x, y = (number - 1) % 3, (number - 1) // 3
    # Inset removes the seam and any fringe from the neighbouring photograph.
    return im.crop((round(im.width*x/3)+3, round(im.height*y/3)+3,
                    round(im.width*(x+1)/3)-3, round(im.height*(y+1)/3)-3)).resize((SIZE, SIZE), RESAMPLE)


def place(canvas, source, box):
    x, y, w, h = box
    canvas.paste(source.resize((w, h), RESAMPLE), (x, y))


def typeface(size, mono=False):
    return ImageFont.truetype('DejaVuSansMono-Bold.ttf' if mono else 'DejaVuSansCondensed-Bold.ttf', size)


def plaque(im, pos, string, color='#e9e3cc', bg='#253e40', size=22):
    draw = ImageDraw.Draw(im)
    x, y = pos
    font = typeface(size, True)
    width = int(draw.textlength(string, font=font)) + 14
    draw.rectangle((x, y, x+width, y+size+10), fill=bg)
    draw.text((x+7, y+3), string, fill=color, font=font)


def four(images):
    sheet = Image.new('RGB', (SIZE, SIZE))
    for i, im in enumerate(images):
        # Duplicate a real edge into the gutter for bilinear and mip sampling.
        thumb = im.resize((192, 192), RESAMPLE)
        x, y = i % 2 * 200, i // 2 * 200
        sheet.paste(thumb, (x+4, y+4))
        for a, b, region in [(0, 4, (0, 0, 1, 192)), (196, 4, (191, 0, 192, 192))]:
            sheet.paste(thumb.crop(region).resize((4, 192)), (x+a, y+b))
        for offset, edge in [(0, 4), (196, 195)]:
            sheet.paste(sheet.crop((x, y+edge, x+200, y+edge+1)).resize((200, 4)), (x, y+offset))
    return sheet


def hardware():
    return four([cell('cistern', n) for n in [2, 6, 1, 7]])


def machinery():
    pump = cell('cistern', 4)
    place(pump, cell('cistern', 3), (43, 104, 186, 164))
    place(pump, cell('cistern', 6), (252, 106, 88, 88))
    place(pump, cell('gantry', 6), (28, 340, 344, 17))
    plaque(pump, (45, 31), 'INTAKE  04')
    cooler = cell('vehicle', 8)
    fins = ImageEnhance.Color(cell('cladding', 2)).enhance(.35)
    for x in [21, 204]:
        place(cooler, fins, (x, 43, 172, 183))
    place(cooler, cell('cladding', 7), (24, 252, 207, 94))
    plaque(cooler, (242, 263), '-18 C', '#d0e7d6', '#294950', 22)
    door = cell('salvage', 7)
    d = ImageDraw.Draw(door)
    d.rectangle((15, 8, 384, 396), outline='#493f39', width=7)
    place(door, fins, (72, 37, 254, 63))
    d.rounded_rectangle((46, 201, 92, 212), radius=4, fill='#bbb9a8', outline='#323d3f', width=2)
    plaque(door, (158, 144), 'SERVICE', size=18)
    duct = cell('gantry', 9)
    place(duct, fins, (29, 31, 342, 277))
    place(duct, cell('gantry', 6), (28, 344, 124, 20))
    return four([pump, cooler, door, duct])


def cargo_faces():
    tarp = cell('salvage', 9)
    for x in [44, 322]:
        place(tarp, cell('fabric', 3), (x, 0, 33, 400))
        ImageDraw.Draw(tarp).rectangle((x-2, 268, x+35, 286), outline='#998d70', width=4)
    timber = cell('heritage', 3)
    d = ImageDraw.Draw(timber)
    for y in [100, 200, 300]:
        d.line((0, y, 400, y), fill='#40382e', width=5)
    for x in [74, 303]:
        place(timber, cell('vehicle', 7), (x, 0, 14, 400))
    crate = Image.blend(cell('cistern', 4), Image.new('RGB', (400, 400), '#50797c'), .60)
    d = ImageDraw.Draw(crate)
    for y in [4, 139, 274]:
        d.rectangle((0, y, 400, y+11), fill='#93adaa')
        d.rectangle((0, y+12, 400, y+21), fill='#344f56')
        d.rounded_rectangle((150, y+27, 250, y+41), radius=6, fill='#243b40')
    plaque(crate, (18, 182), 'FISH  04', size=18)
    sling = cell('fabric', 5)
    net = ImageOps.colorize(cell('fabric', 2).convert('L'), '#344744', '#c5b984')
    sling = Image.blend(sling, net, .65)
    for x in [15, 198, 370]:
        place(sling, cell('fabric', 3), (x, 0, 17, 400))
    return four([tarp, timber, crate, sling])


def glazing():
    metal = cell('cladding', 1)
    window = ImageOps.colorize(cell('vehicle', 5).convert('L'), '#284149', '#8da5a5')
    # Glazing reflects the pale sky over a dark band of distant cargo; the
    # brushed-metal photograph supplies the subtle unevenness of each pane.
    sky = ImageOps.colorize(Image.linear_gradient('L'), '#a3b9b8', '#586f73').resize((400, 400))
    draw = ImageDraw.Draw(sky)
    draw.polygon([(0,267),(24,260),(24,244),(70,244),(70,264),(119,264),(119,237),
                  (154,237),(154,251),(212,251),(212,262),(245,262),(245,239),(311,239),
                  (311,258),(349,258),(349,248),(400,248),(400,400),(0,400)], fill='#40585d')
    draw.polygon([(167,0),(195,0),(100,400),(87,400)], fill='#adbbb8')
    window = Image.blend(sky, window, .19)
    wide = metal.copy()
    d = ImageDraw.Draw(wide)
    for x in [5, 202]:
        d.rectangle((x, 17, x+191, 381), fill='#333f41')
        place(wide, window, (x+7, 27, 177, 341))
        d.line((x+9, 153, x+181, 153), fill='#496268', width=4)
    clerestory = cell('salvage', 2)
    glass = ImageOps.colorize(cell('vehicle', 6).convert('L'), '#344e55', '#93a8a5')
    for x in [10, 140, 270]:
        place(clerestory, glass, (x, 20, 120, 348))
    hatch = cell('cistern', 4)
    place(hatch, window, (75, 48, 250, 132))
    ImageDraw.Draw(hatch).rectangle((47, 220, 96, 229), fill='#c5c1a7')
    plaque(hatch, (170, 252), 'P-04', size=28)
    dado = cell('heritage', 4)
    place(dado, cell('cistern', 5), (0, 192, 400, 208))
    return four([wide, clerestory, hatch, dado])


def notices():
    signs = Image.new('RGB', (400, 400))
    data = [('04','TIDAL PUMP','INTAKE   /   QUAYSIDE','#233f41','#efb653'),
            ('01','COLD STORE','FISH LANDING   /   BERTH 01','#294c60','#c9ddd5'),
            ('05','WEIGH OFFICE','NORTH YARD   /   SCALE 02','#e3dac0','#b3583a'),
            ('02','MARINE WORKS','PORT ENGINEERING   /   EAST','#214c4a','#ebdcb1')]
    for i, (num, title, sub, base, accent) in enumerate(data):
        y = i*100
        weather = ImageOps.colorize(cell('gantry', 5).convert('L'), '#282f32', base)
        place(signs, weather, (0, y, 400, 100))
        d = ImageDraw.Draw(signs)
        ink = '#313b3a' if i == 2 else '#f2eddb'
        d.rectangle((5, y+5, 395, y+94), outline=accent, width=2)
        d.rectangle((9, y+9, 88, y+90), fill=accent)
        d.text((15, y+22), num, font=typeface(45), fill='#213b42')
        d.text((101, y+13), title, font=typeface(34), fill=ink)
        d.text((103, y+62), sub, font=typeface(13, True), fill=ink)
    return signs


def verge():
    grass = ImageEnhance.Color(cell('shore', 1)).enhance(.74)
    flowers = ImageEnhance.Color(cell('verge', 2)).enhance(.67)
    return Image.blend(grass, flowers, .43)


def tidewall():
    dry = cell('gantry', 7)
    low = ImageEnhance.Color(cell('shore', 6)).enhance(.72)
    mask = Image.linear_gradient('L').resize((400, 400)).point(lambda v: max(0, min(255, (v-112)*4)))
    return Image.composite(low, dry, mask)


# Slots unused by the original scene carry new materials. Existing actor materials
# keep their names and layer indices. Signs and hardware share pages at authoring time.
REPLACEMENTS = {
    'curb': ('saltConcrete', ('gantry', 7)), 'shutter': ('slatDoor', ('cladding', 2)),
    'rime': ('workTin', ('salvage', 1)), 'painted': ('portBlue', ('cistern', 4)),
    'railbed': ('portHardware', hardware), 'cable': ('portFreight', cargo_faces),
    'rivets': ('portPanels', machinery), 'sand': ('portSigns', notices), 'matte': ('portWindows', glazing),
    'drain': ('drain', ('cistern', 3)), 'cement': ('cement', ('cladding', 6)),
    'seaWall': ('seaWall', tidewall), 'stoneWall': ('stoneWall', ('salvage', 6)),
    'wetStone': ('wetStone', ('shore', 6)), 'stoneMoss': ('stoneMoss', ('shore', 4)),
    'darkRock': ('darkRock', ('shore', 9)), 'quarry': ('quarry', ('limestone', 1)),
    'moss': ('moss', ('verge', 1)), 'weeds': ('weeds', verge),
    'bank': ('bank', ('shore', 2)), 'chip': ('chip', ('limestone', 6))
}
EXTRA = [('yardStripes', ('gantry', 6)), ('bondTimber', ('cistern', 8)),
         ('saltCladding', ('vehicle', 8)), ('slateRoof', ('heritage', 6))]


def bake(base_sheet=None):
    manifest = json.loads((ASSETS / 'materials.json').read_text())
    source_info = {v['name']: v for v in manifest['layers']}
    original = json.loads((BAKE / 'layers.json').read_text())
    entries = [(name, *REPLACEMENTS.get(name, (name, None))) for name in original
               if name != 'white' and not name.startswith('label')]
    entries += [(None, name, recipe) for name, recipe in EXTRA]
    cols = manifest['columns']
    sheet = Image.new('RGB', (SIZE*cols, SIZE*((len(entries)+cols-1)//cols)))
    info = []
    for i, (old, name, recipe) in enumerate(entries):
        if recipe is None:
            if base_sheet is None:
                tile = Image.open(BAKE / (old+'.png'))
            else:
                x, y = i % cols * SIZE, i // cols * SIZE
                tile = base_sheet.crop((x, y, x+SIZE, y+SIZE))
            entry = source_info[old]
        elif callable(recipe):
            tile = recipe()
            entry = {'name': name, 'recipe': recipe.__name__}
        else:
            tile = cell(*recipe)
            entry = {'name': name, 'source': BOARDS[recipe[0]], 'cell': recipe[1]}
        info.append(entry)
        sheet.paste(tile, (i % cols * SIZE, i // cols * SIZE))
    sheet.save(ASSETS / 'materials.webp', quality=89, method=6)
    manifest['layers'] = info
    (ASSETS / 'materials.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--import-boards', type=Path)
    args = parser.parse_args()
    if args.import_boards:
        SOURCES.mkdir(parents=True, exist_ok=True)
        for key, filename in BOARDS.items():
            im = Image.open(args.import_boards / filename).convert('RGB')
            im.save(SOURCES / (key+'.webp'), quality=91, method=6)
    bake()
