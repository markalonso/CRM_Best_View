# CRM Best View - Architecture Scaffold

Production-ready architecture for an AI-powered CRM intake platform.

## Stack
- Next.js 14 (App Router)
- Tailwind CSS
- ShadCN UI setup
- Zustand (state management)
- Supabase (Auth + Postgres + Storage)

## Folder Structure
```
app/
components/
modules/
  sale/
  rent/
  buyers/
  clients/
  intake/
  media/
  dashboard/
  search/
lib/
services/
  api/
  ai/
  storage/
  supabase/
  integrations/
hooks/
store/
types/
```

## Layering Rules
- **UI layer**: `app/`, `components/`, `hooks/`, `store/`
- **Business logic**: `modules/*/*.service.ts`
- **Data access/integrations**: `modules/*/*.repository.ts`, `services/*`

## Navigation Layout (current)
- Left sidebar sections:
  - Inbox
  - Sale Properties
  - Rent Properties
  - Buyers
  - Clients
  - Media
  - Dashboard
- Top bar:
  - Global Search
  - Add New Intake
  - Notifications
  - User Profile
- Main layout:
  - Sidebar + Topbar + Main content area
- Prepared view modes:
  - Grid / Kanban / Dashboard / Map (future)

## Auth
- Request middleware is implemented in `middleware.ts`.
- Public routes: `/`, `/inbox`, `/api/health`, and `/api/inbox/*`.
- All other routes require Supabase access token cookie (`sb-access-token`).

## Environment Variables
Create `.env.local`:
```bash
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

Validated in `lib/env.ts` with Zod.

## AI and API Boundaries
- AI clients/services are server-side only under `services/ai`.
- API orchestration layer is in `services/api`.
- Route handlers are thin transport adapters under `app/api/*`.

## Future Integrations (prepared)
- `services/integrations/google-sheets.service.ts`
- `services/integrations/voiceflow.service.ts`
- `services/integrations/telegram.service.ts`

## Notes
- Feature modules are intentionally placeholders until implementation phase.


## Inbox (implemented)
- Intake Review wizard route `/inbox/[id]` with 4 steps: Confirm Type, Extracted Data Review, New vs Existing, Merge & Save.
- Review save action performs create/update, links intake media to selected record, and writes timeline events.
- Route: `/inbox`
- CRM-style intake session table with filters: status, type, has media, date range, and text search.
- Right-side drawer with full raw text, media previews, AI suggested type/confidence, and `Review & Confirm` action placeholder.
- `New Intake` modal supports pasted text + multi-file upload and saves draft intake sessions.
- Backend endpoint `POST /api/inbox/sessions` creates draft `intake_sessions` rows and uploads files to `crm-media/intake_sessions/{session_id}/` then inserts `media` records.
- Backend endpoint `GET /api/inbox/sessions` returns inbox listing with media counts and filter support.


## Unified Media Manager
- Reusable `MediaManager` component is now used in Inbox drawer, Intake Review, and record pages (sale/rent/buyers/clients).
- Upload supports drag-drop + multi-select and stores files in:
  - `/media/{record_type}/{record_id}/` for confirmed records
  - `/intake_sessions/{session_id}/` for draft intake sessions
- Media metadata stored in `media` table: `record_type`, `record_id`, `intake_session_id`, `file_url`, `mime_type`, `media_type`, `original_filename`, `file_size`, `created_at`.
- Duplicate prevention for intake uploads uses same `original_filename + file_size` in same `intake_session_id`.
- Storage provider abstraction added for future Dropbox sync support (`dropbox_folder_link`).


## AI Intake Processing API
- `POST /api/ai/process-intake` input: `{ intake_session_id }`.
- Flow: fetch `raw_text` -> detect type/language -> extract strict JSON by type -> deterministic validate/normalize.
- Persists `type_detected`, `ai_json`, `ai_meta`, and updates intake status to `needs_review` when critical fields are missing.


## Strict Extraction Prompts
- Implemented dedicated prompt builders: `getSalePrompt()`, `getRentPrompt()`, `getBuyerPrompt()`, `getClientPrompt()`.
- Extraction now validates against strict per-type schemas and applies deterministic normalization rules in `validateAndNormalize`.
- If extraction JSON cannot be repaired, `/api/ai/process-intake` marks session `needs_review` and stores the error in `ai_meta`.
