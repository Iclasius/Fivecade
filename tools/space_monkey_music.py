"""
Space Monkey 3: Bananas Gone Bad - composition + rendu des musiques.

Genere dans ../fivecade_space_monkey/html/music/ :
  menu.ogg : "jungle cosmique", 112 BPM (page d'accueil)
  game.ogg : jungle (breakbeat) spatiale, 165 BPM, montee + drop (partie)
Chaque morceau est une boucle parfaite (queue des notes et echo replies
sur le debut).

Version 3. Historique des retours utilisateur :
  - v1 (synthe planant) : "trop douce et gentille" ;
  - v2 (electro agressive) : nerveuse mais "doit faire penser a un singe
    dans l'espace".
Identite sonore retenue :
  - LE SINGE / LA JUNGLE : bongos, congas, tambours de bois, riff de
    marimba en pentatonique mineure (joueur, rebondissant), cris de singe
    synthetises ("hou hou hou HAA HAA", synthese additive a formants) ;
  - L'ESPACE : melodie au theremine (glissandos + vibrato, le son des
    vieux films de SF), bips, lasers, nappe cosmique ;
  - L'ENERGIE : la partie est en "jungle" (breakbeat rapide, basse
    saturee) - clin d'oeil au nom du genre.
Les aigus restent plafonnes (~7 kHz, aucun signal carre brut).

Usage : python space_monkey_music.py   (numpy + ffmpeg requis)
"""
import os
import subprocess
import wave
import numpy as np

from street_wars_music import SR, Track, additive, pad, hat, env, midi, hz

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fivecade_space_monkey', 'html', 'music')
rng = np.random.default_rng(2026)

# Progression : Am - Am - F - G, melodies en pentatonique mineure de La.
PROG = [('A', 'm'), ('A', 'm'), ('F', ''), ('G', '')]


# ------------------------------------------------------------------ timbres "jungle"

def marimba(freq, dur=0.5):
    """Lame de bois frappee : partiels 1 / 4 / 10 qui s'eteignent vite."""
    n = int((dur + 0.4) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for ratio, amp, tau in ((1, 1.0, 0.45), (3.98, 0.35, 0.09), (9.9, 0.1, 0.03)):
        if freq * ratio < 7000:
            x += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / tau)
    click = rng.standard_normal(n) * np.exp(-t * 900) * 0.15
    return (x + click) * env(n, 0.001, 0.02, 1, 0.08, int(dur * SR))


def bongo(freq):
    """Peau tendue frappee a la main : hauteur qui retombe + claquement."""
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 0.35 * np.exp(-t * 70))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22)
    slap = np.diff(rng.standard_normal(n), prepend=0) * np.exp(-t * 250) * 0.3
    return body + slap


def log_drum(freq):
    """Tambour de bois grave, accorde."""
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 0.15 * np.exp(-t * 40))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 20)


FORMANTS = {  # (frequence, largeur) des formants de la voix
    'oo': [(330, 90), (870, 130), (2240, 250)],
    'aa': [(760, 120), (1150, 150), (2500, 260)],
}


