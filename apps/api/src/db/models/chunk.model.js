import mongoose from "mongoose";

// Read-only-facing model for the existing AI-service "chunks" collection.
// strict:false is intentional because AI-service owns the full chunk schema.
const chunkSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    knowledgeBaseId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    ingestionId: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
  },
  { strict: false, versionKey: false, collection: "chunks" }
);

export const Chunk = mongoose.models.Chunk || mongoose.model("Chunk", chunkSchema);
export default Chunk;
