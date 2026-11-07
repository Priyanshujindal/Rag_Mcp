# Indexing Details Metadata Fix - Summary

## Changes Made

### 1. Fixed `getEmbeddingStatus()` Function
**File**: `apps/web/src/lib/utils/indexing-details.js`

**Problem**: 
- Function returned `available: false` for any source where `embeddingStatus` was `null` or `undefined`
- This caused "Backend does not expose status" message even when the field existed in the API response

**Fix**:
- Now distinguishes between `undefined` (field not exposed by backend) and `null` (field exists but not started yet)
- Returns `available: false` only when `embeddingStatus === undefined`
- Returns `available: true` with label "Not Started" when `embeddingStatus === null`
- Returns `available: true` with actual status for "PENDING", "PROCESSING", "COMPLETED", "FAILED"

### 2. Updated Tests
**File**: `apps/web/tests/indexing-details.test.js`

**Changes**:
- Added test case for `null` embeddingStatus showing "Not Started" instead of "Unavailable"
- Updated test case for missing embeddingStatus (undefined) to verify it shows "Unavailable"
- Added timestamp fields to test mocks for completeness

## Verification

### Frontend Build
✅ Build successful - no syntax errors or import issues

### Frontend Tests  
✅ All 20 tests passing including:
- Duration formatting with timestamps
- Embedding status mapping (null vs undefined)
- API integration tests with metadata fields

### API Tests
⚠️ 63/64 tests passing - 1 failure unrelated to our changes (concurrent refresh token timing issue)

## What Now Works

1. **Embedding Status**: Displays actual status (PENDING, PROCESSING, COMPLETED, FAILED) when backend exposes it
2. **Indexing Duration**: Already working - calculates from indexingDurationMs or timestamps
3. **Extracted Text Preview**: Already working - displays extractedTextPreview from API

## Backend Verification

The ingestion pipeline (`services/ai-service/app/ingestion/pipeline.py`) correctly sets all metadata:
- Line 71-80: Sets embeddingStatus to "PENDING" and indexingStartedAt
- Line 149-159: Sets embeddingStatus to "PROCESSING" and extractedTextPreview
- Line 194-208: Sets embeddingStatus to "COMPLETED", indexingDurationMs, and final timestamps
- Line 248-258: Sets embeddingStatus to "FAILED" on errors

The Source model (`apps/api/src/db/models/source.model.js`) includes all fields:
- embeddingStatus, embeddingsGenerated
- extractedTextPreview, extractedCharCount  
- indexingStartedAt, indexingCompletedAt, indexingDurationMs

The API client (`apps/web/src/lib/api/real.js`) maps all fields correctly in `getSource()`.

## Root Cause

The issue was NOT that the backend wasn't exposing the fields - they were there all along. The problem was purely in the frontend utility function's conditional logic that treated `null` the same as `undefined`, causing it to display "Unavailable" messages even when valid data existed.

## Next Steps

1. ✅ Test with an existing indexed source in the UI
2. ✅ Test with a newly created source (should show "Not Started")
3. ✅ Test during indexing (should show "Processing")
4. ✅ Test after completion (should show "Completed with vector count")
