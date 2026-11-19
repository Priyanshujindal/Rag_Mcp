import fs from "fs";
import path from "path";
import crypto from "crypto";

const STORAGE_DIR = path.resolve(process.cwd(), "storage");

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Storage service interface (local disk implementation, swappable with S3)
 */
export const storage = {
  /**
   * Saves a buffer to local disk storage
   * @param {Buffer} buffer
   * @param {string} originalName
   * @returns {Promise<{ fileKey: string, filePath: string, size: number }>}
   */
  async saveFile(buffer, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const hash = crypto.randomBytes(16).toString("hex");
    const filename = `${Date.now()}-${hash}${ext}`;
    const filePath = path.join(STORAGE_DIR, filename);

    await fs.promises.writeFile(filePath, buffer);
    return {
      fileKey: `uploads/${filename}`,
      filePath,
      size: buffer.length,
    };
  },

  /**
   * Deletes a file by its key
   * @param {string} fileKey
   */
  async deleteFile(fileKey) {
    const filename = path.basename(fileKey);
    const filePath = path.join(STORAGE_DIR, filename);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  },
};

export default storage;

