# fw-words — CLI de transcrição em nível de PALAVRA para o painel Quarks Cuts.
# Empacotado com PyInstaller e spawnado pelo painel como processo separado
# (mesmo padrão do whisper-cli.exe/ffmpeg.exe do whisper.cpp).
#
# Por que existe: o faster-whisper alinha palavras por cross-attention, mais
# preciso que o DTW do whisper.cpp em fala contínua/alongada — o caso em que
# as legendas escorregavam ~0,5s e davam 1h de ajuste manual num corte.
#
# Uso: fw-words.exe <midia> [modelo]
#   modelo: tiny|base|small|medium|large-v3 (default: large-v3)
# Saída (stdout, última linha): JSON {"words":[{"s":0.12,"e":0.5,"t":"Olá"}],"language":"pt"}
# Progresso (stderr): "progress = NN%" (mesmo formato do whisper.cpp, p/ o painel).
import sys
import os
import json

# UTF-8 sempre, independente do codepage do Windows (o painel lê o JSON em utf8).
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "uso: fw-words <midia> [modelo]"}))
        sys.exit(1)
    media = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"
    if not os.path.isfile(media):
        print(json.dumps({"error": "arquivo não encontrado: " + media}))
        sys.exit(1)

    from faster_whisper import WhisperModel

    print("carregando modelo " + model_size + "...", file=sys.stderr, flush=True)
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        media,
        language=None,               # autodetecta
        word_timestamps=True,        # alinhamento por palavra (cross-attention)
        vad_filter=True,             # âncora em fala real
        temperature=0,
        condition_on_previous_text=False,
        no_speech_threshold=0.5,
        compression_ratio_threshold=2.4,
    )

    dur = float(getattr(info, "duration", 0) or 0)
    words = []
    for seg in segments:  # generator: consome conforme transcreve
        for w in (seg.words or []):
            t = (w.word or "").strip()
            if t:
                words.append({"s": round(w.start, 3), "e": round(w.end, 3), "t": t})
        if dur > 0:
            pct = min(99, int(seg.end / dur * 100))
            print("progress = %d%%" % pct, file=sys.stderr, flush=True)

    print("progress = 100%", file=sys.stderr, flush=True)
    print(json.dumps({"words": words, "language": info.language}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
