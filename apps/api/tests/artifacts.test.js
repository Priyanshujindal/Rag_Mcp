import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { Artifact, Message } from "../src/db/models/index.js";
import { FileIntentService } from "../src/modules/chat/file-intent.service.js";
import storageService from "../src/services/storage.service.js";

describe("Artifacts & File Generation Engine", () => {
  describe("FileIntentService - Natural Language Intent Detection", () => {
    it("detects PDF generation intent", () => {
      const res = FileIntentService.detectFileIntent("Create a PDF containing my DSA notes.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("pdf");
      expect(res.filename).toContain(".pdf");
      expect(res.title.toLowerCase()).toContain("dsa notes");
    });

    it("detects Word (.docx) generation intent", () => {
      const res = FileIntentService.detectFileIntent("Generate a Word document explaining neural networks.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("docx");
      expect(res.filename).toContain(".docx");
      expect(res.title.toLowerCase()).toContain("neural networks");
    });

    it("detects PowerPoint (.pptx) presentation intent", () => {
      const res = FileIntentService.detectFileIntent("Create a 10-slide PowerPoint presentation about Generative AI.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("pptx");
      expect(res.filename).toContain(".pptx");
    });

    it("detects Excel (.xlsx) spreadsheet intent", () => {
      const res = FileIntentService.detectFileIntent("Create an Excel sheet containing my monthly expenses.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("xlsx");
      expect(res.filename).toContain(".xlsx");
    });

    it("detects CSV generation intent", () => {
      const res = FileIntentService.detectFileIntent("Generate a CSV containing this dataset.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("csv");
      expect(res.filename).toContain(".csv");
    });

    it("detects Python script generation intent", () => {
      const res = FileIntentService.detectFileIntent("Generate a Python script for binary search.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("py");
      expect(res.filename).toContain(".py");
    });

    it("detects Markdown (.md) generation intent with 'md file'", () => {
      const res = FileIntentService.detectFileIntent("generate a md file about artificial intelligence");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("md");
      expect(res.filename).toContain(".md");
      expect(res.title.toLowerCase()).toContain("artificial intelligence");
    });

    it("detects image generation intent", () => {
      const res = FileIntentService.detectFileIntent("generate an image of a cybernetic cat in Tokyo");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("image");
      expect(res.filename).toContain(".webp");
      expect(res.title.toLowerCase()).toContain("cybernetic cat");
    });

    it("cleans markdown content by stripping outer fences, preamble, and postamble", () => {
      const raw = "Sure! Here is your document:\n```markdown\n# Architecture Guide\n\nThis is the content.\n```\nHope this helps!";
      const cleaned = FileIntentService.cleanMarkdownContent(raw, "Architecture Guide");
      expect(cleaned).toContain("# Architecture Guide");
      expect(cleaned).toContain("This is the content.");
      expect(cleaned).not.toContain("```markdown");
      expect(cleaned).not.toContain("Sure! Here is");
      expect(cleaned).not.toContain("Hope this helps!");
    });

    it("detects previous message conversion intent", () => {
      const res = FileIntentService.detectFileIntent("Convert this response into a PDF.");
      expect(res.hasIntent).toBe(true);
      expect(res.fileType).toBe("pdf");
      expect(res.isConvertPrevious).toBe(true);
    });

    it("returns hasIntent: false for normal questions", () => {
      const res = FileIntentService.detectFileIntent("What is the capital of France?");
      expect(res.hasIntent).toBe(false);
    });
  });

  describe("FileIntentService - Content Parsing", () => {
    it("parses markdown tables into headers and typed rows", () => {
      const mdTable = `
| Product | Price | Units |
|---------|-------|-------|
| Laptop  | 1200  | 5     |
| Mouse   | 25    | 50    |
      `;
      const parsed = FileIntentService.parseMarkdownTable(mdTable);
      expect(parsed.headers).toEqual(["Product", "Price", "Units"]);
      expect(parsed.rows.length).toBe(2);
      expect(parsed.rows[0]).toEqual(["Laptop", 1200, 5]);
      expect(parsed.rows[1]).toEqual(["Mouse", 25, 50]);
    });

    it("strips markdown asterisks and parses currency/numbers from tables", () => {
      const mdTable = `
| **Category** | **Budget** | **Actual** | Notes |
|---|---|---|---|
| **Housing** | $1,500 | $1,450 | Rent |
| **Transportation** | $300 | $320 | Gas and metro |
| **Total** | **$1,800** | **$1,770** | Monthly sum |
      `;
      const parsed = FileIntentService.parseMarkdownTable(mdTable);
      expect(parsed.headers).toEqual(["Category", "Budget", "Actual", "Notes"]);
      expect(parsed.rows[0]).toEqual(["Housing", 1500, 1450, "Rent"]);
      expect(parsed.rows[1]).toEqual(["Transportation", 300, 320, "Gas and metro"]);
      expect(parsed.rows[2]).toEqual(["Total", 1800, 1770, "Monthly sum"]);
    });

    it("extracts code blocks from markdown responses", () => {
      const response = "Here is the code:\n```python\ndef solve():\n    return 42\n```\nHope that helps!";
      const code = FileIntentService.extractCodeSnippet(response, "py");
      expect(code).toBe("def solve():\n    return 42");
    });

    it("parses presentation slides from markdown headings and bullet points", () => {
      const text = `
# Slide 1: Introduction
- Overview of deep learning
- History and milestones

## Slide 2: Architecture
- Transformer models
- Self-attention mechanism
      `;
      const slides = FileIntentService.parseSlides(text);
      expect(slides.length).toBe(2);
      expect(slides[0].title).toBe("Introduction");
      expect(slides[0].points.length).toBe(2);
      expect(slides[1].title).toBe("Architecture");
      expect(slides[1].points.length).toBe(2);
    });
  });

  describe("StorageService - Workspace Tenant Isolation", () => {
    const testWsId = "672c1234567890abcdef1234";
    const testFilename = "report.pdf";
    const testBuffer = Buffer.from("%PDF-1.4 Mock PDF content");
    let savedStorageKey = "";
    let savedStoragePath = "";

    it("saves artifact file inside workspace directory", async () => {
      const saved = await storageService.saveFile(testWsId, testFilename, testBuffer);
      savedStorageKey = saved.storageKey;
      savedStoragePath = saved.storagePath;

      expect(saved.sizeBytes).toBe(testBuffer.length);
      expect(fs.existsSync(saved.storagePath)).toBe(true);
      expect(saved.storagePath).toContain(testWsId);
    });

    it("reads artifact file safely for matching workspace", async () => {
      const readBuffer = await storageService.readFile(testWsId, savedStoragePath);
      expect(readBuffer.toString()).toBe(testBuffer.toString());
    });

    it("rejects unauthorized read if accessed across workspaces (tenant isolation)", async () => {
      const otherWsId = "672c9999999999abcdef9999";
      await expect(storageService.readFile(otherWsId, savedStoragePath)).rejects.toThrow();
    });

    it("deletes artifact file cleanly", async () => {
      await storageService.deleteFile(testWsId, savedStoragePath);
      expect(fs.existsSync(savedStoragePath)).toBe(false);
    });
  });

  describe("Artifact Model", () => {
    it("serializes artifact cleanly and exposes id without _id or __v", () => {
      const artifact = new Artifact({
        workspaceId: new mongoose.Types.ObjectId(),
        conversationId: new mongoose.Types.ObjectId(),
        filename: "notes.pdf",
        fileType: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storageKey: "abc_notes.pdf",
        storagePath: "/tmp/abc_notes.pdf",
        status: "ready",
      });

      const json = artifact.toJSON();
      expect(json).toHaveProperty("id");
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
      expect(json.filename).toBe("notes.pdf");
      expect(json.fileType).toBe("pdf");
      expect(json.status).toBe("ready");
    });
  });
});

