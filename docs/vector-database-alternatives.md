# Vector Database Alternatives (Free Plan Focus)

This is a quick shortlist of managed alternatives to Upstash Vector, ranked by practical free-tier capacity.

## 1) Qdrant Cloud (Best free capacity)

- Free tier: Free forever
- Limits: Single node, 0.5 vCPU, 1 GB RAM, 4 GB disk
- Best for: Prototyping + small production-like RAG workloads with the largest always-free managed capacity in this list
- Source: https://qdrant.tech/pricing/

## 2) Pinecone (Strong managed option)

- Free tier: Starter/free serverless plan
- Limits: 2 GB serverless index storage per org (with plan RU/WU rate/usage limits)
- Best for: Production-ready API experience and easy scaling path
- Sources:
  - https://docs.pinecone.io/reference/api/database-limits
  - https://www.pinecone.io/blog/serverless-free/

## 3) Supabase + pgvector (Good if already using Supabase)

- Free tier: Included in Supabase free project
- Limits: 500 MB database size per project (free projects can become read-only if exceeded)
- Best for: Teams already on Postgres/Supabase who want vectors in the same DB
- Sources:
  - https://supabase.com/pricing
  - https://supabase.com/docs/guides/platform/database-size

## 4) Weaviate Cloud (Trial-oriented)

- Free offering: Sandbox/free trial model (typically 14 days)
- Limits: Best treated as evaluation/trial, not large always-free long-term capacity
- Source: https://weaviate.io/pricing

## Recommendation by free-tier size

1. Qdrant Cloud (4 GB disk)
2. Pinecone (2 GB storage)
3. Supabase pgvector (500 MB DB)
4. Weaviate (trial-first)

