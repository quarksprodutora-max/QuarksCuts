var AutoJCut = AutoJCut || {};

AutoJCut.TICKS_PER_SECOND = 254016000000;
AutoJCut.EPS_SECONDS = 0.02;
AutoJCut.FRAME_SLACK_SECONDS = 0.05;

AutoJCut._escapeString = function (value) {
  return String(value).replace(/[\\\"\n\r\t]/g, function (ch) {
    if (ch === "\\") {
      return "\\\\";
    }
    if (ch === "\"") {
      return "\\\"";
    }
    if (ch === "\n") {
      return "\\n";
    }
    if (ch === "\r") {
      return "\\r";
    }
    return "\\t";
  });
};

AutoJCut._stringify = function (value) {
  if (typeof JSON !== "undefined" && JSON.stringify) {
    try {
      return JSON.stringify(value);
    } catch (eJson) {}
  }
  if (value === null || value === undefined) {
    return "null";
  }
  var type = typeof value;
  if (type === "number") {
    return isFinite(value) ? String(value) : "null";
  }
  if (type === "boolean") {
    return value ? "true" : "false";
  }
  if (type === "string") {
    return "\"" + AutoJCut._escapeString(value) + "\"";
  }
  var i;
  var pieces;
  var key;
  if (value instanceof Array) {
    pieces = [];
    for (i = 0; i < value.length; i += 1) {
      pieces.push(AutoJCut._stringify(value[i]));
    }
    return "[" + pieces.join(",") + "]";
  }
  pieces = [];
  for (key in value) {
    if (value.hasOwnProperty(key)) {
      pieces.push("\"" + AutoJCut._escapeString(key) + "\":" + AutoJCut._stringify(value[key]));
    }
  }
  return "{" + pieces.join(",") + "}";
};

AutoJCut._ok = function (data) {
  return AutoJCut._stringify({ ok: true, data: data || null });
};

AutoJCut._err = function (message) {
  return AutoJCut._stringify({ ok: false, error: String(message) });
};

AutoJCut._parse = function (jsonStr) {
  if (!jsonStr || jsonStr === "undefined" || jsonStr === "null") {
    return {};
  }
  if (typeof jsonStr === "object") {
    return jsonStr;
  }
  if (typeof JSON !== "undefined" && JSON.parse) {
    return JSON.parse(String(jsonStr));
  }
  return eval("(" + jsonStr + ")");
};

AutoJCut._wrap = function (fn) {
  try {
    return fn();
  } catch (e) {
    return AutoJCut._err((e && e.toString) ? e.toString() : e);
  }
};

AutoJCut._hasFn = function (obj, name) {
  if (!obj) {
    return false;
  }
  try {
    if (typeof obj[name] === "function") {
      return true;
    }
  } catch (e1) {}
  try {
    if (obj.reflect && obj.reflect.methods) {
      var methods = obj.reflect.methods;
      var i;
      for (i = 0; i < methods.length; i += 1) {
        if (String(methods[i].name) === name) {
          return true;
        }
      }
    }
  } catch (e2) {}
  return false;
};

AutoJCut._enableQE = function () {
  if (typeof app.enableQE === "function") {
    app.enableQE();
  }
  if (typeof qe === "undefined" || !qe) {
    throw new Error("QE DOM indisponível nesta versão do Premiere.");
  }
  return qe;
};

AutoJCut._activeSequence = function () {
  var seq = app.project && app.project.activeSequence;
  if (!seq) {
    throw new Error("Nenhuma sequência ativa. Abra uma sequência no Premiere.");
  }
  return seq;
};

AutoJCut._secondsFromTime = function (value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value.seconds === "number") {
    return value.seconds;
  }
  if (typeof value.secs === "number") {
    return value.secs;
  }
  if (value.ticks !== undefined) {
    return Number(value.ticks) / AutoJCut.TICKS_PER_SECOND;
  }
  return Number(value) || 0;
};

AutoJCut._ticksFromSeconds = function (seconds) {
  return String(Math.round(Number(seconds) * AutoJCut.TICKS_PER_SECOND));
};

AutoJCut._collectionCount = function (col, keys) {
  if (!col) {
    return 0;
  }
  var k;
  for (k = 0; k < keys.length; k += 1) {
    try {
      if (typeof col[keys[k]] === "number") {
        return col[keys[k]];
      }
    } catch (e) {}
  }
  var count = 0;
  try {
    while (col[count]) {
      count += 1;
      if (count > 256) {
        break;
      }
    }
  } catch (e2) {}
  return count;
};

AutoJCut._itemAt = function (col, index) {
  try {
    if (col && col[index]) {
      return col[index];
    }
  } catch (e1) {}
  try {
    if (col && typeof col.getItemAt === "function") {
      return col.getItemAt(index);
    }
  } catch (e2) {}
  return null;
};

AutoJCut._forEachTrack = function (seq, fn) {
  var i;
  var videoCount = AutoJCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  var audioCount = AutoJCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  for (i = 0; i < videoCount; i += 1) {
    var videoTrack = AutoJCut._itemAt(seq.videoTracks, i);
    if (videoTrack) {
      fn(videoTrack, "video", i);
    }
  }
  for (i = 0; i < audioCount; i += 1) {
    var audioTrack = AutoJCut._itemAt(seq.audioTracks, i);
    if (audioTrack) {
      fn(audioTrack, "audio", i);
    }
  }
};

AutoJCut._trackClipCount = function (track) {
  try {
    if (track && track.clips) {
      return AutoJCut._collectionCount(track.clips, ["numItems", "numTracks", "length"]);
    }
  } catch (e) {}
  try {
    if (typeof track.numItems === "number") {
      return track.numItems;
    }
  } catch (e2) {}
  return 0;
};

AutoJCut._audioTracksInfo = function (seq) {
  var tracks = [];
  var i;
  var n = AutoJCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  for (i = 0; i < n; i += 1) {
    var track = AutoJCut._itemAt(seq.audioTracks, i);
    var name = "A" + (i + 1);
    try {
      if (track && track.name) {
        name = String(track.name);
      }
    } catch (eName) {}
    tracks.push({
      index: i,
      name: name,
      clipCount: AutoJCut._trackClipCount(track)
    });
  }
  return tracks;
};

AutoJCut._sequenceCount = function () {
  return AutoJCut._collectionCount(app.project.sequences, ["numSequences", "numItems", "length"]);
};

AutoJCut._listSequences = function () {
  var list = [];
  var n = AutoJCut._sequenceCount();
  var active = null;
  try {
    active = app.project.activeSequence;
  } catch (e) {}
  var activeId = active ? String(active.sequenceID) : "";
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoJCut._itemAt(app.project.sequences, i);
    if (!seq) {
      continue;
    }
    var id = "";
    var name = "Sequência";
    try {
      id = String(seq.sequenceID);
      name = String(seq.name);
    } catch (eInfo) {
      continue;
    }
    var already = false;
    var j;
    for (j = 0; j < list.length; j += 1) {
      if (list[j].id === id) {
        already = true;
        break;
      }
    }
    if (already) {
      continue;
    }
    list.push({
      id: id,
      name: name,
      isActive: id === activeId
    });
  }
  return list;
};

AutoJCut._findSequenceById = function (sequenceID) {
  var target = String(sequenceID);
  var n = AutoJCut._sequenceCount();
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoJCut._itemAt(app.project.sequences, i);
    try {
      if (seq && String(seq.sequenceID) === target) {
        return seq;
      }
    } catch (e) {}
  }
  return null;
};

AutoJCut._activateSequence = function (seq) {
  if (!seq) {
    return;
  }
  try {
    if (AutoJCut._hasFn(app.project, "openSequence")) {
      app.project.openSequence(seq.sequenceID);
    }
  } catch (e1) {}
  try {
    app.project.activeSequence = seq;
  } catch (e2) {}
};

AutoJCut.BACKUP_SUFFIX = " - backup";

AutoJCut._walkProjectItems = function (root, fn) {
  if (!root) {
    return;
  }
  fn(root);
  if (root.children && root.children.numItems) {
    var i;
    for (i = 0; i < root.children.numItems; i += 1) {
      AutoJCut._walkProjectItems(root.children[i], fn);
    }
  }
};

