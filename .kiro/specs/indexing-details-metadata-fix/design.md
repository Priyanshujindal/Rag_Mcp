# Indexing Details Metadata Exposure Bugfix Design

## Overview

The bug occurs because the backend Mongoose Source model includes metadata fields like `embeddingStatus`, `indexingDurationMs`, `indexingStartedAt`, `indexingCompletedAt`, `extractedTextPreview`, `extractedCharCount`, and `embeddingsGenerated` in the schema, and the ingestion pipeline correctly persists these values to MongoDB. However, when the API returns source documents via `GET /sources/:id`, these fields are successfully included in the response through the Mongoose `toJSON()` transformation. The issue is that the frontend API client's `getSource()` function properly maps most of these fields but the UI displays "Unavailable" fallback messages, suggesting the UI component itself may have conditional logic that incorrectly treats valid data as missing.

The fix ensures that all ingestion metadata fields flow correctly from the database through the API to the frontend, and that the UI properly displays the actual values instead of fallback messages.

## Glossary

- **Bug_Condition (C)**: The condition where the UI displays "Unavailable" messages for metadata fields that exist in the database and API response
- **Property (P)**: The desired behavior where the UI displays actual metadata values from the API response
- **Preservation**: Existing source document functionality including basic fields (name, url, status, chunkCount), chunk loading, and source CRUD operations
- **Source Model**: The Mongoose schema in `apps/api/src/db/models/source.model.js` that defines the MongoDB document structure
- **toJSON() Transform**: The Mongoose plugin applied via `applyToJSONTransform(sourceSchema)` that converts `_id` to `id` in JSON responses
- **sourcesService.getById()**: The service function in `apps/api/src/modules/documents/sources.service.js` that retrieves a source and calls `toJSON()`
- **getSource()**: The frontend API client function in `apps/web/src/lib/api/real.js` that fetches source data and maps fields
- **Ingestion Pipeline**: The Python service in `services/ai-service/app/ingestion/pipeline.py` that processes documents and persists metadata

## Bug Details

### Bug Condition

The bug manifests when the UI component responsible for displaying indexing details receives a source object with metadata fields but displays "Unavailable" fallback messages instead of the actual values. This suggests the UI component has conditional logic checking for the presence of these fields that is either incorrectly implemented or checking for the wrong field names/structure.

**Formal Specification:**
```
FUNCTION isBugCondition(sourceResponse)
  INPUT: sourceResponse of type SourceObject from API
  OUTPUT: boolean
  
  RETURN sourceResponse.embeddingStatus IS NOT NULL
         AND sourceResponse.extractedTextPreview IS NOT NULL
         AND sourceResponse.indexingDurationMs IS NOT NULL
         AND UI displays "Unavailable" for any of these fields
END FUNCTION
```

### Examples

- **Example 1**: After successful URL crawl, `embeddingStatus` is "COMPLETED" in MongoDB and API response, but UI shows "Unavailable - Backend does not expose status"
- **Example 2**: After successful file upload, `indexingDurationMs` is 1523 in MongoDB and API response, but UI shows "Unavailable - Timestamps not exposed"
- **Example 3**: After successful indexing, `extractedTextPreview` contains "This is the beginning of the document..." in MongoDB and API response, but UI shows "Extracted text preview is not exposed by the backend API"
- **Edge Case**: When `embeddingStatus` is explicitly set to `null` (legitimately unavailable), UI should correctly show "Not Available" or similar (not "Unavailable - Backend does not expose status")

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Source CRUD operations (create, list, get, delete) must continue to work correctly
- Chunk retrieval via `GET /sources/:id/chunks` must continue to return correct chunk data
- The `toJSON()` transformation must continue to convert `_id` to `id` in all responses
- Existing source fields (name, url, type, status, chunkCount, error, timestamps) must continue to display correctly
- Source reindexing must continue to update metadata without creating duplicate records
- Pagination for source lists and chunk lists must continue to work correctly

