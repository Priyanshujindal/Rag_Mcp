import { useState, useRef, useEffect, useCallback } from "react";

export const VOICE_LANGUAGES = [
  { code: "en-IN", label: "English (India)", badge: "EN-IN" },
  { code: "en-US", label: "English (US)", badge: "EN-US" },
  { code: "en-GB", label: "English (UK)", badge: "EN-GB" },
  { code: "hi-IN", label: "Hindi (हिन्दी)", badge: "HI-IN" },
];

/**
 * Determines default voice recognition language.
 * Prefers stored language, or defaults to en-IN for Indian locales and accents.
 */
export function getDefaultVoiceLanguage() {
  try {
    const saved = localStorage.getItem("ragmcp_voice_lang");
    if (saved && VOICE_LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  } catch {}

  if (typeof navigator !== "undefined" && navigator.language) {
    const browser = navigator.language.toLowerCase();
    if (browser.startsWith("hi")) return "hi-IN";
    if (browser.startsWith("en-gb")) return "en-GB";
    if (browser.startsWith("en-us")) return "en-US";
    return "en-IN";
  }
  return "en-IN";
}

/**
 * Corrects common speech-to-text misrecognitions, splits of Indian & custom names,
 * and handles spoken punctuation (e.g. "question mark" -> "?").
 *
 * @param {string} text - Raw transcript from speech recognition
 * @param {Array<string>} [customWords=[]] - Custom vocabulary words
 * @param {object} [user=null] - Logged-in user profile
 * @returns {string} Cleaned transcript
 */
export function applyVocabularyCorrection(text, customWords = [], user = null) {
  if (!text) return text;
  let result = text;

  // 1. Spoken punctuation formatting
  result = result
    .replace(/\s+question mark\b/gi, "?")
    .replace(/\s+comma\b/gi, ",")
    .replace(/\s+(period|full stop)\b/gi, ".")
    .replace(/\s+exclamation (mark|point)\b/gi, "!")
    .replace(/\s+new line\b/gi, "\n");

  // 2. High-priority phonetic variants & syllable splits for user's name & common app terms
  result = result
    .replace(
      /\b(priyan\s*shu|priya\s*shoe|priyanshoo|preeyanshu|prian\s*shoe|priyashu|priyanshu)\b/gi,
      "Priyanshu"
    )
    .replace(/\b(jin\s*dal|jindle|jindal)\b/gi, "Jindal")
    .replace(/\b(rag\s*mcp|ragmcp|rag\s*m\s*c\s*p)\b/gi, "Rag_Mcp")
    .replace(/\b(open\s*router|openrouter)\b/gi, "OpenRouter")
    .replace(/\b(nemotron|nemo\s*tron)\b/gi, "Nemotron")
    .replace(/\b(gemini)\b/gi, "Gemini");

  // 3. User's specific profile name if available
  const userName = user?.name;
  if (userName && typeof userName === "string") {
    const parts = userName.trim().split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (part.length > 2) {
        try {
          const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const reg = new RegExp(`\\b${escaped}\\b`, "gi");
          result = result.replace(reg, part);
        } catch {}
      }
    }
  }

  // 4. Custom words list (e.g. from localStorage or prop)
  if (Array.isArray(customWords)) {
    for (const word of customWords) {
      if (word && typeof word === "string" && word.trim().length > 1) {
        const cleanWord = word.trim();
        try {
          const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const reg = new RegExp(`\\b${escaped}\\b`, "gi");
          result = result.replace(reg, cleanWord);
        } catch {}
      }
    }
  }

  return result;
}

/**
 * Robust Speech-to-Text Dictation Hook.
 * Supports Chrome, Edge, Safari, Brave, and Chromium-based browsers.
 *
 * Features:
 * - Delta-based streaming: Allows user to delete/edit text mid-speech without rewriting or resurrecting deleted text.
 * - Vocabulary & Phonetic corrections for user names and custom domain terms.
 * - Multi-language voice selection with default tuned to user's locale (e.g. en-IN for Indian English phonetics).
 * - High-clarity audio constraints (echoCancellation, noiseSuppression, autoGainControl).
 * - Real-time interim preview with zero duplicate insertions.
 *
 * @param {object} options
 * @param {string} [options.currentInput=""] - Live input value to synchronize manual deletions
 * @param {(text: string) => void} options.onTranscript - Callback with full transcribed text
 * @param {(type: string, msg: string) => void} [options.onError] - Error callback
 * @param {string} [options.lang] - Initial language code
 * @param {Array<string>} [options.customWords=[]] - Custom words / names
 * @param {object} [options.user=null] - User profile
 */
