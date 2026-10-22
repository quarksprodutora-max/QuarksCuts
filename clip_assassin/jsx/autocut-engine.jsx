var AutoCut = AutoCut || {};

AutoCut._perfOn = function () {
  return false;
};
AutoCut._perfTime = function (op, index, fn) {
  return fn();
};
AutoCut._perfAdd = function () {};
AutoCut._perfEnter = function () {
  return null;
};
AutoCut._perfExit = function () {
  return 0;
};
AutoCut._perfNote = function () {};
AutoCut._perfHostSlice = function () {
  return null;
};

AutoCut.TICKS_PER_SECOND = 254016000000;
AutoCut.EPS_SECONDS = 0.02;
AutoCut.FRAME_SLACK_SECONDS = 0.05;

AutoCut._escapeString = function (value) {
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

AutoCut._stringify = function (value) {
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
    return "\"" + AutoCut._escapeString(value) + "\"";
  }
  var i;
  var pieces;
  var key;
  if (value instanceof Array) {
    pieces = [];
    for (i = 0; i < value.length; i += 1) {
      pieces.push(AutoCut._stringify(value[i]));
    }
    return "[" + pieces.join(",") + "]";
  }
  pieces = [];
  for (key in value) {
    if (value.hasOwnProperty(key)) {
      pieces.push("\"" + AutoCut._escapeString(key) + "\":" + AutoCut._stringify(value[key]));
    }
  }
  return "{" + pieces.join(",") + "}";
};

AutoCut._ok = function (data) {
  return AutoCut._stringify({ ok: true, data: data || null });
};

AutoCut._err = function (message) {
  return AutoCut._stringify({ ok: false, error: String(message) });
};

AutoCut._parse = function (jsonStr) {
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

AutoCut._wrap = function (fn) {
  try {
    return fn();
  } catch (e) {
    return AutoCut._err((e && e.toString) ? e.toString() : e);
  }
};

AutoCut._hasFn = function (obj, name) {
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

AutoCut._enableQE = function () {
  if (typeof app.enableQE === "function") {
    app.enableQE();
  }
  if (typeof qe === "undefined" || !qe) {
    throw new Error("QE DOM indisponível nesta versão do Premiere.");
  }
  return qe;
};

AutoCut._activeSequence = function () {
  var seq = app.project && app.project.activeSequence;
  if (!seq) {
    throw new Error("Nenhuma sequência ativa. Abra uma sequência no Premiere.");
  }
  return seq;
};

AutoCut._secondsFromTime = function (value) {
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
    return Number(value.ticks) / AutoCut.TICKS_PER_SECOND;
  }
  return Number(value) || 0;
};

AutoCut._ticksFromSeconds = function (seconds) {
  return String(Math.round(Number(seconds) * AutoCut.TICKS_PER_SECOND));
};

AutoCut._ticksValue = function (ticks) {
  return Number(String(ticks));
};

AutoCut._clipStartTicks = function (clip) {
  try {
    if (clip && clip.start && clip.start.ticks !== undefined && clip.start.ticks !== null && String(clip.start.ticks) !== "") {
      return String(clip.start.ticks);
    }
  } catch (e) {}
  return "0";
};

AutoCut._setClipStartTicks = function (clip, ticks) {
  var tickStr = String(ticks);
  if (AutoCut._ticksValue(tickStr) < 0) {
    tickStr = "0";
  }
  try {
    var t = new Time();
    t.ticks = tickStr;
    clip.start = t;
    return true;
  } catch (eTime) {}
  try {
    clip.start = tickStr;
    return true;
  } catch (eStr) {}
  return false;
};

AutoCut._sequenceDurationSeconds = function (seq) {
  try {
    var endTicks = Number(seq.end);
    var zero = Number(seq.zeroPoint) || 0;
    if (endTicks) {
      return (endTicks - zero) / AutoCut.TICKS_PER_SECOND;
    }
  } catch (e) {}
  var maxEnd = 0;
  AutoCut._forEachTrack(seq, function (track) {
    var clips = track.clips;
    var i;
    for (i = 0; i < clips.numItems; i += 1) {
      var end = AutoCut._secondsFromTime(clips[i].end);
      if (end > maxEnd) {
        maxEnd = end;
      }
    }
  });
  return maxEnd;
};

AutoCut._collectionCount = function (col, keys) {
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

AutoCut._itemAt = function (col, index) {
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

AutoCut._forEachTrack = function (seq, fn) {
  var i;
  var videoCount = AutoCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  var audioCount = AutoCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  for (i = 0; i < videoCount; i += 1) {
    var videoTrack = AutoCut._itemAt(seq.videoTracks, i);
    if (videoTrack) {
      fn(videoTrack, "video", i);
    }
  }
  for (i = 0; i < audioCount; i += 1) {
    var audioTrack = AutoCut._itemAt(seq.audioTracks, i);
    if (audioTrack) {
      fn(audioTrack, "audio", i);
    }
  }
};

AutoCut._trackClipCount = function (track) {
  try {
    if (track && track.clips) {
      return AutoCut._collectionCount(track.clips, ["numItems", "numTracks", "length"]);
    }
  } catch (e) {}
  try {
    if (typeof track.numItems === "number") {
      return track.numItems;
    }
  } catch (e2) {}
  return 0;
};

AutoCut._audioTracksInfo = function (seq) {
  var tracks = [];
  var i;
  var n = AutoCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  for (i = 0; i < n; i += 1) {
    var track = AutoCut._itemAt(seq.audioTracks, i);
    if (!track) {
      tracks.push({
        index: i,
        name: "A" + (i + 1),
        muted: false,
        clipCount: 0
      });
      continue;
    }
    var name = "A" + (i + 1);
    try {
      if (track.name) {
        name = String(track.name);
      }
    } catch (eName) {}
    var muted = false;
    try {
      muted = !!(track.isMuted && track.isMuted());
    } catch (eMute) {}
    tracks.push({
      index: i,
      name: name,
      muted: muted,
      clipCount: AutoCut._trackClipCount(track)
    });
  }
  if (tracks.length) {
    return tracks;
  }
  try {
    AutoCut._enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
      return tracks;
    }
    var qn = 0;
    if (typeof qeSeq.numAudioTracks === "number") {
      qn = qeSeq.numAudioTracks;
    }
    for (i = 0; i < qn; i += 1) {
      var qeTrack = qeSeq.getAudioTrackAt(i);
      var qeName = "A" + (i + 1);
      try {
        if (qeTrack && qeTrack.name) {
          qeName = String(qeTrack.name);
        }
      } catch (eQeName) {}
      tracks.push({
        index: i,
        name: qeName,
        muted: false,
        clipCount: qeTrack && typeof qeTrack.numItems === "number" ? qeTrack.numItems : 0
      });
    }
  } catch (eQe) {}
  return tracks;
};

AutoCut._sequenceCount = function () {
  return AutoCut._collectionCount(app.project.sequences, ["numSequences", "numItems", "length"]);
};

AutoCut._listSequences = function () {
  var list = [];
  var n = AutoCut._sequenceCount();
  var active = null;
  try {
    active = app.project.activeSequence;
  } catch (e) {}
  var activeId = active ? String(active.sequenceID) : "";
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoCut._itemAt(app.project.sequences, i);
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
      isActive: id === activeId,
      audioTrackCount: AutoCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]),
      videoTrackCount: AutoCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"])
    });
  }
  return list;
};

AutoCut._findSequenceById = function (sequenceID) {
  var target = String(sequenceID);
  var n = AutoCut._sequenceCount();
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoCut._itemAt(app.project.sequences, i);
    try {
      if (seq && String(seq.sequenceID) === target) {
        return seq;
      }
    } catch (e) {}
  }
  return null;
};

AutoCut._walkProjectItems = function (root, fn) {
  if (!root) {
    return;
  }
  fn(root);
  if (root.children && root.children.numItems) {
    var i;
    for (i = 0; i < root.children.numItems; i += 1) {
      AutoCut._walkProjectItems(root.children[i], fn);
    }
  }
};

AutoCut._projectItemForSequence = function (seq) {
  var found = null;
  AutoCut._walkProjectItems(app.project.rootItem, function (item) {
    if (found || !item) {
      return;
    }
    try {
      if (item.isSequence && item.isSequence()) {
        var linked = item.getSequence ? item.getSequence() : null;
        if (linked && linked.sequenceID === seq.sequenceID) {
          found = item;
        }
      }
    } catch (e) {}
  });
  return found;
};

AutoCut._renameSequence = function (seq, name) {
  seq.name = name;
  var item = AutoCut._projectItemForSequence(seq);
  if (item) {
    try {
      item.name = name;
    } catch (e) {}
  }
};

AutoCut._activateSequence = function (seq) {
  if (!seq) {
    return;
  }
  try {
    if (AutoCut._hasFn(app.project, "openSequence")) {
      app.project.openSequence(seq.sequenceID);
    }
  } catch (e1) {}
  try {
    app.project.activeSequence = seq;
  } catch (e2) {}
};

AutoCut._closeSequenceTab = function (seq) {
  if (!seq) {
    return;
  }
  try {
    seq.close();
    return;
  } catch (e1) {}
  try {
    seq.close(true);
  } catch (e2) {}
};

AutoCut._razorArg = function (seq, seconds) {
  var t = new Time();
  t.seconds = seconds;
  try {
    var settings = seq.getSettings();
    if (t.getFormatted && settings && settings.videoFrameRate) {
      return t.getFormatted(settings.videoFrameRate, seq.videoDisplayFormat);
    }
  } catch (e) {}
  return AutoCut._ticksFromSeconds(seconds);
};

AutoCut._qeTrackCount = function (qeSeq, kind) {
  if (kind === "video") {
    if (typeof qeSeq.numVideoTracks === "number") {
      return qeSeq.numVideoTracks;
    }
    return app.project.activeSequence.videoTracks.numTracks;
  }
  if (typeof qeSeq.numAudioTracks === "number") {
    return qeSeq.numAudioTracks;
  }
  return app.project.activeSequence.audioTracks.numTracks;
};

AutoCut._trackHasClipAt = function (track, seconds) {
  if (!track) {
    return false;
  }
  var clips = track.clips;
  var n = AutoCut._collectionCount(clips, ["numItems", "length"]);
  var i;
  for (i = 0; i < n; i += 1) {
    var clip = AutoCut._itemAt(clips, i);
    if (!clip) {
      continue;
    }
    var start = AutoCut._secondsFromTime(clip.start);
    var end = AutoCut._secondsFromTime(clip.end);
    if (start <= seconds + AutoCut.EPS_SECONDS && end >= seconds - AutoCut.EPS_SECONDS) {
      return true;
    }
  }
  return false;
};

AutoCut._razorTrack = function (qeTrack, arg, ticks) {
  if (!qeTrack || !AutoCut._hasFn(qeTrack, "razor")) {
    throw new Error("track.razor() não está disponível nesta versão do Premiere.");
  }
  try {
    qeTrack.razor(arg);
  } catch (e1) {
    qeTrack.razor(ticks);
  }
};

AutoCut._razorAllTracks = function (seq, seconds) {
  AutoCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    throw new Error("Não foi possível obter a sequência ativa no QE DOM.");
  }
  var arg = AutoCut._razorArg(seq, seconds);
  var ticks = AutoCut._ticksFromSeconds(seconds);
  var i;
  var vCount = AutoCut._qeTrackCount(qeSeq, "video");
  var aCount = AutoCut._qeTrackCount(qeSeq, "audio");
  for (i = 0; i < vCount; i += 1) {
    AutoCut._razorTrack(qeSeq.getVideoTrackAt(i), arg, ticks);
  }
  for (i = 0; i < aCount; i += 1) {
    AutoCut._razorTrack(qeSeq.getAudioTrackAt(i), arg, ticks);
  }
};

AutoCut._clipInRange = function (clip, startSec, endSec) {
  var clipStart = AutoCut._secondsFromTime(clip.start);
  var clipEnd = AutoCut._secondsFromTime(clip.end);
  return clipStart < endSec - AutoCut.EPS_SECONDS && clipEnd > startSec + AutoCut.EPS_SECONDS;
};

AutoCut._clipFullyInside = function (clip, startSec, endSec) {
  var clipStart = AutoCut._secondsFromTime(clip.start);
  var clipEnd = AutoCut._secondsFromTime(clip.end);
  var slack = AutoCut.FRAME_SLACK_SECONDS;
  return clipStart >= startSec - slack && clipEnd <= endSec + slack;
};

AutoCut._itemStartSeconds = function (item) {
  try {
    if (item.start && typeof item.start.secs === "number") {
      return Number(item.start.secs);
    }
  } catch (e) {}
  return AutoCut._secondsFromTime(item.start);
};

AutoCut._itemEndSeconds = function (item) {
  try {
    if (item.end && typeof item.end.secs === "number") {
      return Number(item.end.secs);
    }
  } catch (e2) {}
  return AutoCut._secondsFromTime(item.end);
};

