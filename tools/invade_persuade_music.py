"""
Invade and Persuade - composition + rendu des musiques de la borne.

Genere html/music/menu.ogg, level1.ogg, level2.ogg, level3.ogg (boucles
parfaites : les queues de notes et la reverb sont repliees sur le debut).

Theme : desert + armee, couleur 16 bits (SNES / Mega Drive) :
  - gamme "hijaz" sur MI (E F G# A B C D) = couleur orientale / desert ;
  - fanfare de cuivres, caisse claire de marche, timbales = armee ;
  - cuivres additifs a brillance dynamique, basse FM, luth FM pince
    (oud), darbouka discrete ; aucun signal carre brut (les aigus
    agressifs de la premiere version "faisaient mal au crane").

Usage : python invade_persuade_music.py   (numpy + ffmpeg requis)
"""
import os
import subprocess
import numpy as np

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fivecade_invade_persuade', 'html', 'music')
rng = np.random.default_rng(1987)

# ---------------------------------------------------------------- notes
NOTE_IDX = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def midi(name):
    return 12 * (int(name[-1]) + 1) + NOTE_IDX[name[:-1]]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


HIJAZ = [64, 65, 68, 69, 71, 72, 74]  # E F G# A B C D (octave 4)


def scale_shift(m, steps):
    """Deplace une note de `steps` degres dans la gamme hijaz."""
    pcs = [p % 12 for p in HIJAZ]
    octv, pc = divmod(m, 12)
    if pc not in pcs:
        return m
    i = pcs.index(pc) + steps
    o, i = divmod(i, len(pcs))
    return (octv + o) * 12 + pcs[i]


CHORDS = {
    'E': ['E3', 'G#3', 'B3'], 'F': ['F3', 'A3', 'C4'], 'Am': ['A2', 'C3', 'E3'],
    'Dm': ['D3', 'F3', 'A3'], 'G': ['G2', 'B2', 'D3'],
}
BASS_ROOT = {'E': 'E2', 'F': 'F2', 'Am': 'A1', 'Dm': 'D2', 'G': 'G1'}

# ---------------------------------------------------------------- enveloppes


def env_asr(dur, a=0.01, d=0.1, s=0.8, r=0.08):
    n_on = max(1, int(dur * SR))
    n_r = int(r * SR)
    t = np.arange(n_on + n_r) / SR
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    if n_r:
        e[n_on:] = e[n_on - 1] * np.exp(-np.arange(n_r) / (n_r / 5.0))
    return e, t

# ---------------------------------------------------------------- instruments