AutoJCut._projectItemForSequence = function (seq) {
  var found = null;
  if (!seq || !app.project || !app.project.rootItem) {
    return null;
  }
  AutoJCut._walkProjectItems(app.project.rootItem, function (item) {
    if (found || !item) {
      return;
    }
    try {
      if (item.isSequence && item.isSequence()) {
        var linked = item.getSequence ? item.getSequence() : null;
        if (linked && String(linked.sequenceID) === String(seq.sequenceID)) {
          found = item;
        }
      }
    } catch (e) {}
  });
  return found;
};

AutoJCut._renameSequence = function (seq, name) {
  if (!seq) {
    return;
  }
  try {
    seq.name = name;
  } catch (e1) {}
  var item = AutoJCut._projectItemForSequence(seq);
  if (item) {
    try {
      item.name = name;
    } catch (e2) {}
  }
};

AutoJCut._sequenceIdsSnapshot = function () {
  var ids = {};
  var n = AutoJCut._sequenceCount();
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoJCut._itemAt(app.project.sequences, i);
    try {
      if (seq) {
        ids[String(seq.sequenceID)] = true;
      }
    } catch (e) {}
  }
  return ids;
};

AutoJCut._findNewSequence = function (idsBefore, originalId) {
  var n = AutoJCut._sequenceCount();
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoJCut._itemAt(app.project.sequences, i);
    try {
      if (seq && String(seq.sequenceID) !== String(originalId) && !idsBefore[String(seq.sequenceID)]) {
        return seq;
      }
    } catch (e) {}
  }
  return null;
};

AutoJCut._findSequenceByName = function (name) {
  var want = String(name);
  var n = AutoJCut._sequenceCount();
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoJCut._itemAt(app.project.sequences, i);
    try {
      if (seq && String(seq.name) === want) {
        return seq;
      }
    } catch (e) {}
  }
  return null;
};

AutoJCut._duplicateViaClone = function (seq, backupName) {
  if (!AutoJCut._hasFn(seq, "clone")) {
    return null;
  }
  var originalId = seq.sequenceID;
  var idsBefore = AutoJCut._sequenceIdsSnapshot();
  seq.clone();
  var cloneSeq = AutoJCut._findNewSequence(idsBefore, originalId);
  if (!cloneSeq) {
    return null;
  }
  AutoJCut._renameSequence(cloneSeq, backupName);
  AutoJCut._activateSequence(AutoJCut._findSequenceById(originalId) || seq);
  return AutoJCut._findSequenceById(cloneSeq.sequenceID) || cloneSeq;
};

AutoJCut._duplicateViaMenu = function (seq, backupName) {
  if (!AutoJCut._hasFn(app, "findMenuCommandId") || !AutoJCut._hasFn(app, "executeCommand")) {
    return null;
  }
  var commandId = app.findMenuCommandId("Duplicate");
  if (!commandId) {
    commandId = app.findMenuCommandId("Duplicar");
  }
  if (!commandId) {
    return null;
  }
  var originalId = seq.sequenceID;
  var idsBefore = AutoJCut._sequenceIdsSnapshot();
  var item = AutoJCut._projectItemForSequence(seq);
  if (item && AutoJCut._hasFn(item, "setSelected")) {
    try {
      item.setSelected(true, true);
    } catch (eSel) {}
  }
  app.executeCommand(commandId);
  var cloneSeq = AutoJCut._findNewSequence(idsBefore, originalId);
  if (!cloneSeq) {
    return null;
  }
  AutoJCut._renameSequence(cloneSeq, backupName);
  AutoJCut._activateSequence(AutoJCut._findSequenceById(originalId) || seq);
  return cloneSeq;
};

AutoJCut._duplicateViaQE = function (seq, backupName) {
  AutoJCut._enableQE();
  var qeProject = qe.project;
  var qeSeq = qe.project.getActiveSequence();
  var originalId = seq.sequenceID;
  var idsBefore = AutoJCut._sequenceIdsSnapshot();
  var invoked = false;
  var names = ["clone", "duplicate", "duplicateSequence", "copySequence"];
  var i;
  for (i = 0; i < names.length; i += 1) {
    if (qeSeq && AutoJCut._hasFn(qeSeq, names[i])) {
      try {
        qeSeq[names[i]]();
        invoked = true;
        break;
      } catch (e1) {}
    }
    if (qeProject && AutoJCut._hasFn(qeProject, names[i])) {
      try {
        qeProject[names[i]]();
        invoked = true;
        break;
      } catch (e2) {}
    }
  }
  if (!invoked) {
    return null;
  }
  var cloneSeq = AutoJCut._findNewSequence(idsBefore, originalId);
  if (cloneSeq) {
    AutoJCut._renameSequence(cloneSeq, backupName);
    AutoJCut._activateSequence(AutoJCut._findSequenceById(originalId) || seq);
  }
  return cloneSeq;
};

AutoJCut._deleteSequence = function (seq) {
  if (!seq) {
    return;
  }
  try {
    if (AutoJCut._hasFn(app.project, "deleteSequence")) {
      app.project.deleteSequence(seq);
      return;
    }
  } catch (e1) {}
  var item = AutoJCut._projectItemForSequence(seq);
  if (item && AutoJCut._hasFn(item, "remove")) {
    item.remove(false, true);
    return;
  }
  throw new Error("Não foi possível apagar a sequência em edição.");
};

AutoJCut.duplicateActiveSequence = function () {
  return AutoJCut._wrap(function () {
    var seq = AutoJCut._activeSequence();
    var originalName = String(seq.name);
    var originalId = String(seq.sequenceID);
    var backupName = originalName + AutoJCut.BACKUP_SUFFIX;
    var cloneSeq = AutoJCut._duplicateViaClone(seq, backupName);
    if (!cloneSeq) {
      cloneSeq = AutoJCut._duplicateViaQE(seq, backupName);
    }
    if (!cloneSeq) {
      cloneSeq = AutoJCut._duplicateViaMenu(seq, backupName);
    }
    if (!cloneSeq) {
      throw new Error("Não foi possível duplicar a sequência para backup. J-Cuts abortados.");
    }
    AutoJCut._activateSequence(AutoJCut._findSequenceById(originalId) || seq);
    var confirmed = AutoJCut._findSequenceById(cloneSeq.sequenceID) || cloneSeq;
    return AutoJCut._ok({
      originalName: originalName,
      originalSequenceId: originalId,
      backupName: confirmed.name,
      backupSequenceId: String(confirmed.sequenceID)
    });
  });
};

AutoJCut.restoreBackup = function (jsonStr) {
  return AutoJCut._wrap(function () {
    var args = AutoJCut._parse(jsonStr);
    var missing = "Sequência backup não encontrada. Use CTRL+Z para desfazer ou restaure o projeto para uma versão anterior";
    var backup = args.backupSequenceId ? AutoJCut._findSequenceById(args.backupSequenceId) : null;
    var originalName = args.originalName ? String(args.originalName) : "";
    if (!backup && originalName) {
      backup = AutoJCut._findSequenceByName(originalName + AutoJCut.BACKUP_SUFFIX);
    }
    if (!backup && args.backupName) {
      backup = AutoJCut._findSequenceByName(args.backupName);
    }
    if (!backup) {
      throw new Error(missing);
    }
    if (!originalName) {
      originalName = String(backup.name).replace(/ - backup$/i, "");
    }
    var working = args.workingSequenceId ? AutoJCut._findSequenceById(args.workingSequenceId) : AutoJCut._activeSequence();
    AutoJCut._activateSequence(backup);
    if (working && String(working.sequenceID) !== String(backup.sequenceID)) {
      AutoJCut._deleteSequence(working);
    }
    AutoJCut._renameSequence(backup, originalName);
    var restored = AutoJCut._findSequenceById(backup.sequenceID) || backup;
    AutoJCut._activateSequence(restored);
    return AutoJCut._ok({
      restoredName: restored.name,
      restoredSequenceId: String(restored.sequenceID)
    });
  });
};