AutoCut._isGapItem = function (item) {
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

AutoCut._rippleDeleteGap = function (item) {
  if (AutoCut._perfOn() && AutoCut._perfRippleDeleteGap) {
    return AutoCut._perfRippleDeleteGap(item);
  }
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

AutoCut._qeTrackHasClipAfter = function (qeTrack, seconds) {
  if (!qeTrack || typeof qeTrack.numItems !== "number") {
    return false;
  }
  var i;
  for (i = 0; i < qeTrack.numItems; i += 1) {
    var item = qeTrack.getItemAt(i);
    if (!item || AutoCut._isGapItem(item)) {
      continue;
    }
    if (AutoCut._itemStartSeconds(item) >= seconds - AutoCut.EPS_SECONDS) {
      return true;
    }
  }
  return false;
};

AutoCut._deleteGapItems = function (seq, intervals) {
  var perf = AutoCut._perfOn();
  var slack = AutoCut.FRAME_SLACK_SECONDS;
  var slackTicks = AutoCut.TICKS_PER_SECOND * slack;
  var rippleEvents = [];
  var closed = 0;
  var closeMethod = "";

  function itemStartTicks(item) {
    try {
      if (item && item.start && item.start.ticks !== undefined && item.start.ticks !== null && String(item.start.ticks) !== "") {
        return String(item.start.ticks);
      }
    } catch (e) {}
    return "";
  }

  function itemEndTicks(item) {
    try {
      if (item && item.end && item.end.ticks !== undefined && item.end.ticks !== null && String(item.end.ticks) !== "") {
        return String(item.end.ticks);
      }
    } catch (e) {}
    return "";
  }

  function lastLeftoverStarts() {
    var videoTicks = "";
    var audioTicks = "";
    var videoNum = -1;
    var audioNum = -1;
    AutoCut._forEachTrack(seq, function (track, kind) {
      var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
      var i;
      for (i = 0; i < n; i += 1) {
        var clip = AutoCut._itemAt(track.clips, i);
        if (!clip || AutoCut._isGapItem(clip)) {
          continue;
        }
        if (perf) {
          AutoCut._perfAdd("lastLeftoverStarts.visited", 1);
        }
        var ticks = AutoCut._clipStartTicks(clip);
        var tnum = AutoCut._ticksValue(ticks);
        if (kind === "video" && tnum >= videoNum) {
          videoNum = tnum;
          videoTicks = ticks;
        }
        if (kind === "audio" && tnum >= audioNum) {
          audioNum = tnum;
          audioTicks = ticks;
        }
      }
    });
    return { videoTicks: videoTicks, audioTicks: audioTicks };
  }

  function overlapsSilence(start, end) {
    var i;
    for (i = 0; i < (intervals || []).length; i += 1) {
      var s = Number(intervals[i][0]) / 1000 - slack;
      var e = Number(intervals[i][1]) / 1000 + slack;
      if (start < e && end > s) {
        return true;
      }
    }
    return false;
  }

  function collectFromQeTrack(qeTrack, push) {
    if (!qeTrack || typeof qeTrack.numItems !== "number") {
      return;
    }
    var i;
    for (i = 0; i < qeTrack.numItems; i += 1) {
      if (perf) {
        AutoCut._perfAdd("gapScan.visited", 1);
      }
      push(qeTrack.getItemAt(i));
    }
  }

  function scanAllGapItems(push) {
    AutoCut._enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var t;
    if (qeSeq) {
      var videoCount = qeSeq.numVideoTracks || 0;
      var audioCount = qeSeq.numAudioTracks || 0;
      for (t = 0; t < videoCount; t += 1) {
        collectFromQeTrack(qeSeq.getVideoTrackAt(t), push);
      }
      for (t = 0; t < audioCount; t += 1) {
        collectFromQeTrack(qeSeq.getAudioTrackAt(t), push);
      }
    }
    AutoCut._forEachTrack(seq, function (track) {
      var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
      var c;
      for (c = 0; c < n; c += 1) {
        if (perf) {
          AutoCut._perfAdd("gapScan.visited", 1);
        }
        push(AutoCut._itemAt(track.clips, c));
      }
    });
  }

  function collectUniqueIntervals() {
    var raw = [];
    scanAllGapItems(function (item) {
      if (!item || !AutoCut._isGapItem(item)) {
        return;
      }
      var start = AutoCut._itemStartSeconds(item);
      var end = AutoCut._itemEndSeconds(item);
      if (!(end > start) || !overlapsSilence(start, end)) {
        return;
      }
      raw.push({
        start: start,
        end: end,
        startTicks: AutoCut._ticksValue(itemStartTicks(item)),
        endTicks: AutoCut._ticksValue(itemEndTicks(item))
      });
    });
    var unique = [];
    var i;
    var j;
    for (i = 0; i < raw.length; i += 1) {
      var gap = raw[i];
      var merged = false;
      for (j = 0; j < unique.length; j += 1) {
        var u = unique[j];
        var tickMatch =
          gap.startTicks &&
          u.startTicks &&
          Math.abs(gap.startTicks - u.startTicks) <= slackTicks &&
          Math.abs(gap.endTicks - u.endTicks) <= slackTicks;
        var secMatch =
          Math.abs(gap.start - u.start) <= slack && Math.abs(gap.end - u.end) <= slack;
        if (tickMatch || secMatch) {
          merged = true;
          break;
        }
      }
      if (!merged) {
        unique.push(gap);
      }
    }
    unique.sort(function (a, b) {
      if (b.startTicks && a.startTicks) {
        return b.startTicks - a.startTicks;
      }
      return b.start - a.start;
    });
    return unique;
  }

  function liveGapsAt(range) {
    var items = [];
    scanAllGapItems(function (item) {
      if (!item || !AutoCut._isGapItem(item)) {
        return;
      }
      var start = AutoCut._itemStartSeconds(item);
      var end = AutoCut._itemEndSeconds(item);
      if (!(end > start)) {
        return;
      }
      var startTicks = AutoCut._ticksValue(itemStartTicks(item));
      var endTicks = AutoCut._ticksValue(itemEndTicks(item));
      var tickHit =
        range.startTicks &&
        startTicks &&
        startTicks < range.endTicks + slackTicks &&
        endTicks > range.startTicks - slackTicks;
      var secHit = start < range.end + slack && end > range.start - slack;
      if (tickHit || secHit) {
        items.push(item);
      }
    });
    return items;
  }

  var collectToken = perf ? AutoCut._perfEnter("collectUniqueIntervals", "", { intervals: (intervals || []).length }) : null;
  var unique = collectUniqueIntervals();
  if (collectToken) {
    AutoCut._perfExit(collectToken, "ok", {
      inclusive: 1,
      intervals: (intervals || []).length,
      uniqueGaps: unique.length
    });
    AutoCut._perfNote("closeGaps.inventory", {
      intervals: (intervals || []).length,
      uniqueGaps: unique.length
    });
  }
  var g;
  for (g = 0; g < unique.length; g += 1) {
    var gap = unique[g];
    var gapToken = perf ? AutoCut._perfEnter("gap.iteration", g, {
      inclusive: 1,
      posSec: Number(gap.start).toFixed(3),
      durSec: Number(gap.end - gap.start).toFixed(3)
    }) : null;
    var before;
    var items;
    var didClose = false;
    try {
      before = AutoCut._perfTime("lastLeftoverStarts.before", g, function () {
        return lastLeftoverStarts();
      });
      items = AutoCut._perfTime("liveGapsAt", g, function () {
        return liveGapsAt(gap);
      });
      if (items.length) {
        AutoCut._perfTime("targetAllTracks", g, function () {
          AutoCut._targetAllTracks(seq);
        });
        AutoCut._perfTime("deselectGetSelection", g, function () {
          AutoCut._deselectGetSelection(seq);
        });
        AutoCut._perfTime("selectGapItems", g, function () {
          var k;
          for (k = 0; k < items.length; k += 1) {
            if (perf) {
              AutoCut._perfAdd("selectGapItems.visited", 1);
            }
            try {
              items[k].setSelected(true, k === 0);
            } catch (eSel) {}
          }
        });
        didClose = AutoCut._perfTime("rippleDeleteGap", g, function () {
          return AutoCut._rippleDeleteGap(items[0]);
        });
      }
      if (didClose) {
        closed += 1;
        closeMethod = "rippleDelete unique intervals";
      }

      var after = AutoCut._perfTime("lastLeftoverStarts.after", g, function () {
        return lastLeftoverStarts();
      });
      if (gapToken) {
        var rippleInfo = AutoCut._perf && AutoCut._perf.lastRipple ? AutoCut._perf.lastRipple : null;
        AutoCut._perfExit(gapToken, didClose ? "closed" : "not-closed", {
          inclusive: 1,
          items: items.length,
          removal: didClose ? 1 : 0,
          method: rippleInfo ? rippleInfo.method : "",
          callResult: rippleInfo ? rippleInfo.callResult : "",
          removalValidated: "not-checked",
          posSec: Number(gap.start).toFixed(3),
          durSec: Number(gap.end - gap.start).toFixed(3)
        });
        gapToken = null;
      }
    } catch (eGapIter) {
      if (gapToken) {
        AutoCut._perfExit(gapToken, "error", {
          inclusive: 1,
          error: String(eGapIter).replace(/[\r\n]/g, " ")
        });
      }
      throw eGapIter;
    }
    rippleEvents.push({
      pass: 0,
      index: g,
      videoTicksBefore: before.videoTicks,
      videoTicksAfter: after.videoTicks,
      audioTicksBefore: before.audioTicks,
      audioTicksAfter: after.audioTicks,
      deltaBefore: AutoCut._ticksValue(before.audioTicks) - AutoCut._ticksValue(before.videoTicks),
      deltaAfter: AutoCut._ticksValue(after.audioTicks) - AutoCut._ticksValue(after.videoTicks)
    });
  }

  return {
    closedCount: closed,
    closeMethod: closeMethod || "rippleDelete unique intervals",
    rippleEvents: rippleEvents
  };
};

AutoCut._listLeftoverClipsByTicks = function (track) {
  var list = [];
  if (!track) {
    return list;
  }
  var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
  var perf = AutoCut._perfOn();
  var collectT0 = perf ? AutoCut._perfNowUs() : 0;
  var i;
  for (i = 0; i < n; i += 1) {
    if (perf) {
      AutoCut._perfAdd("snap.collect.visited", 1);
    }
    var clip = AutoCut._itemAt(track.clips, i);
    if (!clip || AutoCut._isGapItem(clip) || AutoCut._isExplicitGap(clip)) {
      continue;
    }
    list.push(clip);
  }
  if (perf && AutoCut._perfRecord) {
    AutoCut._perfRecord("snap.collect", "", AutoCut._perfElapsedMs(collectT0), "ok", 0);
  }
  var sortT0 = perf ? AutoCut._perfNowUs() : 0;
  list = AutoCut._sortByKey(list, function (c) {
    return AutoCut._ticksValue(AutoCut._clipStartTicks(c));
  });
  if (perf && AutoCut._perfRecord) {
    AutoCut._perfRecord("snap.sort", "", AutoCut._perfElapsedMs(sortT0), "ok", 0);
  }
  return list;
};

AutoCut._snapAudioStartsToVideoTicks = function (seq) {
  var perf = AutoCut._perfOn();
  var snapToken = perf ? AutoCut._perfEnter("snap.total", "", { inclusive: 1 }) : null;
  var snapped = 0;
  var examined = 0;
  var last = null;
  var videoTrackCount = AutoCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  var audioTrackCount = AutoCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  var maxTracks = videoTrackCount < audioTrackCount ? videoTrackCount : audioTrackCount;
  var t;
  for (t = 0; t < maxTracks; t += 1) {
    var videos = AutoCut._listLeftoverClipsByTicks(AutoCut._trackAt(seq, "video", t));
    var audios = AutoCut._listLeftoverClipsByTicks(AutoCut._trackAt(seq, "audio", t));
    var n = videos.length < audios.length ? videos.length : audios.length;
    var j;
    for (j = 0; j < n; j += 1) {
      examined += 1;
      var videoClip = videos[j];
      var audioClip = audios[j];
      var videoTicks = AutoCut._clipStartTicks(videoClip);
      var audioBefore = AutoCut._clipStartTicks(audioClip);
      var restored = String(audioBefore) !== String(videoTicks);
      if (restored) {
        var moveToken = perf ? AutoCut._perfEnter("snap.setStart", examined) : null;
        AutoCut._setClipStartTicks(audioClip, videoTicks);
        if (moveToken) {
          AutoCut._perfExit(moveToken, "ok", null);
        }
        snapped += 1;
      }
      last = {
        videoTicks: videoTicks,
        audioBefore: audioBefore,
        audioAfter: AutoCut._clipStartTicks(audioClip),
        restored: restored
      };
    }
  }
  if (snapToken) {
    AutoCut._perfExit(snapToken, "ok", {
      inclusive: 1,
      examined: examined,
      attempted: snapped
    });
  }
  return {
    snappedCount: snapped,
    lastVideoTicks: last ? last.videoTicks : "",
    lastAudioTicksBefore: last ? last.audioBefore : "",
    lastAudioTicksAfter: last ? last.audioAfter : "",
    lastSnapRan: last ? Boolean(last.restored) : false
  };
};

AutoCut._removeClip = function (clip, ripple) {
  if (ripple) {
    try {
      clip.rippleDelete();
      return "rippleDelete";
    } catch (e1) {}
  }
  try {
    clip.remove(ripple ? 1 : 0, 1);
    return ripple ? "remove-ripple" : "remove-lift";
  } catch (e2) {
    try {
      clip.remove();
      return "remove";
    } catch (e3) {}
  }
  throw new Error("Não foi possível remover o clipe (QE/DOM sem remove/rippleDelete).");
};

AutoCut._collectClipsInRange = function (seq, startSec, endSec, fullyInside) {
  var collected = [];
  AutoCut._forEachTrack(seq, function (track, kind, index) {
    if (!track) {
      return;
    }
    var clips = track.clips;
    var n = AutoCut._collectionCount(clips, ["numItems", "length"]);
    var i;
    for (i = 0; i < n; i += 1) {
      var clip = AutoCut._itemAt(clips, i);
      if (!clip || AutoCut._isGapItem(clip)) {
        continue;
      }
      var match = fullyInside
        ? AutoCut._clipFullyInside(clip, startSec, endSec)
        : AutoCut._clipInRange(clip, startSec, endSec);
      if (match) {
        collected.push({
          clip: clip,
          kind: kind,
          trackIndex: index,
          start: AutoCut._secondsFromTime(clip.start)
        });
      }
    }
  });
  collected.sort(function (a, b) {
    return b.start - a.start;
  });
  return collected;
};

AutoCut._collectQeClipsInside = function (qeSeq, startSec, endSec) {
  var found = [];
  var slack = AutoCut.FRAME_SLACK_SECONDS;
  function walk(getTrack, count) {
    var t;
    for (t = 0; t < count; t += 1) {
      var track = getTrack(t);
      if (!track || typeof track.numItems !== "number") {
        continue;
      }
      var i;
      for (i = 0; i < track.numItems; i += 1) {
        var item = track.getItemAt(i);
        if (!item || AutoCut._isGapItem(item)) {
          continue;
        }
        var start = AutoCut._itemStartSeconds(item);
        var end = AutoCut._itemEndSeconds(item);
        if (start >= startSec - slack && end <= endSec + slack && end > start) {
          found.push(item);
        }
      }
    }
  }
  walk(function (index) {
    return qeSeq.getVideoTrackAt(index);
  }, qeSeq.numVideoTracks || 0);
  walk(function (index) {
    return qeSeq.getAudioTrackAt(index);
  }, qeSeq.numAudioTracks || 0);
  found.sort(function (a, b) {
    return AutoCut._itemStartSeconds(b) - AutoCut._itemStartSeconds(a);
  });
  return found;
};

AutoCut._assertActiveSequence = function (sequenceId) {
  var seq = AutoCut._activeSequence();
  if (sequenceId && String(sequenceId) !== String(seq.sequenceID)) {
    throw new Error("A sequência ativa mudou desde a análise. Selecione de novo a sequência original.");
  }
  return seq;
};

AutoCut._targetAllTracks = function (seq) {
  AutoCut._forEachTrack(seq, function (track) {
    if (track && AutoCut._hasFn(track, "setTargeted")) {
      try {
        track.setTargeted(true, true);
      } catch (e) {}
    }
  });
};

AutoCut._setInOut = function (seq, startSec, endSec) {
  var startTicks = AutoCut._ticksFromSeconds(startSec);
  var endTicks = AutoCut._ticksFromSeconds(endSec);
  try {
    seq.setInPoint(startTicks);
    seq.setOutPoint(endTicks);
    return;
  } catch (e1) {}
  seq.setInPoint(startSec);
  seq.setOutPoint(endSec);
};

AutoCut._findCommand = function (names) {
  if (!AutoCut._hasFn(app, "findMenuCommandId")) {
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

AutoCut._runCommand = function (names) {
  var id = AutoCut._findCommand(names);
  if (id) {
    try {
      app.executeCommand(id);
      return true;
    } catch (e1) {}
  }
  try {
    AutoCut._enableQE();
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

AutoCut._trackAt = function (seq, kind, index) {
  if (kind === "video") {
    return AutoCut._itemAt(seq.videoTracks, index);
  }
  return AutoCut._itemAt(seq.audioTracks, index);
};

AutoCut._listDomClips = function (track) {
  var list = [];
  if (!track) {
    return list;
  }
  var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
  var i;
  for (i = 0; i < n; i += 1) {
    var clip = AutoCut._itemAt(track.clips, i);
    if (!clip || AutoCut._isGapItem(clip)) {
      continue;
    }
    list.push(clip);
  }
  list = AutoCut._sortByKey(list, AutoCut._itemStartSeconds);
  return list;
};

AutoCut._isExplicitGap = function (clip) {
  if (!clip) {
    return true;
  }
  try {
    if (clip.isGap && clip.isGap()) {
      return true;
    }
  } catch (eGap) {}
  try {
    var type = String(clip.type || "").toLowerCase();
    if (type === "empty" || type === "gap") {
      return true;
    }
  } catch (eType) {}
  return false;
};

AutoCut._listOrderedClips = function (track) {
  var list = [];
  if (!track) {
    return list;
  }
  var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
  var perf = AutoCut._perfOn();
  var collectT0 = perf ? AutoCut._perfNowUs() : 0;
  var i;
  for (i = 0; i < n; i += 1) {
    if (perf) {
      AutoCut._perfAdd("relink.collect.visited", 1);
    }
    var clip = AutoCut._itemAt(track.clips, i);
    if (!clip || AutoCut._isExplicitGap(clip)) {
      continue;
    }
    list.push(clip);
  }
  if (perf && AutoCut._perfRecord) {
    AutoCut._perfRecord("relink.collect", "", AutoCut._perfElapsedMs(collectT0), "ok", 0);
  }
  var sortT0 = perf ? AutoCut._perfNowUs() : 0;
  list = AutoCut._sortByKey(list, AutoCut._itemStartSeconds);
  if (perf && AutoCut._perfRecord) {
    AutoCut._perfRecord("relink.sort", "", AutoCut._perfElapsedMs(sortT0), "ok", 0);
  }
  return list;
};

AutoCut._clearSelection = function (seq) {
  AutoCut._forEachTrack(seq, function (track) {
    var clips = AutoCut._listDomClips(track);
    var i;
    for (i = 0; i < clips.length; i += 1) {
      try {
        clips[i].setSelected(false, true);
      } catch (e) {}
    }
  });
};

AutoCut._selectClips = function (clips) {
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

AutoCut._deselectGetSelection = function (sequence) {
  if (!sequence) {
    return;
  }
  var selection;
  try {
    selection = sequence.getSelection();
  } catch (eGet) {
    return;
  }
  if (!selection) {
    return;
  }
  var n = typeof selection.length === "number"
    ? selection.length
    : AutoCut._collectionCount(selection, ["numItems", "length"]);
  var i;
  for (i = 0; i < n; i += 1) {
    var clip = AutoCut._itemAt(selection, i);
    if (!clip) {
      continue;
    }
    try {
      clip.setSelected(false, true);
    } catch (eSel) {}
  }
};

AutoCut._selectionCount = function (sequence) {
  try {
    if (sequence && sequence.getSelection) {
      var sel = sequence.getSelection();
      if (sel) {
        if (typeof sel.length === "number") {
          return sel.length;
        }
        var fromCol = AutoCut._collectionCount(sel, ["numItems", "length"]);
        if (fromCol) {
          return fromCol;
        }
      }
    }
  } catch (eSel) {}
  return 0;
};

AutoCut._sameClip = function (a, b) {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  try {
    if (a.nodeId && b.nodeId && String(a.nodeId) === String(b.nodeId)) {
      if (Math.abs(AutoCut._itemStartSeconds(a) - AutoCut._itemStartSeconds(b)) < 0.05) {
        return true;
      }
    }
  } catch (eId) {}
  return false;
};

AutoCut._collectionHasClip = function (col, clip) {
  if (!col || !clip) {
    return false;
  }
  var n = AutoCut._collectionCount(col, ["numItems", "length"]);
  if (!n && typeof col.length === "number") {
    n = col.length;
  }
  var i;
  for (i = 0; i < n; i += 1) {
    if (AutoCut._sameClip(AutoCut._itemAt(col, i), clip)) {
      return true;
    }
  }
  return false;
};

AutoCut._pairReportsLinked = function (video, audio) {
  try {
    if (video && video.getLinkedItems) {
      if (AutoCut._collectionHasClip(video.getLinkedItems(), audio)) {
        return true;
      }
    }
  } catch (e1) {}
  try {
    if (audio && audio.getLinkedItems) {
      if (AutoCut._collectionHasClip(audio.getLinkedItems(), video)) {
        return true;
      }
    }
  } catch (e2) {}
  try {
    if (video && video.isLinked && video.isLinked()) {
      if (audio && audio.isLinked && audio.isLinked()) {
        return true;
      }
    }
  } catch (e3) {}
  return false;
};

AutoCut._listRelinkAlignedClips = function (seq) {
  var videos = [];
  var audios = [];
  var videoCount = 0;
  var audioCount = 0;
  var videoTrackCount = AutoCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
  var audioTrackCount = AutoCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
  var maxTracks = videoTrackCount < audioTrackCount ? videoTrackCount : audioTrackCount;
  var t;
  for (t = 0; t < maxTracks; t += 1) {
    var trackVideos = AutoCut._listOrderedClips(AutoCut._trackAt(seq, "video", t));
    var trackAudios = AutoCut._listOrderedClips(AutoCut._trackAt(seq, "audio", t));
    if (!trackVideos.length && !trackAudios.length) {
      continue;
    }
    videoCount += trackVideos.length;
    audioCount += trackAudios.length;
    var n = trackVideos.length < trackAudios.length ? trackVideos.length : trackAudios.length;
    var j;
    for (j = 0; j < n; j += 1) {
      videos.push(trackVideos[j]);
      audios.push(trackAudios[j]);
    }
  }
  return {
    videos: videos,
    audios: audios,
    videoCount: videoCount,
    audioCount: audioCount,
    pairCount: videos.length < audios.length ? videos.length : audios.length
  };
};

AutoCut._perfFinishData = function (hostT0, data) {
  if (AutoCut._perfOn() && AutoCut._perfHostSlice) {
    try {
      data.perf = AutoCut._perfHostSlice(hostT0);
    } catch (ePerfData) {}
  }
  return AutoCut._ok(data);
};

AutoCut.countRelinkPairs = function (jsonStr) {
  return AutoCut._wrap(function () {
    var hostT0 = AutoCut._perfOn() ? AutoCut._perfNowUs() : 0;
    var args = AutoCut._parse(jsonStr);
    var sequence = app.project.activeSequence;
    AutoCut._assertActiveSequence(args.sequenceId);
    var listed = AutoCut._perfTime("relink.list", "count", function () {
      return AutoCut._listRelinkAlignedClips(sequence);
    });
    return AutoCut._perfFinishData(hostT0, {
      videoCount: listed.videoCount,
      audioCount: listed.audioCount,
      pairCount: listed.pairCount
    });
  });
};

AutoCut.relinkPairAt = function (jsonStr) {
  return AutoCut._wrap(function () {
    var hostT0 = AutoCut._perfOn() ? AutoCut._perfNowUs() : 0;
    var args = AutoCut._parse(jsonStr);
    var sequence = app.project.activeSequence;
    AutoCut._assertActiveSequence(args.sequenceId);
    var index = Number(args.index);
    var pairToken = AutoCut._perfOn() ? AutoCut._perfEnter("relink.pair", index, { inclusive: 1 }) : null;
    var listed = AutoCut._perfTime("relink.list", index, function () {
      return AutoCut._listRelinkAlignedClips(sequence);
    });
    if (!(index >= 0) || index >= listed.videos.length || index >= listed.audios.length) {
      if (pairToken) {
        AutoCut._perfExit(pairToken, "out-of-range", { inclusive: 1 });
      }
      return AutoCut._perfFinishData(hostT0, {
        ok: false,
        index: index,
        pairCount: listed.pairCount,
        videoCount: listed.videoCount,
        audioCount: listed.audioCount,
        command: "sequence.linkSelection",
        commandOk: false,
        selectedCount: 0,
        error: "índice fora da lista"
      });
    }
    var videoClip = listed.videos[index];
    var audioClip = listed.audios[index];
    var videoStartBefore = AutoCut._itemStartSeconds(videoClip);
    var audioStartBefore = AutoCut._itemStartSeconds(audioClip);

    AutoCut._perfTime("relink.deselect", index, function () {
      AutoCut._deselectGetSelection(sequence);
    });
    AutoCut._perfTime("relink.selectVideo", index, function () {
      try {
        videoClip.setSelected(true, true);
      } catch (eVid) {}
    });
    AutoCut._perfTime("relink.selectAudio", index, function () {
      try {
        audioClip.setSelected(true, true);
      } catch (eAud) {}
    });

    var selectedCount = 0;
    AutoCut._perfTime("relink.selectionCount", index, function () {
      selectedCount = AutoCut._selectionCount(sequence);
    });
    var commandOk = false;
    var error = "";
    var linkToken = AutoCut._perfOn() ? AutoCut._perfEnter("relink.linkSelection", index) : null;
    try {
      commandOk = sequence.linkSelection() !== false;
      if (!commandOk) {
        error = "linkSelection retornou false";
      }
      if (linkToken) {
        AutoCut._perfExit(linkToken, commandOk ? "ok" : "false", null);
      }
    } catch (eLink) {
      error = String(eLink);
      if (linkToken) {
        AutoCut._perfExit(linkToken, "exception", { error: error.replace(/[\r\n]/g, " ") });
      }
    }

    var videoStartAfter = AutoCut._itemStartSeconds(videoClip);
    var audioStartAfter = AutoCut._itemStartSeconds(audioClip);
    var startShifted =
      Math.abs(videoStartAfter - videoStartBefore) > 0.001 ||
      Math.abs(audioStartAfter - audioStartBefore) > 0.001;

    var linked = commandOk;
    if (!commandOk) {
      AutoCut._perfTime("relink.verifyLink", index, function () {
        linked = AutoCut._pairReportsLinked(videoClip, audioClip);
      });
    }
    AutoCut._perfTime("relink.deselectAfter", index, function () {
      try {
        videoClip.setSelected(false, true);
      } catch (eOffV) {}
      try {
        audioClip.setSelected(false, true);
      } catch (eOffA) {}
    });

    if (linked) {
      error = "";
    } else if (!error) {
      if (selectedCount < 2) {
        error = "seleção: " + selectedCount + " (precisa 2)";
      } else {
        error = "clipes não ficaram vinculados";
      }
    }
    if (pairToken) {
      AutoCut._perfExit(pairToken, linked ? "linked" : "not-linked", { inclusive: 1, commandOk: commandOk ? 1 : 0 });
    }
    return AutoCut._perfFinishData(hostT0, {
      ok: Boolean(linked),
      index: index,
      pairCount: listed.pairCount,
      videoCount: listed.videoCount,
      audioCount: listed.audioCount,
      command: "sequence.linkSelection",
      commandOk: Boolean(commandOk),
      selectedCount: selectedCount,
      error: error,
      startShifted: startShifted,
      videoStartBefore: videoStartBefore,
      audioStartBefore: audioStartBefore,
      videoStartAfter: videoStartAfter,
      audioStartAfter: audioStartAfter
    });
  });
};

AutoCut._setTrackTargeted = function (track, targeted) {
  if (track && AutoCut._hasFn(track, "setTargeted")) {
    try {
      track.setTargeted(targeted ? 1 : 0, 1);
    } catch (e) {}
  }
};

AutoCut._untargetAllTracks = function (seq) {
  AutoCut._forEachTrack(seq, function (track) {
    AutoCut._setTrackTargeted(track, false);
  });
};

AutoCut._menuItemName = function (item) {
  if (!item) {
    return "";
  }
  var keys = ["name", "text", "title", "label", "idName", "id"];
  var k;
  for (k = 0; k < keys.length; k += 1) {
    try {
      if (item[keys[k]]) {
        return String(item[keys[k]]).replace(/^&/, "");
      }
    } catch (e) {}
  }
  return "";
};

AutoCut._menuItemMatchesCloseGap = function (item) {
  var blob = AutoCut._menuItemName(item).toLowerCase();
  try {
    blob += " " + String(item);
  } catch (e) {}
  return (
    blob.indexOf("cmd.sequence.close.gaps") !== -1 ||
    blob.indexOf("close gap") !== -1 ||
    blob.indexOf("fechar lacuna") !== -1
  );
};

AutoCut._executeMenuItem = function (item) {
  if (!item) {
    return false;
  }
  try {
    item.execute();
    return true;
  } catch (e1) {}
  try {
    item.doCommand();
    return true;
  } catch (e2) {}
  try {
    item.invoke();
    return true;
  } catch (e3) {}
  return false;
};

AutoCut._executeNamedMenu = function (menuNames) {
  if (typeof qe === "undefined" || !qe.project) {
    return "";
  }
  var m;
  for (m = 0; m < menuNames.length; m += 1) {
    var menu = null;
    try {
      menu = qe.project.getMenuByName(menuNames[m]);
    } catch (eMenu) {}
    if (!menu) {
      continue;
    }
    var count = 0;
    try {
      count = menu.numMenuItems || menu.numItems || 0;
    } catch (eCount) {}
    if (!count) {
      count = 80;
    }
    var i;
    for (i = 0; i < count; i += 1) {
      var item = null;
      try {
        if (menu.getMenuItemAt) {
          item = menu.getMenuItemAt(i);
        } else if (menu.getItemAt) {
          item = menu.getItemAt(i);
        } else {
          item = menu[i];
        }
      } catch (eItem) {}
      if (!AutoCut._menuItemMatchesCloseGap(item)) {
        continue;
      }
      if (AutoCut._executeMenuItem(item)) {
        return "Sequence > " + (AutoCut._menuItemName(item) || "Close Gap");
      }
    }
  }
  return "";
};

AutoCut._resolveCloseGapCommandId = function () {
  if (AutoCut._cachedCloseGapId) {
    return AutoCut._cachedCloseGapId;
  }
  var names = [
    "Close Gap",
    "&Close Gap",
    "Fechar lacuna",
    "&Fechar lacuna",
    "Close Gaps",
    "Fechar lacunas",
    "cmd.sequence.close.gaps"
  ];
  var id = AutoCut._findCommand(names);
  if (id) {
    AutoCut._cachedCloseGapId = id;
    return id;
  }
  if (AutoCut._hasFn(app, "getMenuCommandName")) {
    var i;
    for (i = 1; i < 30000; i += 1) {
      var name = "";
      try {
        name = String(app.getMenuCommandName(i) || "");
      } catch (eScan) {
        continue;
      }
      if (!name) {
        continue;
      }
      var lower = name.toLowerCase().replace(/^&/, "");
      if (lower.indexOf("close gap") !== -1 || lower.indexOf("fechar lacuna") !== -1) {
        AutoCut._cachedCloseGapId = i;
        return i;
      }
    }
  }
  return 0;
};

AutoCut._invokeCloseGapMenu = function (seq) {
  AutoCut._enableQE();
  var before = AutoCut._sequenceDurationSeconds(seq);
  var cmd = "cmd.sequence.close.gaps";

  function changed() {
    return AutoCut._sequenceDurationSeconds(seq) < before - 0.03;
  }

  try {
    qe.executeCommand(cmd);
    if (changed()) {
      return "qe.executeCommand cmd.sequence.close.gaps";
    }
  } catch (e1) {}

  try {
    qe.executeConsoleCommand(cmd);
    if (changed()) {
      return "qe.executeConsoleCommand cmd.sequence.close.gaps";
    }
  } catch (e2) {}

  try {
    qe.project.executeCommand(cmd);
    if (changed()) {
      return "qe.project.executeCommand cmd.sequence.close.gaps";
    }
  } catch (e3) {}

  var id = AutoCut._resolveCloseGapCommandId();
  if (id) {
    try {
      app.executeCommand(id);
      if (changed()) {
        return "app.executeCommand Sequence > Close Gap (" + id + ")";
      }
    } catch (e4) {}
  }

  try {
    app.executeCommand(cmd);
    if (changed()) {
      return "app.executeCommand cmd.sequence.close.gaps";
    }
  } catch (e5) {}

  var menuHit = AutoCut._executeNamedMenu(["Sequence", "Sequência", "Sequencia"]);
  if (menuHit && changed()) {
    return menuHit;
  }
  if (changed()) {
    return menuHit || "Sequence > Close Gap";
  }
  return "";
};

AutoCut._closeGapsViaSequenceMenu = function (seq, intervals, backupSequenceId) {
  AutoCut._activateSequence(seq);
  AutoCut._targetAllTracks(seq);

  var sorted = intervals.slice().sort(function (a, b) {
    return Number(a[0]) - Number(b[0]);
  });
  var shift = 0;
  var closedCount = 0;
  var method = "";
  var totalSilence = 0;
  var t;
  for (t = 0; t < sorted.length; t += 1) {
    totalSilence += (Number(sorted[t][1]) - Number(sorted[t][0])) / 1000;
  }

  var g;
  for (g = 0; g < sorted.length; g += 1) {
    var gapDur = (Number(sorted[g][1]) - Number(sorted[g][0])) / 1000;
    var startSec = Number(sorted[g][0]) / 1000 - shift;
    var endSec = Number(sorted[g][1]) / 1000 - shift;
    var mid = (startSec + endSec) / 2;
    if (mid < 0) {
      mid = 0;
    }
    seq.setPlayerPosition(AutoCut._ticksFromSeconds(mid));
    AutoCut._targetAllTracks(seq);
    var before = AutoCut._sequenceDurationSeconds(seq);
    var invoked = AutoCut._invokeCloseGapMenu(seq);
    var after = AutoCut._sequenceDurationSeconds(seq);
    var delta = before - after;
    if (invoked) {
      method = invoked;
      closedCount += 1;
      shift += delta > 0.03 ? delta : gapDur;
      if (shift >= totalSilence * 0.75) {
        return {
          closedCount: sorted.length,
          closeMethod: method,
          removedMs: shift * 1000
        };
      }
    } else if (g === 0) {
      throw new Error(
        "O Premiere não executou Sequence > Close Gap internamente. Clique uma vez na Timeline e tente de novo."
      );
    } else {
      shift += gapDur;
    }
  }
  return {
    closedCount: closedCount,
    closeMethod: method || "Sequence > Close Gap",
    removedMs: shift * 1000
  };
};

AutoCut._closeGapOnQeTrack = function (qeTrack, startSec, endSec) {
  if (!qeTrack || typeof qeTrack.numItems !== "number") {
    return 0;
  }
  var closed = 0;
  var i;
  for (i = qeTrack.numItems - 1; i >= 0; i -= 1) {
    var item = qeTrack.getItemAt(i);
    if (!item) {
      continue;
    }
    var type = "";
    try {
      type = String(item.type);
    } catch (eType) {}
    if (type === "Clip") {
      continue;
    }
    var start = 0;
    var end = 0;
    try {
      start = item.start.secs !== undefined ? Number(item.start.secs) : AutoCut._secondsFromTime(item.start);
      end = item.end.secs !== undefined ? Number(item.end.secs) : AutoCut._secondsFromTime(item.end);
    } catch (eTime) {
      continue;
    }
    if (!(start < endSec - AutoCut.EPS_SECONDS && end > startSec + AutoCut.EPS_SECONDS)) {
      continue;
    }
    try {
      if (AutoCut._hasFn(item, "rippleDelete")) {
        item.rippleDelete();
        closed += 1;
      } else if (AutoCut._hasFn(item, "remove")) {
        try {
          item.remove(1, 1);
        } catch (eRm) {
          item.remove();
        }
        closed += 1;
      }
    } catch (eClose) {}
  }
  return closed;
};

AutoCut._closeGapOnDomTrack = function (track, startSec, endSec) {
  if (!track) {
    return 0;
  }
  var pieces = [];
  var clips = track.clips;
  var n = AutoCut._collectionCount(clips, ["numItems", "length"]);
  var i;
  for (i = 0; i < n; i += 1) {
    var clip = AutoCut._itemAt(clips, i);
    if (!clip) {
      continue;
    }
    var isGap = false;
    try {
      isGap = !!(clip.isGap && clip.isGap());
    } catch (eGap) {}
    if (!isGap) {
      continue;
    }
    if (AutoCut._clipInRange(clip, startSec, endSec)) {
      pieces.push(clip);
    }
  }
  for (i = pieces.length - 1; i >= 0; i -= 1) {
    try {
      AutoCut._removeClip(pieces[i], true);
    } catch (eRm) {}
  }
  return pieces.length;
};

AutoCut._setClipStart = function (clip, seconds) {
  if (seconds < 0) {
    seconds = 0;
  }
  try {
    clip.start = AutoCut._ticksFromSeconds(seconds);
    return;
  } catch (eTicks) {}
  try {
    var t = new Time();
    t.seconds = seconds;
    clip.start = t;
    return;
  } catch (eTime) {}
  if (AutoCut._hasFn(clip, "move")) {
    var current = AutoCut._secondsFromTime(clip.start);
    clip.move(seconds - current);
  }
};

AutoCut._gapOverlapsIntervals = function (gapStart, gapEnd, intervals) {
  if (!intervals || !intervals.length) {
    return true;
  }
  var i;
  for (i = 0; i < intervals.length; i += 1) {
    var start = Number(intervals[i][0]) / 1000;
    var end = Number(intervals[i][1]) / 1000;
    if (gapStart < end - 0.001 && gapEnd > start + 0.001) {
      return true;
    }
  }
  return false;
};

AutoCut._packTrackGaps = function (track, intervals) {
  if (!track) {
    return 0;
  }
  try {
    if (track.isLocked && track.isLocked()) {
      return 0;
    }
  } catch (eLock) {}
  var list = [];
  var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
  var i;
  for (i = 0; i < n; i += 1) {
    var clip = AutoCut._itemAt(track.clips, i);
    if (!clip) {
      continue;
    }
    var isGap = false;
    try {
      isGap = !!(clip.isGap && clip.isGap());
    } catch (eGap) {}
    if (isGap) {
      continue;
    }
    var start = AutoCut._secondsFromTime(clip.start);
    var end = AutoCut._secondsFromTime(clip.end);
    if (!(end > start)) {
      continue;
    }
    list.push({
      clip: clip,
      start: start,
      end: end,
      duration: end - start
    });
  }
  list.sort(function (a, b) {
    return a.start - b.start;
  });
  if (!list.length) {
    return 0;
  }

  var gaps = [];
  for (i = 0; i < list.length - 1; i += 1) {
    var gapStart = list[i].end;
    var gapEnd = list[i + 1].start;
    if (gapEnd - gapStart > 0.001) {
      gaps.push([gapStart, gapEnd]);
    }
  }

  var moved = 0;
  var g;
  for (g = gaps.length - 1; g >= 0; g -= 1) {
    var amount = gaps[g][1] - gaps[g][0];
    var after = gaps[g][1];
    if (amount <= 0.001) {
      continue;
    }
    for (i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].start >= after - 0.001) {
        AutoCut._setClipStart(list[i].clip, list[i].start - amount);
        list[i].start -= amount;
        list[i].end -= amount;
        moved += 1;
      }
    }
  }
  return moved;
};

AutoCut._closeGapsOnSequence = function (seq, intervals) {
  var moved = 0;
  AutoCut._forEachTrack(seq, function (track) {
    moved += AutoCut._packTrackGaps(track, intervals);
  });
  return moved;
};

AutoCut._shiftClipsAfter = function (seq, fromSec, deltaSec) {
  var toMove = [];
  AutoCut._forEachTrack(seq, function (track, kind, index) {
    var clips = track.clips;
    var i;
    for (i = 0; i < clips.numItems; i += 1) {
      var clip = clips[i];
      var start = AutoCut._secondsFromTime(clip.start);
      if (start >= fromSec - AutoCut.EPS_SECONDS) {
        toMove.push({ clip: clip, start: start, kind: kind, trackIndex: index });
      }
    }
  });
  toMove.sort(function (a, b) {
    return a.start - b.start;
  });
  var i;
  for (i = 0; i < toMove.length; i += 1) {
    var item = toMove[i];
    var newStart = item.start - deltaSec;
    if (newStart < 0) {
      newStart = 0;
    }
    if (AutoCut._hasFn(item.clip, "move")) {
      try {
        item.clip.move(-deltaSec);
        continue;
      } catch (e1) {}
    }
    try {
      item.clip.start = AutoCut._ticksFromSeconds(newStart);
    } catch (e2) {
      var t = new Time();
      t.seconds = newStart;
      item.clip.start = t;
    }
  }
};

AutoCut._listMethodNames = function (obj) {
  var names = [];
  try {
    if (obj && obj.reflect && obj.reflect.methods) {
      var i;
      for (i = 0; i < obj.reflect.methods.length; i += 1) {
        names.push(String(obj.reflect.methods[i].name));
      }
    }
  } catch (e) {}
  return names;
};

AutoCut.getHostInfo = function () {
  return AutoCut._wrap(function () {
    var version = "";
    try {
      version = String(app.version);
    } catch (e) {}
    var seq = null;
    try {
      seq = app.project.activeSequence;
    } catch (e2) {}
    return AutoCut._ok({
      appVersion: version,
      hasActiveSequence: !!seq,
      qeAvailable: (function () {
        try {
          AutoCut._enableQE();
          return true;
        } catch (e3) {
          return false;
        }
      })()
    });
  });
};

AutoCut.ping = function () {
  return "{\"ok\":true,\"data\":{\"pong\":true}}";
};

AutoCut._contextData = function () {
  if (!app.project) {
    throw new Error("Nenhum projeto aberto no Premiere.");
  }
  var sequences = AutoCut._listSequences();
  var seq = null;
  try {
    seq = app.project.activeSequence;
  } catch (eActive) {}
  var playerSeconds = 0;
  var durationSeconds = 0;
  var tracks = [];
  var videoTrackCount = 0;
  var sequenceId = null;
  var sequenceName = null;
  if (seq) {
    sequenceId = String(seq.sequenceID);
    sequenceName = String(seq.name);
    tracks = AutoCut._audioTracksInfo(seq);
    videoTrackCount = AutoCut._collectionCount(seq.videoTracks, ["numTracks", "numItems", "length"]);
    try {
      playerSeconds = AutoCut._secondsFromTime(seq.getPlayerPosition());
    } catch (ePos) {}
    try {
      durationSeconds = AutoCut._sequenceDurationSeconds(seq);
    } catch (eDur) {}
  }
  var version = "";
  try {
    version = String(app.version);
  } catch (eVer) {}
  return {
    sequenceId: sequenceId,
    sequenceName: sequenceName,
    sequences: sequences,
    durationSeconds: durationSeconds,
    playerSeconds: playerSeconds,
    audioTracks: tracks,
    videoTrackCount: videoTrackCount,
    appVersion: version,
    hasActiveSequence: !!seq
  };
};

AutoCut.getContext = function () {
  return AutoCut._wrap(function () {
    return AutoCut._ok(AutoCut._contextData());
  });
};

AutoCut.setActiveSequence = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var seq = AutoCut._findSequenceById(args.sequenceId);
    if (!seq) {
      throw new Error("Sequência não encontrada no projeto.");
    }
    AutoCut._activateSequence(seq);
    var ctx = AutoCut._contextData();
    if (!ctx.sequenceId) {
      throw new Error("A sequência foi encontrada, mas o Premiere não a ativou.");
    }
    return AutoCut._ok(ctx);
  });
};

AutoCut.getPlayerPosition = function () {
  return AutoCut._wrap(function () {
    var seq = null;
    try {
      seq = app.project && app.project.activeSequence;
    } catch (e) {}
    if (!seq) {
      return AutoCut._ok({
        sequenceId: null,
        playerSeconds: 0,
        durationSeconds: 0
      });
    }
    return AutoCut._ok({
      sequenceId: String(seq.sequenceID),
      playerSeconds: AutoCut._secondsFromTime(seq.getPlayerPosition()),
      durationSeconds: AutoCut._sequenceDurationSeconds(seq)
    });
  });
};

AutoCut.setPlayerPosition = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var seq = AutoCut._activeSequence();
    var seconds = Number(args.seconds);
    if (isNaN(seconds) || seconds < 0) {
      seconds = 0;
    }
    seq.setPlayerPosition(AutoCut._ticksFromSeconds(seconds));
    return AutoCut._ok({ playerSeconds: seconds });
  });
};

