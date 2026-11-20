"""Gera os sons originais do Ashtar (src/assets/sounds): notas senoidais com um pouco de harmônico e
queda suave. Uso, em desktop/: python3 scripts/generate-sounds.py src/assets/sounds

- dm.wav: mensagem privada. mention.wav: menção. ring.wav: o toque da ligação privada.
- Os sons da sala (v0.5, ADR 0027), mais graves e mais curtos que os de mensagem, para não se confundirem
  com eles: room-join.wav e room-leave.wav (alguém entrou ou saiu), room-mute.wav e room-unmute.wav,
  room-deafen.wav e room-undeafen.wav (o seu microfone e o seu áudio), room-share-start.wav e
  room-share-stop.wav (alguém começou ou parou de transmitir na sua sala).
- O pressionar para falar (v0.6, ADR 0029): ptt-on.wav e ptt-off.wav, um clique curto ao abrir e ao
  fechar o microfone pelo atalho. Bem curtos e baixos: tocam a cada frase.
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

# Os sons da sala. Subir é chegar ou ligar; descer é sair ou desligar.
# Entrou: Dó5 e Sol5. Saiu: o mesmo par, descendo.
render([note(523.25, 0.0, 0.14, 0.9, 16), note(783.99, 0.08, 0.24, 1.0, 12)], 0.34, f"{out}/room-join.wav")
render([note(783.99, 0.0, 0.14, 0.9, 16), note(523.25, 0.08, 0.26, 1.0, 12)], 0.36, f"{out}/room-leave.wav")
# Mutou: uma nota curta e grave (Lá4) que cai para Mi4. Desmutou: Mi4 subindo para Lá4.
render([note(440.0, 0.0, 0.08, 0.9, 22), note(329.63, 0.05, 0.14, 1.0, 20)], 0.2, f"{out}/room-mute.wav")
render([note(329.63, 0.0, 0.08, 0.9, 22), note(440.0, 0.05, 0.14, 1.0, 20)], 0.2, f"{out}/room-unmute.wav")
# Surdo: três notas descendo (Mi5, Si4, Mi4). Voltou: as três subindo.
render([note(659.25, 0.0, 0.1, 0.85, 20), note(493.88, 0.06, 0.1, 0.9, 20),
        note(329.63, 0.12, 0.2, 1.0, 16)], 0.32, f"{out}/room-deafen.wav")
render([note(329.63, 0.0, 0.1, 0.85, 20), note(493.88, 0.06, 0.1, 0.9, 20),
        note(659.25, 0.12, 0.2, 1.0, 16)], 0.32, f"{out}/room-undeafen.wav")
# Transmissão: o acorde de Ré maior aberto (Ré5, Fá#5, Lá5), subindo ao começar e descendo ao acabar.
render([note(587.33, 0.0, 0.12, 0.8, 14), note(739.99, 0.07, 0.12, 0.85, 14),
        note(880.0, 0.14, 0.3, 1.0, 10)], 0.44, f"{out}/room-share-start.wav")
render([note(880.0, 0.0, 0.12, 0.8, 14), note(739.99, 0.07, 0.12, 0.85, 14),
        note(587.33, 0.14, 0.3, 1.0, 10)], 0.44, f"{out}/room-share-stop.wav")

# Pressionar para falar: um clique só, agudo ao abrir (Ré6) e mais grave ao fechar (Lá5).
render([note(1174.66, 0.0, 0.06, 1.0, 45)], 0.07, f"{out}/ptt-on.wav")
render([note(880.0, 0.0, 0.06, 1.0, 45)], 0.07, f"{out}/ptt-off.wav")