AutoJCut._sequenceDurationSeconds = function (seq) {
  try {
    var endTicks = Number(seq.end);
    var zero = Number(seq.zeroPoint) || 0;
    if (endTicks) {
      return (endTicks - zero) / AutoJCut.TICKS_PER_SECOND;
    }
  } catch (e) {}
  var maxEnd = 0;
  AutoJCut._forEachTrack(seq, function (track) {
    var clips = track.clips;
    var i;
    var n = AutoJCut._collectionCount(clips, ["numItems", "length"]);
    for (i = 0; i < n; i += 1) {
      var end = AutoJCut._secondsFromTime(AutoJCut._itemAt(clips, i).end);
      if (end > maxEnd) {
        maxEnd = end;
      }
    }
  });
  return maxEnd;
};

AutoJCut._itemStartSeconds = function (item) {
  try {
    if (item.start && typeof item.start.secs === "number") {
      return Number(item.start.secs);
    }
  } catch (e) {}
  return AutoJCut._secondsFromTime(item.start);
};

AutoJCut._itemEndSeconds = function (item) {
  try {
    if (item.end && typeof item.end.secs === "number") {
      return Number(item.end.secs);
    }
  } catch (e2) {}
  return AutoJCut._secondsFromTime(item.end);
};

AutoJCut._isGapItem = function (item) {
  if (!item) {
    return false;
  }
  try {
    if (item.isGap && item.isGap()) {
      return true;
    }
  } catch (eGap) {}
  var type = "";
  try {
    type = String(item.type || "").toLowerCase();
  } catch (eType) {}
  if (type === "clip" || type === "video" || type === "audio") {
    return false;
  }
  if (type.indexOf("transition") !== -1) {
    return false;
  }
  if (type === "empty" || type === "gap") {
    return true;
  }
  try {
    if (item.projectItem) {
      return false;
    }
  } catch (eProj) {}
  try {
    if (item.getProjectItem && item.getProjectItem()) {
      return false;
    }
  } catch (eGet) {}
  return true;
};

AutoJCut._rippleDeleteGap = function (item) {
  try {
    item.rippleDelete();
    return true;
  } catch (e1) {}
  try {
    item.remove(true, true);
    return true;
  } catch (e2) {}
  try {
    item.remove(1, 1);
    return true;
  } catch (e3) {}
  try {
    item.remove();
    return true;
  } catch (e4) {}
  return false;
};

AutoJCut._trackFilterAllows = function (trackFilter, kind, index) {
  if (!trackFilter) {
    return true;
  }
  var list = kind === "video" ? trackFilter.video : trackFilter.audio;
  if (!list || !list.length) {
    return false;
  }
  var i;
  for (i = 0; i < list.length; i += 1) {
    if (Number(list[i]) === Number(index)) {
      return true;
    }
  }
  return false;
};

AutoJCut._deleteGapItems = function (seq, intervals, trackFilter) {
  AutoJCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    throw new Error("Não foi possível ler as lacunas da Timeline (QE).");
  }

  var slack = AutoJCut.FRAME_SLACK_SECONDS;
  function overlapsSilence(start, end) {
    var i;
    for (i = 0; i < intervals.length; i += 1) {
      var s = Number(intervals[i][0]) / 1000 - slack;
      var e = Number(intervals[i][1]) / 1000 + slack;
      if (start < e && end > s) {
        return true;
      }
    }
    return false;
  }

  function gapDurationOk(start, end) {
    var i;
    var gapDur = end - start;
    for (i = 0; i < intervals.length; i += 1) {
      var s = Number(intervals[i][0]) / 1000;
      var e = Number(intervals[i][1]) / 1000;
      var want = e - s;
      if (start < e + slack && end > s - slack) {
        if (gapDur > want * 2.5 + slack) {
          return false;
        }
        return true;
      }
    }
    return false;
  }

  function collectGaps() {
    var gaps = [];
    function collectFromTrack(qeTrack) {
      if (!qeTrack || typeof qeTrack.numItems !== "number") {
        return;
      }
      var i;
      for (i = 0; i < qeTrack.numItems; i += 1) {
        var item = qeTrack.getItemAt(i);
        if (!AutoJCut._isGapItem(item)) {
          continue;
        }
        var start = AutoJCut._itemStartSeconds(item);
        var end = AutoJCut._itemEndSeconds(item);
        if (!(end > start)) {
          continue;
        }
        if (!overlapsSilence(start, end)) {
          continue;
        }
        if (!gapDurationOk(start, end)) {
          continue;
        }
        gaps.push({ item: item, start: start });
      }
    }
    var t;
    var videoCount = qeSeq.numVideoTracks || 0;
    var audioCount = qeSeq.numAudioTracks || 0;
    for (t = 0; t < videoCount; t += 1) {
      if (!AutoJCut._trackFilterAllows(trackFilter, "video", t)) {
        continue;
      }
      collectFromTrack(qeSeq.getVideoTrackAt(t));
    }
    for (t = 0; t < audioCount; t += 1) {
      if (!AutoJCut._trackFilterAllows(trackFilter, "audio", t)) {
        continue;
      }
      collectFromTrack(qeSeq.getAudioTrackAt(t));
    }
    AutoJCut._forEachTrack(seq, function (track, kind, index) {
      if (!AutoJCut._trackFilterAllows(trackFilter, kind, index)) {
        return;
      }
      var clips = track.clips;
      var n = AutoJCut._collectionCount(clips, ["numItems", "length"]);
      var c;
      for (c = 0; c < n; c += 1) {
        var clip = AutoJCut._itemAt(clips, c);
        if (!AutoJCut._isGapItem(clip)) {
          continue;
        }
        var start = AutoJCut._itemStartSeconds(clip);
        var end = AutoJCut._itemEndSeconds(clip);
        if (!overlapsSilence(start, end) || !gapDurationOk(start, end)) {
          continue;
        }
        gaps.push({ item: clip, start: start });
      }
    });
    gaps.sort(function (a, b) {
      return b.start - a.start;
    });
    return gaps;
  }

  var closed = 0;
  var pass;
  for (pass = 0; pass < 12; pass += 1) {
    var gaps = collectGaps();
    if (!gaps.length) {
      break;
    }
    var passClosed = 0;
    var g;
    for (g = 0; g < gaps.length; g += 1) {
      if (AutoJCut._rippleDeleteGap(gaps[g].item)) {
        passClosed += 1;
      }
    }
    closed += passClosed;
    if (!passClosed) {
      break;
    }
  }
  return {
    closedCount: closed,
    closeMethod: "rippleDelete das lacunas"
  };
};

AutoJCut._setClipStart = function (clip, seconds) {
  if (seconds < 0) {
    seconds = 0;
  }
  try {
    clip.start = AutoJCut._ticksFromSeconds(seconds);
    return;
  } catch (eTicks) {}
  try {
    var t = new Time();
    t.seconds = seconds;
    clip.start = t;
    return;
  } catch (eTime) {}
  if (AutoJCut._hasFn(clip, "move")) {
    var current = AutoJCut._secondsFromTime(clip.start);
    clip.move(seconds - current);
  }
};

AutoJCut._listDomClips = function (track) {
  var list = [];
  if (!track) {
    return list;
  }
  var n = AutoJCut._collectionCount(track.clips, ["numItems", "length"]);
  var i;
  for (i = 0; i < n; i += 1) {
    var clip = AutoJCut._itemAt(track.clips, i);
    if (!clip || AutoJCut._isGapItem(clip)) {
      continue;
    }
    list.push(clip);
  }
  list.sort(function (a, b) {
    return AutoJCut._itemStartSeconds(a) - AutoJCut._itemStartSeconds(b);
  });
  return list;
};

AutoJCut._frameSeconds = function (seq) {
  try {
    var settings = seq.getSettings();
    if (settings && settings.videoFrameRate) {
      var secs = AutoJCut._secondsFromTime(settings.videoFrameRate);
      if (secs > 0 && secs < 1) {
        return secs;
      }
    }
  } catch (e) {}
  return 1 / 30;
};