AutoCut.focusTimeline = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var working = AutoCut._findSequenceById(args.sequenceId) || AutoCut._activeSequence();
    if (working) {
      AutoCut._activateSequence(working);
    }
    return AutoCut._ok({ focused: true, sequenceId: working ? String(working.sequenceID) : "" });
  });
};

AutoCut._setTrackMute = function (track, muted) {
  if (AutoCut._hasFn(track, "setMute")) {
    track.setMute(muted ? 1 : 0);
    return;
  }
  throw new Error("track.setMute() indisponível.");
};

AutoCut._isolateAudioTrack = function (seq, trackIndex) {
  var snapshot = [];
  var i;
  for (i = 0; i < seq.audioTracks.numTracks; i += 1) {
    var track = seq.audioTracks[i];
    var wasMuted = !!(track.isMuted && track.isMuted());
    snapshot.push({ index: i, muted: wasMuted });
    AutoCut._setTrackMute(track, i !== trackIndex);
  }
  try {
    AutoCut._enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (qeSeq && AutoCut._hasFn(qeSeq, "getAudioTrackAt")) {
      for (i = 0; i < seq.audioTracks.numTracks; i += 1) {
        var qeTrack = qeSeq.getAudioTrackAt(i);
        if (qeTrack && AutoCut._hasFn(qeTrack, "setSolo")) {
          try {
            qeTrack.setSolo(i === trackIndex);
          } catch (eSolo) {}
        }
      }
    }
  } catch (eQe) {}
  return snapshot;
};