**Scope:**
All inputs that do NOT involve the metadata display UI component should be completely unaffected by this fix. This includes:
- Source list views that show basic information only
- Chunk content display
- Source creation and deletion flows
- Knowledge base management operations

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **UI Component Conditional Logic**: The UI component may be checking for metadata fields using incorrect field names, incorrect null/undefined checks, or checking for nested properties that don't exist in the flattened API response structure

2. **Field Name Mismatch**: The UI may be looking for field names that differ from what the API returns (e.g., checking for `extractedText` when the API returns `extractedTextPreview`)

3. **Type Coercion Issues**: The UI may be using strict equality checks that fail when numeric fields like `indexingDurationMs` are returned as numbers but checked as strings, or when `null` values are not distinguished from `undefined`

4. **Missing Frontend Type Definitions**: The TypeScript/JSDoc definitions for the source object may not include these metadata fields, causing the UI to treat them as non-existent even when present in the runtime object

## Correctness Properties

Property 1: Bug Condition - Metadata Display Shows Actual Values

_For any_ source document returned by the API where metadata fields (`embeddingStatus`, `indexingDurationMs`, `indexingStartedAt`, `indexingCompletedAt`, `extractedTextPreview`, `extractedCharCount`, `embeddingsGenerated`) exist and are not null, the UI SHALL display the actual values from these fields instead of "Unavailable" fallback messages.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation - Existing Source Functionality

_For any_ source operation that does NOT involve the metadata display UI component (source list, chunk retrieval, source CRUD operations), the system SHALL produce exactly the same behavior as before the fix, preserving all existing functionality for source management and chunk operations.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Based on the root cause analysis, the fix requires changes to the UI component that displays indexing details.

**File**: Likely `apps/web/src/components/[SourceDetails|IndexingStatus].svelte` or similar (exact path to be determined during implementation)

**Function/Component**: The Svelte component responsible for rendering the "Indexing Details" section

**Specific Changes**:

1. **Update Conditional Checks**: Replace incorrect conditional logic that checks for metadata field presence
   - Change from strict null checks to proper null/undefined coalescing
   - Ensure field names match exactly what `getSource()` returns (e.g., `extractedText` vs `extractedTextPreview`)
   - Use proper TypeScript/JSDoc type guards if applicable

2. **Fix Embedding Status Display**: Update the conditional rendering for embedding status
   - Check for `source.embeddingStatus !== null && source.embeddingStatus !== undefined`
   - Display actual status value with appropriate badge styling for COMPLETED/PROCESSING/FAILED/PENDING
   - Only show "Not Available" when the field is explicitly `null` or `undefined`

3. **Fix Duration Display**: Update the conditional rendering for indexing duration
   - Check for `source.indexingDurationMs !== null && source.indexingDurationMs !== undefined`
   - Calculate human-readable duration from milliseconds (e.g., "1.5s", "342ms", "2.3s")
   - Alternatively, calculate from `indexingStartedAt` and `indexingCompletedAt` if `indexingDurationMs` is not available
   - Only show "Not Available" when both `indexingDurationMs` is null/undefined AND timestamp calculation is not possible

4. **Fix Extracted Text Preview Display**: Update the conditional rendering for extracted text preview
   - Check for `source.extractedText !== null && source.extractedText !== undefined && source.extractedText.length > 0`
   - Display the preview text in a formatted text area or pre-formatted block
   - Show character count from `source.extractedCharCount` if available
   - Only show "No preview available" when the field is explicitly `null`, `undefined`, or empty string

5. **Add Type Definitions**: Update TypeScript interfaces or JSDoc comments to include metadata fields
   - Ensure `Source` type includes all metadata fields with correct types
   - Mark fields as optional (`?:`) to reflect that they may be null for QUEUED sources
   - Add JSDoc comments documenting when each field is expected to be populated

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code by verifying "Unavailable" messages appear when metadata exists, then verify the fix displays actual values and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that the UI displays "Unavailable" when metadata fields exist in the API response. This validates our root cause analysis.

**Test Plan**: Use browser DevTools to inspect the network response for `GET /sources/:id` and verify metadata fields are present, then visually inspect the UI to confirm "Unavailable" messages appear. Run these observations on the UNFIXED code to understand the root cause.

