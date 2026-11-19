/**
 * Base plugin for Mongoose models to standardize JSON serialization
 * - Replaces _id with id (string)
 * - Removes __v
 * - Strips sensitive hashes (passwordHash, tokenHash, keyHash, secretHash)
 * @param {import('mongoose').Schema} schema
 * @param {string[]} [excludedFields]
 */
export function applyToJSONTransform(schema, excludedFields = []) {
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id ? ret._id.toString() : ret.id;
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      delete ret.tokenHash;
      delete ret.keyHash;
      delete ret.secretHash;
      for (const field of excludedFields) {
        delete ret[field];
      }
      return ret;
    },
  });
}

export default applyToJSONTransform;