AutoCut._unmuteAllAudioTracks = function (seq) {
  var snapshot = [];
  var i;
  for (i = 0; i < seq.audioTracks.numTracks; i += 1) {
    var track = seq.audioTracks[i];
    var wasMuted = !!(track.isMuted && track.isMuted());
    snapshot.push({ index: i, muted: wasMuted });
    AutoCut._setTrackMute(track, false);
  }
  try {
    AutoCut._enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (qeSeq && AutoCut._hasFn(qeSeq, "getAudioTrackAt")) {
      for (i = 0; i < seq.audioTracks.numTracks; i += 1) {
        var qeTrack = qeSeq.getAudioTrackAt(i);
        if (qeTrack && AutoCut._hasFn(qeTrack, "setSolo")) {
          try {
            qeTrack.setSolo(false);
          } catch (eSolo) {}
        }
      }
    }
  } catch (eQe) {}
  return snapshot;
};

AutoCut._restoreAudioMutes = function (seq, snapshot) {
  var i;
  for (i = 0; i < snapshot.length; i += 1) {
    try {
      AutoCut._setTrackMute(seq.audioTracks[snapshot[i].index], snapshot[i].muted);
    } catch (e) {}
  }
  try {
    AutoCut._enableQE();
    var qeSeq = qe.project.getActiveSequence();
    for (i = 0; i < seq.audioTracks.numTracks; i += 1) {
      var qeTrack = qeSeq.getAudioTrackAt(i);
      if (qeTrack && AutoCut._hasFn(qeTrack, "setSolo")) {
        try {
          qeTrack.setSolo(false);
        } catch (eSolo) {}
      }
    }
  } catch (eQe) {}
};