**Test Cases**:
1. **Successfully Indexed URL Source Test**: Create and index a URL source, verify API returns `embeddingStatus: "COMPLETED"`, check UI shows "Unavailable - Backend does not expose status" (will fail on unfixed code)
2. **Successfully Indexed File Source Test**: Upload and index a file, verify API returns `indexingDurationMs: [number]`, check UI shows "Unavailable - Timestamps not exposed" (will fail on unfixed code)
3. **Extracted Text Preview Test**: Verify API returns `extractedTextPreview: "[text]"`, check UI shows "Extracted text preview is not exposed by the backend API" (will fail on unfixed code)
4. **QUEUED Source Test**: Check that a newly created QUEUED source (no metadata yet) correctly shows "Not Available" or similar appropriate message (may work correctly on unfixed code)

**Expected Counterexamples**:
- UI displays hardcoded "Unavailable" messages despite metadata being present in API response
- Possible causes: incorrect field name checks, incorrect null checks, missing reactive bindings in Svelte component

### Fix Checking

**Goal**: Verify that for all source documents where metadata fields exist in the API response, the UI displays the actual values instead of "Unavailable" messages.

**Pseudocode:**
```
FOR ALL sourceDocument WHERE hasMetadataFields(sourceDocument) DO
  apiResponse := GET /sources/:id
  uiDisplay := renderSourceDetails(apiResponse)
  ASSERT uiDisplay contains apiResponse.embeddingStatus value
  ASSERT uiDisplay contains apiResponse.indexingDurationMs formatted value
  ASSERT uiDisplay contains apiResponse.extractedTextPreview text
END FOR
```

### Preservation Checking

**Goal**: Verify that for all source operations that do NOT involve the metadata display UI, the system produces the same result as the original code.

**Pseudocode:**
```
FOR ALL sourceOperation WHERE NOT isMetadataDisplayOperation(sourceOperation) DO
  ASSERT fixedSystem(sourceOperation) = originalSystem(sourceOperation)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across different source types, statuses, and operations
- It catches edge cases that manual unit tests might miss (e.g., sources with null fields, sources mid-indexing)
- It provides strong guarantees that behavior is unchanged for all non-metadata-display operations

**Test Plan**: Document current behavior on UNFIXED code for source lists, chunk retrieval, and CRUD operations, then write property-based tests or comprehensive integration tests capturing that behavior.

**Test Cases**:
1. **Source List Display Preservation**: Verify that source lists continue to show correct basic information (name, status, chunkCount) without regression
2. **Chunk Retrieval Preservation**: Verify that `GET /sources/:id/chunks` continues to return correct chunk data with pagination
3. **Source CRUD Preservation**: Verify that create, delete, and reindex operations continue to work correctly
4. **toJSON Transform Preservation**: Verify that all API responses continue to transform `_id` to `id` correctly

### Unit Tests

- Test UI component rendering with mock source objects containing metadata fields
- Test UI component rendering with mock source objects missing metadata fields (null/undefined)
- Test duration calculation logic for various `indexingDurationMs` values
- Test duration calculation from timestamp difference when `indexingDurationMs` is unavailable
- Test embedding status badge rendering for all status values (COMPLETED, PROCESSING, FAILED, PENDING)
- Test extracted text preview truncation and character count display

### Property-Based Tests

- Generate random source documents with various combinations of metadata fields (some null, some populated)
- Verify UI displays actual values for populated fields and appropriate "Not Available" messages for null fields
- Generate random source operations (list, get, chunks, create, delete, reindex) and verify existing functionality is preserved
- Test edge cases with extreme values (very large `indexingDurationMs`, very long `extractedTextPreview`, etc.)

### Integration Tests

- Test full source creation and indexing flow, verify metadata appears in UI once indexing completes
- Test source reindexing flow, verify metadata updates correctly in UI
- Test source details page load for sources in different states (QUEUED, PROCESSING, INDEXED, FAILED)
- Test that metadata display updates reactively when source transitions from PROCESSING to INDEXED