def brass(f, dur, vel=1.0, bright=1.0):
    """Cuivre 16 bits : dent de scie additive, brillance qui s'ouvre a
    l'attaque (comme un vrai cuivre), vibrato tardif. Harmoniques
    limitees a ~5 kHz : pas d'aigus stridents."""
    e, t = env_asr(dur, a=0.02, d=0.14, s=0.72, r=0.1)
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.3 * t) * np.clip((t - 0.18) / 0.25, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    B = (1.5 + 8.0 * bright * np.clip(t / 0.06, 0, 1)) * (0.8 + 0.2 * np.exp(-t / 0.35))
    out = np.zeros_like(t)
    for n in range(1, int(min(40, 6500 / f)) + 1):
        out += (1.0 / n) * np.exp(-(n - 1) / B) * np.sin(n * ph)
    return out * e * vel * 0.33


def chip(f, dur, vel=1.0, duty=0.25):
    """Doublure chiptune douce : onde pulse 25 % a bande limitee (~3.5 kHz)."""
    e, t = env_asr(dur, a=0.006, d=0.09, s=0.55, r=0.05)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 6 * t) * np.clip((t - 0.12) / 0.2, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    out = np.zeros_like(t)
    for n in range(1, int(min(24, 5000 / f)) + 1):
        out += (2 / (n * np.pi)) * np.sin(np.pi * n * duty) * np.cos(n * ph)
    return out * e * vel * 0.22


def fm_bass(f, dur, vel=1.0):
    """Basse FM facon Mega Drive, attaque claquante qui s'arrondit."""
    e, t = env_asr(dur, a=0.003, d=0.16, s=0.45, r=0.04)
    idx = 2.0 * np.exp(-t / 0.06) + 0.45
    ph = 2 * np.pi * f * t
    out = 0.6 * np.sin(ph + idx * np.sin(ph)) + 0.28 * np.sin(ph)
    return out * e * vel * 0.42


def oud(f, dur, vel=1.0):
    """Luth pince (oud) : FM au rapport 2, index qui retombe vite."""
    n = int((dur + 0.45) * SR)
    t = np.arange(n) / SR
    idx = 2.6 * np.exp(-t / 0.025) + 0.25
    ph = 2 * np.pi * f * t
    out = np.sin(ph + idx * np.sin(2 * ph)) + 0.25 * np.sin(2 * ph)
    e = np.exp(-t / 0.24) * np.clip(t / 0.002, 0, 1)
    return out * e * vel * 0.26


def pad(f, dur, vel=1.0):
    """Nappe de cordes : 3 voix legerement desaccordees, attaque lente."""
    e, t = env_asr(dur, a=0.35, d=0.6, s=0.9, r=0.6)
    out = np.zeros_like(t)
    for det in (-0.0045, 0.0, 0.0045):
        ph = 2 * np.pi * f * (1 + det) * t + rng.uniform(0, 2 * np.pi)
        for n in range(1, int(min(10, 2400 / f)) + 1):
            out += (1.0 / n) * np.exp(-n / 4.0) * np.sin(n * ph)
    return out * e * vel * 0.1

# ---------------------------------------------------------------- percussions (echantillons precalcules)


def band_noise(n, lo, hi):
    X = np.fft.rfft(rng.standard_normal(n))
    fr = np.fft.rfftfreq(n, 1 / SR) + 1e-3
    mask = 1 / (1 + (lo / fr) ** 4) * 1 / (1 + (fr / hi) ** 4)
    y = np.fft.irfft(X * mask, n)
    return y / (np.max(np.abs(y)) + 1e-9)


def _t(sec):
    return np.arange(int(sec * SR)) / SR


def mk_kick():
    t = _t(0.4)
    f = 48 + 80 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2) * 0.72


def mk_snare():
    t = _t(0.3)
    nz = band_noise(len(t), 1200, 6500) * np.exp(-t / 0.075) * 0.6
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.045) * 0.45
    return nz + tone


def mk_hat():
    t = _t(0.06)
    return band_noise(len(t), 5000, 9500) * np.exp(-t / 0.016) * 0.3


def mk_dum():
    t = _t(0.35)
    f = 95 + 40 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16) * 0.6


def mk_tek():
    t = _t(0.08)
    return (np.sin(2 * np.pi * 620 * t) * 0.4 + band_noise(len(t), 1800, 5000) * 0.35) * np.exp(-t / 0.022)


def mk_tom(f0):
    t = _t(0.45)
    f = f0 * (1 + 0.35 * np.exp(-t / 0.05))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22) * 0.6


def mk_timpani(m):
    t = _t(1.3)
    f = hz(m) * (1 + 0.03 * np.exp(-t / 0.08))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = (np.sin(ph) + 0.35 * np.sin(1.5 * ph) + 0.15 * np.sin(1.98 * ph)) * np.exp(-t / 0.55)
    thump = band_noise(len(t), 40, 500) * np.exp(-t / 0.03) * 0.5
    return (body + thump) * 0.55


DRUMS = {'kick': mk_kick(), 'snare': mk_snare(), 'hat': mk_hat(), 'dum': mk_dum(), 'tek': mk_tek(),
         'tom_hi': mk_tom(170), 'tom_lo': mk_tom(110)}

# ---------------------------------------------------------------- mixage


class Mix:
    def __init__(self, seconds):
        self.L = int(round(seconds * SR))
        self.tail = int(3.0 * SR)
        self.buf = np.zeros((2, self.L + self.tail))

    def add(self, sig, start_s, gain=1.0, pan=0.0):
        s = int(round(start_s * SR)) % self.L
        th = (pan + 1) * np.pi / 4  # panoramique a puissance constante
        n = min(len(sig), self.buf.shape[1] - s)
        self.buf[0, s:s + n] += sig[:n] * gain * np.cos(th)
        self.buf[1, s:s + n] += sig[:n] * gain * np.sin(th)

    def folded(self):
        out = self.buf[:, :self.L].copy()
        out[:, :self.tail] += self.buf[:, self.L:]  # boucle parfaite
        return out


