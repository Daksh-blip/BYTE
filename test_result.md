#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Session 2 (fork) — Phase 1 password fixes + Signal Protocol migration
- Main agent: Reset email pre-fill now uses an in-memory notice (src/auth-notice.ts) read with useFocusEffect in login.tsx. Global 401 handler is in src/api.ts and src/auth.tsx.
- Signal Protocol: src/signal/* and backend /api/signal/*. Legacy chats are read-only until upgraded.
- Self-tests passed: frontend/tests/signal_e2e.mjs (25/25), backend pytest api (11/11, register test skipped due to the email rate limit), signal_migration (3/3), passwords (13/13), pw_iter5 (11/11).

## Session 3 — audit fixes, live delivery, encrypted photos, multi-device linking
- Security audit: fixed account enumeration (signup returns the same response for existing accounts; dummy bcrypt on unknown-email login), photo route checks blocks, CORS without credentials and configurable via CORS_ORIGINS.
- Live delivery: WebSocket /api/ws (token in the first frame; session re-checked on every frame). Events carry no content: message, typing, read, opened, sync. Receipts toggle in Settings is reciprocal.
- Encrypted photos: XChaCha20 on the device → POST /api/matches/{id}/media (ciphertext only). The key travels inside the Signal message. View-once opens exactly once (atomic, 410 afterwards; the sender can't open it).
- Multi-device: up to 3 devices, each with its own Signal identity (sigUserId "uid.hex"). Each message is encrypted per device (ciphertexts map, exact device set enforced). A new device is pending until a linked device approves it with a 6-digit code. History goes to the new device as a Signal-encrypted transfer via /api/signal/sync. "Takeover" (re-enter password) makes the current device the only one. Migration 2026-10-multidevice retires old single-device records.
- Self-tests passed: frontend/tests/signal_e2e.mjs 30/30, pytest signal_migration 3/3 and passwords 13/13. api tests: the duplicate-register test was updated for the enumeration fix.

## Session 4 — iteration_7 fixes, QR device linking, Google/Apple sign-in, Claude AI
- Fixes: AuthGuard now sends auto-logged-out users to /auth/login (notice set before signOut; hasLoginNotice in auth-notice.ts). Settings signal status shows "Waiting for approval…" when the device is pending. Takeover also revokes PENDING devices + their sessions; DELETE device clears pending. Device list hides expired pending requests and shows "Requested <time>"; code input is full width. View-once photo key is dropped only on 410/403. sendTyping throttle per match.
- QR linking: pending device shows a QR (payload bytetalks-link:v1:<deviceId>:<code>, testID device-link-qr) plus the 6-digit code. Linked device has "Scan code to link a device" (devices-scan-button) -> LinkScanner modal (expo-camera, permission pre-prompt / Open Settings). Manual code entry still works.
- Google sign-in (Emergent): POST /api/auth/google {session_id}; buttons on Welcome and Login (google-sign-in-button). Web callback handled in AuthProvider mount. Apple: POST /api/auth/apple, native button iOS only.
- Claude (claude-sonnet-5-5 via Emergent key): /api/ai/icebreakers/{match}, /api/ai/date-ideas/{match}, /api/ai/bio, /api/admin/reports/{id}/ai-summary. UI: chat-ai-button -> ai-ideas-sheet; edit-bio-ai-button -> ai-bio-sheet; admin sheet admin-ai-summary-button.