AutoJCut._clipInPointSeconds = function (clip) {
  try {
    return AutoJCut._secondsFromTime(clip.inPoint);
  } catch (e) {}
  return 0;
};

AutoJCut._nearestClipByInPoint = function (clips, inPoint) {
  var best = null;
  var bestDelta = 9999;
  var i;
  for (i = 0; i < clips.length; i += 1) {
    var delta = Math.abs(AutoJCut._clipInPointSeconds(clips[i]) - inPoint);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = clips[i];
    }
  }
  if (best && bestDelta <= AutoJCut.FRAME_SLACK_SECONDS * 4) {
    return best;
  }
  return null;
};

AutoJCut._findClipByIdentity = function (clips, inPoint, name, startSec) {
  var candidates = [];
  var i;
  for (i = 0; i < clips.length; i += 1) {
    if (Math.abs(AutoJCut._clipInPointSeconds(clips[i]) - inPoint) <= AutoJCut.FRAME_SLACK_SECONDS * 4) {
      candidates.push(clips[i]);
    }
  }
  if (name) {
    var named = [];
    for (i = 0; i < candidates.length; i += 1) {
      try {
        if (String(candidates[i].name) === String(name)) {
          named.push(candidates[i]);
        }
      } catch (eName) {}
    }
    if (named.length) {
      candidates = named;
    }
  }
  if (!candidates.length) {
    return AutoJCut._nearestClipByInPoint(clips, inPoint);
  }
  if (startSec === undefined || startSec === null) {
    return candidates[0];
  }
  var best = candidates[0];
  var bestDelta = Math.abs(AutoJCut._itemStartSeconds(best) - startSec);
  for (i = 1; i < candidates.length; i += 1) {
    var delta = Math.abs(AutoJCut._itemStartSeconds(candidates[i]) - startSec);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidates[i];
    }
  }
  return best;
};

AutoJCut._syncIdentityTimes = function (identity, video, audio) {
  if (video) {
    identity.videoStart = AutoJCut._itemStartSeconds(video);
  }
  if (audio) {
    identity.audioStart = AutoJCut._itemStartSeconds(audio);
  }
};

AutoJCut._refreshIdentityStarts = function (seq, identities) {
  var i;
  for (i = 0; i < identities.length; i += 1) {
    var video = AutoJCut._videoForIdentity(seq, identities[i]);
    var audioInfo = AutoJCut._audioForIdentity(seq, identities[i]);
    AutoJCut._syncIdentityTimes(identities[i], video, audioInfo ? audioInfo.clip : null);
  }
};

AutoJCut._videoForIdentity = function (seq, identity) {
  var startSec = identity.videoStart;
  var v1 = AutoJCut._findClipByIdentity(
    AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", 0)),
    identity.inPoint,
    identity.videoName,
    startSec
  );
  var v2Track = AutoJCut._trackAt(seq, "video", 1);
  var v2 = null;
  if (v2Track) {
    v2 = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(v2Track),
      identity.inPoint,
      identity.videoName,
      startSec
    );
  }
  if (v1 && v2 && startSec !== undefined && startSec !== null) {
    if (Math.abs(AutoJCut._itemStartSeconds(v2) - startSec) < Math.abs(AutoJCut._itemStartSeconds(v1) - startSec)) {
      return v2;
    }
    return v1;
  }
  return v1 || v2;
};

AutoJCut._audioForIdentity = function (seq, identity) {
  var inPoint = identity.audioInPoint !== undefined ? identity.audioInPoint : identity.inPoint;
  var startSec = identity.audioStart !== undefined ? identity.audioStart : identity.videoStart;
  var best = null;
  var bestTrack = 0;
  var bestDelta = 9999;
  var t;
  for (t = 0; t < 2; t += 1) {
    var track = AutoJCut._trackAt(seq, "audio", t);
    if (!track) {
      continue;
    }
    var clip = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(track),
      inPoint,
      identity.audioName,
      startSec
    );
    if (!clip) {
      continue;
    }
    var delta = startSec === undefined || startSec === null ? t : Math.abs(AutoJCut._itemStartSeconds(clip) - startSec);
    if (!best || delta < bestDelta) {
      best = clip;
      bestTrack = t;
      bestDelta = delta;
    }
  }
  if (!best) {
    return null;
  }
  return { clip: best, trackIndex: bestTrack };
};

AutoJCut._findCommand = function (names) {
  if (!AutoJCut._hasFn(app, "findMenuCommandId")) {
    return 0;
  }
  var i;
  for (i = 0; i < names.length; i += 1) {
    try {
      var id = app.findMenuCommandId(names[i]);
      if (id) {
        return id;
      }
    } catch (e) {}
  }
  return 0;
};

AutoJCut._runCommand = function (names) {
  var id = AutoJCut._findCommand(names);
  if (id) {
    try {
      app.executeCommand(id);
      return true;
    } catch (e1) {}
  }
  try {
    AutoJCut._enableQE();
    var i;
    for (i = 0; i < names.length; i += 1) {
      try {
        qe.executeCommand(names[i]);
        return true;
      } catch (e2) {}
    }
  } catch (eQe) {}
  return false;
};

AutoJCut._clearSelection = function (seq) {
  AutoJCut._forEachTrack(seq, function (track) {
    var clips = AutoJCut._listDomClips(track);
    var i;
    for (i = 0; i < clips.length; i += 1) {
      try {
        clips[i].setSelected(false, true);
      } catch (e) {}
    }
  });
};

AutoJCut._selectClips = function (clips) {
  var i;
  for (i = 0; i < clips.length; i += 1) {
    try {
      clips[i].setSelected(true, i === 0);
    } catch (e1) {
      try {
        clips[i].setSelected(true, false);
      } catch (e2) {}
    }
  }
};

AutoJCut._unlinkClips = function (seq, clips) {
  AutoJCut._activateSequence(seq);
  AutoJCut._clearSelection(seq);
  AutoJCut._selectClips(clips);
  AutoJCut._runCommand(["Unlink", "&Unlink", "Desvincular", "&Desvincular", "Unlink Clips"]);
};

AutoJCut._linkClips = function (seq, clips) {
  AutoJCut._activateSequence(seq);
  AutoJCut._clearSelection(seq);
  AutoJCut._selectClips(clips);
  return AutoJCut._runCommand(["Link", "&Link", "Vincular", "&Vincular", "Link Clips", "Link Clip"]);
};

AutoJCut._unlinkOriginalPairs = function (seq, identities) {
  var i;
  for (i = 0; i < identities.length; i += 1) {
    var video = AutoJCut._videoForIdentity(seq, identities[i]);
    var audioInfo = AutoJCut._audioForIdentity(seq, identities[i]);
    if (video && audioInfo) {
      AutoJCut._unlinkClips(seq, [video, audioInfo.clip]);
    }
  }
  AutoJCut._clearSelection(seq);
};

AutoJCut._relinkOriginalPairs = function (seq, identities) {
  var i;
  for (i = 0; i < identities.length; i += 1) {
    var video = AutoJCut._videoForIdentity(seq, identities[i]);
    var audioInfo = AutoJCut._audioForIdentity(seq, identities[i]);
    if (!video || !audioInfo) {
      continue;
    }
    AutoJCut._linkClips(seq, [video, audioInfo.clip]);
  }
  AutoJCut._clearSelection(seq);
};

AutoJCut._trackAt = function (seq, kind, index) {
  if (kind === "video") {
    return AutoJCut._itemAt(seq.videoTracks, index);
  }
  return AutoJCut._itemAt(seq.audioTracks, index);
};

AutoJCut._addAudioTracks = function (seq, count) {
  if (count <= 0) {
    return;
  }
  AutoJCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    throw new Error("Não foi possível criar a faixa A2.");
  }
  var before = AutoJCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  try {
    qeSeq.addTracks(0, 0, count, before);
  } catch (e1) {
    var i;
    for (i = 0; i < count; i += 1) {
      qeSeq.addTracks(0, 0, 1, AutoJCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]));
    }
  }
};

