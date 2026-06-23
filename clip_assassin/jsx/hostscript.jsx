// ExtendScript for Premiere Pro - Clip Assassin Plugin
// Cuts. Without mercy.

// Helper: trim function for ExtendScript
function trim(str) {
    return str.replace(/^\s+|\s+$/g, '');
}

function testConnection() {
    return "Clip Assassin locked and loaded!";
}

function cutVideo(timeCodesString, reverseMode) {
    try {
        if (!app.project) {
            return "ERROR: No project detected. Open a project first.";
        }

        var project = app.project;

        // Find first video clip in project
        function findFirstVideoClip(item) {
            if (item.type === 1) { // 1 = clip
                return item;
            }
            if (item.children) {
                for (var i = 0; i < item.children.numItems; i++) {
                    var found = findFirstVideoClip(item.children[i]);
                    if (found) return found;
                }
            }
            return null;
        }

        var masterClip = findFirstVideoClip(project.rootItem);

        if (!masterClip) {
            return "ERROR: No target found. Import a video clip first.";
        }

        // Detect framerate from clip
        var frameRate = 30; // default fallback
        try {
            var footage = masterClip.getFootageInterpretation();
            if (footage && footage.frameRate) {
                frameRate = footage.frameRate;
            }
        } catch(e) {
            // If detection fails, use default
        }

        // Parse time ranges - using ||| as separator
        var lines = timeCodesString.split('|||');
        var ranges = [];
        var parseErrors = "";

        for (var i = 0; i < lines.length; i++) {
            var line = trim(lines[i]);
            if (line.length > 0) {
                var parsed = parseTimeRange(line, frameRate);
                if (parsed) {
                    ranges.push(parsed);
                } else {
                    parseErrors += "Line " + i + " ('" + line + "') failed; ";
                }
            }
        }

        if (ranges.length === 0) {
            return "ERROR: No valid targets identified. Check your time format.";
        }

        // Sort by start time
        ranges.sort(function(a, b) {
            return a.startSeconds - b.startSeconds;
        });

        // REVERSE MODE: Convert marked ranges to inverse ranges
        if (reverseMode) {
            // Clear in/out points to ensure we get the full clip duration
            masterClip.clearInPoint();
            masterClip.clearOutPoint();

            var clipDurationObj = masterClip.getOutPoint(4); // Returns Time object
            var clipDuration = clipDurationObj.seconds; // Get duration in seconds

            // DEBUG: Check if we got valid duration
            if (!clipDuration || clipDuration <= 0) {
                return "ERROR: Could not detect clip duration. Got: " + clipDuration;
            }

            var inverseRanges = [];
            var lastEnd = 0;

            for (var i = 0; i < ranges.length; i++) {
                // Add segment before this marked range
                if (lastEnd < ranges[i].startSeconds) {
                    inverseRanges.push({
                        startSeconds: lastEnd,
                        endSeconds: ranges[i].startSeconds
                    });
                }
                lastEnd = ranges[i].endSeconds;
            }

            // Add final segment after last marked range
            if (lastEnd < clipDuration) {
                inverseRanges.push({
                    startSeconds: lastEnd,
                    endSeconds: clipDuration
                });
            }

            ranges = inverseRanges;

            if (ranges.length === 0) {
                return "ERROR: Reverse mode would eliminate entire clip. Nothing to keep.";
            }
        }

        // Create NEW sequence with eliminated targets
        var newSeq = project.createNewSequenceFromClips(
            "Assassinated - " + masterClip.name,
            [masterClip],
            project.rootItem
        );

        if (!newSeq) {
            return "ERROR: Mission failed. Could not create sequence.";
        }

        project.activeSequence = newSeq;

        // Remove the auto-inserted full clip
        var newVideoTrack = newSeq.videoTracks[0];
        if (newVideoTrack.clips.numItems > 0) {
            for (var i = newVideoTrack.clips.numItems - 1; i >= 0; i--) {
                newVideoTrack.clips[i].remove(false, false);
            }
        }

        // Insert only the desired segments - exactly like the old working script
        var trackPosition = 0;

        for (var i = 0; i < ranges.length; i++) {
            var inSec = ranges[i].startSeconds;
            var outSec = ranges[i].endSeconds;

            if (outSec <= inSec) continue;

            // Set in/out points (type 4 = seconds)
            masterClip.setInPoint(inSec, 4);
            masterClip.setOutPoint(outSec, 4);

            // Insert at current position
            newVideoTrack.insertClip(masterClip, trackPosition);

            // Move position forward (in seconds)
            trackPosition += (outSec - inSec);
        }

        // Clear in/out
        masterClip.clearInPoint();
        masterClip.clearOutPoint();

        return "SUCCESS: ✓ Mission accomplished! " + ranges.length + " targets eliminated. Clean sequence created.";
    } catch(e) {
        return "ERROR: Mission compromised - " + e.toString();
    }
}

