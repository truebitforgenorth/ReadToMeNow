import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initFlashcards } from "./flashcards.js";
import { initReadAloud } from "./read-aloud.js";

const firebaseConfig = window.FIREBASE_CONFIG || {};
const firebaseConfigured = ["apiKey", "authDomain", "projectId", "appId"].every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value.trim() && !value.includes("YOUR_");
});

let app = null;
let auth = null;
let db = null;

if (firebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const state = {
  user: null,
  authMode: "signup"
};

const firebaseBanner = document.getElementById("firebaseBanner");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userChip = document.getElementById("userChip");
const authModal = document.getElementById("authModal");
const authBackdrop = document.getElementById("authBackdrop");
const closeAuthBtn = document.getElementById("closeAuthBtn");
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authCopy = document.getElementById("authCopy");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const modeToggleBtn = document.getElementById("modeToggleBtn");
const authMessage = document.getElementById("authMessage");
const displayNameField = document.getElementById("displayNameField");
const displayNameInput = document.getElementById("displayNameInput");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");

function setBanner(message, ready = false) {
  if (!firebaseBanner) {
    return;
  }

  firebaseBanner.textContent = message;
  firebaseBanner.classList.toggle("is-ready", ready);
}

function setAuthMessage(message, tone = "") {
  authMessage.textContent = message;
  authMessage.className = "auth-message";
  if (tone) {
    authMessage.classList.add(tone);
  }
}

function openAuthModal() {
  authModal.classList.remove("hidden");
  authModal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  authModal.classList.add("hidden");
  authModal.setAttribute("aria-hidden", "true");
  setAuthMessage("");
}

function applyAuthMode() {
  const isLogin = state.authMode === "login";
  authTitle.textContent = isLogin ? "Log in to save study sets" : "Create an account for saved flashcards";
  authCopy.textContent = isLogin
    ? "Use your email and password to open your saved flashcard library."
    : "Create a simple student account so your flashcard sets stay tied to you.";
  authSubmitBtn.textContent = isLogin ? "Log In" : "Create Account";
  modeToggleBtn.textContent = isLogin ? "Need an account?" : "Already have an account?";
  displayNameField.classList.toggle("hidden", isLogin);
}

function renderAuthState() {
  const user = state.user;
  const label = user
    ? user.displayName || user.email || "Signed in"
    : "Guest mode";

  userChip.textContent = label;
  loginBtn.classList.toggle("hidden", Boolean(user));
  logoutBtn.classList.toggle("hidden", !user);

  if (!firebaseConfigured) {
    userChip.textContent = "Firebase not set";
    loginBtn.textContent = "Set Up Firebase";
    logoutBtn.classList.add("hidden");
    return;
  }

  loginBtn.textContent = "Log In";
}

loginBtn.addEventListener("click", () => {
  state.authMode = "login";
  applyAuthMode();

  if (!firebaseConfigured) {
    openAuthModal();
    setAuthMessage("Add your Firebase credentials in js/firebase-config.js first.", "is-error");
    return;
  }

  setAuthMessage("");
  openAuthModal();
});

logoutBtn.addEventListener("click", async () => {
  if (!auth) {
    return;
  }

  await signOut(auth);
  setAuthMessage("Logged out.", "is-success");
});

closeAuthBtn.addEventListener("click", closeAuthModal);
authBackdrop.addEventListener("click", closeAuthModal);
modeToggleBtn.addEventListener("click", () => {
  state.authMode = state.authMode === "login" ? "signup" : "login";
  applyAuthMode();
  setAuthMessage("");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!firebaseConfigured || !auth) {
    setAuthMessage("Add your Firebase credentials in js/firebase-config.js first.", "is-error");
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const displayName = displayNameInput.value.trim();

  try {
    if (state.authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
      setAuthMessage("Logged in.", "is-success");
    } else {
      const credentials = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(credentials.user, { displayName });
      }
      setAuthMessage("Account created.", "is-success");
    }

    authForm.reset();
    state.authMode = "login";
    applyAuthMode();
    closeAuthModal();
  } catch (error) {
    const message = error && error.message ? error.message.replace("Firebase: ", "") : "Could not complete authentication.";
    setAuthMessage(message, "is-error");
  }
});

applyAuthMode();

if (firebaseConfigured) {
  setBanner("Firebase is connected. Users can log in and save flashcard sets.", true);
} else {
  setBanner("Add your Firebase project keys in js/firebase-config.js to enable login and saved flashcards.");
}

renderAuthState();

const flashcards = initFlashcards({
  db,
  auth,
  firebaseConfigured,
  openAuthModal,
  getCurrentUser: () => state.user
});

initReadAloud();

if (auth) {
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    renderAuthState();
    flashcards.handleAuthChange(user);
  });
} else {
  flashcards.handleAuthChange(null);
}
