import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SESSION_SETS_KEY = "studylift-session-flashcard-sets";
const LOCAL_SETS_KEY = "studylift-local-flashcard-sets";

function stripLead(text, pattern) {
  return text.replace(pattern, "").trim();
}

function splitBlocks(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function sentenceCardsFromText(text) {
  const sentences = (text.match(/[^.!?]+[.!?]?/g) || [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 18);

  return sentences.slice(0, 24).map((sentence) => {
    const clean = sentence.replace(/[.!?]+$/, "");
    const prompt = clean.split(/\s+/).slice(0, 8).join(" ");
    return {
      front: `What should you remember about "${prompt}${clean.split(/\s+/).length > 8 ? "..." : ""}"?`,
      back: sentence
    };
  });
}

function termCardsFromText(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)(?:\s*[:\-]\s+)(.+)$/);
      if (!match) {
        return null;
      }

      return {
        front: match[1].trim(),
        back: match[2].trim()
      };
    })
    .filter(Boolean);
}

function qaCardsFromText(text) {
  const cards = [];

  splitBlocks(text).forEach((block) => {
    const lines = block
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return;
    }

    let question = "";
    const answerParts = [];

    lines.forEach((line) => {
      if (/^q(?:uestion)?\s*[:\-]/i.test(line)) {
        question = stripLead(line, /^q(?:uestion)?\s*[:\-]\s*/i);
        return;
      }

      if (/^a(?:nswer)?\s*[:\-]/i.test(line)) {
        answerParts.push(stripLead(line, /^a(?:nswer)?\s*[:\-]\s*/i));
        return;
      }

      if (!question) {
        question = line;
      } else {
        answerParts.push(line);
      }
    });

    if (question && answerParts.length) {
      cards.push({
        front: question,
        back: answerParts.join(" ")
      });
    }
  });

  return cards;
}

function generateCardsFromNotes(text, mode) {
  if (!text.trim()) {
    return [];
  }

  if (mode === "qa") {
    return qaCardsFromText(text);
  }

  if (mode === "term") {
    return termCardsFromText(text);
  }

  if (mode === "summary") {
    return sentenceCardsFromText(text);
  }

  const qaCards = qaCardsFromText(text);
  if (qaCards.length >= 2) {
    return qaCards;
  }

  const termCards = termCardsFromText(text);
  if (termCards.length >= 2) {
    return termCards;
  }

  return sentenceCardsFromText(text);
}