// Parse time range in format "1m57-2m08" or "1:57-2:08" or "00:01:30:15-00:02:00:20"
function parseTimeRange(rangeString, frameRate) {
    // Replace different dash types with standard hyphen
    // U+002D = hyphen-minus (-)
    // U+2013 = en dash (–)
    // U+2014 = em dash (—)
    rangeString = rangeString.replace(/[\u2013\u2014]/g, '-');

    // Remove spaces
    rangeString = rangeString.replace(/\s+/g, '');

    // Split by hyphen
    var parts = rangeString.split('-');

    // Handle cases like "0:02:25-0:03:30" where there might be more than 2 parts
    // but in our case it's not a problem because times are not negative
    if (parts.length < 2) {
        return null; // Not a range
    }

    // If there are more parts (e.g. split into more than 2), join them correctly
    // Usually there will be just 2 parts
    var start = parseTime(trim(parts[0]), frameRate);
    var end = parseTime(trim(parts[parts.length - 1]), frameRate);

    if (start === null || end === null) {
        return null;
    }

    return {
        startSeconds: start,
        endSeconds: end
    };
}

// Parse a single time in format "1m57", "1:57", "0:02:25", "00:01:30:15" or "00:01:30;15"
function parseTime(timeString, frameRate) {
    if (!timeString || timeString.length === 0) {
        return null;
    }

    timeString = trim(timeString.toLowerCase());

    var hours = 0, minutes = 0, seconds = 0, frames = 0;
    var isDropFrame = false;
    var isTimecodeFormat = false; // Track if this is HH:MM:SS:FF format

    // Check for drop-frame timecode (semicolon before frames)
    if (timeString.indexOf(';') !== -1) {
        isDropFrame = true;
        isTimecodeFormat = true;
        // Split by semicolon to get frames
        var semiParts = timeString.split(';');
        if (semiParts.length === 2) {
            frames = parseInt(semiParts[1], 10);
            timeString = semiParts[0]; // Continue parsing the time part
        }
    }

    // Format: 1h30m45s or 1h30m or combinations with "h", "m", "s"
    if (timeString.indexOf('h') !== -1) {
        var hParts = timeString.split('h');
        hours = parseInt(hParts[0], 10);

        if (hParts[1]) {
            // Process remainder (may contain m and s)
            var rest = hParts[1];
            if (rest.indexOf('m') !== -1) {
                var mParts = rest.split('m');
                minutes = parseInt(mParts[0], 10);
                if (mParts[1]) {
                    seconds = parseInt(mParts[1].replace('s', ''), 10);
                }
            } else {
                seconds = parseInt(rest.replace('s', ''), 10);
            }
        }
    }
    // Format: 1m57s or 1m57
    else if (timeString.indexOf('m') !== -1) {
        var mParts = timeString.split('m');
        minutes = parseInt(mParts[0], 10);

        if (mParts[1]) {
            // Remove 's' if exists
            var secPart = mParts[1].replace('s', '');
            seconds = parseInt(secPart, 10);
        }
    }
    // Format: 0:02:25 or 1:57:30 or 1:57 or 00:01:30:15 (non-drop-frame with frames)
    else if (timeString.indexOf(':') !== -1) {
        var colonParts = timeString.split(':');

        if (colonParts.length === 2) {
            // MM:SS
            minutes = parseInt(colonParts[0], 10);
            seconds = parseInt(colonParts[1], 10);
        } else if (colonParts.length === 3) {
            // HH:MM:SS
            hours = parseInt(colonParts[0], 10);
            minutes = parseInt(colonParts[1], 10);
            seconds = parseInt(colonParts[2], 10);
        } else if (colonParts.length === 4) {
            // HH:MM:SS:FF (non-drop-frame timecode)
            isTimecodeFormat = true;
            hours = parseInt(colonParts[0], 10);
            minutes = parseInt(colonParts[1], 10);
            seconds = parseInt(colonParts[2], 10);
            frames = parseInt(colonParts[3], 10);
        } else if (colonParts.length === 1) {
            // Just a number with colon? Unlikely, but handle it
            seconds = parseInt(colonParts[0], 10);
        }
    }
    // Just a number = seconds
    else {
        seconds = parseInt(timeString, 10);
    }

    // Handle NaN
    if (isNaN(hours) || hours < 0) hours = 0;
    if (isNaN(minutes) || minutes < 0) minutes = 0;
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    if (isNaN(frames) || frames < 0) frames = 0;

    // TIMECODE FORMAT (HH:MM:SS:FF or HH:MM:SS;FF): Convert everything to frames first, then to seconds
    if (isTimecodeFormat && frameRate > 0) {
        // Determine timebase (the "nominal" framerate used in timecode)
        // For 59.94fps → timebase is 60
        // For 29.97fps → timebase is 30
        // For 23.976fps → timebase is 24
        var timebase = Math.round(frameRate);

        // Calculate total frame number using timebase
        var totalFrames = (hours * 3600 * timebase) +
                          (minutes * 60 * timebase) +
                          (seconds * timebase) +
                          frames;

        // Convert frames back to seconds using ACTUAL framerate for accurate timing
        return totalFrames / frameRate;
    }

    // NON-TIMECODE FORMAT: Simple time calculation
    var totalSeconds = (hours * 3600) + (minutes * 60) + seconds;

    // Add frame offset if frames were specified (shouldn't happen in non-timecode format, but just in case)
    if (frames > 0 && frameRate > 0) {
        totalSeconds += (frames / frameRate);
    }

    return totalSeconds;
}

