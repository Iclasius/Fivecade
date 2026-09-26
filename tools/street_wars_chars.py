"""Street Wars : transforme un export PixelLab (Spritesheet PNG + JSON) en
planche compacte pour le jeu.

Usage : python street_wars_chars.py <export.zip> <gang>
  gang = green | purple | yellow | blue

Sortie : ../fivecade_street_wars/html/chars_<gang>.png, cases de 68x68 :
  ligne 0 : a l'arret  sud, est, nord
  ligne 1 : marche sud  (8 images)
  ligne 2 : marche est  (8 images)
  ligne 3 : marche nord (8 images)
L'ouest n'est pas stocke : le jeu retourne l'est en miroir. Seules ces 3
directions sont donc a generer sous PixelLab (economie de credits).
"""
import io
import json
import os
import sys
import zipfile

from PIL import Image

CELL = 68
ROOT = os.path.dirname(os.path.abspath(__file__))


def main(zip_path, gang):
    z = zipfile.ZipFile(zip_path)
    meta = json.loads(z.read([n for n in z.namelist() if n.endswith('.json')][0]))
    sheet = Image.open(io.BytesIO(z.read([n for n in z.namelist() if n.endswith('.png')][0]))).convert('RGBA')
    cw, ch = meta['spritesheet']['cell_size']['width'], meta['spritesheet']['cell_size']['height']
    rows = meta['spritesheet']['rows']

    def frame(row, col):
        return sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)).resize((CELL, CELL), Image.NEAREST)

    out = Image.new('RGBA', (8 * CELL, 4 * CELL), (0, 0, 0, 0))
    rot = next(r for r in rows if r['type'] == 'rotations')
    for i, d in enumerate(['south', 'east', 'north']):
        out.alpha_composite(frame(rot['row'], rot['directions'].index(d)), (i * CELL, 0))
    missing = []
    for i, d in enumerate(['south', 'east', 'north']):
        walk = next((r for r in rows if r['type'] == 'animation' and r.get('direction') == d), None)
        if walk is None:
            missing.append(d)
            continue
        for k in range(min(8, walk['frame_count'])):
            out.alpha_composite(frame(walk['row'], k), (k * CELL, (i + 1) * CELL))
    dst = os.path.join(ROOT, '..', 'fivecade_street_wars', 'html', 'chars_%s.png' % gang)
    out.save(dst, optimize=True)
    print('%s -> %s (%d octets)%s' % (zip_path, os.path.normpath(dst), os.path.getsize(dst),
                                    ('  MARCHE MANQUANTE : ' + ', '.join(missing)) if missing else ''))


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[2] not in ('green', 'purple', 'yellow', 'blue'):
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