function formatDate(value) {
  if (!value) {
    return "Recently";
  }

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function cloneCards(cards) {
  return cards.map((card) => ({
    front: card.front || "",
    back: card.back || ""
  }));
}

function readLocalSets() {
  try {
    const sessionRaw = window.sessionStorage.getItem(SESSION_SETS_KEY);
    if (sessionRaw) {
      const sessionParsed = JSON.parse(sessionRaw);
      return Array.isArray(sessionParsed) ? sessionParsed : [];
    }

    const raw = window.localStorage.getItem(LOCAL_SETS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSets(sets) {
  window.sessionStorage.setItem(SESSION_SETS_KEY, JSON.stringify(sets));
}

function makeButton(label, className, dataset = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  Object.entries(dataset).forEach(([key, value]) => {
    button.dataset[key] = value;
  });
  return button;
}

function makeTextareaField({ id, labelText, field, index, value }) {
  const fieldWrap = document.createElement("div");
  fieldWrap.className = "form-field";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;

  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.dataset.cardField = field;
  textarea.dataset.index = String(index);
  textarea.value = value;

  fieldWrap.append(label, textarea);
  return fieldWrap;
}

export function initFlashcards({ db, auth, firebaseConfigured, openAuthModal, getCurrentUser }) {
  const cardsGrid = document.getElementById("cardsGrid");
  if (!cardsGrid) {
    return {
      handleAuthChange() {}
    };
  }

  const setTitleInput = document.getElementById("setTitleInput");
  const generatorMode = document.getElementById("generatorMode");
  const notesInput = document.getElementById("notesInput");
  const generateCardsBtn = document.getElementById("generateCardsBtn");
  const addBlankCardBtn = document.getElementById("addBlankCardBtn");
  const saveSetBtn = document.getElementById("saveSetBtn");
  const clearCardsBtn = document.getElementById("clearCardsBtn");
  const flashcardStatus = document.getElementById("flashcardStatus");
  const cardsSummary = document.getElementById("cardsSummary");
  const savedSetList = document.getElementById("savedSetList");
  const accountStatus = document.getElementById("accountStatus");
  const currentDeckLabel = document.getElementById("currentDeckLabel");

  const state = {
    cards: [],
    currentSetId: null,
    savedSets: [],
    unsubscribeSavedSets: null,
    storageMode: "local"
  };

  function isCloudMode() {
    return Boolean(firebaseConfigured && auth && db && getCurrentUser());
  }

  function getActiveSets() {
    return state.savedSets;
  }

  function loadLocalSets() {
    state.savedSets = readLocalSets()
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }

  function saveLocalSetRecord(record) {
    const nextSets = readLocalSets();
    const existingIndex = nextSets.findIndex((set) => set.id === record.id);

    if (existingIndex >= 0) {
      nextSets[existingIndex] = record;
    } else {
      nextSets.unshift(record);
    }

    writeLocalSets(nextSets);
    loadLocalSets();
  }

  function deleteLocalSetRecord(setId) {
    writeLocalSets(readLocalSets().filter((set) => set.id !== setId));
    loadLocalSets();
  }

  function setStatus(message) {
    flashcardStatus.textContent = message;
  }

  function updateSummary() {
    cardsSummary.textContent = `${state.cards.length} card${state.cards.length === 1 ? "" : "s"}`;
    currentDeckLabel.textContent = state.currentSetId
      ? setTitleInput.value.trim() || "Saved deck selected"
      : "Unsaved deck";
  }

  function renderCards() {
    updateSummary();

    if (!state.cards.length) {
      cardsGrid.innerHTML = '<p class="empty-state">No cards yet. Generate a set or add a blank card to start editing.</p>';
      return;
    }

    cardsGrid.innerHTML = "";

    state.cards.forEach((card, index) => {
      const article = document.createElement("article");
      article.className = "card-editor";
      const head = document.createElement("div");
      head.className = "card-editor-head";

      const cardIndex = document.createElement("div");
      cardIndex.className = "card-editor-index";
      cardIndex.textContent = `Card ${index + 1}`;

      const actions = document.createElement("div");
      actions.className = "saved-set-actions";
      actions.append(
        makeButton("Duplicate", "button secondary", { action: "duplicate", index: String(index) }),
        makeButton("Remove", "button danger-soft", { action: "remove", index: String(index) })
      );

      head.append(cardIndex, actions);

      const grid = document.createElement("div");
      grid.className = "card-editor-grid";
      grid.append(
        makeTextareaField({
          id: `card-front-${index}`,
          labelText: "Front",
          field: "front",
          index,
          value: card.front
        }),
        makeTextareaField({
          id: `card-back-${index}`,
          labelText: "Back",
          field: "back",
          index,
          value: card.back
        })
      );

      article.append(head, grid);

      cardsGrid.appendChild(article);
    });
  }

  function renderSavedSets() {
    const user = getCurrentUser();
    const activeSets = getActiveSets();

    if (isCloudMode()) {
      accountStatus.textContent = `Signed in as ${user.email}`;
    } else if (firebaseConfigured) {
      accountStatus.textContent = "Browser demo mode";
    } else {
      accountStatus.textContent = "Browser demo mode";
    }

    if (!activeSets.length) {
      savedSetList.innerHTML = isCloudMode()
        ? '<p class="empty-state">No saved decks yet. Generate cards and press Save Set.</p>'
        : '<p class="empty-state">No demo decks yet. Generate cards and press Save Set.</p>';
      return;
    }

    savedSetList.innerHTML = "";
    activeSets.forEach((set) => {
      const item = document.createElement("article");
      item.className = "saved-set-item";

      const head = document.createElement("div");
      head.className = "saved-set-head";

      const title = document.createElement("div");
      title.className = "saved-set-title";
      title.textContent = set.title || "Untitled set";

      const summary = document.createElement("div");
      summary.className = "cards-summary";
      summary.textContent = `${(set.cards || []).length} cards`;

      head.append(title, summary);

      const meta = document.createElement("p");
      meta.className = "saved-set-meta";
      meta.textContent = `Updated ${formatDate(set.updatedAt)}${set.mode ? ` - ${set.mode}` : ""}`;

      const actions = document.createElement("div");
      actions.className = "saved-set-actions";
      actions.append(
        makeButton("Load", "button secondary", { loadSet: set.id }),
        makeButton("Delete", "button danger-soft", { deleteSet: set.id })
      );

      item.append(head, meta, actions);
      savedSetList.appendChild(item);
    });
  }

  function loadSet(setId) {
    const selected = getActiveSets().find((set) => set.id === setId);
    if (!selected) {
      setStatus("That saved set is no longer available.");
      return;
    }

    state.currentSetId = selected.id;
    state.cards = cloneCards(selected.cards || []);
    setTitleInput.value = selected.title || "";
    notesInput.value = selected.sourceText || "";
    generatorMode.value = selected.mode || "auto";
    renderCards();
    renderSavedSets();
    setStatus(`Loaded "${selected.title || "Untitled set"}".`);
  }

  async function deleteSet(setId) {
    const user = getCurrentUser();

    if (isCloudMode()) {
      await deleteDoc(doc(db, "users", user.uid, "flashcardSets", setId));
    } else {
      deleteLocalSetRecord(setId);
    }

    if (state.currentSetId === setId) {
      state.currentSetId = null;
      currentDeckLabel.textContent = "Unsaved deck";
    }

    setStatus("Saved set deleted.");
  }

  function subscribeToSavedSets(user) {
    if (state.unsubscribeSavedSets) {
      state.unsubscribeSavedSets();
      state.unsubscribeSavedSets = null;
    }

    if (!firebaseConfigured || !auth || !db || !user) {
      state.storageMode = "local";
      loadLocalSets();
      renderSavedSets();
      return;
    }

    state.storageMode = "cloud";

    const savedSetsQuery = query(
      collection(db, "users", user.uid, "flashcardSets"),
      orderBy("updatedAt", "desc")
    );

    state.unsubscribeSavedSets = onSnapshot(savedSetsQuery, (snapshot) => {
      state.savedSets = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data()
      }));
      renderSavedSets();
    }, () => {
      setStatus("Could not load saved flashcards.");
    });
  }

  function clearCurrentDeck(message) {
    state.currentSetId = null;
    state.cards = [];
    setTitleInput.value = "";
    notesInput.value = "";
    generatorMode.value = "auto";
    renderCards();
    renderSavedSets();
    setStatus(message);
  }

  generateCardsBtn.addEventListener("click", () => {
    const generatedCards = generateCardsFromNotes(notesInput.value, generatorMode.value);
    state.cards = cloneCards(generatedCards);
    state.currentSetId = null;
    renderCards();

    if (!generatedCards.length) {
      setStatus("No cards were generated. Try adding more notes or switching generator mode.");
      return;
    }

    if (!setTitleInput.value.trim()) {
      setTitleInput.value = "New Study Set";
    }

    setStatus(`Generated ${generatedCards.length} flashcard${generatedCards.length === 1 ? "" : "s"}. You can edit them before saving.`);
  });

  addBlankCardBtn.addEventListener("click", () => {
    state.cards.push({ front: "", back: "" });
    state.currentSetId = null;
    renderCards();
    setStatus("Added a blank card.");
  });

  clearCardsBtn.addEventListener("click", () => {
    clearCurrentDeck("Cleared the current deck.");
  });

  cardsGrid.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }

    const field = target.dataset.cardField;
    const index = Number(target.dataset.index);
    if (!field || Number.isNaN(index) || !state.cards[index]) {
      return;
    }

    state.cards[index][field] = target.value;
  });

  cardsGrid.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const index = Number(target.dataset.index);
    if (target.dataset.action === "remove" && !Number.isNaN(index)) {
      state.cards.splice(index, 1);
      state.currentSetId = null;
      renderCards();
      setStatus("Removed that card.");
      return;
    }

    if (target.dataset.action === "duplicate" && !Number.isNaN(index) && state.cards[index]) {
      state.cards.splice(index + 1, 0, { ...state.cards[index] });
      state.currentSetId = null;
      renderCards();
      setStatus("Duplicated that card.");
    }
  });

  savedSetList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const loadId = target.dataset.loadSet;
    if (loadId) {
      loadSet(loadId);
      return;
    }

    const deleteId = target.dataset.deleteSet;
    if (deleteId) {
      await deleteSet(deleteId);
    }
  });

  saveSetBtn.addEventListener("click", async () => {
    const user = getCurrentUser();

    const trimmedCards = state.cards
      .map((card) => ({
        front: (card.front || "").trim(),
        back: (card.back || "").trim()
      }))
      .filter((card) => card.front && card.back);

    if (!trimmedCards.length) {
      setStatus("Add at least one complete flashcard before saving.");
      return;
    }

    const title = setTitleInput.value.trim() || "Untitled Study Set";
    if (isCloudMode()) {
      const cloudPayload = {
        title,
        mode: generatorMode.value,
        sourceText: notesInput.value.trim(),
        cards: trimmedCards,
        updatedAt: serverTimestamp(),
        userId: user.uid
      };

      if (state.currentSetId) {
        await setDoc(doc(db, "users", user.uid, "flashcardSets", state.currentSetId), cloudPayload, { merge: true });
        setStatus(`Updated "${title}".`);
      } else {
        const docRef = await addDoc(collection(db, "users", user.uid, "flashcardSets"), {
          ...cloudPayload,
          createdAt: serverTimestamp()
        });
        state.currentSetId = docRef.id;
        setStatus(`Saved "${title}" to your library.`);
      }
    } else {
      const now = new Date().toISOString();
      const localRecord = {
        id: state.currentSetId || `local-${Date.now()}`,
        title,
        mode: generatorMode.value,
        sourceText: notesInput.value.trim(),
        cards: trimmedCards,
        updatedAt: now,
        createdAt: now
      };

      state.currentSetId = localRecord.id;
      saveLocalSetRecord(localRecord);
      renderSavedSets();
      setStatus(firebaseConfigured
        ? `Saved "${title}" in this browser session. Log in if you want cloud sync.`
        : `Saved "${title}" in this browser session.`);
    }

    currentDeckLabel.textContent = title;
  });

  renderCards();
  loadLocalSets();
  renderSavedSets();

  return {
    handleAuthChange(user) {
      subscribeToSavedSets(user);
      renderSavedSets();
      if (!user) {
        currentDeckLabel.textContent = state.currentSetId
          ? setTitleInput.value.trim() || "Saved deck selected"
          : "Unsaved deck";
      }
    }
  };
}