def vowel(f0_start, f0_peak, dur, v):
    """Syllabe chantee : synthese additive dont chaque harmonique prend le
    gain du filtre de formants (voyelle) a sa frequence."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    k = t / dur
    f0 = f0_start + (f0_peak - f0_start) * np.sin(np.pi * np.minimum(k * 1.3, 1)) ** 0.7  # hululement monte puis retombe
    f0 = f0 * (1 + 0.01 * rng.standard_normal(n).cumsum() / np.sqrt(n))  # un peu de rugosite
    phase = 2 * np.pi * np.cumsum(f0) / SR
    fmean = (f0_start + f0_peak) / 2
    x = np.zeros(n)
    for h in range(1, 16):
        fh = fmean * h
        if fh > 5000:
            break
        g = sum(1 / (1 + ((fh - F) / bw) ** 2) for F, bw in FORMANTS[v]) / h ** 0.3
        x += g * np.sin(h * phase)
    breath = np.convolve(rng.standard_normal(n), np.ones(8) / 8, mode='same') * 0.08
    return (x + breath) * env(n, 0.012, 0.03, 0.9, 0.035, n)


def monkey_call(pitch=1.0):
    """Cri de chimpanze facon dessin anime : hou-hou-hou qui monte, puis HAA HAA."""
    parts = [(430, 500, 0.11, 'oo'), (500, 580, 0.11, 'oo'), (580, 680, 0.11, 'oo'),
             (720, 880, 0.2, 'aa'), (700, 830, 0.24, 'aa')]
    out = []
    for f0a, f0b, d, v in parts:
        out.append(vowel(f0a * pitch, f0b * pitch, d, v))
        out.append(np.zeros(int(0.035 * SR)))
    x = np.concatenate(out)
    return x / np.abs(x).max()


# ------------------------------------------------------------------ timbres "espace"

def theremin_line(notes, beat, glide=0.07):
    """Ligne continue au theremine : les notes s'enchainent en glissando
    (legato), vibrato qui s'installe sur chaque note tenue.
    notes = [(nom, debut_en_temps, duree_en_temps)] ; retourne (signal, debut)."""
    start = notes[0][1]
    end = max(b + d for _, b, d in notes)
    n = int((end - start) * beat * SR) + int(0.3 * SR)
    freq = np.zeros(n)
    vib_depth = np.zeros(n)
    f_prev = hz(midi(notes[0][0]))
    for name, b, d in notes:
        i0 = int((b - start) * beat * SR)
        i1 = min(n, int((b - start + d) * beat * SR))
        target = hz(midi(name))
        tt = np.arange(i1 - i0) / SR
        freq[i0:i1] = target + (f_prev - target) * np.exp(-tt / glide)
        vib_depth[i0:i1] = 0.014 * np.minimum(1, tt / 0.3)
        f_prev = target
    last = int((end - start) * beat * SR)
    freq[last:] = f_prev
    t = np.arange(n) / SR
    f = freq * (1 + vib_depth * np.sin(2 * np.pi * 5.8 * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) + 0.18 * np.sin(2 * phase) + 0.06 * np.sin(3 * phase)
    amp = np.ones(n)
    a = int(0.06 * SR)
    amp[:a] = np.linspace(0, 1, a)
    r = int(0.25 * SR)
    amp[last:last + r] = np.linspace(1, 0, r)[:max(0, min(r, n - last))]
    amp[last + r:] = 0
    return x * amp, start


def bleep(freq):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 35)


def zap(freq=1500):
    """Tir laser "pew" (glissando descendant)."""
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    f = freq * np.exp(-t * 9) + 180
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.25 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    return x * np.exp(-t * 11) * 0.5


def sweep(dur):
    """Souffle filtre qui s'eclaircit (montee)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for k, w in enumerate([24, 12, 6, 3]):
        sm = np.convolve(noise, np.ones(w) / w, mode='same')
        out += sm * np.clip(1 - np.abs(t / dur * 3 - k), 0, 1)
    return out * np.sin(np.pi * t / dur) * 0.4


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 110 * 2 ** (3 * t / dur)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 2 * 0.35
    return sweep(dur) * (t / dur) * 1.5 + tone


# ------------------------------------------------------------------ energie

def grit_bass(freq, dur):
    """Basse saturee : dent de scie + sous-basse sinus."""
    n = int((dur + 0.03) * SR)
    t = np.arange(n) / SR
    saw = additive(freq, dur + 0.03, list(range(1, 9)), [1.0 / h for h in range(1, 9)])[:n]
    sub = np.sin(2 * np.pi * freq / 2 * t)
    x = np.tanh((saw * (1 + 1.2 * np.exp(-t * 25)) + sub * 0.9) * 2.0)
    return x * env(n, 0.003, 0.05, 0.85, 0.03, int(dur * SR))


def hard_kick():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = 50 + 160 * np.exp(-t * 45)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 12)
    click = rng.standard_normal(n) * np.exp(-t * 500) * 0.3
    return np.tanh((body + click) * 2.2) * 0.95


def break_snare():
    """Caisse claire de breakbeat : seche et claquante."""
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    noise = np.diff(rng.standard_normal(n), prepend=0) * 0.6
    body = np.sin(2 * np.pi * np.cumsum(240 * np.exp(-t * 10) + 170) / SR) * np.exp(-t * 26)
    return np.tanh((noise * np.exp(-t * 18) + body) * 1.5) * 0.8


class HardTrack(Track):
    """Mixage plus dense que Street Wars : pas de lissage des aigus (deja
    plafonnes a la source), compression plus forte."""

    def render(self, sends):
        mix = np.zeros((2, self.length + 4 * SR))
        for name, buf in self.buses.items():
            wet = sends.get(name, 0)
            mix += buf
            if wet:
                mix += self.echo(buf, 0.75, 0.35, wet)
        tail = mix[:, self.length:]
        loop = mix[:, :self.length].copy()
        loop[:, :tail.shape[1]] += tail
        loop = np.tanh(loop / (np.abs(loop).max() + 1e-9) * 2.2)
        return loop / np.abs(loop).max() * 0.85


def put_theremin(t, notes, b0, gain):
    sig, start = theremin_line([(n, b0 + b, d) for n, b, d in notes], t.beat)
    t.put('theremin', sig, start, gain)