AutoCut._resolvePresetPath = function (preferred) {
  var candidates = [];
  if (preferred) {
    candidates.push(preferred);
  }
  var appRoot = Folder.appPackage && Folder.appPackage.parent ? Folder.appPackage.parent.fsName : "";
  if (appRoot) {
    candidates.push(appRoot + "/MediaIO/systempresets/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr");
  }
  candidates.push("/Applications/Adobe Media Encoder 2026/Adobe Media Encoder 2026.app/Contents/MediaIO/systempresets/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr");
  candidates.push("/Applications/Adobe Premiere Pro 2026/Adobe Premiere Pro 2026.app/Contents/MediaIO/systempresets/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr");

  var i;
  for (i = 0; i < candidates.length; i += 1) {
    var f = new File(candidates[i]);
    if (f.exists) {
      return f.fsName;
    }
  }
  throw new Error("Preset WAV (.epr) não encontrado. Confira presets/audio-export.epr na extensão.");
};

AutoCut._nativeFsPath = function (value) {
  var file = new File(value);
  return file.fsName;
};

AutoCut._removeFileIfExists = function (path) {
  var file = new File(path);
  if (!file.exists) {
    return true;
  }
  try {
    file.remove();
  } catch (eRm) {}
  return !file.exists;
};

AutoCut._tempRefWavPath = function () {
  var dir = Folder.temp;
  if (!dir) {
    throw new Error("Pasta temporária do sistema indisponível.");
  }
  var i;
  for (i = 0; i < 8; i += 1) {
    var name = "autocut-ref-" + Date.now() + (i ? "-" + i : "") + ".wav";
    var outFile = new File(dir.absoluteURI + "/" + name);
    AutoCut._removeFileIfExists(outFile.fsName);
    if (!outFile.exists) {
      return outFile.fsName;
    }
  }
  throw new Error("Não foi possível criar um arquivo WAV temporário.");
};

AutoCut.exportReferenceTrack = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var seq = AutoCut._activeSequence();
    var trackIndex = Number(args.trackIndex);
    var mixAll = trackIndex === -1;
    var trackCount = AutoCut._collectionCount(seq.audioTracks, ["numTracks", "numItems", "length"]);
    if (!mixAll && (isNaN(trackIndex) || trackIndex < 0 || trackIndex >= trackCount)) {
      throw new Error("Faixa de áudio de referência inválida.");
    }
    if (!trackCount) {
      throw new Error("Esta sequência não tem faixas de áudio.");
    }
    var outputPath = args.outputPath;
    if (!outputPath) {
      outputPath = AutoCut._tempRefWavPath();
    } else {
      outputPath = AutoCut._nativeFsPath(outputPath);
      AutoCut._removeFileIfExists(outputPath);
    }
    var presetPath = AutoCut._resolvePresetPath(args.presetPath);
    var snapshot = mixAll
      ? AutoCut._unmuteAllAudioTracks(seq)
      : AutoCut._isolateAudioTrack(seq, trackIndex);
    var result = null;
    try {
      var workArea = 0;
      try {
        if (app.encoder && app.encoder.ENCODE_ENTIRE !== undefined) {
          workArea = app.encoder.ENCODE_ENTIRE;
        }
      } catch (eEnc) {}
      result = seq.exportAsMediaDirect(outputPath, presetPath, workArea);
    } finally {
      AutoCut._restoreAudioMutes(seq, snapshot);
    }
    var outFile = new File(outputPath);
    if (!outFile.exists) {
      throw new Error("A exportação da faixa de referência não gerou o WAV. Resultado: " + String(result));
    }
    return AutoCut._ok({
      outputPath: outputPath,
      byteSize: outFile.length,
      presetPath: presetPath
    });
  });
};

AutoCut._duplicateViaClone = function (seq, backupName) {
  if (!AutoCut._hasFn(seq, "clone")) {
    return null;
  }
  var originalId = seq.sequenceID;
  var idsBefore = {};
  var i;
  for (i = 0; i < app.project.sequences.numSequences; i += 1) {
    idsBefore[app.project.sequences[i].sequenceID] = true;
  }
  seq.clone();
  var cloneSeq = null;
  for (i = 0; i < app.project.sequences.numSequences; i += 1) {
    var candidate = app.project.sequences[i];
    if (candidate.sequenceID !== originalId && !idsBefore[candidate.sequenceID]) {
      cloneSeq = candidate;
      break;
    }
  }
  if (!cloneSeq) {
    for (i = 0; i < app.project.sequences.numSequences; i += 1) {
      var maybe = app.project.sequences[i];
      if (maybe.sequenceID !== originalId && String(maybe.name).indexOf(seq.name) !== -1) {
        cloneSeq = maybe;
      }
    }
  }
  if (!cloneSeq) {
    return null;
  }
  AutoCut._renameSequence(cloneSeq, backupName);
  AutoCut._activateSequence(AutoCut._findSequenceById(originalId) || seq);
  return AutoCut._findSequenceById(cloneSeq.sequenceID) || cloneSeq;
};

