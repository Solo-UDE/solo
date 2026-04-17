# Solo Vault — Cloud Computing Project Report

**Project:** Solo IDE Cloud Vault & Microservices Architecture
**Course:** Cloud Computing
**Date:** 2026-04-05
**Team Size:** 4 (1 frontend/IDE lead + 3 backend/infra engineers)
**Timeline:** 2-3 weeks

---

## 1. Project Overview

Solo IDE is a desktop integrated development environment built with Tauri 2 (Rust backend, React 19 frontend). It features a built-in AI agent powered by the Claude SDK, a terminal emulator, file explorer, code editor, and full git integration.

This project extends Solo IDE with a **cloud-backed knowledge vault** — a personal data store where users can index structured data and files that become accessible to the AI agent during conversations. The entire backend is deployed on AWS using a serverless microservices architecture.

### Problem Statement

Currently, all user data in Solo IDE is stored locally. The AI agent only has access to files currently open in the workspace. There is no way for users to persist knowledge across projects, share context between sessions, or leverage cloud-scale indexing and search.

### Solution

A **Vault** system that:
- Allows users to store structured data (notes, snippets, configs, key-value pairs) and files (PDFs, documents, images)
- Indexes all vault content through an event-driven pipeline for semantic search
- Makes indexed knowledge available to the AI agent via automatic retrieval (RAG) and explicit references
- Supports both project-scoped and user-scoped (global) data
- Syncs agent conversation sessions to the cloud for cross-device access
- Delivers real-time indexing progress feedback via WebSockets

---

## 2. AWS Services & Architecture

### 2.1 Service Inventory (15 AWS Services)

| # | AWS Service | Purpose in Architecture |
|---|-------------|------------------------|
| 1 | **Amazon Cognito** | User authentication and authorization. Issues JWTs for API access. Linked to existing Supabase auth via server-side bridge. |
| 2 | **Amazon API Gateway (REST)** | RESTful API entry point for vault CRUD operations, search, and session sync. Integrates with Cognito authorizer. |
| 3 | **Amazon API Gateway (WebSocket)** | Real-time bidirectional communication for indexing progress updates pushed to the desktop application. |
| 4 | **AWS Lambda** | 8 serverless functions handling authentication, vault CRUD, file operations, semantic search, session sync, and WebSocket notifications. |
| 5 | **Amazon S3** | Durable object storage for vault files. Organized per-user with project-scoped and global directories. Triggers indexing pipeline on upload. |
| 6 | **Amazon RDS (PostgreSQL)** | Relational database with pgvector extension for both structured metadata storage and vector similarity search (embeddings). |
| 7 | **Amazon SQS** | Message queue decoupling file uploads from the indexing pipeline. Provides retry logic and dead-letter queue for failed jobs. |
| 8 | **AWS Step Functions** | Orchestrates the 6-stage indexing pipeline: validate, extract text, chunk, generate embeddings, store, notify. Visual execution tracking. |
| 9 | **Amazon EventBridge** | Event bus routing pipeline state changes to notification and monitoring systems. Loose coupling between pipeline stages. |
| 10 | **Amazon SNS** | Fan-out notification on indexing completion. Triggers WebSocket Lambda and optional email notification. |
| 11 | **Amazon DynamoDB** | NoSQL key-value store for cloud-synced agent conversation sessions. TTL-based auto-expiry after 30 days. |
| 12 | **Amazon CloudFront** | CDN for vault file delivery via signed URLs. Low-latency access to stored documents. |
| 13 | **Amazon CloudWatch** | Centralized logging, metrics, and alarms for all Lambda functions and pipeline executions. |
| 14 | **AWS KMS** | Customer-managed encryption keys for S3 server-side encryption and RDS encryption at rest. |
| 15 | **AWS Secrets Manager** | Secure storage for database credentials, API keys, and third-party service tokens used by Lambda functions. |

