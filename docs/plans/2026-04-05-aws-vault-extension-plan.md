# Design: AWS-Native Vault and Cloud Extension for Solo IDE

**Date:** 2026-04-05
**Status:** Draft proposal
**Author:** Sachin + Codex
**Scope:** Add a cloud-backed Vault platform to Solo IDE with AWS-native identity, storage, indexing, retrieval, and realtime progress updates

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why This Fits Solo](#2-why-this-fits-solo)
3. [Current Repo Context and Constraints](#3-current-repo-context-and-constraints)
4. [Problem Statement](#4-problem-statement)
5. [Product Goals and Non-Goals](#5-product-goals-and-non-goals)
6. [The Vault Product Definition](#6-the-vault-product-definition)
7. [Identity, Tenancy, and Access Model](#7-identity-tenancy-and-access-model)
8. [Recommended AWS Architecture](#8-recommended-aws-architecture)
9. [Service-by-Service Breakdown](#9-service-by-service-breakdown)
10. [Data Model](#10-data-model)
11. [API Surface](#11-api-surface)
12. [Desktop Integration in Solo IDE](#12-desktop-integration-in-solo-ide)
13. [Ingestion and Retrieval Flows](#13-ingestion-and-retrieval-flows)
14. [Nice-to-Have Extensions](#14-nice-to-have-extensions)
15. [Team Allocation and Separate Repo Strategy](#15-team-allocation-and-separate-repo-strategy)
16. [Phased Roadmap](#16-phased-roadmap)
17. [Demo Script for the Course](#17-demo-script-for-the-course)
18. [Test Plan and Acceptance Criteria](#18-test-plan-and-acceptance-criteria)
19. [Risks, Tradeoffs, and Key Decisions](#19-risks-tradeoffs-and-key-decisions)
20. [Recommended Defaults](#20-recommended-defaults)

---

## 1. Executive Summary

The strongest extension to Solo IDE is a cloud-backed Vault that lets users store personal and project knowledge outside the local workspace, have that data indexed on AWS, and selectively feed it into the Solo agent when needed.

This closes a real product gap:

- today, most context in Solo is local to the machine, current repo, or active session
- users have no durable cross-project knowledge layer
- teams cannot share project-specific context cleanly
- the agent cannot reliably access user-owned documents, notes, PDFs, or project artifacts that live outside the repo

The proposed solution is to add an AWS-native Vault platform with:

- AWS Cognito for end-user identity
- S3 for raw vault object storage
- RDS PostgreSQL for metadata, project membership, ingestion jobs, and retrieval audit data
- `pgvector` in PostgreSQL for vector retrieval in v1
- EventBridge and queue-driven workers for event-based ingestion pipelines
- realtime job progress via WebSockets or subscriptions
- a desktop-first Vault UI inside Solo IDE
- explicit retrieval into the Solo agent rather than automatic silent context injection

This should be built as a separate cloud/backend repo that is attached to Solo, while this repository remains the main desktop product integration surface.

---

## 2. Why This Fits Solo

Solo already positions itself as:

- an AI-first desktop IDE
- a multi-provider agent environment
- a place where users work across projects, worktrees, sessions, and tools

The Vault turns Solo from "agent inside an IDE" into "agent with durable memory and cloud-backed knowledge."

That unlocks four meaningful product advantages:

1. **Cross-project continuity**  
   Users can retain notes, architecture documents, specifications, decision logs, and research across repositories.

2. **Project-scoped team knowledge**  
   A project can have a shared knowledge base separate from the codebase itself.

3. **Stronger retrieval quality**  
   The agent can answer with better context because it can reference uploaded docs, design notes, product requirements, and PDFs.

4. **AWS-heavy coursework relevance**  
   The project becomes a credible microservices and event-driven cloud architecture case study rather than only a desktop app.

---

## 3. Current Repo Context and Constraints

From the existing Solo repository:

- there is a native desktop app in `apps/desktop`
- there is a lightweight Bun/Hono server in `server`
- there is already agent communication over WebSockets in the server
- there is already a `solo-auth` crate and desktop auth plumbing
- the current auth path is product-adjacent but not yet a full cloud identity and authorization platform
- the current server is primarily agent-focused, not a multi-tenant application backend

Important implications:

- the Vault backend should not be forced into the current `server` just because it already exists
- GitHub auth and provider auth should stay separate from product identity
- the new cloud repo should own authentication, tenancy, uploads, ingestion, indexing, retrieval, and operations
- Solo desktop should be the first client of that platform

In other words, the clean split is:

```text
Solo desktop repo
  -> UI, agent integration, auth client, vault browsing, attach-to-agent flow

New cloud repo
  -> Cognito, APIs, S3, RDS, event pipelines, workers, search, progress, ops
```

---

## 4. Problem Statement

### The current gap

A user working in Solo may have relevant information in many places:

- product specs
- PDFs
- architecture docs
- internal notes
- markdown files outside the current repository
- team-shared documents
- prior decisions from other projects

That information is currently fragmented and not first-class inside Solo.

### The user need

Users need a place where they can:

- upload personal knowledge
- upload project-specific knowledge
- keep the two scopes separate
- search that knowledge from within Solo
- selectively pass it to the agent
- trust that access is mapped to the correct user and project
- watch indexing progress in realtime

### The system need

The system needs to:

- securely associate data with authenticated users
- separate personal and project data
- handle asynchronous indexing
- support document retrieval with citations
- avoid accidental context leakage across projects or users

---

## 5. Product Goals and Non-Goals

### Product goals

- Create a cloud-backed Vault that stores user-global and project-scoped knowledge.
- Make the Vault available inside Solo IDE first.
- Use AWS services heavily and intentionally.
- Build an event-driven ingestion and indexing pipeline.
- Provide realtime visibility into job status.
- Allow the Solo agent to use Vault data through explicit user action.
- Support project membership and project-level access control.
- Make the architecture understandable and demoable for a course setting.

### Non-goals for v1

- Full external sharing between arbitrary users
- Broad enterprise admin features
- Fully automatic background indexing of every external source
- Multimodal storage for all media types
- Complex organization-level billing
- Perfect production-grade compliance or governance

### Success criteria

- A user can sign in and create or join a project.
- A user can upload documents to personal or project vaults.
- Uploaded files are stored on S3 and indexed asynchronously.
- Progress updates are visible in the client.
- A user can search the vault and attach results to an agent run.
- The agent can answer using retrieved vault snippets with source attribution.

---

## 6. The Vault Product Definition

The Vault is not just "cloud file storage." It is a knowledge layer with storage, indexing, retrieval, and controlled agent access.

### Core concepts

#### User-global Vault

Personal knowledge that belongs to a single user and can be used across projects when the user chooses to include it.

Examples:

- personal coding preferences
- reusable prompts
- prior architecture notes
- design patterns
- research documents
- personal runbooks

#### Project Vault

Knowledge shared by members of a specific project and only visible to those members.

Examples:

- product requirements
- architecture decision records
- API contracts
- customer notes
- deployment guides
- onboarding docs

#### Vault item

A single uploaded or created object, such as:

- markdown file
- plain text file
- PDF
- note created directly in the app
- structured decision entry

#### Collection

A logical grouping of vault items for browsing and retrieval.

Examples:

- "Architecture"
- "Product Specs"
- "Runbooks"
- "Customer Research"

#### Ingestion job

The asynchronous process that:

- validates the uploaded object
- extracts text
- chunks content
- computes embeddings
- writes chunk/index records
- marks the item searchable

#### Retrieval pack

A curated set of results selected by the user to send into the agent context.

This is important because the chosen interaction model is explicit, not silent.

---

## 7. Identity, Tenancy, and Access Model

### Identity decision

Use **AWS Cognito** as the source of truth for product identity.

Why:

- it aligns with the course theme
- it provides managed user pools and JWT flows
- it is a better long-term product identity layer than leaving the system half-attached to provider auth

### Separate auth domains

There are three different auth categories in this product and they should remain conceptually distinct:

1. **Product identity**
   - who the user is in Solo
   - managed by Cognito

2. **Git auth**
   - GitHub or Git provider credentials for repository operations
   - remains separate

3. **AI provider auth**
   - Anthropic, OpenAI, and other provider credentials
   - remains separate

Do not collapse these into one concept in the UI or backend.

### Tenancy model

- every vault item belongs to exactly one owner scope
- owner scope is either `user` or `project`
- user-global storage remains physically and logically separate from project storage metadata
- retrieval can merge scopes at query time when explicitly requested

### Access rules

- user-global vault data is visible only to its owner
- project vault data is visible only to members of that project
- no external sharing in v1
- no public links in v1
- agent retrieval must respect the same scope rules as manual browsing

### Recommended roles

For v1, keep roles minimal:

- `owner`
- `editor`
- `viewer`

If time is tight, only implement:

- `owner`
- `member`

---

## 8. Recommended AWS Architecture

### Architecture overview

```text
Solo Desktop
  -> Cognito sign-in
  -> Vault API
  -> Realtime progress channel

API Gateway / ALB
  -> Vault API service
  -> Auth middleware

S3
  -> raw uploads
  -> extracted artifacts

EventBridge / SQS
  -> upload events
  -> indexing triggers
  -> retryable async work

Worker service
  -> text extraction
  -> chunking
  -> embedding generation
  -> metadata updates

RDS PostgreSQL + pgvector
  -> users
  -> projects
  -> membership
  -> vault metadata
  -> jobs
  -> chunks
  -> embeddings
  -> audit and feedback

WebSocket / subscription service
  -> job progress
  -> completion/failure updates
```

### Recommended AWS services

| Need | Recommended service |
|------|---------------------|
| Identity | Cognito |
| Object storage | S3 |
| Metadata database | RDS PostgreSQL |
| Vector retrieval | pgvector in Postgres |
| Async events | EventBridge |
| Durable queue | SQS |
| Worker compute | ECS Fargate or Lambda |
| API layer | API Gateway + Lambda, or ALB + ECS |
| Realtime updates | API Gateway WebSocket API or AppSync |
| Secrets | Secrets Manager |
| Encryption keys | KMS |
| Monitoring | CloudWatch |
| Tracing | X-Ray or OpenTelemetry-compatible tracing |

### Recommended default for v1

Use:

- Cognito
- S3
- RDS PostgreSQL with `pgvector`
- EventBridge + SQS
- ECS Fargate for API and workers
- API Gateway WebSocket for job progress

This is a strong middle ground:

- more AWS-native than keeping Supabase as the center
- simpler than introducing OpenSearch too early
- more controllable than trying to run everything as isolated Lambdas if parsing grows complex

### Why not OpenSearch first

OpenSearch is attractive for demos, but it increases:

- architecture surface area
- indexing complexity
- operational overhead
- schema synchronization burden

For a course timeline, `pgvector` is the better default.

OpenSearch can be added later if:

- lexical search quality needs to improve
- hybrid ranking becomes important
- service breadth is required for the final presentation

---

## 9. Service-by-Service Breakdown

### 9.1 Auth service

Responsibilities:

- Cognito integration
- token validation
- user profile bootstrap
- desktop session bootstrap

Public behavior:

- verify identity tokens
- create or fetch app user profile
- expose current user and membership information

### 9.2 Project service

Responsibilities:

- create projects
- manage project membership
- enforce project-scoped access checks

Public behavior:

- list projects a user belongs to
- create new project
- invite or add project members
- resolve role information

### 9.3 Vault metadata service

Responsibilities:

- create vault item records
- manage collections and tags
- soft delete, restore, and version history if implemented

Public behavior:

- create item metadata after upload
- list items by scope
- fetch item details
- track current item state

### 9.4 Upload service

Responsibilities:

- issue signed S3 upload URLs
- validate upload intent
- write metadata placeholders
- emit indexing trigger event after object is confirmed

### 9.5 Ingestion service

Responsibilities:

- read uploaded objects
- extract text
- normalize content
- chunk content
- embed content
- store chunk rows and searchable state

### 9.6 Search and retrieval service

Responsibilities:

- semantic search
- keyword fallback if needed
- scoped filtering
- retrieval ranking
- preparation of agent-ready citation packs

### 9.7 Progress and notification service

Responsibilities:

- emit indexing progress states
- communicate completion or failure
- provide resumable status to reconnecting clients

### 9.8 Feedback and analytics service

Responsibilities:

- record which results were retrieved
- record positive or negative feedback
- support future ranking improvements

---

## 10. Data Model

### Core tables

#### `users`

- `id`
- `cognito_sub`
- `email`
- `display_name`
- `created_at`
- `updated_at`

#### `projects`

- `id`
- `name`
- `slug`
- `created_by_user_id`
- `created_at`
- `updated_at`

#### `project_members`

- `id`
- `project_id`
- `user_id`
- `role`
- `joined_at`

#### `vault_collections`

- `id`
- `scope_type` (`user` or `project`)
- `scope_user_id`
- `scope_project_id`
- `name`
- `description`
- `created_at`

#### `vault_items`

- `id`
- `scope_type`
- `scope_user_id`
- `scope_project_id`
- `collection_id`
- `created_by_user_id`
- `source_type` (`upload`, `note`, `import`)
- `content_type`
- `filename`
- `s3_key_raw`
- `s3_key_extracted`
- `checksum`
- `status` (`pending`, `processing`, `ready`, `failed`, `deleted`)
- `created_at`
- `updated_at`

#### `vault_item_versions`

- `id`
- `vault_item_id`
- `version_number`
- `s3_key_raw`
- `s3_key_extracted`
- `checksum`
- `created_at`

#### `ingestion_jobs`

- `id`
- `vault_item_id`
- `status`
- `stage`
- `progress_percent`
- `error_message`
- `attempt_count`
- `started_at`
- `completed_at`
- `created_at`

#### `document_chunks`

- `id`
- `vault_item_id`
- `chunk_index`
- `text`
- `token_count`
- `char_start`
- `char_end`
- `page_number`
- `section_label`
- `embedding`
- `created_at`

#### `retrieval_events`

- `id`
- `user_id`
- `project_id`
- `agent_session_id`
- `query_text`
- `scope_user_enabled`
- `scope_project_enabled`
- `top_k`
- `created_at`

#### `retrieval_event_results`

- `id`
- `retrieval_event_id`
- `document_chunk_id`
- `rank`
- `score`
- `selected_for_agent`

#### `retrieval_feedback`

- `id`
- `retrieval_event_id`
- `user_id`
- `feedback_type`
- `notes`
- `created_at`

### Key modeling rule

Do not materialize user-global data into project vaults by default.

Instead:

- store them separately
- enforce scope in the database and API layer
- merge only at retrieval time when the user explicitly requests both scopes

---

## 11. API Surface

This backend should expose a dedicated Vault API rather than hiding everything behind the current agent websocket layer.

### Auth and session

#### `GET /me`

Returns:

- current user profile
- projects
- membership roles

#### `POST /auth/desktop/bootstrap`

Purpose:

- optional route to help the desktop app establish app-specific session state after Cognito sign-in

### Projects

#### `GET /projects`

Returns all projects the user can access.

#### `POST /projects`

Creates a new project.

#### `POST /projects/:projectId/members`

Adds or invites a member.

#### `GET /projects/:projectId/members`

Lists project membership and roles.

### Collections

#### `GET /vault/collections`

Supports query params for:

- `scope=user`
- `scope=project`
- `projectId`

#### `POST /vault/collections`

Creates a collection within a scope.

### Upload and item creation

#### `POST /vault/uploads/presign`

Returns:

- signed S3 upload URL
- object key
- upload constraints

#### `POST /vault/items`

Creates the vault item metadata row after upload intent is known.

#### `POST /vault/items/:itemId/index`

Queues or re-queues indexing.

### Item browsing

#### `GET /vault/items`

Filters:

- scope
- projectId
- collectionId
- status
- search text

#### `GET /vault/items/:itemId`

Returns:

- metadata
- status
- collection
- owner scope
- ingestion history

#### `DELETE /vault/items/:itemId`

Soft delete in v1 is recommended.

### Search and retrieval

#### `POST /vault/search`

Request:

- query
- scope flags
- projectId
- collection filters
- topK

Response:

- ranked results
- snippet previews
- citations
- item metadata

#### `POST /vault/retrieve-for-agent`

Request:

- selected result IDs or search parameters
- project context
- current agent session ID

Response:

- agent-ready context pack
- citations
- retrieval event ID for audit and feedback

### Realtime status

#### `GET /vault/jobs/:jobId`

Returns latest known job state.

#### `WS /vault/jobs`

Streams:

- queued
- started
- extracting
- chunking
- embedding
- indexing
- complete
- failed

### Feedback

#### `POST /vault/retrieval-feedback`

Records whether the retrieved results were useful.

---

## 12. Desktop Integration in Solo IDE

The Vault should appear as a first-class product feature inside the desktop app, not as an external settings page.

### Recommended UI surfaces

#### Vault panel

A new panel in Solo with:

- scope toggle: `Personal` / `Project`
- project selector
- collections list
- item list
- status badges
- upload button
- search bar
- "Attach to Agent" actions

#### Agent composer integration

Users should be able to:

- search the vault from the agent composer
- select search results or collections
- attach them explicitly
- see what will be sent into the agent context
- remove attached vault context before sending

#### Item detail view

Users should be able to inspect:

- extracted text preview
- source metadata
- indexing status
- citations and chunk boundaries if helpful

### UX rules

- explicit retrieval is the default
- do not silently inject user-global or project-global context into every prompt
- always show which vault context is attached to an agent run
- preserve project boundaries in the UI

### Why desktop-first is correct

Solo is already where the user works.

That means the quickest route to value is:

- upload or browse vault data in Solo
- retrieve it in Solo
- use it with the Solo agent immediately

A web app can be added later for:

- admin operations
- project management
- ingestion observability
- broader browsing

---

## 13. Ingestion and Retrieval Flows

### 13.1 Upload and index flow

1. User signs in through Cognito-backed product auth.
2. User opens the Vault panel in Solo.
3. User chooses `Personal` or a specific `Project` scope.
4. User uploads a file.
5. Backend returns a signed S3 upload URL.
6. Desktop uploads the object to S3.
7. Backend creates a `vault_item` and an `ingestion_job`.
8. EventBridge or SQS triggers the ingestion worker.
9. Worker extracts text and metadata.
10. Worker chunks the content.
11. Worker computes embeddings.
12. Worker stores chunk rows and marks the item as searchable.
13. Progress events are emitted back to the client.
14. User sees the item become ready.

### 13.2 Search and attach flow

1. User opens agent composer or Vault search.
2. User searches within `Personal`, `Project`, or both.
3. Backend returns ranked matches with snippets.
4. User explicitly selects one or more results.
5. Desktop calls `retrieve-for-agent`.
6. Backend returns an agent-ready context pack.
7. Desktop attaches the context pack to the outgoing agent request.
8. Agent uses the retrieved material and cites the sources.

### 13.3 Failure and retry flow

1. Worker fails due to parsing or embedding error.
2. Job is marked `failed` with a reason.
3. Desktop shows the failure state.
4. User can retry indexing.
5. Retry creates a new ingestion job attempt while preserving history.

---

## 14. Nice-to-Have Extensions

The following additions are good follow-on features once the core Vault works.

### 14.1 High-value product features

- Smart collections based on topic clustering
- Saved searches
- Agent-ready "context packs"
- Vault citations with deep links into source docs
- Structured notes for decisions, runbooks, and incidents
- Re-index when source content changes
- Version history for vault items
- Audit timeline for uploads, indexing, and retrieval
- Post-conversation "save to vault" action
- Project onboarding bundle with starter docs and recommended collections

### 14.2 Connector features

- GitHub repo documentation sync
- Notion import
- Google Drive import
- Confluence import
- Website URL ingestion
- local folder sync outside the active repository

### 14.3 AWS-heavy showcase features

- Textract for OCR on PDFs and scanned docs
- Comprehend for entity and key phrase extraction
- Bedrock for document summarization and classification
- Step Functions for a visible ingestion state machine
- SNS notifications when indexing completes
- S3 lifecycle rules and archival tiers
- CloudWatch dashboards for throughput, failures, and latency
- X-Ray traces for pipeline visualization

### 14.4 Collaboration and governance

- Collection-level permissions
- Reviewer approval before a project document becomes retrievable
- Content sensitivity tagging
- Retention rules per project
- export and backup tools
- admin audit dashboards

### 14.5 Agent-specific extensions

- retrieval budget controls by cost and token limit
- context ranking based on active repo or branch
- auto-suggestions for relevant vault items during prompt composition
- memory writeback from completed agent tasks
- long-running background research jobs that populate the vault automatically

---

## 15. Team Allocation and Separate Repo Strategy

You have three additional people. Use them as cloud/backend owners in a separate attached repo while you stay responsible for overall product coherence and Solo integration.

### Repo split

#### This repo: Solo desktop integration

Primary responsibilities:

- Vault UI and panel
- desktop auth client integration
- search and attach-to-agent UX
- agent context integration
- end-to-end demo experience

#### New repo: cloud platform

Primary responsibilities:

- Cognito setup
- API services
- S3 upload management
- RDS schema
- ingestion workers
- event pipeline
- realtime progress channel
- deployment and monitoring

### Team allocation

#### Engineer 1: Identity and tenancy

Owns:

- Cognito
- token validation
- user profile bootstrap
- project creation and membership
- authorization middleware

Deliverables:

- authentication flows
- project and membership APIs
- access control rules

#### Engineer 2: Ingestion and indexing

Owns:

- upload lifecycle
- S3 object management
- parsing
- text extraction
- chunking
- embeddings
- job orchestration

Deliverables:

- upload API
- worker pipeline
- indexing schema
- retry and failure handling

#### Engineer 3: Retrieval, realtime, and ops

Owns:

- search APIs
- `retrieve-for-agent`
- job progress delivery
- CloudWatch dashboards
- deployment scripts and observability

Deliverables:

- retrieval contracts
- websocket progress stream
- operational dashboards
- logging and alarms

#### You: Product and integration lead

Own:

- product requirements
- final data and API contract approval
- Solo desktop UX
- agent integration behavior
- demo script and story
- integration testing across repos

### Coordination rule

Do not let the new repo invent product behavior independently.

You should define:

- scope model
- access model
- API contracts
- job states
- retrieval payload shape

before parallel implementation starts.

---

## 16. Phased Roadmap

### Phase 0: Decision lock and repo setup

- finalize scope model
- finalize auth decision
- finalize API contract
- create new backend repo
- scaffold infrastructure and environments

### Phase 1: Identity and project tenancy

- Cognito setup
- user bootstrap
- project creation
- project membership
- protected API routes

Milestone:

- desktop can authenticate and list projects

### Phase 2: Upload and metadata

- signed S3 uploads
- vault item metadata
- collections
- item listing

Milestone:

- desktop can upload and browse vault items

### Phase 3: Ingestion and indexing

- event-driven jobs
- extraction
- chunking
- embeddings
- searchable ready state
- realtime progress events

Milestone:

- uploaded files become searchable with visible progress

### Phase 4: Retrieval and agent integration

- search API
- retrieve-for-agent API
- attach-to-agent flow in Solo
- citation rendering

Milestone:

- Solo agent can use vault context from explicit user selection

### Phase 5: Demo polish and AWS showcase

- dashboards
- failure states
- better collection UX
- optional Bedrock/Textract/Comprehend features

Milestone:

- course-ready architecture and demo narrative

---

## 17. Demo Script for the Course

The demo should show a user journey, not just services.

### Recommended demo sequence

1. Sign in to Solo using product auth.
2. Show personal and project vault scopes.
3. Create or open a project.
4. Upload:
   - a PDF spec
   - a markdown architecture doc
   - a runbook note
5. Show realtime indexing progress.
6. Open the search experience and query for a feature or system term.
7. Select relevant results and attach them to the agent.
8. Ask the agent a question that cannot be answered well from code alone.
9. Show an answer that references uploaded material with citations.
10. Show AWS architecture slides or dashboard views:
   - Cognito
   - S3
   - RDS
   - event pipeline
   - worker service
   - CloudWatch metrics

### Why this demo works

It demonstrates:

- end-user value
- secure identity
- multi-tenant data separation
- event-driven indexing
- cloud storage
- search and retrieval
- realtime communication
- integration with an AI product

---

## 18. Test Plan and Acceptance Criteria

### Auth and access tests

- user can sign in and sign out
- invalid token is rejected
- project member can access project vault
- non-member cannot access project vault
- user-global vault is visible only to owner

### Upload and indexing tests

- presigned upload works
- metadata row is created correctly
- ingestion job is created
- progress transitions occur in expected order
- ready item becomes searchable
- failed job exposes actionable error

### Retrieval tests

- search honors scope filters
- cross-scope search only works when explicitly requested
- results include snippets and citation metadata
- `retrieve-for-agent` returns only selected content

### Desktop integration tests

- Vault panel loads correctly after auth
- upload progress is visible
- item status updates without manual refresh
- attached vault context is visible before sending to agent
- agent response can show source-backed reasoning

### Operational tests

- worker retry works after transient failure
- websocket reconnect restores job state
- deleted item is no longer retrievable
- logs and metrics are emitted for key operations

### Acceptance criteria

The feature is "real" when:

- a user can upload to S3
- indexing runs asynchronously
- metadata and chunks are queryable
- progress is visible in realtime
- project scope is enforced
- the Solo agent can use selected vault context with citations

---

## 19. Risks, Tradeoffs, and Key Decisions

### Risk: scope explosion

If you add:

- web app
- sharing
- connectors
- multimodal ingestion
- advanced governance

too early, the project will lose focus.

Mitigation:

- keep v1 document-centric
- keep v1 desktop-first
- keep v1 explicit retrieval

### Risk: auth confusion

Users may confuse:

- product login
- GitHub login
- provider login

Mitigation:

- separate them visually and conceptually in the UI
- document their purposes clearly

### Risk: over-complicated search stack

Starting with both PostgreSQL vector search and OpenSearch may slow the team down.

Mitigation:

- start with `pgvector`
- add OpenSearch only if it becomes necessary

### Risk: hidden data leakage

If the agent automatically reads both user-global and project-global context, trust will degrade quickly.

Mitigation:

- keep retrieval explicit by default
- always show attached context
- keep audit records of retrieval events

### Risk: the current server gets overloaded conceptually

The Bun/Hono `server` in this repo is agent-centric and not the right place to grow an entire multi-tenant backend casually.

Mitigation:

- use the attached backend repo for the new platform
- integrate through stable APIs

---

## 20. Recommended Defaults

These are the defaults that best fit the current Solo codebase, your course constraints, and the team structure:

- **Primary goal:** impressive demo with credible architecture
- **Primary surface:** desktop-first
- **Identity:** AWS Cognito
- **Storage:** S3 for raw objects, RDS PostgreSQL for metadata
- **Retrieval index:** `pgvector` in Postgres
- **Async pipeline:** EventBridge + SQS + worker service
- **Realtime progress:** API Gateway WebSocket or equivalent subscription layer
- **Vault access model:** explicit attach/search by default
- **Scopes:** user-global plus project-scoped
- **Scope merging:** separate in storage, merged only at retrieval when selected
- **Project access:** project members only
- **External sharing:** not in v1
- **New teammate focus:** mostly cloud/backend
- **Your focus:** Solo UX, agent integration, product contract, and final demo

If implementation starts immediately, the fastest credible build order is:

1. Cognito and project membership
2. S3 upload and metadata
3. ingestion jobs and progress events
4. RDS chunk storage and vector retrieval
5. Solo desktop Vault panel
6. attach-to-agent flow
7. dashboards and one or two AWS showcase extras

---

## Final Recommendation

Build the Vault as the next foundational layer for Solo.

Do not treat it as a side feature.

If done correctly, it becomes:

- the memory layer for users
- the knowledge layer for projects
- the retrieval layer for agents
- the cloud architecture centerpiece for the course

That is the version of the project most likely to feel useful, technically ambitious, and cohesive.
