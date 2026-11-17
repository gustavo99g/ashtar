"""Gera os sons originais do Ashtar (src/assets/sounds): notas senoidais com um pouco de harmônico e
queda suave. Uso, em desktop/: python3 scripts/generate-sounds.py src/assets/sounds

- dm.wav: mensagem privada. mention.wav: menção. ring.wav: o toque da ligação privada (Etapa 18, ainda sem
  uso no app).
"""
import math, struct, sys, wave

RATE = 22050

def note(freq, start, dur, vol, decay):
    return (freq, start, dur, vol, decay)

def render(notes, total, path):
    n = int(total * RATE)
    buf = [0.0] * n
    for freq, start, dur, vol, decay in notes:
        s0 = int(start * RATE)
        for i in range(int(dur * RATE)):
            t = i / RATE
            if s0 + i >= n:
                break
            attack = min(1.0, t / 0.006)
            env = attack * math.exp(-t * decay)
            # Fade final para não estalar.
            tail = min(1.0, (dur - t) / 0.02)
            x = (math.sin(2 * math.pi * freq * t)
                 + 0.28 * math.sin(2 * math.pi * 2 * freq * t)
                 + 0.08 * math.sin(2 * math.pi * 3 * freq * t))
            buf[s0 + i] += vol * env * tail * x
    peak = max(abs(v) for v in buf) or 1.0
    scale = 0.7 / peak
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(v * scale * 32767)) for v in buf))

out = sys.argv[1]
# Mensagem privada: duas notas subindo, curtas e macias (Mi5, Si5).
render([note(659.25, 0.0, 0.22, 1.0, 14), note(987.77, 0.09, 0.32, 0.9, 11)], 0.42, f"{out}/dm.wav")
# Menção: três notas mais claras (Lá5, Ré6, Fá#6), para se distinguir da conversa.
render([note(880.0, 0.0, 0.16, 0.9, 16), note(1174.66, 0.07, 0.18, 0.9, 15),
        note(1479.98, 0.14, 0.34, 1.0, 10)], 0.5, f"{out}/mention.wav")
# Ligação (Etapa 18): duas notas que se alternam em pares, um ciclo de 2,4 s que se repete.
ring = []
for cycle_start in (0.0, 0.6):
    ring += [note(783.99, cycle_start, 0.16, 1.0, 9), note(587.33, cycle_start + 0.16, 0.24, 0.95, 8)]
render(ring, 2.4, f"{out}/ring.wav")
