from pathlib import Path
from PIL import Image, ImageDraw
import json
ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'kenney-tiny-dungeon' / 'original' / 'Tiles'
# CC0 derivative: preserve authored Kenney pixels, add a small bob / lean and a
# separate CC0 sword or staff. Frames are presentation poses, not gameplay data.
manifest = {'license':'CC0-1.0','source':'https://kenney.nl/assets/tiny-dungeon','frameWidth':32,'frameHeight':32,'columns':4,'rows':3,'animations':{'idle':{'start':0,'end':3,'frameRate':4},'walk':{'start':4,'end':7,'frameRate':9},'attack':{'start':8,'end':11,'frameRate':10}},'heroes':{}}
for hero,tile,weapon in [('dain',86,103),('fenn',96,105),('ashvyn',112,130),('sylra',84,129)]:
    original = Image.open(SOURCE / f'tile_{tile:04}.png').convert('RGBA')
    original.save(ROOT / f'hero-{hero}.png')
    (ROOT / 'heroes').mkdir(exist_ok=True)
    original.save(ROOT / 'heroes' / f'{hero}.png')
    arm = Image.open(SOURCE / f'tile_{weapon:04}.png').convert('RGBA')
    sheet = Image.new('RGBA',(128,96))
    for row in range(3):
        for col in range(4):
            frame=Image.new('RGBA',(32,32))
            dy = [0,0,-1,0][col] if row==0 else [0,-1,0,1][col]
            dx = [0,1,2,0][col] if row==2 else 0
            frame.alpha_composite(original,(8+dx,12+dy))
            if row==2:
                # Dedicated equipment layer makes the attack / cast pose readable.
                angles=[-15,-55,-90,-25] if hero in ('dain','fenn') else [0,-15,-25,0]
                weapon_frame=arm.rotate(angles[col],resample=Image.Resampling.NEAREST,expand=True)
                px=min(16,32-weapon_frame.width)
                frame.alpha_composite(weapon_frame,(px,max(0,14-weapon_frame.height//2)))
                if hero=='sylra' and col in (1,2):
                    d=ImageDraw.Draw(frame)
                    d.ellipse((24,4,28,8),fill=(154,227,255,240))
                    d.point((23,5),fill=(255,255,255,220))
            sheet.alpha_composite(frame,(col*32,row*32))
    sheet.save(ROOT / f'hero-{hero}-sheet.png')
    manifest['heroes'][hero]={'portrait':f'/assets/hero-{hero}.png','sheet':f'/assets/hero-{hero}-sheet.png','originalTile':tile,'originX':0.5,'originY':0.875}
for name,tile in [('minion-melee',110),('minion-ranged',111),('coin',114),('sword',104),('staff',129),('shield',118)]:
    Image.open(SOURCE / f'tile_{tile:04}.png').convert('RGBA').save(ROOT / f'{name}.png')
(ROOT/'heroes.manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
