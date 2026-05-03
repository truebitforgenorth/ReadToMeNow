export function initReadAloud() {
  const textInput = document.getElementById("textInput");
  if (!textInput) {
    return;
  }

  const voiceSelect = document.getElementById("voiceSelect");
  const speedRange = document.getElementById("speedRange");
  const pitchRange = document.getElementById("pitchRange");
  const speedValue = document.getElementById("speedValue");
  const pitchValue = document.getElementById("pitchValue");
  const wordCount = document.getElementById("wordCount");
  const listenTime = document.getElementById("listenTime");
  const statusText = document.getElementById("statusText");
  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const stopBtn = document.getElementById("stopBtn");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const jumpBtn = document.getElementById("jumpBtn");
  const restartSectionBtn = document.getElementById("restartSectionBtn");
  const resetBtn = document.getElementById("resetBtn");
  const segmentSelect = document.getElementById("segmentSelect");
  const segmentPreview = document.getElementById("segmentPreview");

  let voices = [];
  let selectedVoiceId = "";
  let isPaused = false;
  let segments = [];
  let currentSegmentIndex = 0;
  let autoAdvance = true;
  const hasSpeechSupport = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  function updateStats() {
    const text = textInput.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    wordCount.textContent = String(words);
    listenTime.textContent = `${Math.max(1, Math.round(words / 150))} min`;
  }

  function setStatus(message) {
    statusText.textContent = message;
  }

  function isEnglishVoice(voice) {
    return /^en([_-]|$)/i.test(voice.lang || "");
  }

  function getVoiceQualityScore(voice) {
    const name = `${voice.name || ""} ${voice.voiceURI || ""}`.toLowerCase();
    let score = 0;

    if (isEnglishVoice(voice)) score += 1000;
    if (voice.default) score += 200;
    if (name.includes("natural")) score += 140;
    if (name.includes("neural")) score += 140;
    if (name.includes("aria")) score += 100;
    if (name.includes("guy")) score += 100;
    if (name.includes("jenny")) score += 100;
    if (name.includes("samantha")) score += 90;
    if (name.includes("google")) score += 80;
    if (name.includes("microsoft")) score += 80;
    if (name.includes("zira")) score += 35;
    if (name.includes("david")) score += 35;
    if (name.includes("desktop")) score -= 40;
    if (name.includes("espeak")) score -= 200;
    if (name.includes("robot")) score -= 200;

    return score;
  }

  function getVoiceId(voice) {
    return voice.voiceURI || `${voice.name || "voice"}|${voice.lang || "unknown"}`;
  }

  function splitIntoSegments(text) {
    return text
      .split(/\n\s*\n|(?<=[.!?])\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  function truncateText(text, maxLength = 90) {
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
  }

  function updateSegmentPreview() {
    if (!segments.length) {
      segmentPreview.textContent = "Current section preview will show here.";
      return;
    }

    const previewIndex = Math.min(Number(segmentSelect.value) || 0, segments.length - 1);
    segmentPreview.textContent = truncateText(segments[previewIndex] || "", 160);
  }

  function updateSegmentControls() {
    segments = splitIntoSegments(textInput.value.trim());

    if (!segments.length) {
      currentSegmentIndex = 0;
      segmentSelect.innerHTML = '<option value="0">No sections yet</option>';
      segmentSelect.disabled = true;
      jumpBtn.disabled = true;
      restartSectionBtn.disabled = true;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      updateSegmentPreview();
      return;
    }

    currentSegmentIndex = Math.min(currentSegmentIndex, segments.length - 1);
    segmentSelect.innerHTML = "";

    segments.forEach((segment, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `Section ${index + 1}: ${truncateText(segment, 55)}`;
      segmentSelect.appendChild(option);
    });

    segmentSelect.value = String(currentSegmentIndex);
    segmentSelect.disabled = false;
    jumpBtn.disabled = false;
    restartSectionBtn.disabled = false;
    prevBtn.disabled = currentSegmentIndex === 0;
    nextBtn.disabled = currentSegmentIndex >= segments.length - 1;
    updateSegmentPreview();
  }

  function getSelectedVoice() {
    if (!voices.length) {
      return null;
    }

    const selectedId = voiceSelect.value || selectedVoiceId;
    const selectedVoice = voices.find((voice) => getVoiceId(voice) === selectedId);
    if (selectedVoice) {
      return selectedVoice;
    }

    return voices.find((voice) => voice.default) || voices[0] || null;
  }

  function loadVoices() {
    if (!hasSpeechSupport) {
      return;
    }

    const loadedVoices = speechSynthesis.getVoices()
      .filter((voice) => voice && (voice.name || voice.voiceURI))
      .sort((a, b) => {
        const scoreDifference = getVoiceQualityScore(b) - getVoiceQualityScore(a);
        if (scoreDifference !== 0) {
          return scoreDifference;
        }
        return (a.name || "").localeCompare(b.name || "");
      });

    if (!loadedVoices.length) {
      voiceSelect.innerHTML = '<option value="">Loading voices...</option>';
      voiceSelect.disabled = true;
      setStatus("Loading voices");
      return;
    }

    voices = loadedVoices;
    const previousValue = voiceSelect.value || selectedVoiceId;
    voiceSelect.innerHTML = "";
    voiceSelect.disabled = false;

    voices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = getVoiceId(voice);
      const languageLabel = voice.lang || "unknown";
      const englishLabel = isEnglishVoice(voice) ? "English" : "Other";
      const qualityLabel = getVoiceQualityScore(voice) >= 1100 ? "Recommended" : englishLabel;
      option.textContent = `${voice.name || "Unnamed voice"} (${languageLabel}) - ${qualityLabel}${voice.default ? " - Default" : ""}`;
      voiceSelect.appendChild(option);
    });

    const voiceStillExists = voices.some((voice) => getVoiceId(voice) === previousValue);
    const fallbackVoice = voices.find((voice) => voice.default) || voices[0];
    voiceSelect.value = voiceStillExists ? previousValue : getVoiceId(fallbackVoice);
    selectedVoiceId = voiceSelect.value;

    if (statusText.textContent === "Loading voices") {
      setStatus("Idle");
    }
  }

  function applySpeechSettings(utterance) {
    const selectedVoice = getSelectedVoice();
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      if (selectedVoice.lang) {
        utterance.lang = selectedVoice.lang;
      }
    }

    utterance.rate = parseFloat(speedRange.value);
    utterance.pitch = parseFloat(pitchRange.value);
  }

  function attachUtteranceEvents(utterance) {
    utterance.onstart = () => {
      isPaused = false;
      setStatus(`Speaking section ${currentSegmentIndex + 1} of ${segments.length || 1}`);
    };

    utterance.onend = () => {
      isPaused = false;
      if (autoAdvance && currentSegmentIndex < segments.length - 1) {
        currentSegmentIndex += 1;
        updateSegmentControls();
        speakSegment(currentSegmentIndex, true);
        return;
      }

      setStatus("Finished");
    };

    utterance.onerror = (event) => {
      isPaused = false;
      const errorCode = event && event.error ? event.error : "unknown";
      setStatus(errorCode === "voice-unavailable" ? "Selected voice unavailable" : `Speech error: ${errorCode}`);
    };

    utterance.onpause = () => {
      isPaused = true;
      setStatus("Paused");
    };

    utterance.onresume = () => {
      isPaused = false;
      setStatus("Speaking");
    };
  }

  function speakSegment(index, shouldAutoAdvance = true) {
    if (!hasSpeechSupport) {
      setStatus("Speech not supported in this browser");
      return;
    }

    if (!segments.length) {
      setStatus("Add some text first");
      return;
    }

    const boundedIndex = Math.min(Math.max(index, 0), segments.length - 1);
    const text = segments[boundedIndex];
    if (!text) {
      setStatus("That section is empty");
      return;
    }

    autoAdvance = shouldAutoAdvance;
    currentSegmentIndex = boundedIndex;
    segmentSelect.value = String(currentSegmentIndex);
    updateSegmentControls();
    selectedVoiceId = voiceSelect.value;
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    applySpeechSettings(utterance);
    attachUtteranceEvents(utterance);
    speechSynthesis.speak(utterance);
  }

  function speakText() {
    updateSegmentControls();
    speakSegment(currentSegmentIndex, true);
  }

  function restartSpeechIfActive() {
    if (!hasSpeechSupport) {
      return;
    }

    if (speechSynthesis.speaking || speechSynthesis.pending || isPaused) {
      speakSegment(currentSegmentIndex, autoAdvance);
    }
  }

  playBtn.addEventListener("click", speakText);
  voiceSelect.addEventListener("change", () => {
    selectedVoiceId = voiceSelect.value;
    restartSpeechIfActive();
  });
  pauseBtn.addEventListener("click", () => {
    if (!hasSpeechSupport) {
      return;
    }
    speechSynthesis.pause();
    isPaused = true;
    setStatus("Paused");
  });
  resumeBtn.addEventListener("click", () => {
    if (!hasSpeechSupport) {
      return;
    }
    speechSynthesis.resume();
    isPaused = false;
    setStatus("Speaking");
  });
  stopBtn.addEventListener("click", () => {
    if (!hasSpeechSupport) {
      return;
    }
    speechSynthesis.cancel();
    isPaused = false;
    setStatus("Stopped");
  });
  resetBtn.addEventListener("click", () => {
    if (hasSpeechSupport) {
      speechSynthesis.cancel();
    }
    isPaused = false;
    currentSegmentIndex = 0;
    autoAdvance = true;
    textInput.value = "Paste your homework, article, or notes here and press Play.";
    speedRange.value = "1";
    pitchRange.value = "1";
    speedValue.textContent = "1.0";
    pitchValue.textContent = "1.0";
    setStatus("Idle");
    updateStats();
    updateSegmentControls();
  });
  prevBtn.addEventListener("click", () => {
    updateSegmentControls();
    if (!segments.length || currentSegmentIndex === 0) {
      return;
    }
    speakSegment(currentSegmentIndex - 1, true);
  });
  nextBtn.addEventListener("click", () => {
    updateSegmentControls();
    if (!segments.length || currentSegmentIndex >= segments.length - 1) {
      return;
    }
    speakSegment(currentSegmentIndex + 1, true);
  });
  jumpBtn.addEventListener("click", () => {
    updateSegmentControls();
    if (!segments.length) {
      return;
    }
    speakSegment(Number(segmentSelect.value) || 0, true);
  });
  restartSectionBtn.addEventListener("click", () => {
    updateSegmentControls();
    if (!segments.length) {
      return;
    }
    speakSegment(Number(segmentSelect.value) || currentSegmentIndex, false);
  });
  segmentSelect.addEventListener("change", () => {
    currentSegmentIndex = Number(segmentSelect.value) || 0;
    updateSegmentControls();
  });
  speedRange.addEventListener("input", () => {
    speedValue.textContent = parseFloat(speedRange.value).toFixed(1);
    restartSpeechIfActive();
  });
  pitchRange.addEventListener("input", () => {
    pitchValue.textContent = parseFloat(pitchRange.value).toFixed(1);
    restartSpeechIfActive();
  });
  textInput.addEventListener("input", () => {
    updateStats();
    updateSegmentControls();
  });

  if (hasSpeechSupport) {
    loadVoices();

    if (typeof speechSynthesis.addEventListener === "function") {
      speechSynthesis.addEventListener("voiceschanged", loadVoices);
    } else if ("onvoiceschanged" in speechSynthesis) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  } else {
    voiceSelect.innerHTML = '<option value="">Speech not supported</option>';
    voiceSelect.disabled = true;
    setStatus("Speech not supported in this browser");
  }

  updateStats();
  updateSegmentControls();
}