// Helper function for unique values and sorting
function uniqueAndSort(arr) {
    var seen = {};
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        if (!seen[arr[i]]) {
            seen[arr[i]] = true;
            result.push(arr[i]);
        }
    }
    result.sort(function(a, b) { return a - b; });
    return result;
}

// ====================================================================
// QUARKS CUTS — cria uma sequência a partir de trechos JÁ ORDENADOS
// (vindos do VoxFlow/Quarks Cuts). NÃO ordena: preserva o gancho-primeiro.
// A fonte (clipe OU sequência) é escolhida no painel.
// ====================================================================

// Acha (ou cria) uma bin pelo nome na raiz do projeto.
function qcGetOrCreateBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var ch = root.children[i];
        var isBin = false;
        try { isBin = (ch.type === 2); } catch (e) {}
        if (isBin && ch.name === name) return ch;
    }
    try { return root.createBin(name); } catch (e) { return root; }
}

// Coleta clipes e sequências do projeto (entra nas bins). Ordem determinística.
// Ignora a pasta de saída "cortes" (não faz sentido cortar a partir dela).
function qcCollectSources(item, arr) {
    if (!item || !item.children) return arr;
    for (var i = 0; i < item.children.numItems; i++) {
        var ch = item.children[i];
        var isBin = false;
        try { isBin = (ch.type === 2); } catch (e) {}
        if (isBin) {
            if (ch.name === 'cortes') continue;
            if (ch.children && ch.children.numItems > 0) qcCollectSources(ch, arr);
        } else {
            arr.push(ch);
        }
    }
    return arr;
}

