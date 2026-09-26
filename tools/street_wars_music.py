"""
Street Wars, Gang Wars Edition - composition + rendu des musiques.

Genere dans ../fivecade_street_wars/html/music/ :
  menu.ogg  : hip-hop old school 80s, tempo pose (page d'accueil, salons)
  game.ogg  : hip-hop old school plus nerveux (pendant les manches)
Style choisi par l'utilisateur : boite a rythmes facon 808 (grosse caisse
profonde, clap, charleston swingue), basse 808 qui glisse, stabs de
cuivres sur un riff sombre en mineur (note bleue), scratchs, grain de
vinyle, sirene lointaine.
Chaque morceau est une boucle parfaite (la queue des notes et l'echo sont
replies sur le debut).

Pensees pour ne pas fatiguer l'oreille : aucun signal carre brut, timbres
en synthese additive a peu d'harmoniques (naturellement doux), aigus
limites, batterie feutree, volume final modere.

Usage : python street_wars_music.py   (numpy + ffmpeg requis)
"""
import os
import subprocess
import numpy as np

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fivecade_street_wars', 'html', 'music')
rng = np.random.default_rng(1986)

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def midi(n):
    return 12 * (int(n[-1]) + 1) + NOTE[n[:-1]]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ------------------------------------------------------------------ timbres

def env(n, a, d, s, r, sustain_len):
    """ADSR en echantillons (sustain_len = duree tenue avant relachement)."""
    a, d, r = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    hold = max(0, sustain_len - a - d)
    e = np.concatenate([np.linspace(0, 1, a), np.linspace(1, s, d), np.full(hold, s), np.linspace(s, 0, r)])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def additive(freq, dur, harmonics, amps, vib=0.0, vib_rate=5.0, detune=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + vib * np.sin(2 * np.pi * vib_rate * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.zeros(n)
    for h, a in zip(harmonics, amps):
        if freq * h > 9000:  # pas d'aigus agressifs
            break
        out += a * np.sin(h * phase)
        if detune:
            out += a * 0.6 * np.sin(h * phase * (1 + detune))
    return out


def soft_saw(freq, dur, bright=8, **kw):
    hs = list(range(1, bright + 1))
    return additive(freq, dur, hs, [1.0 / h for h in hs], **kw)


def pad(freq, dur):
    x = soft_saw(freq, dur + 0.6, bright=6, vib=0.002, vib_rate=0.3, detune=0.004)
    return x * env(len(x), 0.35, 0.3, 0.8, 0.6, int(dur * SR))


def pluck(freq, dur):
    x = soft_saw(freq, dur + 0.25, bright=7)
    n = len(x)
    e = np.exp(-np.arange(n) / (0.18 * SR))
    return x * e * env(n, 0.004, 0.05, 1, 0.08, int(dur * SR))


def bass(freq, dur):
    x = additive(freq, dur + 0.05, [1, 2, 3, 4], [1, 0.45, 0.2, 0.08])
    return x * env(len(x), 0.005, 0.12, 0.65, 0.05, int(dur * SR))


def lead(freq, dur):
    x = additive(freq, dur + 0.2, [1, 2, 3, 4, 5], [1, 0.35, 0.22, 0.1, 0.06], vib=0.004, vib_rate=5.5)
    return x * env(len(x), 0.03, 0.15, 0.7, 0.18, int(dur * SR))


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 80 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def snare():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0) * 0.5  # souffle un peu eclairci
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25)
    return (noise * np.exp(-t * 18) * 0.5 + body * 0.6) * 0.8


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    noise = np.diff(np.diff(rng.standard_normal(n), prepend=0), prepend=0) * 0.25
    return noise * np.exp(-t * (14 if open_ else 70))


def kick808(tail=0.9):
    n = int(tail * SR)
    t = np.arange(n) / SR
    f = 42 + 95 * np.exp(-t * 35)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    click = rng.standard_normal(n) * np.exp(-t * 400) * 0.15
    return np.tanh((body + click) * 1.6) * 0.9


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    noise = np.diff(rng.standard_normal(n), prepend=0) * 0.45
    e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022]):  # trois claquements rapproches
        i = int(off * SR)
        e[i:] += np.exp(-(t[:n - i]) * (60 if k < 2 else 16)) * (0.6 if k < 2 else 1)
    body = np.sin(2 * np.pi * 200 * t) * np.exp(-t * 30) * 0.3
    return (noise * e + body) * 0.7


def sub808(freq, dur, glide_from=None):
    n = int((dur + 0.08) * SR)
    t = np.arange(n) / SR
    f = np.full(n, freq)
    if glide_from:
        f = freq + (glide_from - freq) * np.exp(-t * 18)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = np.tanh(x * 1.4)  # un peu de grain, reste doux
    return x * env(n, 0.004, 0.1, 0.8, 0.07, int(dur * SR))


