/**
 * Ingestion queue stub (will connect to Redis BullMQ in future stages)
 */
export const ingestionQueue = {
  async add(name, data) {
    // Stub implementation returning 501-like response or logger warning
    return { id: "stub-job-id", name, data, status: "NOT_IMPLEMENTED" };
  },
};

export default ingestionQueue;