AutoJCut._addVideoTracks = function (seq, count) {
  if (count <= 0) {
    return;
  }
  AutoJCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    throw new Error("Não foi possível criar a faixa V2.");
  }
  var before = AutoJCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  try {
    qeSeq.addTracks(count, before, 0, 0);
  } catch (e1) {
    var i;
    for (i = 0; i < count; i += 1) {
      try {
        qeSeq.addTracks(1, AutoJCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]), 0, 0);
      } catch (e2) {
        qeSeq.addTracks(1, 0, 0, 0);
      }
    }
  }
};

AutoJCut._ensureVideoTrackCount = function (seq, minCount) {
  var have = AutoJCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  if (have < minCount) {
    AutoJCut._addVideoTracks(seq, minCount - have);
  }
  have = AutoJCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  if (have < minCount) {
    throw new Error("Não foi possível criar a faixa V2 para isolar o vídeo dos segmentos pares.");
  }
};

AutoJCut._ensureAudioTrackCount = function (seq, minCount) {
  var have = AutoJCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  if (have < minCount) {
    AutoJCut._addAudioTracks(seq, minCount - have);
  }
  have = AutoJCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  if (have < minCount) {
    throw new Error("Não foi possível criar a faixa A2 para isolar o áudio dos segmentos pares.");
  }
};

AutoJCut._assignTime = function (clip, field, seconds) {
  if (!clip) {
    return false;
  }
  var t = new Time();
  t.seconds = Number(seconds);
  try {
    clip[field] = t;
    return true;
  } catch (e1) {}
  try {
    clip[field] = AutoJCut._ticksFromSeconds(seconds);
    return true;
  } catch (e2) {}
  try {
    clip[field].seconds = Number(seconds);
    return true;
  } catch (e3) {}
  try {
    clip[field].ticks = AutoJCut._ticksFromSeconds(seconds);
    return true;
  } catch (e4) {}
  return false;
};

AutoJCut._qeItemOnTrack = function (kind, trackIndex, startSec) {
  AutoJCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    return null;
  }
  var track = kind === "video" ? qeSeq.getVideoTrackAt(trackIndex) : qeSeq.getAudioTrackAt(trackIndex);
  if (!track || typeof track.numItems !== "number") {
    return null;
  }
  var wantType = kind === "video" ? "video" : "audio";
  var best = null;
  var bestDelta = 9999;
  var i;
  for (i = 0; i < track.numItems; i += 1) {
    var item = track.getItemAt(i);
    if (!item) {
      continue;
    }
    try {
      if (item.isGap && item.isGap()) {
        continue;
      }
    } catch (eGap) {}
    try {
      var itemType = String(item.type || "").toLowerCase();
      if (itemType === "empty" || itemType === "gap") {
        continue;
      }
    } catch (eType) {}
    try {
      var mediaType = String(item.mediaType || "").toLowerCase();
      if (mediaType && mediaType.indexOf(wantType) === -1) {
        continue;
      }
    } catch (eMedia) {}
    var delta = Math.abs(AutoJCut._itemStartSeconds(item) - startSec);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = item;
    }
  }
  if (best && bestDelta <= AutoJCut.FRAME_SLACK_SECONDS * 8) {
    return best;
  }
  return null;
};

AutoJCut._moveQeClipTracks = function (qeClip, videoDelta, audioDelta) {
  if (!qeClip) {
    return false;
  }
  var timeCodes = ["", "0", "00:00:00:00", "00;00;00;00"];
  var t;
  for (t = 0; t < timeCodes.length; t += 1) {
    try {
      qeClip.moveToTrack(videoDelta, audioDelta, timeCodes[t], false);
      return true;
    } catch (e1) {}
    try {
      qeClip.moveToTrack(videoDelta, audioDelta, timeCodes[t], 0);
      return true;
    } catch (e2) {}
  }
  return false;
};

AutoJCut._moveQeClipOneAudioTrack = function (qeClip, audioDelta) {
  return AutoJCut._moveQeClipTracks(qeClip, 0, audioDelta);
};

AutoJCut._moveAudioClipToTrack = function (seq, clip, fromIndex, toIndex) {
  if (!clip || fromIndex === toIndex) {
    return true;
  }
  var audioDelta = toIndex - fromIndex;
  if (!audioDelta) {
    return true;
  }
  var startSec = AutoJCut._itemStartSeconds(clip);
  var qeClip = AutoJCut._qeItemOnTrack("audio", fromIndex, startSec);
  if (!qeClip) {
    return false;
  }
  if (!AutoJCut._moveQeClipOneAudioTrack(qeClip, audioDelta)) {
    return false;
  }
  return !!AutoJCut._qeItemOnTrack("audio", toIndex, startSec) || !AutoJCut._qeItemOnTrack("audio", fromIndex, startSec);
};

AutoJCut._moveVideoClipToTrack = function (seq, clip, fromIndex, toIndex) {
  if (!clip || fromIndex === toIndex) {
    return true;
  }
  var videoDelta = toIndex - fromIndex;
  if (!videoDelta) {
    return true;
  }
  var startSec = AutoJCut._itemStartSeconds(clip);
  var qeClip = AutoJCut._qeItemOnTrack("video", fromIndex, startSec);
  if (!qeClip) {
    return false;
  }
  if (!AutoJCut._moveQeClipTracks(qeClip, videoDelta, 0)) {
    return false;
  }
  return !!AutoJCut._qeItemOnTrack("video", toIndex, startSec) || !AutoJCut._qeItemOnTrack("video", fromIndex, startSec);
};

AutoJCut._pad2 = function (n) {
  n = Math.abs(Math.round(Number(n)));
  return n < 10 ? "0" + n : String(n);
};

AutoJCut._timecodeForFrameOffset = function (seq, frames) {
  frames = Math.round(Number(frames));
  var seconds = frames * AutoJCut._frameSeconds(seq);
  var t = new Time();
  t.seconds = Math.abs(seconds);
  var formatted = "";
  try {
    var settings = seq.getSettings();
    if (t.getFormatted && settings && settings.videoFrameRate) {
      formatted = String(t.getFormatted(settings.videoFrameRate, seq.videoDisplayFormat));
    }
  } catch (eFmt) {}
  if (!formatted) {
    var fps = Math.round(1 / AutoJCut._frameSeconds(seq));
    if (fps < 1) {
      fps = 30;
    }
    var abs = Math.abs(frames);
    var ff = abs % fps;
    var totalSec = Math.floor(abs / fps);
    var ss = totalSec % 60;
    var mm = Math.floor(totalSec / 60) % 60;
    var hh = Math.floor(totalSec / 3600);
    formatted = AutoJCut._pad2(hh) + ":" + AutoJCut._pad2(mm) + ":" + AutoJCut._pad2(ss) + ":" + AutoJCut._pad2(ff);
  }
  if (frames < 0 && formatted.charAt(0) !== "-") {
    formatted = "-" + formatted;
  }
  return formatted;
};

AutoJCut._moveQeClipByFrames = function (qeClip, seq, frames) {
  if (!qeClip || !frames) {
    return false;
  }
  var tc = AutoJCut._timecodeForFrameOffset(seq, frames);
  try {
    qeClip.moveToTrack(0, 0, tc, false);
    return true;
  } catch (e1) {}
  try {
    qeClip.moveToTrack(0, 0, tc, 0);
    return true;
  } catch (e2) {}
  return false;
};

AutoJCut._moveClipByFramesOnTrack = function (seq, kind, trackIndex, clip, frames) {
  if (!clip || !frames) {
    return true;
  }
  var frameSec = AutoJCut._frameSeconds(seq);
  var before = AutoJCut._itemStartSeconds(clip);
  var expected = before + frames * frameSec;
  if (expected < -AutoJCut.FRAME_SLACK_SECONDS) {
    return false;
  }
  try {
    if (AutoJCut._hasFn(clip, "move")) {
      clip.move(frames * frameSec);
      if (Math.abs(AutoJCut._itemStartSeconds(clip) - expected) <= AutoJCut.FRAME_SLACK_SECONDS) {
        return true;
      }
    }
  } catch (eDom) {}
  var qeClip = AutoJCut._qeItemOnTrack(kind, trackIndex, AutoJCut._itemStartSeconds(clip));
  if (!qeClip) {
    qeClip = AutoJCut._qeItemOnTrack(kind, trackIndex, before);
  }
  if (AutoJCut._moveQeClipByFrames(qeClip, seq, frames)) {
    return Math.abs(AutoJCut._itemStartSeconds(clip) - expected) <= AutoJCut.FRAME_SLACK_SECONDS;
  }
  return false;
};