// Lista as fontes p/ o dropdown do painel: "index|tipo|ativa|nome" por linha.
function qcListSources() {
    try {
        if (!app.project) return "";
        var arr = qcCollectSources(app.project.rootItem, []);
        var activeName = "";
        try { if (app.project.activeSequence) activeName = app.project.activeSequence.name; } catch (e) {}
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var isSeq = false;
            try { isSeq = arr[i].isSequence(); } catch (e) {}
            var active = (isSeq && arr[i].name === activeName) ? "1" : "0";
            out.push(i + "|" + (isSeq ? "seq" : "clip") + "|" + active + "|" + arr[i].name);
        }
        return out.join("\n");
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Retorna o caminho do arquivo de mídia da fonte (clipe) escolhida no dropdown.
// Usado pelo fluxo "Gerar cortes": precisamos do arquivo em disco p/ transcrever.
// Sequências não têm um arquivo único → retorna ERROR pedindo um clipe.
function qcGetMediaPath(srcIndex) {
    try {
        if (!app.project) return "ERROR: Abra um projeto primeiro.";
        var arr = qcCollectSources(app.project.rootItem, []);
        var idx = parseInt(srcIndex, 10);
        var item = (!isNaN(idx) && idx >= 0 && idx < arr.length) ? arr[idx] : null;
        if (!item) return "ERROR: Fonte inválida. Atualize a lista (🔄) e escolha um clipe.";

        var isSeq = false;
        try { isSeq = item.isSequence(); } catch (e) {}
        if (isSeq) return "ERROR: Para gerar cortes, escolha um CLIPE de vídeo (🎬), não uma sequência (🎞️).";

        var p = "";
        try { p = item.getMediaPath(); } catch (e) { return "ERROR: Não consegui ler o caminho do arquivo: " + e.toString(); }
        if (!p || p.length === 0) return "ERROR: A fonte não tem um arquivo de mídia em disco (mídia offline?).";
        return "OK:" + p;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Exporta o ÁUDIO da SEQUÊNCIA ATIVA para outPath, usando um preset .epr de áudio.
// Síncrono (bloqueia até terminar). Os timestamps da transcrição ficam alinhados
// à timeline da sequência — que é a mesma fonte usada para montar os cortes.
function qcExportActiveAudio(presetPath, outPath) {
    try {
        if (!app.project) return "ERROR: Abra um projeto primeiro.";
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: Nenhuma sequência ativa. Abra a sequência na timeline e tente de novo.";
        var pf = new File(presetPath);
        if (!pf.exists) return "ERROR: Preset de áudio (.epr) não encontrado: " + presetPath;

        var waType;
        try { waType = app.encoder.ENCODE_ENTIRE; } catch (e) { waType = 0; }
        try { seq.exportAsMediaDirect(outPath, presetPath, waType); }
        catch (e) { return "ERROR: Falha na exportação: " + e.toString(); }

        var of = new File(outPath);
        if (!of.exists) return "ERROR: A exportação não gerou o arquivo. Confirme que o preset é de ÁUDIO.";
        return "OK:" + outPath;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Índice da SEQUÊNCIA ATIVA dentro de qcCollectSources, p/ reutilizar quarksCutsBuild.
function qcActiveSourceIndex() {
    try {
        if (!app.project || !app.project.activeSequence) return "ERROR: Nenhuma sequência ativa.";
        var activeName = app.project.activeSequence.name;
        var arr = qcCollectSources(app.project.rootItem, []);
        for (var i = 0; i < arr.length; i++) {
            var isSeq = false;
            try { isSeq = arr[i].isSequence(); } catch (e) {}
            if (isSeq && arr[i].name === activeName) return "OK:" + i;
        }
        return "ERROR: A sequência ativa não está na lista de fontes (está dentro da bin 'cortes'?).";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Nome da sequência ativa (p/ nomear o arquivo .srt do corte).
function qcActiveSeqName() {
    try {
        if (!app.project || !app.project.activeSequence) return "ERROR: Nenhuma sequência ativa.";
        return "OK:" + app.project.activeSequence.name;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Pasta do arquivo do projeto (.prproj). Usada p/ salvar as legendas ao lado.
function qcProjectDir() {
    try {
        if (!app.project || !app.project.path) return "ERROR: Projeto sem caminho (salve o projeto primeiro).";
        var f = new File(app.project.path);
        var dir = f.parent ? f.parent.fsName : "";
        if (!dir) return "ERROR: Não consegui obter a pasta do projeto.";
        return "OK:" + dir;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Importa os .srt de uma pasta para a bin 'legendas' (ficam à mão pra arrastar
// na faixa de legenda do corte). srtPaths: caminhos separados por '|||'.
function qcImportLegendas(srtPathsStr) {
    try {
        if (!app.project) return "ERROR: Abra um projeto primeiro.";
        var bin = qcGetOrCreateBin('legendas');
        var paths = srtPathsStr.split('|||');
        var ok = [];
        for (var i = 0; i < paths.length; i++) {
            var p = trim(paths[i]);
            if (!p) continue;
            ok.push(p);
        }
        if (ok.length === 0) return "ERROR: Nenhum arquivo de legenda para importar.";
        try { app.project.importFiles(ok, true, bin, false); }
        catch (e) { return "ERROR: Falha ao importar legendas: " + e.toString(); }
        return "SUCCESS: " + ok.length + " legenda(s) importada(s) na bin 'legendas'.";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// Limpa TODAS as trilhas (vídeo + áudio) — evita sobrar o clipe inteiro.
function qcClearSequence(seq) {
    var t, i;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        var vt = seq.videoTracks[t];
        for (i = vt.clips.numItems - 1; i >= 0; i--) { vt.clips[i].remove(false, false); }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        var at = seq.audioTracks[t];
        for (i = at.clips.numItems - 1; i >= 0; i--) { at.clips[i].remove(false, false); }
    }
}

// Ajusta o tamanho do quadro da sequência (sem reescalar os clipes).
// aspect: "9x16" (1080x1920) ou "16x9" (1920x1080). Qualquer outro valor = não mexe.
function qcApplyAspect(seq, aspect) {
    if (aspect !== '9x16' && aspect !== '16x9') return;
    try {
        var st = seq.getSettings();
        if (aspect === '9x16') { st.videoFrameWidth = 1080; st.videoFrameHeight = 1920; }
        else { st.videoFrameWidth = 1920; st.videoFrameHeight = 1080; }
        seq.setSettings(st);
    } catch (e) {}
}

// srcIndex: índice na lista do qcListSources (qual clipe/sequência usar como fonte).
// aspect (opcional): "9x16" ou "16x9" para o quadro da sequência do corte.
function quarksCutsBuild(name, rangesStr, srcIndex, aspect) {
    try {
        if (!app.project) return "ERROR: Abra um projeto primeiro.";
        var project = app.project;

        var arr = qcCollectSources(project.rootItem, []);
        var idx = parseInt(srcIndex, 10);
        var master = (!isNaN(idx) && idx >= 0 && idx < arr.length) ? arr[idx]
                     : (arr.length > 0 ? arr[0] : null);
        if (!master) return "ERROR: Nenhuma fonte. Importe o vídeo ou abra a sequência e atualize a lista.";

        // Parse "start:end,start:end" (segundos) — ORDEM PRESERVADA, sem sort
        var pairs = rangesStr.split(',');
        var ranges = [];
        for (var i = 0; i < pairs.length; i++) {
            var p = trim(pairs[i]);
            if (p.length === 0) continue;
            var se = p.split(':');
            if (se.length < 2) continue;
            var s = parseFloat(se[0]);
            var e = parseFloat(se[1]);
            if (isNaN(s) || isNaN(e) || e <= s) continue;
            ranges.push({ s: s, e: e });
        }
        if (ranges.length === 0) return "ERROR: Nenhum trecho válido para '" + name + "'.";

        var seqName = name;  // já vem formatado do painel: "01 |25s|- Título"
        var cortesBin = qcGetOrCreateBin('cortes');
        var newSeq = project.createNewSequenceFromClips(seqName, [master], cortesBin);
        if (!newSeq) return "ERROR: Não consegui criar a sequência '" + seqName + "'.";
        project.activeSequence = newSeq;
        qcApplyAspect(newSeq, aspect);

        // Esvazia a timeline auto-criada e insere só os trechos, na ordem
        qcClearSequence(newSeq);
        var vt = newSeq.videoTracks[0];
        var pos = 0;
        for (var j = 0; j < ranges.length; j++) {
            master.setInPoint(ranges[j].s, 4);
            master.setOutPoint(ranges[j].e, 4);
            vt.insertClip(master, pos);
            pos += (ranges[j].e - ranges[j].s);
        }
        try { master.clearInPoint(); master.clearOutPoint(); } catch (e) {}

        return "SUCCESS: '" + seqName + "' (" + ranges.length + " trechos)";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// ====================================================================
// QUARKS CUTS — UNNEST (desaninhar) a sequência ATIVA.
// A API do Premiere não tem "unnest" nativo; aqui reconstruímos:
// para cada clipe que é uma sequência aninhada, lemos os clipes da
// sequência-fonte e os reinserimos na timeline ativa, na posição certa,
// e então removemos o nest. LIMITES: efeitos aplicados NO clipe-nest se
// perdem; desce só 1 nível; o áudio vem junto do vídeo (overwriteClip).
// ====================================================================

// Mapeia um projectItem (que é uma sequência) → objeto Sequence.
function qcSequenceFromProjectItem(pItem) {
    if (!pItem) return null;
    var seqs = app.project.sequences;
    var pid = null;
    try { pid = pItem.nodeId; } catch (e) {}
    if (pid) {
        for (var i = 0; i < seqs.numSequences; i++) {
            try {
                var sp = seqs[i].projectItem;
                if (sp && sp.nodeId === pid) return seqs[i];
            } catch (e) {}
        }
    }
    // fallback por nome (menos confiável se houver nomes repetidos)
    for (var j = 0; j < seqs.numSequences; j++) {
        try { if (seqs[j].name === pItem.name) return seqs[j]; } catch (e) {}
    }
    return null;
}

// Garante que a sequência tenha pelo menos vNeeded trilhas de vídeo e
// aNeeded de áudio (cria via QE DOM o que faltar).
function qcEnsureTracks(seq, vNeeded, aNeeded) {
    var addV = vNeeded - seq.videoTracks.numTracks;
    var addA = aNeeded - seq.audioTracks.numTracks;
    if (addV <= 0 && addA <= 0) return;
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq) {
            qeSeq.addTracks(
                addV > 0 ? addV : 0, seq.videoTracks.numTracks,
                addA > 0 ? addA : 0, seq.audioTracks.numTracks
            );
        }
    } catch (e) {}
}

// Coleta os clipes-nest (trackItems cujo projectItem é uma sequência) da
// sequência ativa, varrendo só as trilhas de vídeo (cada nest AV ocupa V+A,
// e processamos pela trilha de vídeo para não duplicar).
function qcCollectNests(seq) {
    var nests = [];
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
        var vt = seq.videoTracks[t];
        for (var i = 0; i < vt.clips.numItems; i++) {
            var ti = vt.clips[i];
            var pItem = null;
            try { pItem = ti.projectItem; } catch (e) {}
            var isSeq = false;
            try { isSeq = pItem && pItem.isSequence(); } catch (e) {}
            if (isSeq) {
                nests.push({ vTrack: t, projectItem: pItem,
                             startSec: ti.start.seconds,
                             inSec: ti.inPoint.seconds,
                             outSec: ti.outPoint.seconds });
            }
        }
    }
    return nests;
}

// Reinsere o conteúdo de UMA sequência-fonte na sequência ativa, alinhado
// à posição do nest. Retorna nº de clipes colocados (ou -1 em falha).
function qcExpandNest(targetSeq, nest) {
    var src = nest.src || qcSequenceFromProjectItem(nest.projectItem);
    if (!src) return -1;

    var nestStart = nest.startSec;   // posição do nest na timeline ativa
    var nestIn = nest.inSec;         // recorte de entrada dentro da fonte
    var nestOut = nest.outSec;       // recorte de saída dentro da fonte

    var placed = 0;

    // VÍDEO (o áudio do clipe vem junto via overwriteClip).
    for (var vt = 0; vt < src.videoTracks.numTracks; vt++) {
        var sTrack = src.videoTracks[vt];
        var dTrack = targetSeq.videoTracks[nest.vTrack + vt];
        if (!dTrack) continue;
        for (var i = 0; i < sTrack.clips.numItems; i++) {
            var ci = sTrack.clips[i];
            var cs = ci.start.seconds, ce = ci.end.seconds;
            // ignora o que está fora da janela recortada do nest
            if (ce <= nestIn || cs >= nestOut) continue;
            var clipIn = ci.inPoint.seconds;
            var clipOut = ci.outPoint.seconds;
            // recorta o clipe à janela do nest
            if (cs < nestIn) { clipIn += (nestIn - cs); cs = nestIn; }
            if (ce > nestOut) { clipOut -= (ce - nestOut); ce = nestOut; }
            var pItem = ci.projectItem;
            try {
                pItem.setInPoint(clipIn, 4);
                pItem.setOutPoint(clipOut, 4);
            } catch (e) {}
            var targetTime = nestStart + (cs - nestIn);
            try { dTrack.overwriteClip(pItem, targetTime); placed++; } catch (e) {}
        }
    }

    // ÁUDIO — colocado explicitamente (o overwriteClip de vídeo não traz o áudio).
    for (var at = 0; at < src.audioTracks.numTracks; at++) {
        var saTrack = src.audioTracks[at];
        var daTrack = targetSeq.audioTracks[at];
        if (!daTrack) continue;
        for (var a = 0; a < saTrack.clips.numItems; a++) {
            var ai = saTrack.clips[a];
            var as = ai.start.seconds, ae = ai.end.seconds;
            if (ae <= nestIn || as >= nestOut) continue;
            var aIn = ai.inPoint.seconds, aOut = ai.outPoint.seconds;
            if (as < nestIn) { aIn += (nestIn - as); as = nestIn; }
            if (ae > nestOut) { aOut -= (ae - nestOut); ae = nestOut; }
            var aItem = ai.projectItem;
            try { aItem.setInPoint(aIn, 4); aItem.setOutPoint(aOut, 4); } catch (e) {}
            var aTime = nestStart + (as - nestIn);
            try { daTrack.overwriteClip(aItem, aTime); placed++; } catch (e) {}
        }
    }

    return placed;
}

// Desaninha TODOS os nests da sequência ativa.
function quarksUnnestActive() {
    try {
        if (!app.project) return "ERROR: Abra um projeto primeiro.";
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR: Nenhuma sequência ativa. Abra a sequência na timeline e tente de novo.";

        // 1) Coleta as informações dos nests ANTES de mexer na timeline.
        var nests = qcCollectNests(seq);
        if (nests.length === 0) return "ERROR: Nenhuma sequência aninhada encontrada na timeline ativa.";

        // Mapeia cada nest à sua sequência-fonte; separa os que não dá pra resolver.
        var resolvable = [], failed = 0, vMax = 0, aMax = 0;
        for (var n = 0; n < nests.length; n++) {
            var src = qcSequenceFromProjectItem(nests[n].projectItem);
            if (!src) { failed++; continue; }
            nests[n].src = src;
            resolvable.push(nests[n]);
            var vn = nests[n].vTrack + src.videoTracks.numTracks;
            if (vn > vMax) vMax = vn;
            if (src.audioTracks.numTracks > aMax) aMax = src.audioTracks.numTracks;
        }
        if (resolvable.length === 0) return "ERROR: Os nests não foram mapeados à sequência-fonte (nomes repetidos ou fonte fora do projeto).";

        // 2) Garante trilhas suficientes para receber o conteúdo.
        qcEnsureTracks(seq, vMax, aMax);

        // 3) Remove os clipes-nest (lift: deixa o buraco no lugar) — assim a expansão
        //    não sobrescreve nests vizinhos ainda não processados.
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var vt2 = seq.videoTracks[t];
            for (var i = vt2.clips.numItems - 1; i >= 0; i--) {
                var ti = vt2.clips[i];
                var pItem = null, isSeq = false;
                try { pItem = ti.projectItem; isSeq = pItem && pItem.isSequence(); } catch (e) {}
                if (isSeq && qcSequenceFromProjectItem(pItem)) {
                    try { ti.remove(false, false); } catch (e) {}
                }
            }
        }
        // ...e a parte de áudio dos mesmos nests (a remoção do vídeo não tira o áudio linkado).
        for (var ta = 0; ta < seq.audioTracks.numTracks; ta++) {
            var at2 = seq.audioTracks[ta];
            for (var ia = at2.clips.numItems - 1; ia >= 0; ia--) {
                var tia = at2.clips[ia];
                var pa = null, isSeqA = false;
                try { pa = tia.projectItem; isSeqA = pa && pa.isSequence(); } catch (e) {}
                if (isSeqA && qcSequenceFromProjectItem(pa)) {
                    try { tia.remove(false, false); } catch (e) {}
                }
            }
        }

        // 4) Expande cada nest no espaço já liberado.
        var totalPlaced = 0, expanded = 0;
        for (var k = 0; k < resolvable.length; k++) {
            var got = qcExpandNest(seq, resolvable[k]);
            if (got < 0) { failed++; } else { expanded++; totalPlaced += got; }
        }

        var msg = "SUCCESS: ✓ " + expanded + " nest(s) desaninhado(s), " + totalPlaced + " clipe(s) recolocado(s).";
        if (failed > 0) msg += " (" + failed + " não mapeado(s) à sequência-fonte)";
        return msg;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}