def reverb_ir(seconds=1.7, decay=0.38):
    t = _t(seconds)
    ir = np.stack([rng.standard_normal(len(t)), rng.standard_normal(len(t))]) * np.exp(-t / decay)
    ir[:, :int(0.018 * SR)] = 0  # pre-delai
    X = np.fft.rfft(ir, axis=1)
    fr = np.fft.rfftfreq(len(t), 1 / SR) + 1e-3
    ir = np.fft.irfft(X / np.sqrt(1 + (fr / 6000) ** 2), len(t), axis=1)  # reverb chaude
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))


def master(x, wet):
    L = x.shape[1]
    ir = reverb_ir()
    irp = np.zeros((2, L))
    irp[:, :ir.shape[1]] = ir
    rev = np.fft.irfft(np.fft.rfft(x, axis=1) * np.fft.rfft(irp, axis=1), L, axis=1)  # convolution circulaire
    y = x + wet * rev
    fr = np.fft.rfftfreq(L, 1 / SR) + 1e-3
    Y = np.fft.rfft(y, axis=1)
    Y *= 1 / np.sqrt(1 + (fr / 11000) ** 2)      # coupe douce des aigus
    Y *= 1 / np.sqrt(1 + (28 / fr) ** 4)         # coupe les infra-basses
    y = np.fft.irfft(Y, L, axis=1)
    y /= np.max(np.abs(y)) + 1e-9
    y = np.tanh(y * 1.6) / np.tanh(1.6)          # compression douce
    return y * 0.89

# ---------------------------------------------------------------- ecriture


class Song:
    def __init__(self, bpm, bars, shift=0):
        self.shift = shift  # transposition de tout le morceau (demi-tons)
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.bar = 4 * self.beat
        self.bars = bars
        self.mix = Mix(bars * self.bar)

    def t(self, bar, eighth=0.0):
        return bar * self.bar + eighth * self.beat / 2

    def melody(self, bar0, bars, inst='brass', vel=1.0, octave=0, pan=0.0, harmony=0, gain=1.0):
        for bi, notes in enumerate(bars):
            for pos, dur, name in notes:
                m = midi(name) + 12 * octave
                if harmony:
                    m = scale_shift(m, harmony)
                m += self.shift
                d = dur * self.beat / 2 * 0.94
                st = self.t(bar0 + bi, pos)
                if inst == 'brass':
                    self.mix.add(brass(hz(m) * 1.0015, d, vel), st, gain, pan - 0.25)
                    self.mix.add(brass(hz(m) * 0.9985, d, vel), st, gain, pan + 0.25)
                elif inst == 'chip':
                    self.mix.add(chip(hz(m), d, vel), st, gain, pan)
                elif inst == 'oud':
                    self.mix.add(oud(hz(m), d, vel), st, gain, pan)

    def bass(self, bar0, chords, pattern, vel=1.0, gain=1.0):
        # pattern : liste de (pas de double-croche, octave, longueur en pas)
        step = self.beat / 4
        for bi, ch in enumerate(chords):
            root = midi(BASS_ROOT[ch]) + self.shift
            for s, octv, ln in pattern:
                self.mix.add(fm_bass(hz(root + 12 * octv), ln * step * 0.9, vel), self.t(bar0 + bi) + s * step, gain, 0.0)

    def pads(self, bar0, chords, gain=1.0):
        for bi, ch in enumerate(chords):
            for k, name in enumerate(CHORDS[ch]):
                self.mix.add(pad(hz(midi(name) + 12 + self.shift), self.bar * 0.98), self.t(bar0 + bi), gain, (k - 1) * 0.5)

    def arps(self, bar0, chords, order, gain=1.0, octave=1):
        step = self.beat / 4
        for bi, ch in enumerate(chords):
            tones = [midi(n) + 12 * octave + self.shift for n in CHORDS[ch]] + [midi(CHORDS[ch][0]) + 12 * (octave + 1) + self.shift]
            for s, idx in enumerate(order):
                if idx is None:
                    continue
                self.mix.add(oud(hz(tones[idx]), step * 1.5, 0.8 if s % 4 == 0 else 0.6),
                             self.t(bar0 + bi) + s * step, gain, 0.35)

    def stabs(self, bar0, chords, steps, gain=1.0, length=2):
        # accords de cuivres courts sur les pas de double-croche donnes
        step = self.beat / 4
        for bi, ch in enumerate(chords):
            for s in steps:
                for k, name in enumerate(CHORDS[ch]):
                    m = midi(name) + 12 + self.shift
                    self.mix.add(brass(hz(m), length * step * 0.9, 0.8, bright=0.8), self.t(bar0 + bi) + s * step, gain * 0.55, (k - 1) * 0.4)

    def drums(self, bar0, nbars, pattern, gain=1.0, fill_every=8):
        step = self.beat / 4
        for b in range(nbars):
            is_fill = fill_every and (b + 1) % fill_every == 0
            for inst, steps in pattern.items():
                for s in steps:
                    s_, v = (s if isinstance(s, tuple) else (s, 1.0))
                    if is_fill and inst == 'snare' and s_ >= 8:
                        continue
                    pan = {'hat': 0.3, 'tek': -0.35, 'dum': -0.2}.get(inst, 0.0)
                    self.mix.add(DRUMS[inst], self.t(bar0 + b) + s_ * step, gain * v, pan)
            if is_fill:  # roulement de caisse claire militaire + toms
                for s in range(8, 16):
                    self.mix.add(DRUMS['snare'], self.t(bar0 + b) + s * step, gain * (0.35 + 0.05 * (s - 8)), 0.0)
                self.mix.add(DRUMS['tom_hi'], self.t(bar0 + b) + 12 * step, gain * 0.7, 0.25)
                self.mix.add(DRUMS['tom_lo'], self.t(bar0 + b) + 14 * step, gain * 0.8, -0.25)

    def timpani(self, bar0, chords, gain=1.0):
        for bi, ch in enumerate(chords):
            root = midi(BASS_ROOT[ch]) + 12 + self.shift
            self.mix.add(mk_timpani(root), self.t(bar0 + bi), gain, 0.0)
            self.mix.add(mk_timpani(root + 7), self.t(bar0 + bi, 4), gain * 0.7, 0.0)

    def render(self, wet):
        return master(self.mix.folded(), wet)