AutoJCut._v1Gaps = function (seq) {
  var clips = AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", 0));
  var gaps = [];
  var i;
  for (i = 0; i < clips.length - 1; i += 1) {
    var start = AutoJCut._itemEndSeconds(clips[i]);
    var end = AutoJCut._itemStartSeconds(clips[i + 1]);
    if (end - start > 0.001) {
      gaps.push([start, end]);
    }
  }
  if (clips.length) {
    var lastEnd = AutoJCut._itemEndSeconds(clips[clips.length - 1]);
    var seqEnd = AutoJCut._sequenceDurationSeconds(seq);
    if (seqEnd - lastEnd > 0.001) {
      gaps.push([lastEnd, seqEnd]);
    }
  }
  return gaps;
};

AutoJCut._gapsNearDuration = function (gaps, durationSec) {
  var out = [];
  var i;
  var minDur = durationSec * 0.4;
  var maxDur = durationSec * 2.2 + AutoJCut.FRAME_SLACK_SECONDS;
  for (i = 0; i < gaps.length; i += 1) {
    var dur = gaps[i][1] - gaps[i][0];
    if (dur >= minDur && dur <= maxDur) {
      out.push([Math.round(gaps[i][0] * 1000), Math.round(gaps[i][1] * 1000)]);
    }
  }
  return out;
};

AutoJCut._collectSegments = function (seq) {
  var vClips = AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", 0));
  var aClips = AutoJCut._listDomClips(AutoJCut._trackAt(seq, "audio", 0));
  if (!vClips.length) {
    throw new Error("Não há clipes em V1. Coloque os jump cuts sequenciais em V1 + A1.");
  }
  var segments = [];
  var i;
  for (i = 0; i < vClips.length; i += 1) {
    var video = vClips[i];
    var vStart = AutoJCut._itemStartSeconds(video);
    var vEnd = AutoJCut._itemEndSeconds(video);
    var audio = null;
    var a;
    for (a = 0; a < aClips.length; a += 1) {
      if (
        Math.abs(AutoJCut._itemStartSeconds(aClips[a]) - vStart) <= AutoJCut.FRAME_SLACK_SECONDS &&
        Math.abs(AutoJCut._itemEndSeconds(aClips[a]) - vEnd) <= AutoJCut.FRAME_SLACK_SECONDS
      ) {
        audio = aClips[a];
        break;
      }
    }
    if (!audio) {
      throw new Error(
        "O segmento " +
          (i + 1) +
          " em V1 não tem áudio linkado na mesma posição em A1. O plugin precisa de pares vídeo+áudio nativos."
      );
    }
    segments.push({
      index: i + 1,
      even: (i + 1) % 2 === 0,
      inPoint: AutoJCut._clipInPointSeconds(video),
      audioInPoint: AutoJCut._clipInPointSeconds(audio),
      videoName: String(video.name || ""),
      audioName: String(audio.name || ""),
      start: vStart,
      end: vEnd,
      duration: vEnd - vStart
    });
  }
  for (i = 1; i < segments.length; i += 1) {
    if (Math.abs(segments[i].start - segments[i - 1].end) > AutoJCut.FRAME_SLACK_SECONDS) {
      throw new Error(
        "Os segmentos em V1 não estão em jump cuts sequenciais (há um espaço entre o segmento " +
          segments[i - 1].index +
          " e o " +
          segments[i].index +
          ")."
      );
    }
  }
  return segments;
};

AutoJCut._alignEvenAudioToVideo = function (seq, evenIdentities) {
  var frameSec = AutoJCut._frameSeconds(seq);
  var i;
  for (i = 0; i < evenIdentities.length; i += 1) {
    var video = AutoJCut._videoForIdentity(seq, evenIdentities[i]);
    var audioInfo = AutoJCut._audioForIdentity(seq, evenIdentities[i]);
    if (!video || !audioInfo || audioInfo.trackIndex !== 1) {
      continue;
    }
    var deltaSec = AutoJCut._itemStartSeconds(video) - AutoJCut._itemStartSeconds(audioInfo.clip);
    var frames = Math.round(deltaSec / frameSec);
    if (!frames) {
      continue;
    }
    AutoJCut._moveClipByFramesOnTrack(seq, "audio", 1, audioInfo.clip, frames);
  }
};

AutoJCut._moveEvenAudioToA2 = function (seq, evenIdentities) {
  if (!evenIdentities.length) {
    return;
  }
  AutoJCut._ensureAudioTrackCount(seq, 2);
  AutoJCut._activateSequence(seq);
  AutoJCut._enableQE();
  var i;
  for (i = 0; i < evenIdentities.length; i += 1) {
    var identity = evenIdentities[i];
    var audioInfo = AutoJCut._audioForIdentity(seq, identity);
    if (audioInfo && audioInfo.trackIndex === 1) {
      continue;
    }
    if (!audioInfo || audioInfo.trackIndex !== 0) {
      throw new Error("Não foi possível localizar o áudio do segmento par " + identity.index + " em A1.");
    }
    if (!AutoJCut._moveAudioClipToTrack(seq, audioInfo.clip, 0, 1)) {
      throw new Error("Não foi possível descer o áudio do segmento " + identity.index + " de A1 para A2.");
    }
    var moved = AutoJCut._audioForIdentity(seq, identity);
    if (!moved || moved.trackIndex !== 1) {
      throw new Error("O áudio do segmento " + identity.index + " não chegou à A2.");
    }
    AutoJCut._syncIdentityTimes(identity, null, moved.clip);
    if (!AutoJCut._videoForIdentity(seq, identity)) {
      throw new Error("O vídeo do segmento " + identity.index + " saiu da V1 ao descer o áudio. Desfaça (Cmd+Z) e tente de novo.");
    }
  }
};

AutoJCut._moveEvenVideoBetweenTracks = function (seq, evenIdentities, fromIndex, toIndex) {
  if (!evenIdentities.length || fromIndex === toIndex) {
    return;
  }
  AutoJCut._ensureVideoTrackCount(seq, Math.max(fromIndex, toIndex) + 1);
  AutoJCut._activateSequence(seq);
  AutoJCut._enableQE();
  var fromLabel = "V" + (fromIndex + 1);
  var toLabel = "V" + (toIndex + 1);
  var i;
  for (i = 0; i < evenIdentities.length; i += 1) {
    var identity = evenIdentities[i];
    var already = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", toIndex)),
      identity.inPoint,
      identity.videoName,
      identity.videoStart
    );
    if (
      already &&
      identity.videoStart !== undefined &&
      Math.abs(AutoJCut._itemStartSeconds(already) - identity.videoStart) <= AutoJCut.FRAME_SLACK_SECONDS
    ) {
      continue;
    }
    var video = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", fromIndex)),
      identity.inPoint,
      identity.videoName,
      identity.videoStart
    );
    if (!video) {
      throw new Error(
        "Não foi possível localizar o vídeo do segmento par " + identity.index + " em " + fromLabel + "."
      );
    }
    var startSec = AutoJCut._itemStartSeconds(video);
    if (!AutoJCut._moveVideoClipToTrack(seq, video, fromIndex, toIndex)) {
      throw new Error(
        "Não foi possível mover o vídeo do segmento " + identity.index + " de " + fromLabel + " para " + toLabel + "."
      );
    }
    var moved = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", toIndex)),
      identity.inPoint,
      identity.videoName,
      startSec
    );
    if (!moved) {
      throw new Error("O vídeo do segmento " + identity.index + " não chegou à " + toLabel + ".");
    }
    if (Math.abs(AutoJCut._itemStartSeconds(moved) - startSec) > AutoJCut.FRAME_SLACK_SECONDS) {
      throw new Error("O vídeo do segmento " + identity.index + " mudou de posição ao ir para " + toLabel + ".");
    }
    AutoJCut._syncIdentityTimes(identity, moved, null);
  }
};