export function useSpeechRecognition({
  currentInput = "",
  onTranscript,
  onError,
  lang,
  customWords = [],
  user = null,
} = {}) {
  const [voiceLang, setVoiceLangState] = useState(() => {
    return lang || getDefaultVoiceLanguage();
  });

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(() => {
    return (
      typeof window !== "undefined" &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  });
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const customWordsRef = useRef(customWords);
  const userRef = useRef(user);

  // Synchronization refs to support manual text deletion without rewriting
  const committedTextRef = useRef(currentInput || "");
  const lastEmittedTextRef = useRef(currentInput || "");
  const lastCommittedIndexRef = useRef(-1);

  // When user types or removes text manually in the textarea while mic is active
  useEffect(() => {
    if (currentInput !== lastEmittedTextRef.current) {
      committedTextRef.current = currentInput || "";
      lastEmittedTextRef.current = currentInput || "";
    }
  }, [currentInput]);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    customWordsRef.current = customWords;
  }, [customWords]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Clean up any active session on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const setVoiceLang = useCallback((newLang) => {
    setVoiceLangState(newLang);
    try {
      localStorage.setItem("ragmcp_voice_lang", newLang);
    } catch {}
  }, []);

  const toggleVoiceLang = useCallback(() => {
    setVoiceLangState((prev) => {
      const idx = VOICE_LANGUAGES.findIndex((l) => l.code === prev);
      const next = VOICE_LANGUAGES[(idx + 1) % VOICE_LANGUAGES.length].code;
      try {
        localStorage.setItem("ragmcp_voice_lang", next);
      } catch {}
      return next;
    });
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      recognitionRef.current = null;
    }
    lastCommittedIndexRef.current = -1;
    setIsListening(false);
  }, []);

  const startListening = useCallback(
    async (currentInputText = "") => {
      setError(null);

      // Initialize with whatever is currently in the input box
      committedTextRef.current = currentInputText || "";
      lastEmittedTextRef.current = currentInputText || "";
      lastCommittedIndexRef.current = -1;

      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setIsSupported(false);
        const msg =
          "Speech recognition is not supported in this browser. Please use Chrome, Edge, Safari, or Brave.";
        setError(msg);
        onErrorRef.current?.("not_supported", msg);
        return;
      }

      // Terminate any previous instance
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }

      // Trigger microphone permission with high-quality hardware audio constraints
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          stream.getTracks().forEach((track) => track.stop());
        } catch (permErr) {
          console.warn("Microphone permission check failed:", permErr);
          const isDenied =
            permErr.name === "NotAllowedError" ||
            permErr.name === "PermissionDeniedError";
          const msg = isDenied
            ? "Microphone access was denied or blocked."
            : permErr.message || "Failed to access microphone.";
          setError(msg);
          onErrorRef.current?.(isDenied ? "permission_denied" : "error", msg);
          setIsListening(false);
          return;
        }
      }

      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = voiceLang;
        recognition.maxAlternatives = 1;

        // Bias speech model using SpeechGrammarList if supported
        const SpeechGrammarList =
          window.SpeechGrammarList || window.webkitSpeechGrammarList;
        if (SpeechGrammarList) {
          try {
            const grammarList = new SpeechGrammarList();
            const vocabTerms = [
              "Priyanshu",
              "Jindal",
              ...(userRef.current?.name ? userRef.current.name.split(/\s+/) : []),
              ...customWordsRef.current,
            ].filter(Boolean);
            if (vocabTerms.length > 0) {
              const jsgf = `#JSGF V1.0; grammar names; public <name> = ${vocabTerms.join(" | ")} ;`;
              grammarList.addFromString(jsgf, 1);
              recognition.grammars = grammarList;
            }
          } catch {}
        }

        recognition.onstart = () => {
          setIsListening(true);
          setError(null);
        };

        recognition.onresult = (event) => {
          let newFinalChunks = "";
          let currentInterim = "";

          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0]?.transcript || "";
            if (result.isFinal) {
              // Only commit results that have not been committed yet
              if (i > lastCommittedIndexRef.current) {
                newFinalChunks += (newFinalChunks ? " " : "") + transcript.trim();
                lastCommittedIndexRef.current = i;
              }
            } else {
              currentInterim += transcript;
            }
          }

          if (newFinalChunks) {
            const cleanFinal = applyVocabularyCorrection(
              newFinalChunks,
              customWordsRef.current,
              userRef.current
            );
            const base = committedTextRef.current.trim();
            committedTextRef.current = base ? `${base} ${cleanFinal}` : cleanFinal;
          }

          let displayText = committedTextRef.current;
          if (currentInterim && currentInterim.trim()) {
            const cleanInterim = applyVocabularyCorrection(
              currentInterim.trim(),
              customWordsRef.current,
              userRef.current
            );
            const base = committedTextRef.current.trim();
            displayText = base ? `${base} ${cleanInterim}` : cleanInterim;
          }

          if (displayText !== lastEmittedTextRef.current) {
            lastEmittedTextRef.current = displayText;
            onTranscriptRef.current?.(displayText);
          }
        };

        recognition.onerror = (event) => {
          console.warn("Speech recognition error:", event.error);
          if (
            event.error === "not-allowed" ||
            event.error === "service-not-allowed"
          ) {
            const msg =
              "Microphone access was denied or blocked. Please allow microphone access in your browser settings.";
            setError(msg);
            onErrorRef.current?.("permission_denied", msg);
          } else if (event.error === "network") {
            const msg = "Network error connecting to speech recognition service.";
            setError(msg);
            onErrorRef.current?.("network", msg);
          } else if (event.error !== "no-speech") {
            const msg = `Speech error: ${event.error}`;
            setError(msg);
            onErrorRef.current?.("error", msg);
          }
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.error("Failed to start SpeechRecognition:", err);
        const errMsg = err.message || "Failed to initialize microphone.";
        setError(errMsg);
        onErrorRef.current?.("error", errMsg);
        setIsListening(false);
      }
    },
    [voiceLang]
  );

  const toggleListening = useCallback(
    (currentInputText = "") => {
      if (isListening) {
        stopListening();
      } else {
        startListening(currentInputText);
      }
    },
    [isListening, startListening, stopListening]
  );

  const currentLangObj =
    VOICE_LANGUAGES.find((l) => l.code === voiceLang) || VOICE_LANGUAGES[0];

  return {
    isListening,
    isSupported,
    error,
    voiceLang,
    voiceLangBadge: currentLangObj.badge,
    voiceLangLabel: currentLangObj.label,
    setVoiceLang,
    toggleVoiceLang,
    startListening,
    stopListening,
    toggleListening,
  };
}