AutoCut._duplicateViaMenu = function (seq, backupName) {
  if (!AutoCut._hasFn(app, "findMenuCommandId") || !AutoCut._hasFn(app, "executeCommand")) {
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
  var idsBefore = {};
  var i;
  for (i = 0; i < app.project.sequences.numSequences; i += 1) {
    idsBefore[app.project.sequences[i].sequenceID] = true;
  }
  var item = AutoCut._projectItemForSequence(seq);
  if (item && AutoCut._hasFn(item, "select")) {
    try {
      app.project.rootItem.select ? null : null;
      item.setSelected(true, true);
    } catch (eSel) {}
  }
  app.executeCommand(commandId);
  var cloneSeq = null;
  for (i = 0; i < app.project.sequences.numSequences; i += 1) {
    var candidate = app.project.sequences[i];
    if (!idsBefore[candidate.sequenceID]) {
      cloneSeq = candidate;
      break;
    }
  }
  if (!cloneSeq) {
    return null;
  }
  AutoCut._renameSequence(cloneSeq, backupName);
  AutoCut._activateSequence(AutoCut._findSequenceById(originalId) || seq);
  return cloneSeq;
};

AutoCut._duplicateViaQE = function (seq, backupName) {
  AutoCut._enableQE();
  var qeProject = qe.project;
  var methods = AutoCut._listMethodNames(qeProject);
  var qeSeq = qe.project.getActiveSequence();
  var seqMethods = AutoCut._listMethodNames(qeSeq);
  var originalId = seq.sequenceID;
  var idsBefore = {};
  var i;
  for (i = 0; i < app.project.sequences.numSequences; i += 1) {
    idsBefore[app.project.sequences[i].sequenceID] = true;
  }
  var invoked = false;
  var names = ["clone", "duplicate", "duplicateSequence", "copySequence"];
  for (i = 0; i < names.length; i += 1) {
    if (AutoCut._hasFn(qeSeq, names[i])) {
      try {
        qeSeq[names[i]]();
        invoked = true;
        break;
      } catch (e1) {}
    }
    if (AutoCut._hasFn(qeProject, names[i])) {
      try {
        qeProject[names[i]]();
        invoked = true;
        break;
      } catch (e2) {}
    }
  }
  if (!invoked) {
    return {
      seq: null,
      probed: { project: methods, sequence: seqMethods }
    };
  }
  var cloneSeq = null;
  for (i = 0; i < app.project.sequences.numSequences; i += 1) {
    var candidate = app.project.sequences[i];
    if (!idsBefore[candidate.sequenceID]) {
      cloneSeq = candidate;
      break;
    }
  }
  if (cloneSeq) {
    AutoCut._renameSequence(cloneSeq, backupName);
    AutoCut._activateSequence(AutoCut._findSequenceById(originalId) || seq);
  }
  return { seq: cloneSeq, probed: { project: methods, sequence: seqMethods } };
};

AutoCut._duplicateManual = function (seq, backupName) {
  var newSeq = null;
  if (AutoCut._hasFn(app.project, "createNewSequence")) {
    try {
      newSeq = app.project.createNewSequence(backupName);
    } catch (e1) {}
  }
  if (!newSeq) {
    throw new Error("createNewSequence não está disponível para o fallback manual de backup.");
  }
  AutoCut._renameSequence(newSeq, backupName);
  AutoCut._forEachTrack(seq, function (track, kind, trackIndex) {
    var clips = track.clips;
    var i;
    for (i = 0; i < clips.numItems; i += 1) {
      var clip = clips[i];
      if (!clip.projectItem) {
        continue;
      }
      var startTicks = clip.start.ticks || AutoCut._ticksFromSeconds(AutoCut._secondsFromTime(clip.start));
      try {
        if (kind === "video") {
          newSeq.overwriteClip(clip.projectItem, startTicks, trackIndex, -1);
        } else {
          newSeq.overwriteClip(clip.projectItem, startTicks, -1, trackIndex);
        }
      } catch (eIns) {
        try {
          if (kind === "video") {
            newSeq.videoTracks[trackIndex].overwriteClip(clip.projectItem, AutoCut._secondsFromTime(clip.start));
          } else {
            newSeq.audioTracks[trackIndex].overwriteClip(clip.projectItem, AutoCut._secondsFromTime(clip.start));
          }
        } catch (e2) {}
      }
    }
  });
  AutoCut._activateSequence(seq);
  return newSeq;
};

AutoCut.duplicateActiveSequence = function () {
  return AutoCut._wrap(function () {
    var hostT0 = AutoCut._perfOn() ? AutoCut._perfNowUs() : 0;
    var backupToken = AutoCut._perfOn() ? AutoCut._perfEnter("backup", "", { inclusive: 1 }) : null;
    var seq = AutoCut._activeSequence();
    var backupName = seq.name + " - Backup";
    var strategy = "";
    var cloneSeq = AutoCut._duplicateViaClone(seq, backupName);
    if (cloneSeq) {
      strategy = "sequence.clone";
    }
    var qeProbe = null;
    if (!cloneSeq) {
      qeProbe = AutoCut._duplicateViaQE(seq, backupName);
      cloneSeq = qeProbe.seq;
      if (cloneSeq) {
        strategy = "qe-duplicate";
      }
    }
    if (!cloneSeq) {
      cloneSeq = AutoCut._duplicateViaMenu(seq, backupName);
      if (cloneSeq) {
        strategy = "executeCommand-Duplicate";
      }
    }
    if (!cloneSeq) {
      cloneSeq = AutoCut._duplicateManual(seq, backupName);
      if (cloneSeq) {
        strategy = "manual-rebuild";
      }
    }
    if (!cloneSeq) {
      throw new Error("Não foi possível duplicar a sequência para backup. Cortes abortados.");
    }
    var confirmed = AutoCut._findSequenceById(cloneSeq.sequenceID);
    if (!confirmed) {
      throw new Error("O backup não pôde ser confirmado no projeto. Cortes abortados.");
    }
    var original = AutoCut._findSequenceById(seq.sequenceID) || seq;
    AutoCut._activateSequence(original);
    AutoCut._closeSequenceTab(confirmed);
    AutoCut._activateSequence(original);
    if (backupToken) {
      AutoCut._perfExit(backupToken, strategy || "ok", { inclusive: 1 });
    }
    return AutoCut._perfFinishData(hostT0, {
      backupName: confirmed.name,
      backupSequenceId: confirmed.sequenceID,
      originalSequenceId: original.sequenceID,
      strategy: strategy,
      qeProbe: qeProbe
    });
  });
};

AutoCut.applyCuts = function (jsonStr) {
  return AutoCut._wrap(function () {
    var hostT0 = AutoCut._perfOn() ? AutoCut._perfNowUs() : 0;
    var args = AutoCut._parse(jsonStr);
    var seq = AutoCut._assertActiveSequence(args.sequenceId);
    var mode = args.mode || "lift";
    var phase = args.phase || "cut";
    var intervals = args.intervals || [];
    var timesSeconds = args.timesSeconds || [];
    var razorCount = 0;
    var removedCount = 0;
    var closedCount = 0;
    var removedMs = 0;
    var closeMethod = "";
    var i;

    if (phase === "razorTimes") {
      timesSeconds = timesSeconds.slice().sort(function (a, b) {
        return Number(b) - Number(a);
      });
      razorCount = AutoCut._razorTimesFast(seq, timesSeconds);
      return AutoCut._perfFinishData(hostT0, {
        phase: phase,
        razorCount: razorCount,
        durationSeconds: AutoCut._sequenceDurationSeconds(seq)
      });
    }

    intervals = intervals.slice().sort(function (a, b) {
      return Number(b[0]) - Number(a[0]);
    });
    if (!intervals.length) {
      throw new Error("Nenhum intervalo de silêncio para aplicar.");
    }

    if (phase === "lift") {
      var liftResult = AutoCut._liftIntervalsFast(seq, intervals);
      return AutoCut._perfFinishData(hostT0, {
        phase: phase,
        removedClipPieces: liftResult.removedCount,
        removedMs: liftResult.removedMs,
        qeLiveScans: liftResult.qeLiveScans,
        durationSeconds: AutoCut._sequenceDurationSeconds(seq)
      });
    }

    if (phase === "closeGaps") {
      AutoCut._perfNote("closeGaps", { phase: "enter", intervals: intervals.length });
      var gapResult = AutoCut._deleteGapItemsFast(seq, intervals);
      if (!gapResult) {
        AutoCut._perfNote("closeGaps", { phase: "legacy-fallback" });
        gapResult = AutoCut._deleteGapItems(seq, intervals);
      }
      AutoCut._perfNote("snap", { phase: "enter", examined: "pending" });
      var snap = AutoCut._snapAudioStartsToVideoTicks(seq);
      return AutoCut._perfFinishData(hostT0, {
        phase: phase,
        closedCount: gapResult.closedCount,
        closeMethod: gapResult.closeMethod,
        rippleEvents: gapResult.rippleEvents || [],
        fastPath: !!gapResult.fastPath,
        fullScans: gapResult.fullScans || 0,
        snapCount: snap.snappedCount,
        lastVideoTicks: snap.lastVideoTicks,
        lastAudioTicksBefore: snap.lastAudioTicksBefore,
        lastAudioTicksAfter: snap.lastAudioTicksAfter,
        lastSnapRan: snap.lastSnapRan,
        durationSeconds: AutoCut._sequenceDurationSeconds(seq)
      });
    }

    AutoCut._enableQE();
    for (i = 0; i < intervals.length; i += 1) {
      var startMs = Number(intervals[i][0]);
      var endMs = Number(intervals[i][1]);
      if (!(endMs > startMs)) {
        continue;
      }
      var startSec = startMs / 1000;
      var endSec = endMs / 1000;
      AutoCut._razorAllTracks(seq, endSec);
      AutoCut._razorAllTracks(seq, startSec);
      razorCount += 2;
      if (mode === "razor") {
        continue;
      }
      var cutPieces = AutoCut._collectClipsInRange(seq, startSec, endSec, true);
      var c;
      for (c = 0; c < cutPieces.length; c += 1) {
        AutoCut._removeClip(cutPieces[c].clip, false);
        removedCount += 1;
      }
      removedMs += endMs - startMs;
    }
    return AutoCut._perfFinishData(hostT0, {
      mode: mode,
      intervalCount: intervals.length,
      razorCount: razorCount,
      removedClipPieces: removedCount,
      removedMs: mode === "razor" ? 0 : removedMs,
      durationSeconds: AutoCut._sequenceDurationSeconds(seq)
    });
  });
};

AutoCut.restoreBackup = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var backup = AutoCut._findSequenceById(args.backupSequenceId);
    if (!backup) {
      throw new Error("A sequência de backup não foi encontrada. Desfazer abortado.");
    }
    var working = AutoCut._findSequenceById(args.workingSequenceId);
    var originalName = args.originalName || String(backup.name).replace(/ - Backup$/, "");

    AutoCut._activateSequence(backup);
    if (working && String(working.sequenceID) !== String(backup.sequenceID)) {
      try {
        if (AutoCut._hasFn(app.project, "deleteSequence")) {
          app.project.deleteSequence(working);
        } else {
          var item = AutoCut._projectItemForSequence(working);
          if (item && AutoCut._hasFn(item, "remove")) {
            item.remove(false, true);
          } else {
            throw new Error("deleteSequence indisponível.");
          }
        }
      } catch (eDel) {
        throw new Error("Não foi possível apagar a sequência em edição: " + eDel.toString());
      }
    }
    AutoCut._renameSequence(backup, originalName);
    var restored = AutoCut._findSequenceById(backup.sequenceID) || backup;
    AutoCut._activateSequence(restored);
    return AutoCut._ok({
      restoredName: restored.name,
      restoredSequenceId: restored.sequenceID
    });
  });
};

AutoCut._relinkOne = function (sequence, listed, index, opts) {
  // opts.quietUi: select/deselect without forcing a UI refresh (updateUI=false).
  // opts.finalUi: this is the last pair of the batch -> refresh the UI on deselect.
  // opts.probe: log (diagnostic only) whether the pair was already linked.
  var quiet = !!(opts && opts.quietUi);
  var finalUi = !quiet || !!(opts && opts.finalUi);
  if (!(index >= 0) || index >= listed.videos.length || index >= listed.audios.length) {
    return ({
      ok: false,
      index: index,
      pairCount: listed.pairCount,
      videoCount: listed.videoCount,
      audioCount: listed.audioCount,
      command: "sequence.linkSelection",
      commandOk: false,
      selectedCount: 0,
      error: "índice fora da lista"
    });
  }
  var videoClip = listed.videos[index];
  var audioClip = listed.audios[index];
  var videoStartBefore = AutoCut._itemStartSeconds(videoClip);
  var audioStartBefore = AutoCut._itemStartSeconds(audioClip);

  if (opts && opts.probe) {
    var tProbe = AutoCut._fastClock();
    var already = false;
    try {
      already = !!(videoClip.getLinkedItems && AutoCut._collectionHasClip(videoClip.getLinkedItems(), audioClip));
    } catch (eProbe) {}
    AutoCut._perfAdd("fast.relink.probed", 1);
    if (already) {
      AutoCut._perfAdd("fast.relink.alreadyLinked", 1);
    }
    AutoCut._fastAddMs("fast.relink.probeMs", tProbe);
  }
  var tSel = AutoCut._fastClock();
  AutoCut._deselectGetSelection(sequence);
  try {
    videoClip.setSelected(true, !quiet);
  } catch (eVid) {}
  try {
    audioClip.setSelected(true, !quiet);
  } catch (eAud) {}

  var selectedCount = AutoCut._selectionCount(sequence);
  if (quiet && selectedCount < 2) {
    // Quiet selection did not register: redo it exactly like the original.
    AutoCut._perfAdd("fast.relink.quietFallback", 1);
    quiet = false;
    finalUi = true;
    AutoCut._deselectGetSelection(sequence);
    try {
      videoClip.setSelected(true, true);
    } catch (eVid2) {}
    try {
      audioClip.setSelected(true, true);
    } catch (eAud2) {}
    selectedCount = AutoCut._selectionCount(sequence);
  }
  AutoCut._fastAddMs("fast.relink.selectMs", tSel);
  var tLink = AutoCut._fastClock();
  var commandOk = false;
  var error = "";
  try {
    commandOk = sequence.linkSelection() !== false;
    if (!commandOk) {
      error = "linkSelection retornou false";
    }
  } catch (eLink) {
    error = String(eLink);
  }

  AutoCut._fastAddMs("fast.relink.linkMs", tLink);
  var videoStartAfter = AutoCut._itemStartSeconds(videoClip);
  var audioStartAfter = AutoCut._itemStartSeconds(audioClip);
  var startShifted =
    Math.abs(videoStartAfter - videoStartBefore) > 0.001 ||
    Math.abs(audioStartAfter - audioStartBefore) > 0.001;

  var linked = commandOk || AutoCut._pairReportsLinked(videoClip, audioClip);
  var tDes = AutoCut._fastClock();
  try {
    videoClip.setSelected(false, finalUi);
  } catch (eOffV) {}
  try {
    audioClip.setSelected(false, finalUi);
  } catch (eOffA) {}
  AutoCut._fastAddMs("fast.relink.deselectMs", tDes);

  if (linked) {
    error = "";
  } else if (!error) {
    if (selectedCount < 2) {
      error = "seleção: " + selectedCount + " (precisa 2)";
    } else {
      error = "clipes não ficaram vinculados";
    }
  }
  return ({
    ok: Boolean(linked),
    index: index,
    pairCount: listed.pairCount,
    videoCount: listed.videoCount,
    audioCount: listed.audioCount,
    command: "sequence.linkSelection",
    commandOk: Boolean(commandOk),
    selectedCount: selectedCount,
    error: error,
    startShifted: startShifted,
    videoStartBefore: videoStartBefore,
    audioStartBefore: audioStartBefore,
    videoStartAfter: videoStartAfter,
    audioStartAfter: audioStartAfter
  });
};


/* ==========================================================================
 * Fast paths.
 *
 * The legacy implementation re-scanned every clip of every track (DOM + QE)
 * once or more PER SILENCE, and re-listed every clip PER RELINKED PAIR.
 * With N silences the timeline has ~2N clips per track, so the total work was
 * O(N^2) ExtendScript DOM reads — fine for 18 cuts, hours for 450.
 *
 * The functions below perform exactly the same Premiere operations, on the
 * same items, in the same order, but read the timeline once per batch and
 * keep plain-number snapshots in memory. Wherever the snapshot could be out
 * of date, the live timeline is re-checked and, on any mismatch, the legacy
 * full scan is used for that step.
 * ========================================================================== */

AutoCut._sortByKey = function (list, keyFn) {
  var i;
  var wrapped = [];
  for (i = 0; i < list.length; i += 1) {
    wrapped.push({ item: list[i], key: keyFn(list[i]) });
  }
  wrapped.sort(function (a, b) {
    return a.key - b.key;
  });
  var out = [];
  for (i = 0; i < wrapped.length; i += 1) {
    out.push(wrapped[i].item);
  }
  return out;
};