def stab(freq, dur=0.22):
    """Stab de cuivres : attaque franche, harmoniques de cuivre, court."""
    n = int((dur + 0.1) * SR)
    x = np.zeros(n)
    for detune in (-0.006, 0, 0.007):
        x += additive(freq * (1 + detune), dur + 0.1, [1, 2, 3, 4, 5, 6], [1, 0.7, 0.5, 0.32, 0.2, 0.12])[:n]
    t = np.arange(n) / SR
    return x / 3 * np.exp(-t * 7) * env(n, 0.008, 0.05, 0.9, 0.08, int(dur * SR))


def scratch(dur=0.5):
    """Scratch de platine : bruit filtre dont la hauteur fait des allers-retours."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    base = rng.standard_normal(n)
    speed = np.abs(np.sin(2 * np.pi * (3.5 / dur) * t))  # va-et-vient du disque
    # "filtre" simple : moyenne glissante de longueur variable selon la vitesse
    out = np.zeros(n)
    for k, w in enumerate([2, 4, 8, 16]):
        sm = np.convolve(base, np.ones(w) / w, mode='same')
        weight = np.clip(1 - np.abs(speed * 4 - (3 - k)), 0, 1)
        out += sm * weight
    tone = np.sin(2 * np.pi * np.cumsum(180 + 420 * speed) / SR) * 0.35
    return (out * 0.7 + tone) * (0.2 + 0.8 * speed) * np.exp(-t * 1.2) * 0.5


def siren(dur=3.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 700 + 180 * np.sin(2 * np.pi * 0.7 * t)
    x = additive(1, dur, [1, 2], [1, 0.2])  # placeholder de longueur
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.2 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    return x * np.sin(np.pi * t / dur) ** 2


def crackle(dur):
    n = int(dur * SR)
    x = np.zeros(n)
    pops = rng.integers(0, n, size=int(dur * 14))
    x[pops] = rng.uniform(-1, 1, size=len(pops))
    x = np.convolve(x, np.exp(-np.arange(40) / 8), mode='same')
    hiss = np.convolve(rng.standard_normal(n), np.ones(6) / 6, mode='same') * 0.05
    return (x * 0.5 + hiss)


# ------------------------------------------------------------------ piste

class Track:
    def __init__(self, bpm, bars):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.length = int(bars * 4 * self.beat * SR)
        self.buses = {}

    def put(self, bus, sig, at_beat, gain=1.0, pan=0.0):
        buf = self.buses.setdefault(bus, np.zeros((2, self.length + 4 * SR)))
        i = int(at_beat * self.beat * SR)
        j = min(buf.shape[1], i + len(sig))
        if i >= buf.shape[1]:
            return
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        buf[0, i:j] += sig[:j - i] * gain * l * 1.41
        buf[1, i:j] += sig[:j - i] * gain * r * 1.41

    def echo(self, x, delay_beats, fb, mix):
        d = int(delay_beats * self.beat * SR)
        out = x.copy()
        tap = x.copy()
        for _ in range(5):
            tap = np.roll(tap, d, axis=1) * fb
            out += tap * mix
        return out

    def render(self, sends):
        mix = np.zeros((2, self.length + 4 * SR))
        for name, buf in self.buses.items():
            wet = sends.get(name, 0)
            mix += buf
            if wet:
                mix += self.echo(buf, 0.75, 0.45, wet)
        # boucle parfaite : la queue revient sur le debut
        tail = mix[:, self.length:]
        loop = mix[:, :self.length].copy()
        loop[:, :tail.shape[1]] += tail
        # adoucissement general (moyenne glissante tres legere = aigus arrondis)
        k = 3
        loop = np.stack([np.convolve(ch, np.ones(k) / k, mode='same') for ch in loop])
        loop = np.tanh(loop / (np.abs(loop).max() + 1e-9) * 1.3)  # compression douce
        return loop / np.abs(loop).max() * 0.6  # volume final modere


# ------------------------------------------------------------------ morceaux

def chord_notes(root, kind):
    r = midi(root)
    return [r, r + (3 if kind == 'm' else 4), r + 7]


SWING = 0.07  # decalage des doubles croches paires (groove hip-hop)


def drums_boombap(t, b0, heavy=False, fill=False):
    """Une mesure de boom-bap : grosse caisse 808, clap sur 2 et 4, charleston swingue."""
    for k in ([0, 1.75, 2.5] if not heavy else [0, 0.75, 1.75, 2.5, 3.5]):
        t.put('drums', kick808(0.6 if heavy else 0.9), b0 + k, (0.42 if k == 0 else 0.3) * (0.7 if heavy else 1))
    for k in (1, 3):
        t.put('drums', clap(), b0 + k, 0.55)
    for h in range(8):
        off = h * 0.5 + (SWING if h % 2 else 0)
        t.put('drums', hat(open_=(h == 7 and fill)), b0 + off, 0.12 if h % 2 else 0.16, pan=0.3)


def menu_theme():
    """Boom-bap sombre a 88 BPM : Dm (note bleue), stabs de cuivres, basse 808, scratchs."""
    t = Track(bpm=88, bars=16)
    # riff de cuivres (Re mineur + La bemol = note bleue)
    riff = [('D4', 0), ('D4', 0.75), ('F4', 1.5), ('G4', 2.5), ('G#4', 3.25)]
    riff_b = [('A#3', 0), ('A#3', 0.75), ('D4', 1.5), ('C4', 2.5), ('A3', 3.25)]
    t.put('fx', siren(5.0), 0, 0.05, pan=-0.6)  # sirene lointaine en ouverture
    t.put('fx', crackle(t.length / SR), 0, 0.5)
    for bar in range(16):
        b0 = bar * 4
        drums_boombap(t, b0, heavy=False, fill=(bar % 4 == 3))
        # basse 808
        roots = ['D1', 'D1', 'A#0', 'A0']
        r = midi(roots[(bar // 2) % 4]) + 12
        for off, du, gl in [(0, 1.2, r + 12), (1.75, 0.5, None), (2.5, 1.0, None)]:
            t.put('bass', sub808(hz(r), du * t.beat, hz(gl) if gl else None), b0 + off, 0.26)
        # stabs : riff A deux mesures, riff B deux mesures (a partir de la mesure 3)
        if bar >= 2:
            notes = riff if (bar // 2) % 2 == 0 else riff_b
            for n, off in notes:
                for iv in (0, 7):  # quinte = son de cuivres plus plein
                    t.put('stab', stab(hz(midi(n) + iv)), b0 + off, 0.22, pan=-0.15 if iv else 0.15)
        if bar % 4 == 3:
            t.put('fx', scratch(0.9), b0 + 3, 0.3, pan=0.2)
    return t.render({'stab': 0.2, 'drums': 0.03, 'fx': 0.1})


def game_theme():
    """Hip-hop old school plus nerveux a 100 BPM : Em, stabs d'orchestre, basse qui cogne, scratchs."""
    t = Track(bpm=100, bars=32)
    prog = ['E1', 'E1', 'C1', 'D1', 'E1', 'E1', 'C1', 'B0']
    hook = [('E4', 0), ('E4', 0.5), ('G4', 1), ('E4', 1.75), ('A4', 2.5), ('G4', 3), ('F#4', 3.5)]
    t.put('fx', crackle(t.length / SR), 0, 0.4)
    for bar in range(32):
        b0 = bar * 4
        section = bar // 8  # 0 intro, 1 couplet, 2 pause (plus leger), 3 refrain
        drums_boombap(t, b0, heavy=(section in (1, 3)), fill=(bar % 4 == 3))
        r = midi(prog[bar % 8]) + 12
        for off, du in [(0, 0.7), (0.75, 0.25), (1.5, 0.5), (2.5, 0.7), (3.25, 0.25), (3.5, 0.4)]:
            t.put('bass', sub808(hz(r + (12 if off == 3.5 else 0)), du * t.beat), b0 + off, 0.13 if section != 2 else 0.1)
        # stabs d'orchestre sur les temps forts de la progression
        chord = [0, 3, 7] if prog[bar % 8] in ('E1', 'B0') else [0, 4, 7]
        if section != 2:
            for iv in chord:
                t.put('stab', stab(hz(r + 36 + iv), 0.18), b0, 0.16)
                t.put('stab', stab(hz(r + 36 + iv), 0.14), b0 + 2.75, 0.12)
        # accroche de cuivres au couplet et au refrain
        if section in (1, 3) and bar % 2 == 0:
            for n, off in hook:
                for iv in (0, 7):
                    t.put('lead', stab(hz(midi(n) + iv), 0.2), b0 + off, 0.2, pan=0.2 if iv else -0.2)
        if bar % 4 == 3:
            t.put('fx', scratch(0.7), b0 + 3.25, 0.32, pan=-0.2)
        if section == 2 and bar % 2 == 0:
            t.put('fx', scratch(1.2), b0 + 1, 0.22, pan=0.3)
    return t.render({'stab': 0.18, 'lead': 0.22, 'drums': 0.03, 'fx': 0.08})


def save(name, stereo):
    os.makedirs(OUT_DIR, exist_ok=True)
    wav = os.path.join(OUT_DIR, name + '.wav')
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype('<i2')
    import wave
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
