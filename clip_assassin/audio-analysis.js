(function (global) {
  var WINDOW_MS = 10;

  function getNodeRequire() {
    if (typeof require === "function") {
      return require;
    }
    if (typeof cep_node !== "undefined" && typeof cep_node.require === "function") {
      return cep_node.require;
    }
    if (typeof window !== "undefined" && window.cep_node && typeof window.cep_node.require === "function") {
      return window.cep_node.require;
    }
    return null;
  }

  function readFileBuffer(filePath) {
    var nodeRequire = getNodeRequire();
    if (nodeRequire) {
      var fs = nodeRequire("fs");
      return fs.readFileSync(filePath);
    }

    if (window.cep && cep.fs && typeof cep.fs.readFile === "function") {
      var result = cep.fs.readFile(filePath, cep.encoding.Base64);
      if (result.err) {
        throw new Error("Não foi possível ler o WAV exportado (código " + result.err + ").");
      }
      var binary = atob(result.data);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    throw new Error("Node.js não está habilitado nesta extensão CEP. Ative --enable-nodejs no manifest.");
  }

  function readString(view, offset, length) {
    var chars = [];
    for (var i = 0; i < length; i += 1) {
      chars.push(String.fromCharCode(view.getUint8(offset + i)));
    }
    return chars.join("");
  }

  function parseWav(buffer) {
    var arrayBuffer = buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    var view = new DataView(arrayBuffer);
    if (readString(view, 0, 4) !== "RIFF" || readString(view, 8, 4) !== "WAVE") {
      throw new Error("O arquivo exportado não é um WAV PCM válido.");
    }

    var offset = 12;
    var format = null;
    var channels = 1;
    var sampleRate = 48000;
    var bitsPerSample = 16;
    var dataOffset = 0;
    var dataSize = 0;

    while (offset + 8 <= view.byteLength) {
      var chunkId = readString(view, offset, 4);
      var chunkSize = view.getUint32(offset + 4, true);
      var next = offset + 8 + chunkSize + (chunkSize % 2);
      if (chunkId === "fmt ") {
        format = view.getUint16(offset + 8, true);
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === "data") {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }
      offset = next;
    }

    if (!dataSize) {
      throw new Error("Chunk de dados de áudio não encontrado no WAV.");
    }

    var isFloat = format === 3;
    var bytesPerSample = bitsPerSample / 8;
    var frameSize = bytesPerSample * channels;
    var totalFrames = Math.floor(dataSize / frameSize);
    var samples = new Float32Array(totalFrames);

    for (var frame = 0; frame < totalFrames; frame += 1) {
      var mix = 0;
      for (var ch = 0; ch < channels; ch += 1) {
        var pos = dataOffset + frame * frameSize + ch * bytesPerSample;
        var sample = 0;
        if (isFloat && bitsPerSample === 32) {
          sample = view.getFloat32(pos, true);
        } else if (bitsPerSample === 16) {
          sample = view.getInt16(pos, true) / 32768;
        } else if (bitsPerSample === 24) {
          var b0 = view.getUint8(pos);
          var b1 = view.getUint8(pos + 1);
          var b2 = view.getUint8(pos + 2);
          var val = (b2 << 16) | (b1 << 8) | b0;
          if (val & 0x800000) {
            val -= 0x1000000;
          }
          sample = val / 8388608;
        } else if (bitsPerSample === 32 && !isFloat) {
          sample = view.getInt32(pos, true) / 2147483648;
        } else {
          sample = view.getInt8(pos) / 128;
        }
        mix += sample;
      }
      samples[frame] = mix / channels;
    }

    return {
      sampleRate: sampleRate,
      channels: channels,
      samples: samples,
      durationMs: (totalFrames / sampleRate) * 1000,
    };
  }

  function computeLevels(samples, sampleRate, windowMs) {
    var windowSize = Math.max(1, Math.round((sampleRate * (windowMs || WINDOW_MS)) / 1000));
    var levelCount = Math.ceil(samples.length / windowSize);
    var rms = new Float32Array(levelCount);
    var peak = new Float32Array(levelCount);
    var dbfs = new Float32Array(levelCount);

    for (var i = 0; i < levelCount; i += 1) {
      var start = i * windowSize;
      var end = Math.min(samples.length, start + windowSize);
      var sumSq = 0;
      var maxAbs = 0;
      for (var s = start; s < end; s += 1) {
        var v = samples[s];
        sumSq += v * v;
        var abs = Math.abs(v);
        if (abs > maxAbs) {
          maxAbs = abs;
        }
      }
      var count = Math.max(1, end - start);
      var rmsValue = Math.sqrt(sumSq / count);
      rms[i] = rmsValue;
      peak[i] = maxAbs;
      dbfs[i] = rmsValue > 0 ? 20 * Math.log10(rmsValue) : -90;
    }

    return {
      windowMs: windowMs || WINDOW_MS,
      rms: Array.prototype.slice.call(rms),
      peak: Array.prototype.slice.call(peak),
      dbfs: Array.prototype.slice.call(dbfs),
      durationMs: (samples.length / sampleRate) * 1000,
    };
  }

  function detectSilenceRegions(dbfs, windowMs, thresholdDb, minDurationMs, paddingMs) {
    var regions = [];
    var inSilence = false;
    var startIndex = 0;

    for (var i = 0; i < dbfs.length; i += 1) {
      var silent = Number(dbfs[i]) < Number(thresholdDb);
      if (silent && !inSilence) {
        inSilence = true;
        startIndex = i;
      } else if (!silent && inSilence) {
        regions.push([startIndex * windowMs, i * windowMs]);
        inSilence = false;
      }
    }
    if (inSilence) {
      regions.push([startIndex * windowMs, dbfs.length * windowMs]);
    }

    var kept = [];
    for (var r = 0; r < regions.length; r += 1) {
      if (regions[r][1] - regions[r][0] >= minDurationMs) {
        kept.push(regions[r]);
      }
    }

    var padded = [];
    for (var p = 0; p < kept.length; p += 1) {
      var start = kept[p][0] + paddingMs;
      var end = kept[p][1] - paddingMs;
      var prevEnd = padded.length ? padded[padded.length - 1][1] : -Infinity;
      if (start < prevEnd) {
        start = prevEnd;
      }
      if (end - start >= Math.min(40, minDurationMs / 4)) {
        padded.push([start, end]);
      }
    }

    return padded;
  }

  function suggestThreshold(dbfs) {
    var values = [];
    for (var i = 0; i < dbfs.length; i += 1) {
      if (isFinite(dbfs[i])) {
        values.push(dbfs[i]);
      }
    }
    if (!values.length) {
      return -30;
    }
    values.sort(function (a, b) {
      return a - b;
    });
    var idx = Math.floor(values.length * 0.15);
    var noiseFloor = values[idx];
    var suggested = Math.round(noiseFloor + 8);
    return Math.max(-60, Math.min(0, suggested));
  }

  function analyzeWavFile(filePath) {
    var buffer = readFileBuffer(filePath);
    var wav = parseWav(buffer);
    var levels = computeLevels(wav.samples, wav.sampleRate, WINDOW_MS);
    return {
      sampleRate: wav.sampleRate,
      durationMs: wav.durationMs,
      windowMs: levels.windowMs,
      rms: levels.rms,
      peak: levels.peak,
      dbfs: levels.dbfs,
    };
  }

  function deleteFile(filePath) {
    try {
      var nodeRequire = getNodeRequire();
      if (nodeRequire) {
        nodeRequire("fs").unlinkSync(filePath);
        return;
      }
      if (window.cep && cep.fs && typeof cep.fs.deleteFile === "function") {
        cep.fs.deleteFile(filePath);
      }
    } catch (error) {
      console.warn("Não foi possível apagar o WAV temporário", error);
    }
  }

  global.AutoCutAudio = {
    WINDOW_MS: WINDOW_MS,
    analyzeWavFile: analyzeWavFile,
    detectSilenceRegions: detectSilenceRegions,
    suggestThreshold: suggestThreshold,
    deleteFile: deleteFile,
  };
})(window);