### 2.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    SOLO IDE (Desktop)                │
│                                                      │
│  Vault Panel ←→ vault_commands.rs ──── HTTPS/WSS ──→│
│  Agent Panel ←→ agent_commands.rs                    │
│  Session Sync ←→ session_sync_commands.rs            │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                    AWS CLOUD                          │
│                                                       │
│  ┌────────────┐    ┌─────────────────────────┐        │
│  │ CloudFront │───→│  API Gateway             │        │
│  └────────────┘    │  (REST + WebSocket)      │        │
│                    └──────────┬───────────────┘        │
│                    ┌──────────┼──────────┐             │
│                    ▼          ▼          ▼              │
│              Cognito    Lambda (x8)   WebSocket         │
│              (Auth)     (Handlers)    (Progress)        │
│                              │                          │
│              ┌───────────────┼───────────────┐          │
│              ▼               ▼               ▼           │
│             S3             RDS           DynamoDB         │
│          (Files)      (PostgreSQL       (Sessions)        │
│              │         + pgvector)                        │
│         S3 Event                                         │
│              ▼                                           │
│             SQS ──→ Step Functions                       │
│                     (6-stage pipeline)                   │
│                            │                             │
│                      EventBridge                         │
│                       │        │                         │
│                      SNS   CloudWatch                    │
│                       │                                  │
│                   WebSocket                              │
│                   (notify)                               │
│                                                          │
│   Supporting: KMS (encryption) │ Secrets Manager (keys)  │
└──────────────────────────────────────────────────────────┘
```

### 2.3 Architectural Decisions

**Why Serverless (Lambda + API Gateway)?**
- Pay-per-use pricing suitable for a development/demo environment
- Auto-scaling without infrastructure management
- Each Lambda function is a focused microservice with a single responsibility
- API Gateway provides built-in rate limiting, auth integration, and request validation

**Why pgvector in RDS instead of a dedicated vector database?**
- Eliminates an additional service dependency (Pinecone, Weaviate)
- Structured metadata and vector embeddings coexist in one engine
- Simpler queries: JOIN vault_entries with vault_chunks for filtered similarity search
- PostgreSQL is industry-standard — team members are already familiar

**Why Step Functions for the indexing pipeline?**
- Visual execution DAG in AWS console — excellent for demos
- Built-in retry logic, error handling, and timeout per stage
- Each stage is independently deployable and testable
- State machine definition is declarative (ASL JSON)

**Why DynamoDB for sessions instead of RDS?**
- Session data is key-value (user_id + session_id → messages)
- No relational queries needed — just put/get by key
- TTL attribute provides automatic cleanup after 30 days
- Demonstrates both SQL (RDS) and NoSQL (DynamoDB) in the same project

---

## 3. What We Are Building

### 3.1 Vault System (Core Feature)

Users store knowledge in the vault as entries of different types:

| Entry Type | Description | Example |
|------------|-------------|---------|
| **Note** | Free-form text content | Meeting notes, design decisions |
| **File** | Uploaded document | PDFs, images, configuration files |
| **Snippet** | Code blocks | Reusable code patterns, templates |
| **Config** | Configuration data | Environment variables, API endpoints |
| **Key-Value** | Structured pairs | Project metadata, reference data |

Each entry can be:
- **Project-scoped** — only available when working in a specific project
- **User-scoped (global)** — available across all projects

All entries are automatically processed through the indexing pipeline and become searchable by the AI agent.

### 3.2 Indexing Pipeline

A 6-stage Step Functions pipeline processes every vault entry:

1. **Validate** — Check file type, size, and user quota
2. **Extract Text** — Convert files to plain text (PDF extraction, OCR for images, raw for code)
3. **Chunk** — Split into ~500 token segments for granular retrieval
4. **Generate Embeddings** — Create vector embeddings (1536-dimensional) for semantic search
5. **Store** — Write chunks and vectors to RDS with pgvector
6. **Notify** — Send completion event via EventBridge → SNS → WebSocket

Real-time progress is streamed back to the desktop application via WebSocket API Gateway.

### 3.3 AI Agent Integration

The vault feeds knowledge into the AI agent through two modes:

**Automatic RAG (Retrieval-Augmented Generation):**
Before each agent response, the system searches the vault for content relevant to the user's message. Top matching chunks (cosine similarity > 0.7) are injected into the agent's context.

**Explicit References (`@vault`):**
Users can explicitly reference vault entries by name (e.g., `@vault(api-spec)`). The full entry content is injected as an attachment to the agent message.

### 3.4 Cloud-Synced Sessions

Agent conversation history is synced to DynamoDB for cross-device access:
- Local-first: app works offline, sync is async
- On each message: write local + async push to cloud
- On app open: merge local and cloud sessions (last-write-wins)

### 3.5 Authentication Bridge

Existing Supabase auth (GitHub OAuth + magic link) is preserved. A server-side bridge auto-creates Cognito users when they first access vault features. Users see a single login flow — Cognito is invisible.

---

## 4. APIs Provisioned

### 4.1 REST API Endpoints (14 total)

**Authentication (2 endpoints):**
```
POST   /auth/link              → Link Supabase user to Cognito
POST   /auth/refresh           → Refresh Cognito JWT tokens
```

**Vault CRUD (5 endpoints):**
```
GET    /vault/entries           → List entries (filter by project, scope, tags)
POST   /vault/entries           → Create new vault entry
GET    /vault/entries/{id}      → Get entry details
PUT    /vault/entries/{id}      → Update entry
DELETE /vault/entries/{id}      → Delete entry + S3 cleanup
```

**Vault Files (2 endpoints):**
```
POST   /vault/entries/{id}/upload    → Get pre-signed S3 upload URL
GET    /vault/entries/{id}/download  → Get CloudFront signed URL
```

**Vault Search (1 endpoint):**
```
POST   /vault/search           → Semantic vector search (pgvector)
```

**Session Sync (4 endpoints):**
```
GET    /sessions                → List cloud sessions
POST   /sessions/sync          → Push session to cloud
GET    /sessions/{id}          → Pull specific session
DELETE /sessions/{id}          → Delete cloud session
```

### 4.2 WebSocket API

```
$connect       → Authenticate via Cognito token
$disconnect    → Clean up connection mapping
index_progress → Server pushes indexing pipeline progress
```

### 4.3 Lambda Functions (8 total)

| Lambda | Trigger | Purpose |
|--------|---------|---------|
| `auth-handler` | API Gateway | Cognito user creation and token exchange |
| `vault-crud` | API Gateway | Entry create, read, update, delete, list |
| `vault-files` | API Gateway | Pre-signed URL generation for S3 upload/download |
| `vault-search` | API Gateway | pgvector similarity search in RDS |
| `pipeline-validate` | Step Functions | Entry validation (type, size, quota) |
| `pipeline-process` | Step Functions | Text extraction, chunking, embedding generation |
| `pipeline-store` | Step Functions | Write chunks + vectors to RDS |
| `ws-notify` | EventBridge/SNS | Push progress updates via WebSocket |

---

## 5. Data Model

### 5.1 RDS Schema (PostgreSQL + pgvector)

Four tables: `users`, `projects`, `vault_entries`, `vault_chunks`

- **users** — Cognito user ID, email, created_at
- **projects** — User's projects with workspace paths
- **vault_entries** — All vault items with type, tags, metadata (JSONB), S3 references, index status
- **vault_chunks** — Indexed text chunks with 1536-dimensional vector embeddings

Key indexes:
- IVFFlat index on vault_chunks.embedding for fast cosine similarity search
- GIN index on vault_entries.tags for tag-based filtering
- Composite index on (user_id, project_id) for scoped queries

### 5.2 S3 Structure

Per-user directory hierarchy with global and project-scoped partitions:
```
solo-vault-{env}/users/{cognito_user_id}/global/files/
solo-vault-{env}/users/{cognito_user_id}/projects/{project_id}/files/
```

### 5.3 DynamoDB Schema

Table `solo-sessions` with composite key (user_id, session_id). GSI on project_id for project-scoped session queries. TTL on 30-day expiry.

---

## 6. Team Allocation & Timeline

### Team Roles

| Member | Role | Repository |
|--------|------|-----------|
| **Sachin** | IDE integration lead (Tauri commands, React UI, agent integration) | Solo IDE repo |
| **Engineer 1** | AWS infrastructure & IaC (Cognito, API Gateway, S3, RDS, KMS, Secrets Manager) | Cloud repo |
| **Engineer 2** | Lambda functions & API development (CRUD, files, auth, WebSocket) | Cloud repo |
| **Engineer 3** | Pipeline & data (Step Functions, SQS, EventBridge, SNS, DynamoDB, search) | Cloud repo |

### Week-by-Week Plan

**Week 1 — Foundation:**
- AWS infrastructure provisioned (all services created and configured)
- Lambda functions for auth and vault CRUD operational
- Solo IDE vault panel scaffold with Tauri commands
- Basic end-to-end: create entry → store in RDS → list in UI

**Week 2 — Pipeline + Integration:**
- Step Functions pipeline fully operational (all 6 stages)
- WebSocket progress streaming working
- CloudFront file delivery configured
- DynamoDB session sync operational
- Agent integration (RAG search + @vault references)
- Full vault panel UI with upload, search, progress

**Week 3 — Polish + Demo:**
- End-to-end testing across all services
- Error handling and edge cases
- Performance optimization (pgvector tuning, Lambda cold starts)
- Demo environment setup and rehearsal
- Documentation and presentation preparation

---

## 7. Demo Plan

A 3-5 minute live demonstration covering the full data flow:

1. **Login** — Authenticate in Solo IDE (Supabase → auto Cognito link)
2. **Create** — Open Vault panel, add a text entry with tags
3. **Upload** — Upload a PDF file, watch real-time progress bar
4. **AWS Console** — Show Step Functions DAG executing with green/blue stages
5. **Search** — Search the vault, find indexed content
6. **Agent RAG** — Ask the AI agent a question, see vault context auto-injected
7. **Explicit Reference** — Use `@vault(entry)` syntax for targeted retrieval
8. **Session Sync** — Show conversation stored in DynamoDB
9. **Infrastructure** — Walk through CloudWatch logs, S3 bucket, RDS tables

This demonstrates the complete lifecycle: user action → event-driven pipeline → cloud storage → AI-powered retrieval → real-time feedback, touching all 15 AWS services.