AutoCut._timeTicksString = function (time) {
  try {
    if (time && time.ticks !== undefined && time.ticks !== null && String(time.ticks) !== "") {
      return String(time.ticks);
    }
  } catch (e) {}
  return "";
};

AutoCut._fastNote = function (op, extra) {
  if (!AutoCut._perfOn()) {
    return;
  }
  var fields = {};
  var key;
  try {
    var counters = AutoCut._perf.counters || {};
    for (key in counters) {
      if (counters.hasOwnProperty(key) && key.indexOf("fast.") === 0) {
        fields[key] = typeof counters[key] === "number" && counters[key] % 1 ? counters[key].toFixed(1) : counters[key];
      }
    }
  } catch (eC) {}
  if (extra) {
    for (key in extra) {
      if (extra.hasOwnProperty(key)) {
        fields[key] = extra[key];
      }
    }
  }
  AutoCut._perfNote(op, fields);
};

AutoCut._fastClock = function () {
  return AutoCut._perfOn() ? AutoCut._perfNowUs() : 0;
};

AutoCut._fastAddMs = function (name, t0) {
  if (!AutoCut._perfOn()) {
    return;
  }
  var d = AutoCut._perfNowUs() - t0;
  if (d > 0) {
    AutoCut._perfAdd(name, d / 1000);
  }
};

/* ---------- razor ------------------------------------------------------- */

AutoCut._razorTimesFast = function (seq, timesSeconds) {
  AutoCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    throw new Error("Não foi possível obter a sequência ativa no QE DOM.");
  }
  var settings = null;
  try {
    settings = seq.getSettings();
  } catch (eSet) {}
  var displayFormat = null;
  try {
    displayFormat = seq.videoDisplayFormat;
  } catch (eFmt) {}
  var vCount = AutoCut._qeTrackCount(qeSeq, "video");
  var aCount = AutoCut._qeTrackCount(qeSeq, "audio");
  // Clip coverage per track (razor does not change coverage, only splits).
  var tSnap = AutoCut._fastClock();
  var cover = { video: [], audio: [] };
  AutoCut._forEachTrack(seq, function (track, kind, index) {
    var spans = [];
    var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
    var c;
    for (c = 0; c < n; c += 1) {
      var clip = AutoCut._itemAt(track.clips, c);
      if (!clip) {
        continue;
      }
      spans.push([AutoCut._secondsFromTime(clip.start), AutoCut._secondsFromTime(clip.end)]);
    }
    cover[kind][index] = spans;
  });
  AutoCut._fastAddMs("fast.razor.snapshotMs", tSnap);
  function covered(kind, index, sec) {
    var spans = cover[kind][index];
    if (!spans) {
      return true; // unknown -> razor, like the original
    }
    var z;
    for (z = 0; z < spans.length; z += 1) {
      if (spans[z][0] < sec + 0.05 && spans[z][1] > sec - 0.05) {
        return true;
      }
    }
    return false;
  }
  var ordered = timesSeconds.slice().sort(function (a, b) {
    return Number(a) - Number(b);
  });
  var count = 0;
  var k;
  for (k = 0; k < ordered.length; k += 1) {
    var seconds = Number(ordered[k]);
    var arg = null;
    try {
      var t = new Time();
      t.seconds = seconds;
      if (t.getFormatted && settings && settings.videoFrameRate) {
        arg = t.getFormatted(settings.videoFrameRate, displayFormat);
      }
    } catch (eArg) {
      arg = null;
    }
    var ticks = AutoCut._ticksFromSeconds(seconds);
    if (arg === null) {
      arg = ticks;
    }
    var i;
    var tr;
    for (i = 0; i < vCount; i += 1) {
      if (!covered("video", i, seconds)) {
        AutoCut._perfAdd("fast.razor.skippedEmpty", 1);
        continue;
      }
      tr = AutoCut._fastClock();
      AutoCut._razorTrack(qeSeq.getVideoTrackAt(i), arg, ticks);
      AutoCut._fastAddMs("fast.razor.videoMs", tr);
      AutoCut._perfAdd("fast.razor.videoCalls", 1);
    }
    for (i = 0; i < aCount; i += 1) {
      if (!covered("audio", i, seconds)) {
        AutoCut._perfAdd("fast.razor.skippedEmpty", 1);
        continue;
      }
      tr = AutoCut._fastClock();
      AutoCut._razorTrack(qeSeq.getAudioTrackAt(i), arg, ticks);
      AutoCut._fastAddMs("fast.razor.audioMs", tr);
      AutoCut._perfAdd("fast.razor.audioCalls", 1);
    }
    count += 1;
  }
  AutoCut._fastNote("fast.razor", { batchTimes: ordered.length });
  return count;
};

/* ---------- lift -------------------------------------------------------- */

AutoCut._snapshotDomClips = function (seq) {
  var entries = [];
  AutoCut._forEachTrack(seq, function (track, kind, index) {
    if (!track) {
      return;
    }
    var clips = track.clips;
    var n = AutoCut._collectionCount(clips, ["numItems", "length"]);
    var i;
    for (i = 0; i < n; i += 1) {
      var clip = AutoCut._itemAt(clips, i);
      if (!clip || AutoCut._isGapItem(clip)) {
        continue;
      }
      entries.push({
        clip: clip,
        kind: kind,
        trackIndex: index,
        start: AutoCut._secondsFromTime(clip.start),
        end: AutoCut._secondsFromTime(clip.end),
        track: kind + "|" + index,
        removed: false
      });
    }
  });
  return entries;
};

AutoCut._snapshotQeClips = function (qeSeq) {
  var list = [];
  function walk(kind, getTrack, count) {
    var t;
    for (t = 0; t < count; t += 1) {
      var track = getTrack(t);
      if (!track || typeof track.numItems !== "number") {
        continue;
      }
      var i;
      for (i = 0; i < track.numItems; i += 1) {
        var item = track.getItemAt(i);
        if (!item || AutoCut._isGapItem(item)) {
          continue;
        }
        list.push({
          start: AutoCut._itemStartSeconds(item),
          end: AutoCut._itemEndSeconds(item),
          track: kind + "|" + t
        });
      }
    }
  }
  walk("video", function (index) {
    return qeSeq.getVideoTrackAt(index);
  }, qeSeq.numVideoTracks || 0);
  walk("audio", function (index) {
    return qeSeq.getAudioTrackAt(index);
  }, qeSeq.numAudioTracks || 0);
  return list;
};

AutoCut._liftIntervalsFast = function (seq, intervals) {
  var slack = AutoCut.FRAME_SLACK_SECONDS;
  AutoCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  var tSnapL = AutoCut._fastClock();
  var dom = AutoCut._snapshotDomClips(seq);
  AutoCut._fastAddMs("fast.lift.domSnapshotMs", tSnapL);
  tSnapL = AutoCut._fastClock();
  var qeClips = qeSeq ? AutoCut._snapshotQeClips(qeSeq) : [];
  AutoCut._fastAddMs("fast.lift.qeSnapshotMs", tSnapL);
  var removedCount = 0;
  var removedMs = 0;
  var qeLiveScans = 0;
  var i;
  var j;
  for (i = 0; i < intervals.length; i += 1) {
    var liftStart = Number(intervals[i][0]) / 1000;
    var liftEnd = Number(intervals[i][1]) / 1000;
    if (!(liftEnd > liftStart)) {
      continue;
    }
    // Same selection as _collectClipsInRange(seq, s, e, true), from the snapshot.
    var pieces = [];
    for (j = 0; j < dom.length; j += 1) {
      var d = dom[j];
      if (d.removed) {
        continue;
      }
      if (d.start >= liftStart - slack && d.end <= liftEnd + slack) {
        pieces.push(d);
      }
    }
    pieces.sort(function (a, b) {
      return b.start - a.start;
    });
    var p;
    var tRm = AutoCut._fastClock();
    for (p = 0; p < pieces.length; p += 1) {
      AutoCut._removeClip(pieces[p].clip, false);
      pieces[p].removed = true;
      removedCount += 1;
    }
    AutoCut._fastAddMs("fast.lift.removeMs", tRm);
    AutoCut._perfAdd("fast.lift.removedPieces", pieces.length);
    if (qeSeq) {
      // Legacy code rescanned QE for leftovers the DOM pass did not remove.
      // Only do that live scan if the snapshot says such a leftover can exist.
      // Per track: how many non-gap QE items sit inside this interval vs how
      // many DOM clips inside it we have removed. Only if QE has MORE is there a
      // leftover the legacy QE pass would remove -> then run that pass live.
      var qeInside = {};
      var domInside = {};
      for (j = 0; j < qeClips.length; j += 1) {
        var q = qeClips[j];
        if (q.start >= liftStart - slack && q.end <= liftEnd + slack && q.end > q.start) {
          qeInside[q.track] = (qeInside[q.track] || 0) + 1;
        }
      }
      for (j = 0; j < dom.length; j += 1) {
        var dd = dom[j];
        if (dd.removed && dd.start >= liftStart - slack && dd.end <= liftEnd + slack) {
          domInside[dd.track] = (domInside[dd.track] || 0) + 1;
        }
      }
      var needLive = false;
      var tk;
      for (tk in qeInside) {
        if (qeInside.hasOwnProperty(tk) && qeInside[tk] > (domInside[tk] || 0)) {
          needLive = true;
          break;
        }
      }
      if (needLive) {
        qeLiveScans += 1;
        AutoCut._perfAdd("fast.lift.qeLiveScan", 1);
        var qePieces = AutoCut._collectQeClipsInside(qeSeq, liftStart, liftEnd);
        var qq;
        for (qq = 0; qq < qePieces.length; qq += 1) {
          try {
            AutoCut._removeClip(qePieces[qq], false);
            removedCount += 1;
          } catch (eQeLift) {}
        }
        // The DOM snapshot may now contain clips removed through QE: refresh it.
        dom = AutoCut._snapshotDomClips(seq);
        qeClips = AutoCut._snapshotQeClips(qeSeq);
      }
    }
    removedMs += Number(intervals[i][1]) - Number(intervals[i][0]);
  }
  AutoCut._fastNote("fast.lift", { batchIntervals: intervals.length });
  return { removedCount: removedCount, removedMs: removedMs, qeLiveScans: qeLiveScans };
};

/* ---------- close gaps (ripple delete) ---------------------------------- */

AutoCut._qeItemSnapshot = function (item) {
  if (!item) {
    return null;
  }
  var startTicksStr = AutoCut._timeTicksString(item.start);
  var endTicksStr = AutoCut._timeTicksString(item.end);
  return {
    isGap: AutoCut._isGapItem(item),
    start: AutoCut._itemStartSeconds(item),
    end: AutoCut._itemEndSeconds(item),
    startTicksStr: startTicksStr,
    startTicks: AutoCut._ticksValue(startTicksStr),
    endTicks: AutoCut._ticksValue(endTicksStr)
  };
};

