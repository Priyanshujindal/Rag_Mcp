# RAG Pipeline Audit - Manual Testing Steps

## Overview
These are manual testing steps to verify the RAG pipeline improvements implemented in Phase 2.

## Prerequisites
1. System must be running (MongoDB, AI Service, Web frontend)
2. At least one workspace with a knowledge base containing indexed documents
3. Access to system logs (for viewing logging improvements)

## Test 1: Empty Context Handling (Strengthened System Rule)

### Purpose
Verify that when no relevant context is found, the chatbot responds with the correct fallback message.

### Steps
1. Log in to the web interface
2. Navigate to a chatbot connected to a knowledge base
3. Ask a question that is completely unrelated to the indexed content
   - Example: If your KB is about technical documentation, ask "What is the recipe for chocolate cake?"
4. Observe the chatbot response

### Expected Result
The chatbot should respond with:
"I don't have enough information in the knowledge base to answer that question."

The chatbot should NOT attempt to answer from its general knowledge.

### Notes
- This verifies the strengthened system rule #5 in IMMUTABLE_SYSTEM_RULES
- The backend already had fallback handling, but this makes it more explicit


## Test 2: Threshold Filtering with Logging

### Purpose
Verify that when min_score_threshold filters all results, a warning is logged.

### Prerequisites
- Access to AI service logs (check console output or log files)
- Knowledge base with indexed content

### Steps
1. Use the RAG Debugger or API to make a retrieval request
2. Set a very high `min_score_threshold` (e.g., 0.95 or 0.99)
3. Use a query that would normally return some results
4. Check the AI service logs

### Expected Result
You should see a WARNING log entry similar to:
```
WARNING: min_score_threshold=0.99 filtered all 5 candidate(s); highest_score=0.67
```

This log entry should appear when candidates were retrieved but all were filtered out by the threshold.

### API Test Example
```bash
curl -X POST http://localhost:8000/v1/internal/retrieve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_INTERNAL_API_KEY" \
  -d '{
    "query": "user authentication",
    "workspace_id": "YOUR_WORKSPACE_ID",
    "kb_id": "YOUR_KB_ID",
    "min_score_threshold": 0.95
  }'
```

### Notes
- This feature helps diagnose when threshold settings are too restrictive
- The log only appears when candidates exist but are filtered
- The log includes the count and highest score to help tune the threshold


## Test 3: Empty Retrieval Results (No Change, Verify Existing Behavior)

### Purpose
Verify that when no candidates are retrieved (empty search results), the system handles it gracefully.

### Steps
1. Use the RAG Debugger or API to make a retrieval request
2. Use a query with a workspace/KB that has no indexed documents
   OR use a brand new workspace with an empty knowledge base
3. Observe the response

### Expected Result
- The API should return a valid response with empty results
- No errors or crashes
- The chatbot should provide the fallback message (from Test 1)

### Notes
- This behavior already existed; we're just verifying it wasn't broken


## Test 4: Integration Test Suite

### Purpose
Verify that all automated tests pass.

### Steps
```powershell
cd services/ai-service
.\.venv\Scripts\Activate.ps1
python -m pytest tests/test_retrieval.py tests/test_prompt_builder.py -v -p no:logfire
```

### Expected Result
All tests should pass (29 tests):
- 23 existing tests (unchanged)
- 2 new tests: `test_empty_retrieval_results` and `test_all_results_filtered_by_threshold`
- 4 prompt builder tests (including existing empty context test)

Note: `test_all_results_filtered_by_threshold` may skip with a warning due to Atlas Search indexing delays - this is expected.


## Test 5: Frontend Build

### Purpose
Verify that frontend builds successfully (no breaking changes).

### Steps
```powershell
cd apps/web
npm run build
```

### Expected Result
Build completes successfully with no errors.


## Additional Verification

### Log Location
AI Service logs can be found at:
- Console output if running in development mode
- Docker logs: `docker logs <ai-service-container-name>`
- Log files if configured (check `services/ai-service/app/core/config.py`)

### RAG Debugger
The web interface includes a RAG Debugger (if enabled) that shows:
- Retrieved passages
- Scores
- Filtering applied
- Final results

This is useful for visual verification of the retrieval pipeline.


## Summary of Changes

1. **Strengthened Empty Context Rule**: Added explicit rule #5 to IMMUTABLE_SYSTEM_RULES
2. **Threshold Filtering Log**: Added WARNING log when min_score_threshold filters all candidates
3. **Integration Tests**: Added 2 new tests to verify empty handling scenarios

## Audit Findings Status

| Finding | Status | Notes |
|---------|--------|-------|
| Empty query validation missing | ✗ INCORRECT | Already implemented with `min_length=1` in Pydantic schemas |
| Empty results not handled | ✓ PARTIAL | Already had fallback but strengthened with explicit rule #5 |
| Citation validation missing | ⚠️ DEFERRED | Not critical for current scope; system already prevents invalid citations |

