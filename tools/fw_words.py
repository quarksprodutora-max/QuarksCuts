# fw-words — CLI de transcrição em nível de PALAVRA para o painel Quarks Cuts.
# Empacotado com PyInstaller e spawnado pelo painel como processo separado
# (mesmo padrão do whisper-cli.exe/ffmpeg.exe do whisper.cpp).
#
# Pipeline: faster-whisper (transcrição) + WhisperX (alinhamento FORÇADO por
# fonemas com wav2vec2) — validado contra gabarito real da produção: erro médio
# de fronteira caiu de ~876ms para ~363ms, maioria dentro de ±100ms.
# Se o alinhamento falhar (idioma sem modelo, lib ausente), cai nos tempos do
# faster-whisper puro — nunca deixa de entregar.
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

# 0,5s de silêncio antes do áudio: sem isso a PRIMEIRA palavra é engolida
# quando o corte já começa falando (caso real: "Nossa" sumia do EDITADO 15).
PAD_SEC = 0.5
SR = 16000


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "uso: fw-words <midia> [modelo]"}))
        sys.exit(1)
    media = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"
    if not os.path.isfile(media):
        print(json.dumps({"error": "arquivo não encontrado: " + media}))
        sys.exit(1)

    import numpy as np
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    log("decodificando áudio...")
    audio = decode_audio(media, sampling_rate=SR)
    audio = np.concatenate([np.zeros(int(PAD_SEC * SR), dtype=audio.dtype), audio])
    dur = len(audio) / SR

    log("carregando modelo " + model_size + "...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        audio,
        language=None,               # autodetecta
        word_timestamps=True,        # tempos por palavra (base p/ o fallback)
        vad_filter=True,
        vad_parameters={"speech_pad_ms": 400},
        temperature=0,
        condition_on_previous_text=False,
        no_speech_threshold=0.5,
        compression_ratio_threshold=2.4,
    )

    fw_words = []
    x_segments = []
    for seg in segments:  # generator: consome conforme transcreve
        x_segments.append({"start": seg.start, "end": seg.end, "text": seg.text})
        for w in (seg.words or []):
            t = (w.word or "").strip()
            if t:
                fw_words.append({"s": w.start, "e": w.end, "t": t})
        if dur > 0:
            pct = min(89, int(seg.end / dur * 90))
            log("progress = %d%%" % pct)

    words = fw_words
    # Alinhamento forçado por fonemas (WhisperX + wav2vec2) — a precisão real.
    try:
        log("alinhando por fonemas (WhisperX)...")
        log("progress = 92%")
        import whisperx
        model_a, meta = whisperx.load_align_model(language_code=info.language, device="cpu")
        aligned = whisperx.align(x_segments, model_a, meta, audio, "cpu", return_char_alignments=False)
        x_words = []
        for s in aligned.get("segments", []):
            for w in s.get("words", []):
                t = (w.get("word") or "").strip()
                if t and "start" in w and "end" in w:
                    x_words.append({"s": w["start"], "e": w["end"], "t": t})
        if len(x_words) >= len(fw_words) * 0.8:  # sanidade: alinhou o grosso?
            words = x_words
            log("alinhamento OK: " + str(len(x_words)) + " palavras")
        else:
            log("alinhamento incompleto (" + str(len(x_words)) + "/" + str(len(fw_words)) + ") — usando tempos do faster-whisper")
    except Exception as e:
        log("WhisperX indisponível (" + str(e)[:120] + ") — usando tempos do faster-whisper")
        # diagnóstico: o erro do lazy-import do transformers esconde a causa real
        try:
            import transformers.models.wav2vec2.modeling_wav2vec2  # noqa
        except Exception:
            import traceback
            log("DIAG modeling_wav2vec2:\n" + traceback.format_exc()[-800:])

    # desconta o silêncio artificial do início
    out = []
    for w in words:
        s = max(0.0, round(w["s"] - PAD_SEC, 3))
        e = max(s, round(w["e"] - PAD_SEC, 3))
        out.append({"s": s, "e": e, "t": w["t"]})

    log("progress = 100%")
    print(json.dumps({"words": out, "language": info.language}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