AutoCut._deleteGapItemsFast = function (seq, intervals) {
  var slack = AutoCut.FRAME_SLACK_SECONDS;
  var slackTicks = AutoCut.TICKS_PER_SECOND * slack;
  AutoCut._enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) {
    return null;
  }

  // Legacy scan also looked at DOM clips judged as "gap" (no projectItem).
  // If any exists, keep the legacy algorithm to stay identical.
  var domGap = false;
  AutoCut._forEachTrack(seq, function (track) {
    if (domGap) {
      return;
    }
    var n = AutoCut._collectionCount(track.clips, ["numItems", "length"]);
    var c;
    for (c = 0; c < n; c += 1) {
      var clip = AutoCut._itemAt(track.clips, c);
      if (clip && AutoCut._isGapItem(clip)) {
        domGap = true;
        return;
      }
    }
  });
  if (domGap) {
    return null;
  }

  // One snapshot of every QE track, in the same order the legacy scan used.
  var tracks = [];
  var t;
  var videoCount = qeSeq.numVideoTracks || 0;
  var audioCount = qeSeq.numAudioTracks || 0;
  for (t = 0; t < videoCount; t += 1) {
    tracks.push(qeSeq.getVideoTrackAt(t));
  }
  for (t = 0; t < audioCount; t += 1) {
    tracks.push(qeSeq.getAudioTrackAt(t));
  }
  var cache = [];
  var k;
  var i;
  for (k = 0; k < tracks.length; k += 1) {
    var arr = [];
    var tr = tracks[k];
    if (tr && typeof tr.numItems === "number") {
      for (i = 0; i < tr.numItems; i += 1) {
        var snap = AutoCut._qeItemSnapshot(tr.getItemAt(i));
        if (!snap) {
          return null;
        }
        arr.push(snap);
      }
    }
    cache.push(arr);
  }

  // overlapsSilence(), exact, via sorted intervals + prefix max.
  var ivs = [];
  for (i = 0; i < (intervals || []).length; i += 1) {
    ivs.push({
      s: Number(intervals[i][0]) / 1000 - slack,
      e: Number(intervals[i][1]) / 1000 + slack
    });
  }
  ivs.sort(function (a, b) {
    return a.s - b.s;
  });
  var prefixMaxE = [];
  for (i = 0; i < ivs.length; i += 1) {
    prefixMaxE.push(i === 0 ? ivs[i].e : Math.max(prefixMaxE[i - 1], ivs[i].e));
  }
  function overlapsSilence(start, end) {
    // count of intervals with s < end
    var lo = 0;
    var hi = ivs.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (ivs[mid].s < end) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo === 0) {
      return false;
    }
    return start < prefixMaxE[lo - 1];
  }

  // collectUniqueIntervals(), exact (bucketed duplicate lookup).
  var unique = [];
  var buckets = {};
  for (k = 0; k < cache.length; k += 1) {
    for (i = 0; i < cache[k].length; i += 1) {
      var it = cache[k][i];
      if (!it.isGap) {
        continue;
      }
      if (!(it.end > it.start) || !overlapsSilence(it.start, it.end)) {
        continue;
      }
      var gap = { start: it.start, end: it.end, startTicks: it.startTicks, endTicks: it.endTicks };
      var bucket = Math.floor(gap.start / slack);
      var merged = false;
      var b;
      for (b = bucket - 2; b <= bucket + 2 && !merged; b += 1) {
        var list = buckets[b];
        if (!list) {
          continue;
        }
        var u;
        for (u = 0; u < list.length; u += 1) {
          var un = list[u];
          var tickMatch =
            gap.startTicks &&
            un.startTicks &&
            Math.abs(gap.startTicks - un.startTicks) <= slackTicks &&
            Math.abs(gap.endTicks - un.endTicks) <= slackTicks;
          var secMatch = Math.abs(gap.start - un.start) <= slack && Math.abs(gap.end - un.end) <= slack;
          if (tickMatch || secMatch) {
            merged = true;
            break;
          }
        }
      }
      if (!merged) {
        unique.push(gap);
        if (!buckets[bucket]) {
          buckets[bucket] = [];
        }
        buckets[bucket].push(gap);
      }
    }
  }
  unique.sort(function (a, b) {
    if (b.startTicks && a.startTicks) {
      return b.startTicks - a.startTicks;
    }
    return b.start - a.start;
  });

  function hits(range, live) {
    if (!live.isGap) {
      return false;
    }
    if (!(live.end > live.start)) {
      return false;
    }
    var tickHit =
      range.startTicks &&
      live.startTicks &&
      live.startTicks < range.endTicks + slackTicks &&
      live.endTicks > range.startTicks - slackTicks;
    var secHit = live.start < range.end + slack && live.end > range.start - slack;
    return !!(tickHit || secHit);
  }

  // Legacy liveGapsAt(): full rescan of every QE track.
  function fullLiveGapsAt(range) {
    var items = [];
    var kk;
    for (kk = 0; kk < tracks.length; kk += 1) {
      var trk = tracks[kk];
      if (!trk || typeof trk.numItems !== "number") {
        continue;
      }
      var ii;
      for (ii = 0; ii < trk.numItems; ii += 1) {
        var item = trk.getItemAt(ii);
        if (!item) {
          continue;
        }
        var live = AutoCut._qeItemSnapshot(item);
        if (hits(range, live)) {
          items.push(item);
        }
      }
    }
    return items;
  }

  // Local liveGapsAt(): only reads the few items around the range on each
  // track, verifying that nothing there moved since the snapshot. Gaps are
  // processed from the end of the timeline backwards, so a ripple never
  // moves items that sit before the range being processed.
  function localLiveGapsAt(range) {
    var items = [];
    var margin = slack * 2;
    var from = range.start - slack - margin;
    var to = range.end + slack + margin;
    var kk;
    for (kk = 0; kk < tracks.length; kk += 1) {
      var trk = tracks[kk];
      var arr = cache[kk];
      if (!trk || typeof trk.numItems !== "number" || !arr.length) {
        continue;
      }
      // first index whose end > from
      var lo = 0;
      var hi = arr.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (arr[mid].end > from) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      var first = lo;
      // last index whose start < to
      lo = 0;
      hi = arr.length;
      while (lo < hi) {
        var mid2 = (lo + hi) >> 1;
        if (arr[mid2].start < to) {
          lo = mid2 + 1;
        } else {
          hi = mid2;
        }
      }
      var last = lo - 1;
      var a = first - 1;
      var z = last + 1;
      if (a < 0) {
        a = 0;
      }
      if (z > arr.length - 1) {
        z = arr.length - 1;
      }
      var liveCount = trk.numItems;
      var ii;
      for (ii = a; ii <= z; ii += 1) {
        if (ii >= liveCount) {
          return null;
        }
        var item = trk.getItemAt(ii);
        var live = AutoCut._qeItemSnapshot(item);
        if (!live) {
          return null;
        }
        if (live.isGap !== arr[ii].isGap || live.startTicksStr !== arr[ii].startTicksStr) {
          // Right-hand boundary item may have been rippled already (the gap
          // processed just before). That is fine as long as it still starts
          // after the range, so it cannot be a hit and bounds the window.
          var afterRange =
            ii === z &&
            ii > last &&
            live.start >= to &&
            (!live.startTicks || live.startTicks >= range.endTicks + slackTicks);
          if (!afterRange) {
            return null;
          }
          continue;
        }
        if (hits(range, live)) {
          items.push(item);
        }
      }
    }
    return items;
  }

  function refreshTracks() {
    // The legacy code re-fetched the QE sequence/tracks for every gap; do the same (cheap).
    var liveSeq = qe.project.getActiveSequence();
    if (!liveSeq) {
      return;
    }
    var fresh = [];
    var ft;
    for (ft = 0; ft < (liveSeq.numVideoTracks || 0); ft += 1) {
      fresh.push(liveSeq.getVideoTrackAt(ft));
    }
    for (ft = 0; ft < (liveSeq.numAudioTracks || 0); ft += 1) {
      fresh.push(liveSeq.getAudioTrackAt(ft));
    }
    if (fresh.length === tracks.length) {
      tracks = fresh;
    }
  }

  var closed = 0;
  var fullScans = 0;
  var targeted = false;
  var g;
  for (g = 0; g < unique.length; g += 1) {
    if (g > 0) {
      var tRef = AutoCut._fastClock();
      refreshTracks();
      AutoCut._fastAddMs("fast.gap.refreshTracksMs", tRef);
    }
    var gapT = AutoCut._perfEnter("fast.gap", g, null);
    var tLook = AutoCut._fastClock();
    var items = localLiveGapsAt(unique[g]);
    if (items === null) {
      fullScans += 1;
      AutoCut._perfAdd("fast.gap.fullScanFallback", 1);
      items = fullLiveGapsAt(unique[g]);
    } else {
      AutoCut._perfAdd("fast.gap.local", 1);
    }
    AutoCut._fastAddMs("fast.gap.lookupMs", tLook);
    var didClose = false;
    if (items.length) {
      var tStep = AutoCut._fastClock();
      if (!targeted) {
        AutoCut._targetAllTracks(seq);
        targeted = true;
      }
      AutoCut._fastAddMs("fast.gap.targetMs", tStep);
      tStep = AutoCut._fastClock();
      AutoCut._deselectGetSelection(seq);
      AutoCut._fastAddMs("fast.gap.deselectMs", tStep);
      tStep = AutoCut._fastClock();
      var s;
      for (s = 0; s < items.length; s += 1) {
        try {
          items[s].setSelected(true, s === 0);
        } catch (eSel) {}
      }
      AutoCut._fastAddMs("fast.gap.selectMs", tStep);
      tStep = AutoCut._fastClock();
      didClose = AutoCut._rippleDeleteGap(items[0]);
      AutoCut._fastAddMs("fast.gap.rippleMs", tStep);
    }
    if (didClose) {
      closed += 1;
    }
    AutoCut._perfExit(gapT, didClose ? "closed" : "not-closed", null);
  }

  AutoCut._fastNote("fast.closeGaps", { uniqueGaps: unique.length, closed: closed, fullScans: fullScans });
  return {
    closedCount: closed,
    closeMethod: "rippleDelete unique intervals",
    rippleEvents: [],
    fastPath: true,
    fullScans: fullScans
  };
};

/* ---------- relink ------------------------------------------------------ */

AutoCut._relinkListing = function (sequence) {
  var listed = AutoCut._listRelinkAlignedClips(sequence);
  listed.keysV = [];
  listed.keysA = [];
  var i;
  for (i = 0; i < listed.videos.length; i += 1) {
    listed.keysV.push(AutoCut._itemStartSeconds(listed.videos[i]));
    listed.keysA.push(AutoCut._itemStartSeconds(listed.audios[i]));
  }
  return listed;
};

AutoCut.relinkPairsBatch = function (jsonStr) {
  return AutoCut._wrap(function () {
    var hostT0 = AutoCut._perfOn() ? AutoCut._perfNowUs() : 0;
    var args = AutoCut._parse(jsonStr);
    var sequence = app.project.activeSequence;
    AutoCut._assertActiveSequence(args.sequenceId);
    var start = Number(args.start) || 0;
    var count = Number(args.count) || 0;
    var listed = AutoCut._relinkListing(sequence);
    var results = [];
    var relisted = 0;
    var i;
    for (i = start; i < start + count; i += 1) {
      // Cheap staleness check: the cached clips must still start where they did.
      var stale = false;
      if (i < listed.videos.length && i < listed.audios.length) {
        try {
          stale =
            Math.abs(AutoCut._itemStartSeconds(listed.videos[i]) - listed.keysV[i]) > 0.0005 ||
            Math.abs(AutoCut._itemStartSeconds(listed.audios[i]) - listed.keysA[i]) > 0.0005;
        } catch (eStale) {
          stale = true;
        }
      }
      if (stale) {
        relisted += 1;
        AutoCut._perfAdd("fast.relink.relistStale", 1);
        listed = AutoCut._relinkListing(sequence);
      }
      var one = AutoCut._relinkOne(sequence, listed, i, {
        quietUi: true,
        finalUi: i === start + count - 1,
        probe: i < 20
      });
      if (!one.ok) {
        // Retry exactly like the legacy per-pair call (fresh listing).
        relisted += 1;
        AutoCut._perfAdd("fast.relink.retry", 1);
        listed = AutoCut._relinkListing(sequence);
        one = AutoCut._relinkOne(sequence, listed, i);
      }
      results.push(one);
    }
    AutoCut._fastNote("fast.relink", { batchStart: start, batchCount: count });
    return AutoCut._perfFinishData(hostT0, { pairCount: listed.pairCount, results: results, relisted: relisted });
  });
};


/* ---------- Modo Turbo (XML) ------------------------------------------- */

AutoCut.turboExport = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var seq = AutoCut._assertActiveSequence(args.sequenceId);
    var outFile = new File(args.path);
    if (outFile.exists) {
      outFile.remove();
    }
    var t0 = new Date().getTime();
    var ok = seq.exportAsFinalCutProXML(outFile.fsName, 1);
    var ms = new Date().getTime() - t0;
    outFile = new File(args.path);
    if (!outFile.exists) {
      throw new Error("O Premiere não gerou o XML da sequência (exportAsFinalCutProXML retornou " + String(ok) + ").");
    }
    return AutoCut._ok({
      path: outFile.fsName,
      bytes: outFile.length,
      exportMs: ms,
      sequenceName: String(seq.name),
      sequenceId: String(seq.sequenceID)
    });
  });
};

AutoCut._sequenceIdSet = function () {
  var ids = {};
  var n = AutoCut._sequenceCount();
  var i;
  for (i = 0; i <= n; i += 1) {
    var seq = AutoCut._itemAt(app.project.sequences, i);
    try {
      if (seq) {
        ids[String(seq.sequenceID)] = true;
      }
    } catch (e) {}
  }
  return ids;
};

AutoCut.turboImport = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var file = new File(args.path);
    if (!file.exists) {
      throw new Error("XML da sequência Turbo não encontrado.");
    }
    var before = AutoCut._sequenceIdSet();
    var bin = null;
    try {
      bin = app.project.getInsertionBin();
    } catch (eBin) {}
    if (!bin) {
      bin = app.project.rootItem;
    }
    var t0 = new Date().getTime();
    var imported = app.project.importFiles([file.fsName], true, bin, false);
    var ms = new Date().getTime() - t0;
    var created = [];
    var n = AutoCut._sequenceCount();
    var i;
    for (i = 0; i <= n; i += 1) {
      var seq = AutoCut._itemAt(app.project.sequences, i);
      try {
        if (seq && !before[String(seq.sequenceID)]) {
          created.push(seq);
        }
      } catch (e) {}
    }
    if (!created.length) {
      throw new Error("O Premiere importou o XML, mas nenhuma sequência nova apareceu (importFiles retornou " + String(imported) + ").");
    }
    var target = created[0];
    var c;
    for (c = 0; c < created.length; c += 1) {
      if (args.name && String(created[c].name) === String(args.name)) {
        target = created[c];
        break;
      }
    }
    if (args.name && String(target.name) !== String(args.name)) {
      AutoCut._renameSequence(target, args.name);
    }
    AutoCut._activateSequence(target);
    return AutoCut._ok({
      sequenceId: String(target.sequenceID),
      sequenceName: String(target.name),
      createdCount: created.length,
      importMs: ms
    });
  });
};

AutoCut.turboDiscard = function (jsonStr) {
  return AutoCut._wrap(function () {
    var args = AutoCut._parse(jsonStr);
    var original = AutoCut._findSequenceById(args.originalSequenceId);
    var turbo = AutoCut._findSequenceById(args.turboSequenceId);
    if (original) {
      AutoCut._activateSequence(original);
    }
    if (turbo) {
      if (AutoCut._hasFn(app.project, "deleteSequence")) {
        app.project.deleteSequence(turbo);
      } else {
        var item = AutoCut._projectItemForSequence(turbo);
        if (item && AutoCut._hasFn(item, "remove")) {
          item.remove(false, true);
        } else {
          throw new Error("Não foi possível apagar a sequência Turbo (deleteSequence indisponível).");
        }
      }
    }
    return AutoCut._ok({
      restoredName: original ? String(original.name) : "",
      restoredSequenceId: original ? String(original.sequenceID) : ""
    });
  });
};

// Diagnóstico de desempenho no host (perf.jsx). false = desligado para distribuição:
// perf.jsx não é carregado e as funções _perf* ficam como no-op.
AutoCut.PERF_DIAGNOSTICS_ENABLED = false;

if (AutoCut.PERF_DIAGNOSTICS_ENABLED) try {
  var autoCutPerfPath = "";
  try {
    autoCutPerfPath = String($.fileName || "");
  } catch (ePerfName) {}
  if (autoCutPerfPath) {
    var autoCutPerfFile = new File(autoCutPerfPath.replace(/[^\/\\]+$/, "perf.jsx"));
    if (autoCutPerfFile.exists) {
      $.evalFile(autoCutPerfFile);
    }
  }
} catch (ePerfLoad) {}
