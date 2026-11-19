/**
 * Reindex queue stub (will connect to Redis BullMQ in future stages)
 */
export const reindexQueue = {
  async add(name, data) {
    return { id: "stub-reindex-job-id", name, data, status: "NOT_IMPLEMENTED" };
  },
};

export default reindexQueue;