AutoJCut._moveEvenVideoToV2 = function (seq, evenIdentities) {
  AutoJCut._moveEvenVideoBetweenTracks(seq, evenIdentities, 0, 1);
};

AutoJCut._trimEvenVideoHeads = function (seq, evenIdentities, frames) {
  frames = Math.round(Number(frames));
  if (!evenIdentities.length || !frames) {
    return;
  }
  var trimSec = frames * AutoJCut._frameSeconds(seq);
  AutoJCut._unlinkOriginalPairs(seq, evenIdentities);
  var i;
  for (i = 0; i < evenIdentities.length; i += 1) {
    var identity = evenIdentities[i];
    var video = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(AutoJCut._trackAt(seq, "video", 1)),
      identity.inPoint,
      identity.videoName,
      identity.videoStart
    );
    if (!video) {
      throw new Error("Não foi possível localizar o vídeo do segmento par " + identity.index + " em V2 para o trim.");
    }
    var oldStart = AutoJCut._itemStartSeconds(video);
    var oldEnd = AutoJCut._itemEndSeconds(video);
    var oldIn = AutoJCut._clipInPointSeconds(video);
    var oldOut = AutoJCut._secondsFromTime(video.outPoint);
    var newStart = oldStart + trimSec;
    var newIn = oldIn + trimSec;
    if (newStart >= oldEnd - AutoJCut.FRAME_SLACK_SECONDS) {
      throw new Error("O trim de " + frames + " frames é grande demais para o vídeo do segmento " + identity.index + ".");
    }
    AutoJCut._assignTime(video, "inPoint", newIn);
    AutoJCut._assignTime(video, "start", newStart);
    if (Math.abs(AutoJCut._itemEndSeconds(video) - oldEnd) > AutoJCut.FRAME_SLACK_SECONDS) {
      AutoJCut._assignTime(video, "end", oldEnd);
    }
    if (Math.abs(AutoJCut._secondsFromTime(video.outPoint) - oldOut) > AutoJCut.FRAME_SLACK_SECONDS) {
      AutoJCut._assignTime(video, "outPoint", oldOut);
    }
    if (Math.abs(AutoJCut._itemStartSeconds(video) - newStart) > AutoJCut.FRAME_SLACK_SECONDS) {
      throw new Error("Não foi possível aparar o início do vídeo do segmento " + identity.index + ".");
    }
    identity.inPoint = AutoJCut._clipInPointSeconds(video);
    AutoJCut._syncIdentityTimes(identity, video, null);
  }
};

AutoJCut._moveClipDelta = function (seq, kind, trackIndex, clip, deltaSec) {
  if (!clip || Math.abs(deltaSec) < 0.0001) {
    return true;
  }
  var frames = Math.round(deltaSec / AutoJCut._frameSeconds(seq));
  if (!frames) {
    return true;
  }
  return AutoJCut._moveClipByFramesOnTrack(seq, kind, trackIndex, clip, frames);
};

AutoJCut._moveIdentityByFrames = function (seq, identity, frames, audioTrackIndex) {
  frames = Math.round(Number(frames));
  if (!frames) {
    return;
  }
  var video = AutoJCut._videoForIdentity(seq, identity);
  if (!video) {
    throw new Error("Não foi possível localizar o vídeo do segmento " + identity.index + " após o deslocamento anterior.");
  }
  var vStart = AutoJCut._itemStartSeconds(video);
  var expected = vStart + frames * AutoJCut._frameSeconds(seq);
  if (!AutoJCut._moveClipByFramesOnTrack(seq, "video", 0, video, frames)) {
    throw new Error("Não foi possível deslocar o vídeo do segmento " + identity.index + ".");
  }
  identity.videoStart = expected;
  var audioInfo = AutoJCut._audioForIdentity(seq, identity);
  if (!audioInfo) {
    return;
  }
  var trackIndex = audioTrackIndex !== undefined ? audioTrackIndex : audioInfo.trackIndex;
  var audio = audioInfo.clip;
  if (trackIndex !== audioInfo.trackIndex) {
    audio = AutoJCut._findClipByIdentity(
      AutoJCut._listDomClips(AutoJCut._trackAt(seq, "audio", trackIndex)),
      identity.audioInPoint !== undefined ? identity.audioInPoint : identity.inPoint,
      identity.audioName,
      identity.audioStart
    );
  }
  if (!audio) {
    return;
  }
  if (Math.abs(AutoJCut._itemStartSeconds(audio) - expected) <= AutoJCut.FRAME_SLACK_SECONDS) {
    identity.audioStart = AutoJCut._itemStartSeconds(audio);
    return;
  }
  if (!AutoJCut._moveClipByFramesOnTrack(seq, "audio", trackIndex, audio, frames)) {
    throw new Error("Não foi possível deslocar o áudio do segmento " + identity.index + ".");
  }
  identity.audioStart = AutoJCut._itemStartSeconds(audio);
};

AutoJCut._shiftClipsOnTrackAfter = function (seq, kind, trackIndex, afterSec, amount) {
  var frames = Math.round(amount / AutoJCut._frameSeconds(seq));
  if (!frames) {
    return;
  }
  var clips = AutoJCut._listDomClips(AutoJCut._trackAt(seq, kind, trackIndex));
  var i;
  for (i = clips.length - 1; i >= 0; i -= 1) {
    if (AutoJCut._itemStartSeconds(clips[i]) >= afterSec - AutoJCut.EPS_SECONDS) {
      AutoJCut._moveClipByFramesOnTrack(seq, kind, trackIndex, clips[i], -frames);
    }
  }
};

AutoJCut._shiftIdentitiesAfter = function (seq, identities, afterIndex, frames) {
  frames = Math.round(Number(frames));
  if (!frames) {
    return;
  }
  var i;
  for (i = identities.length - 1; i >= 0; i -= 1) {
    if (identities[i].index <= afterIndex) {
      continue;
    }
    AutoJCut._moveIdentityByFrames(seq, identities[i], frames, identities[i].even ? 1 : 0);
  }
};

AutoJCut._closeCreatedGaps = function (seq, xSeconds, trackFilter, evenIdentities) {
  var intervals = AutoJCut._gapsNearDuration(AutoJCut._v1Gaps(seq), xSeconds);
  if (!intervals.length) {
    AutoJCut._alignEvenAudioToVideo(seq, evenIdentities);
    return { closedCount: 0, closeMethod: "nenhuma lacuna do tamanho X" };
  }
  var result = AutoJCut._deleteGapItems(seq, intervals, trackFilter);
  AutoJCut._alignEvenAudioToVideo(seq, evenIdentities);
  var leftover = AutoJCut._gapsNearDuration(AutoJCut._v1Gaps(seq), xSeconds);
  if (leftover.length) {
    var g;
    for (g = leftover.length - 1; g >= 0; g -= 1) {
      var amount = leftover[g][1] / 1000 - leftover[g][0] / 1000;
      var after = leftover[g][1] / 1000;
      AutoJCut._shiftClipsOnTrackAfter(seq, "video", 0, after, amount);
      if (AutoJCut._trackFilterAllows(trackFilter, "audio", 0)) {
        AutoJCut._shiftClipsOnTrackAfter(seq, "audio", 0, after, amount);
      }
    }
    result.closeMethod += " + deslocamento das faixas";
    AutoJCut._alignEvenAudioToVideo(seq, evenIdentities);
  }
  return result;
};

