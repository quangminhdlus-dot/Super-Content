const clamp = (value, min, max) => Math.min(max, Math.max(value, min));

export function createStudioReader({overlay, el, prefs, source, listen, active, seek, savePreferences}) {
  let core, motion, speechPath, recentVoice = -Infinity;
  let segments = [], offsets = [], activeSegment = -1, anchor = 0, maxAnchor = 0;
  let dragPointer, dragY = 0, dragAnchor = 0, manualUntil = 0, speedPosition = 0, lastScroll = 0, wordCount = 0;
  const grips = el.guide.querySelectorAll("button");

  function selectSegment(index) {
    if (index === activeSegment) return;
    activeSegment = index;
    for (let i = 0; i < segments.length; i++) {
      segments[i].classList.toggle("past", i < index);
      segments[i].classList.toggle("current", i === index);
    }
  }

  function segmentAtScroll() {
    const y = el.scroll.scrollTop + anchor;
    let index = activeSegment < 0 ? 0 : activeSegment;
    while (index > 0 && offsets[index].top > y + 1) index--;
    while (index + 1 < offsets.length && offsets[index + 1].top <= y + 1) index++;
    return index;
  }

  function measure(keepPosition = true) {
    const height = el.scroll.clientHeight;
    if (!height) return;
    maxAnchor = Math.max(0, height - Math.max(48, prefs.font * 1.5) - 14);
    anchor = 11 + prefs.anchor * maxAnchor;
    overlay.style.setProperty("--sc-p-font", prefs.font + "px");
    el.stage.style.setProperty("--sc-p-anchor", anchor + "px");
    el.stage.style.setProperty("--sc-p-height", height + "px");
    for (const grip of grips) {
      const value = String(Math.round(prefs.anchor * 100));
      grip.setAttribute("aria-valuemin", "0");
      grip.setAttribute("aria-valuemax", "100");
      grip.setAttribute("aria-valuenow", value);
    }
    const oldOffset = offsets[activeSegment]?.top;
    const oldRelative = oldOffset === undefined ? 0 : el.scroll.scrollTop - (oldOffset - (measure.previousAnchor ?? anchor));
    const box = el.scroll.getBoundingClientRect();
    el.script.style.translate = "";
    offsets = segments.map(segment => {
      const rect = segment.getBoundingClientRect();
      return {top: rect.top - box.top + el.scroll.scrollTop, height: rect.height};
    });
    if (keepPosition && offsets[activeSegment]) el.scroll.scrollTop = offsets[activeSegment].top - anchor + oldRelative;
    measure.previousAnchor = anchor;
    speechPath = undefined;
    speedPosition = lastScroll = el.scroll.scrollTop;
    motion?.reset(lastScroll);
  }

  function renderScript() {
    const formatted = core.formattedSegments(source.text);
    const fragment = document.createDocumentFragment();
    let end = 0;
    function append(parent, start, stop) {
      for (const item of core.spans(formatted, start, stop)) {
        if (!item.bold) parent.append(item.text);
        else {
          const strong = document.createElement("strong");
          strong.textContent = item.text;
          parent.append(strong);
        }
      }
    }
    for (const [index, segment] of formatted.segments.entries()) {
      if (end < segment.displayStart) append(fragment, end, segment.displayStart);
      const span = document.createElement("span");
      span.dataset.segment = index;
      append(span, Math.max(end, segment.displayStart), segment.end);
      fragment.append(span);
      segments.push(span);
      end = segment.end;
    }
    if (end < formatted.plain.length) append(fragment, end, formatted.plain.length);
    el.script.replaceChildren(fragment);
    wordCount = formatted.plain.trim().split(/\s+/u).filter(Boolean).length;
    motion = new core.ScrollMotion();
    selectSegment(0);
    measure(false);
    return formatted.segments;
  }

  function follow(decision, before) {
    if (performance.now() < manualUntil) return;
    const row = offsets[decision.index];
    if (!row) return;
    const previous = speechPath;
    if (previous?.index === decision.index && decision.progress <= previous.progress) return;
    if (!previous) motion.reset(el.scroll.scrollTop);
    const at = performance.now();
    const top = row.top - anchor;
    const distance = row.height * .82;
    const elapsed = Math.max(.18, (at - (previous?.at ?? at)) / 1000);
    const rate = decision.source === "hold" || previous?.index !== decision.index ? 0 :
      .55 * previous.rate + .45 * Math.min(.95, (decision.progress - previous.progress) / elapsed);
    const limit = Math.max(0, el.scroll.scrollHeight - el.scroll.clientHeight);
    const backward = decision.index < before;
    const raw = top + decision.progress * distance;
    const goal = clamp(backward
      ? Math.max(el.scroll.scrollTop - Math.min(44, row.height * .24), Math.min(raw, el.scroll.scrollTop))
      : Math.max(previous?.index === decision.index && !previous.backward ? previous.goal : el.scroll.scrollTop, raw), 0, limit);
    selectSegment(decision.index);
    speechPath = {index: decision.index, at, top, distance, progress: decision.progress, rate, limit, goal, backward, confidence: decision.confidence};
  }

  function trackManualPosition() {
    if (!offsets.length) return;
    const position = segmentAtScroll();
    if (position !== activeSegment) {
      selectSegment(position);
      seek(position);
    }
  }

  function updatePrompter(now, elapsed) {
    if (!motion || !offsets.length) return;
    if (prefs.mode === "manual" || now < manualUntil ||
        (el.scroll.scrollTop !== lastScroll && !speechPath && prefs.mode !== "fixed")) {
      trackManualPosition();
      speedPosition = lastScroll = el.scroll.scrollTop;
      return;
    }
    if (active() && prefs.mode === "fixed") {
      if (el.scroll.scrollTop !== lastScroll) speedPosition = el.scroll.scrollTop;
      const limit = el.scroll.scrollHeight - el.scroll.clientHeight;
      const distance = (offsets.at(-1).top + offsets.at(-1).height - anchor) / Math.max(wordCount, 1);
      speedPosition = Math.min(limit, speedPosition + distance * prefs.wpm * elapsed / 60000);
      el.scroll.scrollTop = Math.round(speedPosition);
      lastScroll = el.scroll.scrollTop;
      trackManualPosition();
    } else if (active() && prefs.mode === "voice" && speechPath) {
      if (!speechPath.backward && now - recentVoice <= 250 && now - speechPath.at < 650) {
        const progress = Math.min(.96, core.predictedProgress(speechPath.progress, speechPath.rate, now - speechPath.at, now - recentVoice));
        speechPath.goal = Math.min(speechPath.limit, Math.max(speechPath.goal, speechPath.top + speechPath.distance * progress));
      }
      const position = motion.advance(speechPath.goal, elapsed, 450, speechPath.confidence);
      el.scroll.scrollTop = Math.round(position);
      lastScroll = el.scroll.scrollTop;
      const residual = lastScroll - position;
      el.script.style.translate = Math.abs(residual) > .03 ? "0 " + residual.toFixed(2) + "px" : "";
    }
  }

  function setAnchor(value, persist = true) {
    prefs.anchor = clamp(value, 0, 1);
    measure();
    if (persist) savePreferences();
  }

  for (const grip of grips) {
    const move = (event) => {
      if (maxAnchor) setAnchor(dragAnchor + (event.clientY - dragY) / maxAnchor, false);
    };
    listen(grip, "pointerdown", event => {
      dragPointer = event.pointerId;
      grip.setPointerCapture(event.pointerId);
      dragY = event.clientY;
      dragAnchor = prefs.anchor;
    });
    listen(grip, "pointermove", event => { if (dragPointer === event.pointerId) move(event); });
    listen(grip, "lostpointercapture", () => { dragPointer = undefined; savePreferences(); });
    listen(grip, "keydown", event => {
      const next = { ArrowUp:prefs.anchor - .025, ArrowDown:prefs.anchor + .025, Home:0, End:1 };
      if (!Object.hasOwn(next, event.key)) return;
      event.preventDefault();
      setAnchor(next[event.key]);
    });
  }

  const beginManual = () => {
    manualUntil = performance.now() + 500;
    speechPath = undefined;
    el.script.style.translate = "";
    motion?.reset(el.scroll.scrollTop);
  };
  listen(el.scroll, "wheel", beginManual);
  listen(el.scroll, "pointerdown", beginManual);
  listen(el.scroll, "scroll", () => {
    if (performance.now() < manualUntil) manualUntil = performance.now() + 250;
  });

  function resetMotion() {
    speechPath = undefined;
    el.script.style.translate = "";
    speedPosition = lastScroll = el.scroll.scrollTop;
    motion?.reset(lastScroll);
  }
  const resize = new ResizeObserver(() => measure());
  resize.observe(el.stage);
  return {
    load(runtime) { core = runtime; return renderScript(); },
    move: updatePrompter,
    follow,
    activity(now) { recentVoice = now; },
    measure,
    destroy() { resize.disconnect(); },
    resetMotion,
    seekCurrent() { seek(Math.max(0, activeSegment)); },
    rewind() {
      el.scroll.scrollTop = 0;
      manualUntil = 0;
      selectSegment(0);
      seek(0);
      resetMotion();
    },
  };
}
