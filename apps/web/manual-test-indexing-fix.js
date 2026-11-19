// Manual Test Script for Indexing Details Fix
// Run this in the browser console on the Knowledge Bases page

import { getEmbeddingStatus, formatIndexingDuration } from './src/lib/utils/indexing-details.js';

console.log('=== Testing Indexing Details Utility Functions ===\n');

// Test 1: Source with COMPLETED embedding status
const completedSource = {
  embeddingStatus: 'COMPLETED',
  embeddingsGenerated: 919,
  chunkCount: 919,
  indexingDurationMs: 45230,
  indexingStartedAt: '2026-11-06T10:00:00.000Z',
  indexingCompletedAt: '2026-11-06T10:00:45.230Z',
  extractedTextPreview: 'This is a sample of the extracted text...',
  extractedCharCount: 15420
};

console.log('Test 1: COMPLETED source');
console.log('Embedding Status:', getEmbeddingStatus(completedSource));
console.log('Duration:', formatIndexingDuration(
  completedSource.indexingDurationMs,
  completedSource.indexingStartedAt,
  completedSource.indexingCompletedAt
));
console.log('');

// Test 2: Source with null embedding status (not started)
const queuedSource = {
  embeddingStatus: null,
  chunkCount: 0,
  status: 'QUEUED'
};

console.log('Test 2: QUEUED source (null embeddingStatus)');
console.log('Embedding Status:', getEmbeddingStatus(queuedSource));
console.log('');

// Test 3: Source without embeddingStatus field (undefined)
const legacySource = {
  chunkCount: 50,
  status: 'INDEXED'
};

console.log('Test 3: Legacy source (undefined embeddingStatus)');
console.log('Embedding Status:', getEmbeddingStatus(legacySource));
console.log('');

// Test 4: Source with PROCESSING status
const processingSource = {
  embeddingStatus: 'PROCESSING',
  embeddingsGenerated: 450,
  chunkCount: 919,
  indexingStartedAt: '2026-11-06T10:00:00.000Z'
};

console.log('Test 4: PROCESSING source');
console.log('Embedding Status:', getEmbeddingStatus(processingSource));
console.log('Duration:', formatIndexingDuration(
  null,
  processingSource.indexingStartedAt,
  new Date().toISOString()
));
console.log('');

// Test 5: Duration calculation from timestamps only
const startTime = '2026-11-06T10:00:00.000Z';
const endTime = '2026-11-06T10:02:15.500Z';

console.log('Test 5: Duration from timestamps');
console.log('Duration:', formatIndexingDuration(null, startTime, endTime));
console.log('');

console.log('=== All Tests Complete ===');
console.log('\nExpected Results:');
console.log('- Test 1: available=true, label="Completed (919/919 vectors)", duration="45.2s"');
console.log('- Test 2: available=true, label="Not Started", status="not_started"');
console.log('- Test 3: available=false, label="Unavailable"');
console.log('- Test 4: available=true, label="Processing (450/919 vectors)"');
console.log('- Test 5: duration="2m 16s"');
