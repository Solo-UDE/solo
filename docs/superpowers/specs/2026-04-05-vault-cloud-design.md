# Solo Vault & Cloud Services — Design Specification

**Date:** 2026-04-05
**Author:** Sachin + Team
**Status:** Approved
**Timeline:** 2-3 weeks

---

## Context

Solo IDE is a Tauri 2 desktop IDE with a Rust backend and React 19 frontend. It currently has full local capabilities (terminal, file explorer, AI agent, code editor, git integration, auth) but no cloud persistence.

This project extends Solo with a **Vault** — a cloud-backed knowledge store where users index structured data and files that the AI agent can retrieve during conversations. The backend is deployed entirely on AWS as a serverless microservices architecture, built by a team of 3 backend/infra engineers in a separate repository.

**Why:** This is a Cloud Computing course project where the primary evaluation criteria is depth of AWS service usage. The vault feature naturally touches 15 AWS services, each architecturally justified.

**Outcome:** Users get a personal knowledge base scoped per-project or globally, searchable by the AI agent via RAG (automatic) and explicit `@vault` references, with real-time indexing feedback via WebSockets.

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    SOLO IDE (Tauri)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │VaultPanel│  │AgentPanel│  │ Cloud Session Sync │  │
│  └────┬─────┘  └────┬─────┘  └─────────┬─────────┘  │
│       │              │                  │            │
│  ┌────┴──────────────┴──────────────────┴──────┐     │
│  │          vault_commands.rs (Tauri IPC)       │     │
│  │          session_sync_commands.rs            │     │
│  └─────────────────────┬───────────────────────┘     │
└────────────────────────┼─────────────────────────────┘
                         │ HTTPS + WSS
                         ▼