def triad(root, kind, octave):
    r = midi(root + str(octave))
    return [r, r + (3 if kind == 'm' else 4), r + 7]


# Riff de marimba (1 mesure, doubles croches) : degres relatifs a la
# fondamentale de l'accord, en pentatonique (0, 3, 5, 7, 10, 12).
MARIMBA_RIFF = [(0, 0), (0.5, 7), (0.75, 12), (1.25, 10), (1.5, 7), (2, 3), (2.5, 5), (2.75, 7), (3.25, 3), (3.5, 0)]
PENTA_HI = ['A5', 'C6', 'D6', 'E6', 'G6']


# ------------------------------------------------------------------ morceaux

def menu_theme():
    """Accueil 112 BPM : jungle cosmique. Tambours de bois et bongos,
    marimba, theremine mysterieux, cris de singe lointains, bips."""
    t = HardTrack(bpm=112, bars=16)
    mel = [  # theremine, 4 mesures qui se repondent (demarre mesure 5)
        [('E5', 0, 1.5), ('A5', 1.5, 1.5), ('G5', 3, 1)],
        [('E5', 0, 1), ('D5', 1, 1), ('C5', 2, 2)],
        [('C5', 0, 1.5), ('F5', 1.5, 1.5), ('E5', 3, 1)],
        [('D5', 0, 1), ('B4', 1, 1), ('D5', 2, 1), ('G5', 3, 1)],
    ]
    for bar in range(16):
        b0 = bar * 4
        root, kind = PROG[bar % 4]
        r = midi(root + '2')
        # nappe cosmique
        for m in triad(root, kind, 3):
            t.put('pad', pad(hz(m + 12), 4 * t.beat), b0, 0.05, pan=rng.uniform(-0.5, 0.5))
        # tambours de bois (accordes) + bongos
        for off in (0, 1.5, 2.75):
            t.put('perc', log_drum(hz(r)), b0 + off, 0.35)
        for off, f in ((0.5, 420), (1, 310), (1.75, 420), (2.5, 420), (3, 310), (3.5, 420), (3.75, 310)):
            t.put('perc', bongo(f), b0 + off, 0.22, pan=0.4 if f > 400 else -0.3)
        # batterie qui entre a la mesure 3
        if bar >= 2:
            t.put('drums', hard_kick(), b0, 0.5)
            t.put('drums', hard_kick(), b0 + 2.5, 0.4)
            t.put('drums', break_snare(), b0 + 2, 0.4)
            for h in range(8):
                t.put('drums', hat(), b0 + h * 0.5, 0.1, pan=0.3)
        # basse
        t.put('bass', grit_bass(hz(r - 12), 1.4 * t.beat), b0, 0.17)
        t.put('bass', grit_bass(hz(r - 12), 0.6 * t.beat), b0 + 2.5, 0.17)
        # marimba
        for off, deg in MARIMBA_RIFF:
            t.put('marimba', marimba(hz(r + 24 + deg), 0.3 * t.beat), b0 + off, 0.16, pan=-0.2)
        # theremine a partir de la mesure 5
        if bar >= 4:
            put_theremin(t, mel[bar % 4], b0, 0.2)
        # bips spatiaux epars
        if bar % 2 == 1:
            for k in range(3):
                t.put('fx', bleep(hz(midi(rng.choice(PENTA_HI)))), b0 + 1 + k * 0.75, 0.1, pan=rng.uniform(-0.7, 0.7))
        # cris de singe lointains
        if bar in (3, 11):
            t.put('monkey', monkey_call(1.0), b0 + 2.5, 0.28, pan=-0.35)
    return t.render({'theremin': 0.3, 'marimba': 0.18, 'monkey': 0.4, 'fx': 0.35, 'pad': 0.2})