# ---------------------------------------------------------------- partitions
# Positions et durees en CROCHES (8 par mesure de 4/4).


THEME_A = [
    [(0, 1, 'E4'), (1, 1, 'E4'), (2, 1, 'F4'), (3, 1, 'G#4'), (4, 3, 'A4'), (7, 1, 'G#4')],
    [(0, 1, 'F4'), (1, 1, 'G#4'), (2, 2, 'A4'), (4, 2, 'B4'), (6, 1, 'A4'), (7, 1, 'G#4')],
    [(0, 2, 'F4'), (2, 2, 'E4'), (4, 1, 'F4'), (5, 1, 'G#4'), (6, 1, 'F4'), (7, 1, 'E4')],
    [(0, 4, 'E4'), (4, 1, 'B3'), (5, 1, 'D4'), (6, 1, 'E4'), (7, 1, 'F4')],
    [(0, 1, 'B4'), (1, 1, 'B4'), (2, 1, 'C5'), (3, 1, 'B4'), (4, 2, 'A4'), (6, 2, 'G#4')],
    [(0, 1, 'A4'), (1, 1, 'B4'), (2, 2, 'C5'), (4, 2, 'D5'), (6, 1, 'C5'), (7, 1, 'B4')],
    [(0, 2, 'C5'), (2, 1, 'B4'), (3, 1, 'A4'), (4, 2, 'G#4'), (6, 2, 'F4')],
    [(0, 6, 'E4'), (6, 1, 'E4'), (7, 1, 'E4')],
]
CH_A = ['E', 'E', 'F', 'E', 'E', 'Am', 'F', 'E']

