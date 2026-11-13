# Bugfix Requirements Document

## Introduction

The Indexing Details UI displays "Unavailable" for Embedding Status, Indexing Duration, and Extracted Text Preview fields even when the ingestion pipeline successfully stores this metadata in MongoDB. This occurs because the backend API does not expose these fields in the source document response, causing the frontend to display placeholder values instead of actual ingestion metadata.

The bug affects user visibility into the ingestion process, making it impossible to verify whether embeddings were generated successfully, how long indexing took, or what text was extracted from the source document.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include embeddingStatus in the response even though it exists in MongoDB

1.2 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include indexingDurationMs in the response even though it exists in MongoDB

1.3 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include indexingStartedAt in the response even though it exists in MongoDB

1.4 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include indexingCompletedAt in the response even though it exists in MongoDB

1.5 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include extractedTextPreview in the response even though it exists in MongoDB

1.6 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include extractedCharCount in the response even though it exists in MongoDB

1.7 WHEN the backend API returns a source document via GET /sources/:id THEN the system does not include embeddingsGenerated in the response even though it exists in MongoDB

1.8 WHEN the frontend receives a source document without embeddingStatus THEN the UI displays "Unavailable" with the message "Backend does not expose status"

1.9 WHEN the frontend receives a source document without indexingDurationMs, indexingStartedAt, or indexingCompletedAt THEN the UI displays "Unavailable" with the message "Timestamps not exposed"

1.10 WHEN the frontend receives a source document without extractedTextPreview THEN the UI displays "Extracted text preview is not exposed by the backend API"

### Expected Behavior (Correct)

2.1 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include embeddingStatus in the response when it exists in MongoDB

2.2 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include indexingDurationMs in the response when it exists in MongoDB

2.3 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include indexingStartedAt in the response when it exists in MongoDB

2.4 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include indexingCompletedAt in the response when it exists in MongoDB

2.5 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include extractedTextPreview in the response when it exists in MongoDB

2.6 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include extractedCharCount in the response when it exists in MongoDB

2.7 WHEN the backend API returns a source document via GET /sources/:id THEN the system SHALL include embeddingsGenerated in the response when it exists in MongoDB

2.8 WHEN the frontend receives a source document with embeddingStatus THEN the UI SHALL display the actual embedding status (COMPLETED, PROCESSING, FAILED, or PENDING) with a status badge

2.9 WHEN the frontend receives a source document with indexingDurationMs or both indexingStartedAt and indexingCompletedAt THEN the UI SHALL calculate and display the actual indexing duration in a human-readable format

2.10 WHEN the frontend receives a source document with extractedTextPreview THEN the UI SHALL display the actual extracted text preview with character count

2.11 WHEN the ingestion pipeline successfully completes THEN the system SHALL ensure all metadata fields (embeddingStatus, indexingDurationMs, indexingStartedAt, indexingCompletedAt, extractedTextPreview, extractedCharCount, embeddingsGenerated) are persisted to MongoDB

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the backend API returns a source document via GET /sources THEN the system SHALL CONTINUE TO include workspaceId, knowledgeBaseId, type, name, url, fileKey, status, chunkCount, and timestamps

3.2 WHEN the frontend API client maps a source response via getSource() THEN the system SHALL CONTINUE TO correctly map all existing fields including id, name, url, type, status, and chunkCount

3.3 WHEN a source is successfully indexed THEN the system SHALL CONTINUE TO persist the correct chunkCount to MongoDB

3.4 WHEN the frontend displays chunks via GET /sources/:id/chunks THEN the system SHALL CONTINUE TO display actual chunk content correctly

3.5 WHEN the frontend requests all chunks for a source THEN the system SHALL CONTINUE TO load and display all chunks without data loss through pagination

3.6 WHEN the ingestion pipeline fails THEN the system SHALL CONTINUE TO set status to FAILED and persist the error message

3.7 WHEN the source model transforms to JSON via toJSON() THEN the system SHALL CONTINUE TO apply the existing toJSONTransform plugin that converts _id to id

3.8 WHEN a source is re-indexed THEN the system SHALL CONTINUE TO update the metadata fields without creating duplicate MongoDB records

3.9 WHEN the backend API returns a source list via GET /sources THEN the system SHALL CONTINUE TO support pagination with page and limit parameters

3.10 WHEN the frontend displays the Total Chunks count THEN the system SHALL CONTINUE TO show the correct number from chunkCount field