┌─────────────────────────────────────────────────────┐
│               AWS CLOUD (Team's Repo)               │
│                                                      │
│  CloudFront ──→ API Gateway (REST + WebSocket)       │
│                       │                              │
│            ┌──────────┼──────────┐                   │
│            ▼          ▼          ▼                    │
│     Cognito     Lambda (x8)   WebSocket              │
│     (auth)      (handlers)    (progress)             │
│                       │                              │
│         ┌─────────────┼─────────────┐                │
│         ▼             ▼             ▼                 │
│        S3           RDS          DynamoDB             │
│    (files)     (metadata +    (sessions)             │
│         │       search index)                        │
│    S3 Event                                          │
│         ▼                                            │
│        SQS ──→ Step Functions Pipeline               │
│                 │→ Extract text                       │
│                 │→ Chunk content                      │
│                 │→ Generate embeddings                │
│                 │→ Store in RDS                       │
│                 │→ SNS notify                         │
│                                                      │
│   EventBridge │ CloudWatch │ KMS │ Secrets Manager   │
└─────────────────────────────────────────────────────┘
```

**Two repos, one product:**
- **Solo IDE repo** (Sachin): New vault_commands.rs, vault panel, agent integration, session sync
- **Cloud repo** (Team): All AWS infrastructure + Lambda functions + API definitions

**Communication:** Desktop app → AWS via HTTPS (REST API Gateway) and WSS (WebSocket API Gateway). Cognito JWTs in Authorization headers.

---

## AWS Service Map — 15 Services

| # | Service | Role | Justification |
|---|---------|------|---------------|
| 1 | **Cognito** | User auth (sign-up, sign-in, JWT tokens) | Per-user identity. Maps users to S3 paths and RDS records. |
| 2 | **API Gateway (REST)** | CRUD API for vault entries + files | Single entry point. Rate limiting, auth integration built-in. |
| 3 | **API Gateway (WebSocket)** | Real-time indexing progress | Push progress to Solo IDE as Step Functions pipeline advances. |
| 4 | **Lambda** | 8 functions across CRUD, search, indexing, sync | Stateless compute. Pay-per-use, auto-scaling. |
| 5 | **S3** | File storage (vault documents, images, code) | Durable object storage. Triggers events on upload. Per-user paths. |
| 6 | **RDS (PostgreSQL + pgvector)** | Metadata, search index, embeddings | Structured data + vector similarity search in one engine. |
| 7 | **SQS** | Queue between upload and indexing pipeline | Decouples upload latency from indexing. Retry + dead-letter queue. |
| 8 | **Step Functions** | Orchestrate multi-stage indexing pipeline | Visual pipeline: extract → chunk → embed → index → notify. |
| 9 | **EventBridge** | Route pipeline state change events | Loose coupling between stages and notification system. |
| 10 | **SNS** | Notify on indexing completion | Fanout to WebSocket Lambda + optional email. |
| 11 | **DynamoDB** | Cloud-synced agent sessions | Fast key-value access. TTL for auto-expiry. |
| 12 | **CloudFront** | CDN for vault file retrieval | Signed URLs for secure access. Low-latency delivery. |
| 13 | **CloudWatch** | Logging, metrics, alarms | Operational visibility. Alarm on pipeline failures. |
| 14 | **KMS** | Encryption at rest for S3 + RDS | Security best practice. Server-side encryption. |
| 15 | **Secrets Manager** | Store API keys, DB credentials | Lambda runtime secret retrieval. Rotation support. |

---

## Vault Data Model

### S3 Bucket Structure

```
solo-vault-{env}/
  users/
    {cognito_user_id}/
      global/                    ← user-scoped (available in all projects)
        files/{uuid}.{ext}
      projects/
        {project_id}/            ← project-scoped
          files/{uuid}.{ext}
```

### RDS Schema (PostgreSQL + pgvector)

```sql
-- Users table (synced from Cognito)
CREATE TABLE users (
  id UUID PRIMARY KEY,           -- Cognito sub
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  workspace_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Vault entries (structured data + file references)
CREATE TABLE vault_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  project_id UUID REFERENCES projects(id) NULL,  -- NULL = user-scoped (global)
  title TEXT NOT NULL,
  content TEXT,
  entry_type TEXT NOT NULL,      -- 'note', 'file', 'snippet', 'config', 'keyvalue'
  tags TEXT[],
  metadata JSONB DEFAULT '{}',
  s3_key TEXT,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  index_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Chunks (indexed content pieces)
CREATE TABLE vault_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID REFERENCES vault_entries(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),       -- pgvector: OpenAI ada-002 dimension
  token_count INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_chunks_embedding ON vault_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_entries_user_project ON vault_entries(user_id, project_id);
CREATE INDEX idx_entries_tags ON vault_entries USING gin(tags);
```

**Scoping logic:**
- `project_id = NULL` → user-scoped, available across all projects
- `project_id = {id}` → project-scoped, only in that project
- Agent queries: `WHERE user_id = ? AND (project_id = ? OR project_id IS NULL)`

---

## Indexing Pipeline (Step Functions)

### Pipeline Stages

```
Upload → S3 Event → SQS → Step Functions:
  1. Validate   → Check file type, size, user quota
  2. Extract    → PDF→text, image→OCR, code→raw
  3. Chunk      → Split into ~500 token chunks
  4. Embed      → Generate vector embeddings
  5. Store      → Write chunks + vectors to RDS
  6. Notify     → EventBridge → SNS → WebSocket
```

### Lambda Functions per Stage

| Step | Lambda | Input | Output | Error Handling |
|------|--------|-------|--------|----------------|
| Validate | `validate-entry` | entry_id, s3_key | validated metadata | Fail → mark entry `failed`, notify |
| Extract | `extract-text` | s3_key, mime_type | raw text | Unsupported type → skip with warning |
| Chunk | `chunk-content` | raw text, config | array of chunks | Empty text → single-chunk passthrough |
| Embed | `generate-embeddings` | chunks[] | chunks[] + vectors[] | API error → retry 3x, then fail |
| Store | `store-indexed` | chunks + vectors | chunk_ids[] | RDS error → retry, then dead-letter |
| Notify | `notify-complete` | entry_id, status | — | Best-effort, non-blocking |

### Real-time Progress via WebSocket

Each Step Functions state transition emits to EventBridge. A Lambda pushes progress via WebSocket API Gateway:

```json
{
  "type": "index_progress",
  "entry_id": "uuid",
  "step": "embed",
  "step_index": 4,
  "total_steps": 6,
  "status": "running",
  "message": "Generating embeddings for 12 chunks..."
}
```

---

## Authentication Flow (Cognito + Supabase Bridge)

Solo keeps Supabase for IDE auth. Cognito is added for vault API auth. Users don't interact with Cognito directly.

### Flow

1. User logs in via Supabase (existing GitHub OAuth / magic link)
2. On success, Solo IDE calls `POST /auth/link` with Supabase token
3. Lambda verifies Supabase JWT, creates/finds Cognito user via `AdminCreateUser`
4. Returns Cognito tokens → stored in CredentialManager (macOS Keychain)
5. All vault API calls use Cognito JWT in Authorization header
6. API Gateway Cognito authorizer validates JWT on every request

### Token Storage

```
CredentialManager (Keychain):
  supabase.accessToken    ← existing
  supabase.refreshToken   ← existing
  cognito.accessToken     ← NEW
  cognito.refreshToken    ← NEW
  cognito.idToken         ← NEW
```

Token refresh: on 401 response, call `POST /auth/refresh` → get new Cognito tokens.

---

## Agent Integration (RAG + Explicit References)

### Mode 1: Auto RAG (automatic)

Before each Claude API call, the agent-bridge:
1. Extracts keywords from user message
2. Calls `POST /vault/search` with query + project context
3. pgvector similarity search returns top 5 relevant chunks
4. Injects results into system prompt as vault context
5. Threshold: cosine similarity > 0.7 only
6. Token budget: cap vault context at ~2000 tokens

### Mode 2: Explicit `@vault` Reference

1. User types `@vault(entry-name)` in agent message
2. Frontend parses `@vault()` syntax
3. Calls `GET /vault/entries?title=entry-name`
4. Full entry content injected as explicit attachment
5. No similarity threshold — user explicitly requested it

### Integration Point

In `agent-bridge/src/agent.ts`:
- Pre-message hook calls vault search API
- New attachment type `vault_entry`
- `formatVaultContext()` utility formats chunks for system prompt

---

## Solo IDE Integration

### New Files

```
solo/
├── crates/solo-protocol/src/lib.rs          ← Add VaultEntry, VaultChunk types
├── apps/desktop/src-tauri/src/
│   ├── vault_commands.rs                    ← 8 Tauri commands
│   ├── session_sync_commands.rs             ← 4 Tauri commands
│   └── lib.rs                               ← Register new modules
├── apps/desktop/src/
│   ├── lib/tauri/vault.ts                   ← TS IPC wrappers
│   ├── lib/tauri/sessionSync.ts             ← TS IPC wrappers
│   ├── stores/vaultStore.ts                 ← Zustand store
│   ├── stores/sessionSyncStore.ts           ← Zustand store
│   ├── hooks/useVaultStream.ts              ← WebSocket listener
│   ├── components/vault/                    ← UI components
│   │   ├── VaultPanel.tsx
│   │   ├── VaultEntryList.tsx
│   │   ├── VaultEntryForm.tsx
│   │   ├── VaultFileUpload.tsx
│   │   ├── VaultSearch.tsx
│   │   ├── VaultScopeToggle.tsx
│   │   └── VaultIndexProgress.tsx
│   └── components/panels/VaultPanel.tsx     ← Panel registration
```

### Tauri Commands

```
vault_list_entries(project_id, scope, filters)    → Vec<VaultEntry>
vault_create_entry(title, content, type, tags)    → VaultEntry
vault_update_entry(entry_id, updates)             → VaultEntry
vault_delete_entry(entry_id)                      → ()
vault_upload_file(entry_id, file_path)            → UploadResult
vault_download_file(entry_id)                     → FilePath
vault_search(query, project_id, top_k)            → Vec<VaultSearchResult>
vault_get_index_status(entry_id)                  → IndexStatus

session_sync_push(session_id)                     → SyncResult
session_sync_pull()                               → Vec<SessionSummary>
session_sync_restore(session_id)                  → Session
session_sync_delete(session_id)                   → ()
```

---

## Cloud-Synced Sessions (DynamoDB)

### Data Model

```
Table: solo-sessions
  PK: user_id (String)
  SK: session_id (String)

Attributes:
  messages: List<Map>
  model: String
  project_id: String
  created_at: Number
  updated_at: Number
  ttl: Number (auto-expire 30 days)

GSI: project-sessions-index
  PK: project_id
  SK: updated_at
```

### Sync Strategy

- **Local-first:** App works fully offline. Cloud sync is best-effort async.
- **On message added:** Write local (instant) + async POST to DynamoDB (background).
- **On app open:** Compare local sessions with cloud → merge (cloud timestamp wins).
- **Conflict resolution:** Last-write-wins based on `updated_at`.

---

## REST API Design

### Auth
```
POST   /auth/link              ← Link Supabase user to Cognito
POST   /auth/refresh           ← Refresh Cognito tokens
```

### Vault CRUD
```
GET    /vault/entries           ← List entries (query: project_id, scope, tags, page)
POST   /vault/entries           ← Create entry
GET    /vault/entries/{id}      ← Get entry details
PUT    /vault/entries/{id}      ← Update entry
DELETE /vault/entries/{id}      ← Delete entry (+ S3 cleanup)
```

### Vault Files
```
POST   /vault/entries/{id}/upload    ← Get pre-signed S3 upload URL
GET    /vault/entries/{id}/download  ← Get CloudFront signed URL
```

### Vault Search
```
POST   /vault/search           ← Semantic search (body: query, project_id, top_k)
```

### Session Sync
```
GET    /sessions                ← List cloud sessions
POST   /sessions/sync          ← Push session to cloud
GET    /sessions/{id}          ← Pull specific session
DELETE /sessions/{id}          ← Delete cloud session
```

### WebSocket
```
$connect    ← Auth via Cognito token in query string
$disconnect ← Clean up connection
index_progress ← Server pushes indexing progress events
```

**Total: 14 REST endpoints + 1 WebSocket channel = 8 Lambda functions**

---

## Team Work Split & Timeline

### Week 1: Foundation

| Person | Work |
|--------|------|
| **Engineer 1** | AWS infra: Cognito, API Gateway (REST + WebSocket), S3 + KMS, RDS + pgvector, Secrets Manager. IaC with CDK/CloudFormation. |
| **Engineer 2** | Lambda functions: auth/link, vault CRUD, S3 pre-signed URLs |
| **Engineer 3** | Lambda functions: search (pgvector), SQS setup, Step Functions skeleton |
| **Sachin** | Solo IDE: vault_commands.rs, vault.ts wrappers, vaultStore.ts, VaultPanel scaffold, Cognito in CredentialManager |

### Week 2: Pipeline + Integration

| Person | Work |
|--------|------|
| **Engineer 1** | Complete Step Functions pipeline, EventBridge, SNS, CloudWatch alarms |
| **Engineer 2** | WebSocket API Gateway, CloudFront, DynamoDB sessions table |
| **Engineer 3** | Session sync Lambdas, search optimization, DLQ, integration tests |
| **Sachin** | VaultPanel UI, useVaultStream.ts, agent integration in agent-bridge |

### Week 3: Polish + Demo

| Person | Work |
|--------|------|
| **All engineers** | E2E testing, performance tuning, error handling, demo env setup |
| **Sachin** | Session sync UI, @vault parsing, vault panel polish, demo prep |

---

## Verification & Testing

1. **Auth flow:** Login Supabase → auto-link Cognito → vault API calls work with JWT
2. **Upload flow:** Create entry → upload file → see in S3 → pipeline starts
3. **Pipeline:** Step Functions console — all 6 stages green
4. **Real-time:** WebSocket delivers progress → vault panel shows live progress bar
5. **Search:** After indexing, semantic search returns relevant chunks
6. **Agent RAG:** Ask agent a question → vault context auto-injected → agent references vault data
7. **@vault reference:** `@vault(entry-name)` → full entry injected as context
8. **Session sync:** Conversation → appears in DynamoDB → restore on new device
9. **Scope isolation:** Project-scoped entries only visible in that project

---

## Demo Script (3-5 minutes)

1. Open Solo IDE, log in (Supabase → auto Cognito link)
2. Open Vault panel → create text entry "API Design Spec" with tags
3. Upload PDF file → show real-time progress bar as it indexes
4. Switch to AWS console → show Step Functions DAG executing live
5. Back to Solo IDE → search vault → find indexed content
6. Open Agent panel → ask about the API spec → agent auto-retrieves vault context
7. Use `@vault(api-design-spec)` for explicit reference
8. Show DynamoDB session sync in AWS console
9. Show CloudWatch logs, S3 bucket structure, RDS tables