THEME_B = [
    [(0, 2, 'E5'), (2, 1, 'D5'), (3, 1, 'C5'), (4, 2, 'D5'), (6, 2, 'E5')],
    [(0, 6, 'A4'), (6, 1, 'B4'), (7, 1, 'C5')],
    [(0, 2, 'D5'), (2, 1, 'C5'), (3, 1, 'B4'), (4, 2, 'C5'), (6, 2, 'D5')],
    [(0, 6, 'G#4'), (6, 1, 'A4'), (7, 1, 'B4')],
    [(0, 2, 'C5'), (2, 2, 'A4'), (4, 2, 'F5'), (6, 2, 'E5')],
    [(0, 2, 'D5'), (2, 2, 'C5'), (4, 4, 'B4')],
    [(0, 1, 'A4'), (1, 1, 'G#4'), (2, 1, 'F4'), (3, 1, 'G#4'), (4, 1, 'A4'), (5, 1, 'B4'), (6, 1, 'C5'), (7, 1, 'D5')],
    [(0, 8, 'E5')],
]
CH_B = ['Am', 'Am', 'Dm', 'E', 'F', 'E', 'F', 'E']

THEME_C = [  # theme du niveau 2 (meme gamme, plus rythme)
    [(0, 1, 'B4'), (1, 1, 'C5'), (2, 1, 'B4'), (3, 1, 'A4'), (4, 1, 'G#4'), (5, 1, 'A4'), (6, 2, 'B4')],
    [(0, 1, 'E4'), (1, 1, 'F4'), (2, 1, 'G#4'), (3, 1, 'A4'), (4, 4, 'B4')],
    [(0, 1, 'C5'), (1, 1, 'D5'), (2, 1, 'C5'), (3, 1, 'B4'), (4, 1, 'A4'), (5, 1, 'B4'), (6, 2, 'C5')],
    [(0, 1, 'B4'), (1, 1, 'A4'), (2, 1, 'G#4'), (3, 1, 'F4'), (4, 4, 'E4')],
    [(0, 1, 'B4'), (1, 1, 'C5'), (2, 1, 'B4'), (3, 1, 'A4'), (4, 1, 'G#4'), (5, 1, 'A4'), (6, 2, 'B4')],
    [(0, 1, 'E4'), (1, 1, 'F4'), (2, 1, 'G#4'), (3, 1, 'A4'), (4, 4, 'B4')],
    [(0, 1, 'C5'), (1, 1, 'D5'), (2, 1, 'C5'), (3, 1, 'B4'), (4, 1, 'A4'), (5, 1, 'B4'), (6, 2, 'C5')],
    [(0, 1, 'G#4'), (1, 1, 'A4'), (2, 1, 'B4'), (3, 1, 'C5'), (4, 1, 'D5'), (5, 1, 'C5'), (6, 1, 'B4'), (7, 1, 'G#4')],
]
CH_C = ['E', 'E', 'Am', 'E', 'E', 'E', 'Am', 'E']

THEME_D = [
    [(0, 2, 'D5'), (2, 2, 'F5'), (4, 2, 'E5'), (6, 2, 'D5')],
    [(0, 6, 'E5'), (6, 2, 'B4')],
    [(0, 2, 'C5'), (2, 2, 'F5'), (4, 2, 'E5'), (6, 2, 'C5')],
    [(0, 6, 'B4'), (6, 2, 'G#4')],
    [(0, 2, 'A4'), (2, 2, 'D5'), (4, 2, 'F5'), (6, 2, 'E5')],
    [(0, 4, 'E5'), (4, 2, 'D5'), (6, 2, 'C5')],
    [(0, 2, 'B4'), (2, 2, 'A4'), (4, 2, 'G#4'), (6, 2, 'F4')],
    [(0, 8, 'E4')],
]
CH_D = ['Dm', 'E', 'F', 'E', 'Dm', 'E', 'F', 'E']

THEME_E = [  # niveau 2 "Tempete de sable" : lent, lancinant (luth + chip)
    [(0, 3, 'E4'), (3, 1, 'F4'), (4, 2, 'G#4'), (6, 2, 'F4')],
    [(0, 6, 'E4'), (6, 1, 'D4'), (7, 1, 'E4')],
    [(0, 3, 'F4'), (3, 1, 'G#4'), (4, 2, 'A4'), (6, 2, 'G#4')],
    [(0, 6, 'F4'), (6, 2, 'E4')],
    [(0, 2, 'A4'), (2, 2, 'B4'), (4, 3, 'C5'), (7, 1, 'B4')],
    [(0, 2, 'A4'), (2, 2, 'G#4'), (4, 4, 'F4')],
    [(0, 2, 'G#4'), (2, 1, 'F4'), (3, 1, 'G#4'), (4, 2, 'A4'), (6, 1, 'G#4'), (7, 1, 'F4')],
    [(0, 8, 'E4')],
]
CH_E = ['E', 'E', 'F', 'F', 'Am', 'Dm', 'E', 'E']

