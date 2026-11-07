/**
 * Backfill script to populate metadata for sources indexed before metadata fields were added.
 * 
 * Run from apps/api: node scripts/backfill-source-metadata.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from workspace root
dotenv.config({ path: join(__dirname, "../../.env") });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "Rag_Mcp";

console.log("MongoDB URI:", MONGODB_URI ? "Loaded" : "MISSING");
console.log("Database:", DB_NAME);

async function backfillMetadata() {
  try {
    console.log("\nConnecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    console.log("Connected!\n");

    const db = mongoose.connection.db;
    const sourcesCollection = db.collection("sources");
    const chunksCollection = db.collection("chunks");

    // Find sources that need backfilling
    const sourcesToBackfill = await sourcesCollection
      .find({
        status: "INDEXED",
        $or: [
          { embeddingStatus: null },
          { embeddingStatus: { $exists: false } },
          { extractedTextPreview: null },
          { extractedTextPreview: { $exists: false } },
        ],
      })
      .toArray();

    if (sourcesToBackfill.length === 0) {
      console.log("No sources need backfilling!");
      await mongoose.disconnect();
      return;
    }

    console.log(`Found ${sourcesToBackfill.length} sources to backfill\n`);

    for (const source of sourcesToBackfill) {
      console.log(`Processing: ${source.name || "Unnamed"}`);
      console.log(`  ID: ${source._id}`);

      // Get chunks for this source
      const chunks = await chunksCollection
        .find({ sourceId: source._id })
        .limit(50)
        .toArray();

      if (chunks.length === 0) {
        console.log(`  Warning: No chunks found - skipping\n`);
        continue;
      }

      // Build text preview from first 20 chunks
      const textChunks = chunks
        .slice(0, 20)
        .map((c) => c.text || "")
        .filter((t) => t.length > 0);
      const extractedPreview = textChunks.join("\n\n").slice(0, 5000);

      // Calculate total characters
      const sampleChars = chunks.reduce((sum, c) => sum + (c.text?.length || 0), 0);
      const totalChunkCount = await chunksCollection.countDocuments({
        sourceId: source._id,
      });
      const estimatedTotalChars = Math.round(
        sampleChars * (totalChunkCount / chunks.length)
      );

      // Check if chunks have embeddings
      const chunksWithEmbeddings = chunks.filter(
        (c) => c.embedding && Array.isArray(c.embedding) && c.embedding.length > 0
      );
      const hasEmbeddings = chunksWithEmbeddings.length === chunks.length;

      console.log(`  Chunks checked: ${chunks.length}`);
      console.log(`  Chunks with embeddings: ${chunksWithEmbeddings.length}`);
      console.log(`  Sample embedding length: ${chunksWithEmbeddings[0]?.embedding?.length || 0}`);

      const embeddingStatus = hasEmbeddings ? "COMPLETED" : "PENDING";
      const embeddingsGenerated = hasEmbeddings ? totalChunkCount : 0;

      // Update source
      await sourcesCollection.updateOne(
        { _id: source._id },
        {
          $set: {
            embeddingStatus,
            embeddingsGenerated,
            extractedTextPreview: extractedPreview,
            extractedCharCount: estimatedTotalChars,
            chunkCount: totalChunkCount,
            updatedAt: new Date(),
          },
        }
      );

      console.log(`  Updated!`);
      console.log(`     Embedding Status: ${embeddingStatus}`);
      console.log(`     Embeddings: ${embeddingsGenerated}/${totalChunkCount}`);
      console.log(`     Preview Length: ${extractedPreview.length} chars`);
      console.log(`     Estimated Total: ${estimatedTotalChars.toLocaleString()} chars\n`);
    }

    console.log(`Backfill complete! Updated ${sourcesToBackfill.length} sources`);
  } catch (error) {
    console.error("Error:", error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  }
}

backfillMetadata();