AutoJCut._contextData = function () {
  if (!app.project) {
    throw new Error("Nenhum projeto aberto no Premiere.");
  }
  var sequences = AutoJCut._listSequences();
  var seq = null;
  try {
    seq = app.project.activeSequence;
  } catch (eActive) {}
  var version = "";
  try {
    version = String(app.version);
  } catch (eVer) {}
  var sequenceId = null;
  var sequenceName = null;
  var durationSeconds = 0;
  var tracks = [];
  if (seq) {
    sequenceId = String(seq.sequenceID);
    sequenceName = String(seq.name);
    tracks = AutoJCut._audioTracksInfo(seq);
    try {
      durationSeconds = AutoJCut._sequenceDurationSeconds(seq);
    } catch (eDur) {}
  }
  return {
    sequenceId: sequenceId,
    sequenceName: sequenceName,
    sequences: sequences,
    durationSeconds: durationSeconds,
    audioTracks: tracks,
    appVersion: version,
    hasActiveSequence: !!seq
  };
};

AutoJCut.getContext = function () {
  return AutoJCut._wrap(function () {
    return AutoJCut._ok(AutoJCut._contextData());
  });
};

AutoJCut.ping = function () {
  return "{\"ok\":true,\"data\":{\"pong\":true}}";
};

AutoJCut._jcutJob = null;

AutoJCut._generateJCutsActivateSeq = function (args) {
  var seq = AutoJCut._activeSequence();
  var wantId = null;
  if (args && args.sequenceId) {
    wantId = args.sequenceId;
  } else if (AutoJCut._jcutJob && AutoJCut._jcutJob.sequenceId) {
    wantId = AutoJCut._jcutJob.sequenceId;
  }
  if (wantId && seq && String(wantId) !== String(seq.sequenceID)) {
    var found = AutoJCut._findSequenceById(wantId);
    if (found) {
      AutoJCut._activateSequence(found);
      seq = AutoJCut._activeSequence();
    }
  }
  return seq;
};

AutoJCut._generateJCutsStepResult = function (next, frames, count) {
  return AutoJCut._ok({
    next: next,
    frames: frames,
    segmentCount: count
  });
};

AutoJCut.generateJCuts = function (jsonStr) {
  return AutoJCut._wrap(function () {
    var args = AutoJCut._parse(jsonStr);
    var step = "all";
    if (args && args.step) {
      step = String(args.step);
    }
    var seq = AutoJCut._generateJCutsActivateSeq(args);
    var frames;
    var xSeconds;
    var allIdentities;
    var evenIdentities;
    var oddIdentities;
    var n;
    var i;
    var job;
    var oddsToSlide;

    if (step === "all" || step === "collect") {
      frames = Math.round(Number(args.frames));
      if (isNaN(frames) || frames < 1) {
        throw new Error("Informe uma duração de corte em frames maior ou igual a 1.");
      }
      var frameSec = AutoJCut._frameSeconds(seq);
      xSeconds = frames * frameSec;
      var segments = AutoJCut._collectSegments(seq);
      n = segments.length;
      if (n < 2) {
        AutoJCut._jcutJob = null;
        return AutoJCut._ok({
          segmentCount: n,
          frames: frames,
          done: true,
          message: "Geração de J-Cuts concluída."
        });
      }
      for (i = 0; i < n; i += 1) {
        var durFrames = segments[i].duration / frameSec;
        if (frames >= durFrames - 0.01) {
          throw new Error(
            "A duração do corte (" +
              frames +
              " frames) é grande demais para o segmento " +
              segments[i].index +
              " (" +
              Math.round(durFrames) +
              " frames). Reduza o valor."
          );
        }
      }

      allIdentities = [];
      evenIdentities = [];
      oddIdentities = [];
      for (i = 0; i < n; i += 1) {
        var id = {
          index: segments[i].index,
          even: segments[i].even,
          inPoint: segments[i].inPoint,
          audioInPoint: segments[i].audioInPoint,
          videoName: segments[i].videoName,
          audioName: segments[i].audioName,
          videoStart: segments[i].start,
          audioStart: segments[i].start
        };
        allIdentities.push(id);
        if (segments[i].even) {
          evenIdentities.push(id);
        } else {
          oddIdentities.push(id);
        }
      }
      AutoJCut._jcutJob = {
        sequenceId: String(seq.sequenceID),
        frames: frames,
        xSeconds: xSeconds,
        allIdentities: allIdentities,
        evenIdentities: evenIdentities,
        oddIdentities: oddIdentities
      };
      if (step === "collect") {
        return AutoJCut._generateJCutsStepResult("a2", frames, n);
      }
    } else {
      job = AutoJCut._jcutJob;
      if (!job || !job.allIdentities || !job.evenIdentities || !job.oddIdentities) {
        throw new Error("Não há uma geração de J-Cuts em andamento. Clique em Gerar J-Cuts de novo.");
      }
      frames = job.frames;
      xSeconds = job.xSeconds;
      allIdentities = job.allIdentities;
      evenIdentities = job.evenIdentities;
      oddIdentities = job.oddIdentities;
      n = allIdentities.length;
    }

    if (step === "all" || step === "a2") {
      AutoJCut._moveEvenAudioToA2(seq, evenIdentities);
      if (step === "a2") {
        return AutoJCut._generateJCutsStepResult("shiftEvens", frames, n);
      }
    }

    if (step === "all" || step === "shiftEvens") {
      for (i = evenIdentities.length - 1; i >= 0; i -= 1) {
        AutoJCut._moveIdentityByFrames(seq, evenIdentities[i], -frames, 1);
      }
      if (step === "shiftEvens") {
        return AutoJCut._generateJCutsStepResult("closeEvenGaps", frames, n);
      }
    }

    if (step === "all" || step === "closeEvenGaps") {
      AutoJCut._closeCreatedGaps(seq, xSeconds, { video: [0], audio: [] }, evenIdentities);
      AutoJCut._refreshIdentityStarts(seq, allIdentities);
      if (step === "closeEvenGaps") {
        return AutoJCut._generateJCutsStepResult("unlinkOdds", frames, n);
      }
    }

    if (step === "all" || step === "unlinkOdds") {
      oddsToSlide = [];
      for (i = 0; i < oddIdentities.length; i += 1) {
        if (oddIdentities[i].index !== 1) {
          oddsToSlide.push(oddIdentities[i]);
        }
      }
      AutoJCut._unlinkOriginalPairs(seq, oddsToSlide);
      if (step === "unlinkOdds") {
        return AutoJCut._generateJCutsStepResult("moveOdds", frames, n);
      }
    }

    if (step === "all" || step === "moveOdds") {
      oddsToSlide = [];
      for (i = 0; i < oddIdentities.length; i += 1) {
        if (oddIdentities[i].index !== 1) {
          oddsToSlide.push(oddIdentities[i]);
        }
      }
      for (i = oddsToSlide.length - 1; i >= 0; i -= 1) {
        AutoJCut._moveIdentityByFrames(seq, oddsToSlide[i], -frames, 0);
      }
      if (step === "moveOdds") {
        return AutoJCut._generateJCutsStepResult("shiftAfterOdds", frames, n);
      }
    }

    if (step === "all" || step === "shiftAfterOdds") {
      oddsToSlide = [];
      for (i = 0; i < oddIdentities.length; i += 1) {
        if (oddIdentities[i].index !== 1) {
          oddsToSlide.push(oddIdentities[i]);
        }
      }
      for (i = oddsToSlide.length - 1; i >= 0; i -= 1) {
        AutoJCut._shiftIdentitiesAfter(seq, allIdentities, oddsToSlide[i].index, -frames);
      }
      AutoJCut._refreshIdentityStarts(seq, allIdentities);
      AutoJCut._alignEvenAudioToVideo(seq, evenIdentities);
      if (step === "shiftAfterOdds") {
        return AutoJCut._generateJCutsStepResult("finish", frames, n);
      }
    }

    if (step === "all" || step === "finish") {
      AutoJCut._moveEvenVideoToV2(seq, evenIdentities);
      AutoJCut._trimEvenVideoHeads(seq, evenIdentities, frames);
      AutoJCut._moveEvenVideoBetweenTracks(seq, evenIdentities, 1, 0);
      AutoJCut._relinkOriginalPairs(seq, allIdentities);
      AutoJCut._jcutJob = null;
      return AutoJCut._ok({
        segmentCount: n,
        frames: frames,
        done: true,
        message: "Geração de J-Cuts concluída."
      });
    }

    throw new Error("Etapa desconhecida da geração de J-Cuts.");
  });
};