THEME_F = [  # niveau 2, 2e partie : appel de cuivres
    [(0, 1, 'B4'), (1, 1, 'B4'), (2, 2, 'C5'), (4, 1, 'B4'), (5, 1, 'A4'), (6, 2, 'G#4')],
    [(0, 2, 'A4'), (2, 2, 'F4'), (4, 4, 'E4')],
    [(0, 1, 'C5'), (1, 1, 'C5'), (2, 2, 'D5'), (4, 1, 'C5'), (5, 1, 'B4'), (6, 2, 'A4')],
    [(0, 2, 'B4'), (2, 2, 'G#4'), (4, 4, 'E4')],
    [(0, 1, 'B4'), (1, 1, 'B4'), (2, 2, 'C5'), (4, 1, 'B4'), (5, 1, 'A4'), (6, 2, 'G#4')],
    [(0, 2, 'A4'), (2, 2, 'F4'), (4, 4, 'E4')],
    [(0, 1, 'C5'), (1, 1, 'C5'), (2, 2, 'D5'), (4, 1, 'C5'), (5, 1, 'B4'), (6, 2, 'A4')],
    [(0, 8, 'E4')],
]
CH_F = ['E', 'Am', 'Dm', 'E', 'E', 'Am', 'Dm', 'E']

THEME_G = [  # niveau 3 "Assaut final" : traits rapides
    [(0, 1, 'E5'), (1, 1, 'D5'), (2, 1, 'C5'), (3, 1, 'B4'), (4, 1, 'C5'), (5, 1, 'B4'), (6, 1, 'A4'), (7, 1, 'G#4')],
    [(0, 2, 'A4'), (2, 2, 'E4'), (4, 1, 'F4'), (5, 1, 'G#4'), (6, 2, 'A4')],
    [(0, 1, 'F5'), (1, 1, 'E5'), (2, 1, 'D5'), (3, 1, 'C5'), (4, 1, 'D5'), (5, 1, 'C5'), (6, 1, 'B4'), (7, 1, 'A4')],
    [(0, 2, 'B4'), (2, 2, 'E4'), (4, 4, 'G#4')],
    [(0, 2, 'E5'), (2, 2, 'E5'), (4, 1, 'F5'), (5, 1, 'E5'), (6, 2, 'D5')],
    [(0, 2, 'C5'), (2, 2, 'C5'), (4, 1, 'D5'), (5, 1, 'C5'), (6, 2, 'B4')],
    [(0, 1, 'A4'), (1, 1, 'B4'), (2, 1, 'C5'), (3, 1, 'D5'), (4, 2, 'E5'), (6, 2, 'G#4')],
    [(0, 6, 'A4'), (6, 2, 'E4')],
]
CH_G = ['Am', 'Am', 'Dm', 'E', 'Am', 'F', 'E', 'Am']

THEME_H = [  # niveau 3, refrain heroique en notes longues
    [(0, 4, 'A4'), (4, 4, 'C5')],
    [(0, 4, 'B4'), (4, 4, 'G#4')],
    [(0, 4, 'A4'), (4, 4, 'D5')],
    [(0, 8, 'E5')],
    [(0, 4, 'F5'), (4, 4, 'E5')],
    [(0, 4, 'D5'), (4, 4, 'C5')],
    [(0, 4, 'B4'), (4, 2, 'C5'), (6, 2, 'D5')],
    [(0, 8, 'E5')],
]
CH_H = ['Am', 'Am', 'Dm', 'E', 'F', 'Dm', 'E', 'E']

