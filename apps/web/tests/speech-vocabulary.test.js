import test from "node:test";
import assert from "node:assert/strict";
import {
  applyVocabularyCorrection,
  VOICE_LANGUAGES,
  getDefaultVoiceLanguage,
} from "../src/hooks/use-speech-recognition.js";

test("VOICE_LANGUAGES includes English (India) as primary option", () => {
  const codes = VOICE_LANGUAGES.map((l) => l.code);
  assert.ok(codes.includes("en-IN"), "Should include en-IN for Indian English");
  assert.ok(codes.includes("en-US"), "Should include en-US");
  assert.ok(codes.includes("en-GB"), "Should include en-GB");
  assert.ok(codes.includes("hi-IN"), "Should include hi-IN");
});

test("applyVocabularyCorrection fixes phonetic misrecognitions of Priyanshu Jindal", () => {
  const input1 = "hello my name is priyan shu";
  const corrected1 = applyVocabularyCorrection(input1);
  assert.equal(corrected1, "hello my name is Priyanshu");

  const input2 = "i am priya shoe jindal";
  const corrected2 = applyVocabularyCorrection(input2);
  assert.equal(corrected2, "i am Priyanshu Jindal");

  const input3 = "meeting with priyanshoo jin dal";
  const corrected3 = applyVocabularyCorrection(input3);
  assert.equal(corrected3, "meeting with Priyanshu Jindal");
});

test("applyVocabularyCorrection formats spoken punctuation", () => {
  const input = "what is your name question mark please reply comma now period";
  const corrected = applyVocabularyCorrection(input);
  assert.equal(corrected, "what is your name? please reply, now.");
});

test("applyVocabularyCorrection respects user profile name and custom vocabulary", () => {
  const customUser = { name: "Aarav Sharma" };
  const customWords = ["LangChain", "Rag_Mcp"];

  const text = "hi aarav sharma welcome to langchain and rag mcp";
  const corrected = applyVocabularyCorrection(text, customWords, customUser);

  assert.ok(corrected.includes("Aarav"));
  assert.ok(corrected.includes("Sharma"));
  assert.ok(corrected.includes("LangChain"));
  assert.ok(corrected.includes("Rag_Mcp"));
});