def game_theme():
    """Partie 165 BPM : jungle spatiale. Breakbeat + bongos, basse saturee,
    riff de marimba, theme au theremine, cris de singe, montee puis drop."""
    t = HardTrack(bpm=165, bars=32)
    theme = [
        [('E5', 0, 1.5), ('A5', 1.5, 1), ('G5', 2.5, 0.5), ('E5', 3, 1)],
        [('D5', 0, 1), ('E5', 1, 1), ('C5', 2, 2)],
        [('C5', 0, 1), ('D5', 1, 0.5), ('F5', 1.5, 1.5), ('E5', 3, 1)],
        [('D5', 0, 1), ('G5', 1, 1), ('B5', 2, 1), ('A5', 3, 1)],
    ]
    answer = [
        [('A5', 0, 1), ('C6', 1, 1), ('E6', 2, 1.5), ('D6', 3.5, 0.5)],
        [('C6', 0, 1), ('A5', 1, 1), ('G5', 2, 1), ('E5', 3, 1)],
        [('F5', 0, 1), ('A5', 1, 1), ('C6', 2, 1.5), ('A5', 3.5, 0.5)],
        [('G5', 0, 1), ('B5', 1, 1), ('D6', 2, 1), ('E6', 3, 1)],
    ]
    # breakbeat facon "amen" (16 doubles croches par mesure)
    KICK = [0, 2, 10, 11]
    SNARE = {4: 0.6, 7: 0.22, 9: 0.25, 12: 0.6, 15: 0.22}
    for bar in range(32):
        b0 = bar * 4
        section = bar // 8  # 0 intro, 1 theme, 2 pause (jungle pure) + montee, 3 drop
        root, kind = PROG[bar % 4]
        r = midi(root + '2')
        rise = section == 2 and bar % 8 >= 4
        breakdown = section == 2 and bar % 8 < 4
        drums_on = not breakdown and not (section == 0 and bar < 2)
        # breakbeat
        if drums_on and not rise:
            for s in KICK:
                t.put('drums', hard_kick(), b0 + s * 0.25, 0.72)
            for s, g in SNARE.items():
                t.put('drums', break_snare(), b0 + s * 0.25, g)
            for h in range(8):
                t.put('drums', hat(open_=(h == 7)), b0 + h * 0.5 + 0.25, 0.1, pan=0.35)
        if rise:  # roulement qui accelere avant le drop
            steps = 8 if bar % 8 < 6 else 16
            for k in range(steps):
                prog = (bar % 8 - 4 + k / steps) / 4
                t.put('drums', break_snare(), b0 + k * 4.0 / steps, 0.2 + 0.4 * prog)
        # bongos et congas : tout le temps (c'est la jungle)
        for s, f in ((1, 420), (3, 420), (6, 300), (8, 420), (11, 300), (13, 420), (14, 420)):
            t.put('perc', bongo(f), b0 + s * 0.25, 0.2, pan=0.45 if f > 400 else -0.35)
        if breakdown or section == 0:
            for off in (0, 1.5, 3):
                t.put('perc', log_drum(hz(r)), b0 + off, 0.35)
        # basse saturee syncopee (coupee pendant la pause)
        if not breakdown and not (section == 0 and bar < 4):
            for off, du, oc in ((0, 0.7, 0), (0.75, 0.25, 12), (1.5, 0.5, 0), (2.5, 0.7, 0), (3.25, 0.25, 7), (3.5, 0.4, 12)):
                t.put('bass', grit_bass(hz(r - 12 + oc), du * t.beat), b0 + off, 0.17)
        # marimba : le riff du singe, partout sauf pendant la montee
        if not rise:
            for off, deg in MARIMBA_RIFF:
                t.put('marimba', marimba(hz(r + 24 + deg), 0.25 * t.beat), b0 + off, 0.17, pan=-0.25)
        # theremine
        if section == 1:
            put_theremin(t, theme[bar % 4], b0, 0.22)
        elif section == 3:
            put_theremin(t, (theme if bar % 8 < 4 else answer)[bar % 4], b0, 0.24)
        # nappe discrete au drop
        if section == 3:
            for m in triad(root, kind, 3):
                t.put('pad', pad(hz(m + 12), 4 * t.beat), b0, 0.035)
        # effets
        if section == 2 and bar % 8 == 4:
            t.put('fx', riser(16 * t.beat), b0, 0.3)
        if section in (1, 3) and bar % 4 == 2:
            t.put('fx', zap(1500), b0 + 3.5, 0.16, pan=0.5)
        if bar % 2 == 0 and section != 2:
            t.put('fx', bleep(hz(midi(rng.choice(PENTA_HI)))), b0 + 2.75, 0.08, pan=rng.uniform(-0.7, 0.7))
        # cris de singe : fin d'intro, pendant la pause, juste avant le drop, fin de boucle
        if bar in (7, 17, 19, 31):
            t.put('monkey', monkey_call(1.0 if bar != 19 else 1.12), b0 + (2 if bar != 31 else 2.5), 0.32,
                  pan=0.3 if bar % 2 else -0.3)
    return t.render({'theremin': 0.25, 'marimba': 0.15, 'monkey': 0.3, 'fx': 0.2, 'pad': 0.15})


def save(name, stereo):
    os.makedirs(OUT_DIR, exist_ok=True)
    wav = os.path.join(OUT_DIR, name + '.wav')
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype('<i2')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    ogg = os.path.join(OUT_DIR, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '2', ogg], check=True)
    os.remove(wav)
    print('%s : %.1f s, %d Ko' % (ogg, stereo.shape[1] / SR, os.path.getsize(ogg) // 1024))


if __name__ == '__main__':
    save('menu', menu_theme())
    save('game', game_theme())