# Rythmes (pas de double-croche 0..15)
GALLOP = [(0, 0, 2), (4, 0, 1), (6, 0, 1), (8, 0, 2), (12, 0, 1), (14, 1, 2)]      # galop militaire
OSTINATO = [(s, 1 if s in (6, 14) else 0, 1) for s in range(0, 16, 2)]           # croches pulsees
DRIVE16 = [(s, 1 if s % 8 == 6 else 0, 1) for s in range(16)]                    # doubles-croches
ARP_OUD = [0, None, 2, 1, 0, None, 2, 1, 3, None, 2, 1, 0, 1, 2, None]

DR_LEVEL = {'kick': [0, 8, (10, 0.8)], 'snare': [4, 12, (7, 0.25), (15, 0.3)],
            'hat': [(s, 0.8 if s % 4 == 0 else 0.5) for s in range(0, 16, 2)], 'tek': [(3, 0.5), (11, 0.5)]}
DR_LEVEL2 = {'kick': [0, 6, 8, (14, 0.7)], 'snare': [4, 12, (10, 0.25)],
             'hat': [(s, 0.6 if s % 4 == 0 else 0.35) for s in range(16)],
             'dum': [(0, 0.6), (9, 0.5)], 'tek': [(2, 0.5), (3, 0.35), (11, 0.5), (13, 0.4)]}
DR_LEVEL3 = {'kick': [0, 4, 8, 12, (14, 0.7)], 'snare': [4, 12, (6, 0.3), (15, 0.35)],
             'hat': [(s, 0.7 if s % 4 == 2 else 0.4) for s in range(0, 16, 2)], 'tek': [(3, 0.4), (11, 0.4)]}
DR_MAQSUM = {  # rythme oriental "maqsum" (dum tek . tek dum . tek .)
    'dum': [(0, 1.0), (8, 0.9)], 'kick': [(0, 0.6), (8, 0.5)],
    'tek': [(2, 0.7), (6, 0.7), (12, 0.7), (14, 0.35), (15, 0.3)],
    'hat': [(s, 0.25) for s in range(1, 16, 2)], 'snare': [(12, 0.35)]}
DR_ASSAULT = {'kick': [0, 3, 6, 8, 11, (14, 0.8)], 'snare': [4, 12, (13, 0.3), (15, 0.4)],
              'hat': [(s, 0.6 if s % 2 == 0 else 0.3) for s in range(16)], 'tek': [(7, 0.4)]}
HALF_BASS = [(0, 0, 6), (6, 0, 2), (8, 0, 6), (14, 1, 2)]
DR_MARCH = {'snare': [(0, 0.9), (2, 0.35), (3, 0.35), (4, 0.7), (8, 0.9), (10, 0.35), (11, 0.35), (12, 0.7), (14, 0.5), (15, 0.5)]}


def song_menu():
    s = Song(92, 20)
    intro = ['E', 'E', 'F', 'E']
    s.pads(0, intro + CH_A + CH_B, gain=0.9)
    s.arps(0, intro, ARP_OUD, gain=0.8)
    s.arps(12, CH_B, ARP_OUD, gain=0.5)
    s.timpani(0, intro + CH_A + CH_B, gain=0.7)
    s.drums(0, 20, DR_MARCH, gain=0.55, fill_every=4)
    s.bass(4, CH_A + CH_B, [(0, 0, 6), (8, 0, 6)], gain=0.7)
    s.melody(4, THEME_A, 'brass', vel=0.95)
    s.melody(12, THEME_B, 'brass', vel=0.95)
    s.melody(12, THEME_B, 'brass', vel=0.5, harmony=-2, gain=0.6)  # 2e voix de cuivres
    return s, 0.26


def song_level1():
    s = Song(140, 32)
    ch = CH_A + CH_B + CH_A + CH_B
    s.bass(0, ch, GALLOP)
    s.arps(0, ch, ARP_OUD, gain=0.35)
    s.pads(8, CH_B, gain=0.7)
    s.pads(24, CH_B, gain=0.7)
    s.drums(0, 32, DR_LEVEL, gain=0.7)
    s.melody(0, THEME_A, 'brass')
    s.melody(8, THEME_B, 'brass')
    s.melody(16, THEME_A, 'brass')
    s.melody(16, THEME_A, 'chip', octave=1, gain=0.5, pan=0.2)
    s.melody(24, THEME_B, 'brass')
    s.melody(24, THEME_B, 'brass', vel=0.55, harmony=-2, gain=0.6)
    return s, 0.16


def song_level2():
    """Tempete de sable : LA hijaz, 116 BPM, groove oriental lent (maqsum),
    melodie au luth + chip, cuivres seulement en ponctuations."""
    s = Song(116, 32, shift=5)
    ch = CH_E + CH_F + CH_E + CH_F
    s.bass(0, ch, HALF_BASS, gain=0.85)
    s.drums(0, 32, DR_MAQSUM, gain=0.75, fill_every=16)
    s.pads(0, ch, gain=0.55)
    s.melody(0, THEME_E, 'oud', gain=1.0, pan=-0.2)
    s.melody(0, THEME_E, 'chip', gain=0.55, pan=0.2)
    s.melody(8, THEME_F, 'chip', gain=0.9)
    s.stabs(8, CH_F, [0, 3, 6], gain=0.8)
    s.melody(16, THEME_E, 'chip', octave=1, gain=0.6, pan=0.2)
    s.melody(16, THEME_E, 'oud', gain=0.9, pan=-0.2)
    s.arps(16, CH_E, ARP_OUD, gain=0.3, octave=0)
    s.melody(24, THEME_F, 'brass', vel=0.85)
    s.stabs(24, CH_F, [0, 3, 6], gain=0.7)
    return s, 0.2


def song_level3():
    """Assaut final : RE hijaz, 168 BPM, traits rapides puis refrain
    heroique en notes longues sur basse en doubles-croches."""
    s = Song(168, 32, shift=-2)
    ch = CH_G + CH_H + CH_G + CH_H
    s.bass(0, ch, DRIVE16, gain=0.6)
    s.drums(0, 32, DR_ASSAULT, gain=0.7, fill_every=4)
    s.melody(0, THEME_G, 'chip', gain=0.95)
    s.melody(0, THEME_G, 'oud', octave=-1, gain=0.5, pan=-0.3)
    s.stabs(0, CH_G, [0, 10], gain=0.7)
    s.melody(8, THEME_H, 'brass')
    s.melody(8, THEME_H, 'brass', vel=0.55, harmony=-2, gain=0.6)
    s.pads(8, CH_H, gain=0.65)
    s.melody(16, THEME_G, 'brass', vel=0.9)
    s.melody(16, THEME_G, 'chip', octave=1, gain=0.35, pan=0.25)
    s.melody(24, THEME_H, 'brass', octave=0)
    s.melody(24, THEME_H, 'brass', vel=0.6, harmony=-2, gain=0.6)
    s.melody(24, THEME_H, 'chip', octave=1, gain=0.3, pan=0.25)
    s.pads(24, CH_H, gain=0.65)
    return s, 0.14


def analyse(name, y):
    mono = y.mean(axis=0)
    X = np.abs(np.fft.rfft(mono)) ** 2
    fr = np.fft.rfftfreq(len(mono), 1 / SR)
    tot = X.sum()
    rms = np.sqrt(np.mean(mono ** 2))
    print('%-8s %5.1fs  crete %.2f  RMS %.1f dBFS  energie >4kHz %.1f%%  >8kHz %.2f%%  centroide %d Hz' % (
        name, len(mono) / SR, np.max(np.abs(y)), 20 * np.log10(rms + 1e-9),
        100 * X[fr > 4000].sum() / tot, 100 * X[fr > 8000].sum() / tot, (X * fr).sum() / tot))


def write_ogg(name, y):
    os.makedirs(OUT_DIR, exist_ok=True)
    wav = os.path.join(OUT_DIR, name + '.wav')
    pcm = (np.clip(y.T, -1, 1) * 32767).astype('<i2')
    import wave
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    ogg = os.path.join(OUT_DIR, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', ogg], check=True)
    os.remove(wav)
    print('   ->', os.path.normpath(ogg), '%.0f Ko' % (os.path.getsize(ogg) / 1024))


if __name__ == '__main__':
    for name, fn in (('menu', song_menu), ('level1', song_level1), ('level2', song_level2), ('level3', song_level3)):
        song, wet = fn()
        y = song.render(wet)
        analyse(name, y)
        write_ogg(name, y)
