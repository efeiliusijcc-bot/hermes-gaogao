CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE vector_materials_text_embedding_v4
  ADD COLUMN IF NOT EXISTS search_tokens text NOT NULL DEFAULT '';

ALTER TABLE vector_materials_text_embedding_v4
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Run index statements outside a surrounding transaction so PostgreSQL can
-- keep the source table readable while the indexes are built.
-- A cancelled concurrent build leaves an invalid same-named index that
-- IF NOT EXISTS would otherwise skip forever, so remove those first.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I', namespace.nspname, index_class.relname)
  FROM pg_index i
  JOIN pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
 WHERE NOT i.indisvalid
   AND index_class.relname = ANY (ARRAY[
     'vector_materials_text_embedding_v4_embedding_hnsw_idx',
     'hybrid_retrieval_search_documents_vector_idx',
     'vector_materials_text_embedding_v4_title_trgm_idx'
   ])
\gexec

CREATE INDEX CONCURRENTLY IF NOT EXISTS vector_materials_text_embedding_v4_embedding_hnsw_idx
  ON vector_materials_text_embedding_v4
  USING hnsw (embedding_vector vector_cosine_ops);

CREATE TABLE IF NOT EXISTS hybrid_retrieval_search_documents (
  document_id integer PRIMARY KEY REFERENCES vector_materials_text_embedding_v4(id) ON DELETE CASCADE,
  content_hash text,
  search_tokens text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_tokens)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS hybrid_retrieval_search_documents_vector_idx
  ON hybrid_retrieval_search_documents
  USING gin (search_vector);

CREATE INDEX CONCURRENTLY IF NOT EXISTS vector_materials_text_embedding_v4_title_trgm_idx
  ON vector_materials_text_embedding_v4
  USING gin ((coalesce(nullif(ch_title, ''), entitle, '')) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS hybrid_retrieval_entity_aliases (
  entity_id text NOT NULL,
  canonical_name text NOT NULL,
  alias text NOT NULL,
  entity_type text NOT NULL,
  PRIMARY KEY (entity_id, alias)
);

CREATE TABLE IF NOT EXISTS hybrid_retrieval_document_entities (
  document_id integer NOT NULL REFERENCES vector_materials_text_embedding_v4(id) ON DELETE CASCADE,
  entity_id text NOT NULL,
  mention_count integer NOT NULL DEFAULT 1,
  confidence double precision NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, entity_id)
);

CREATE INDEX IF NOT EXISTS hybrid_retrieval_document_entities_entity_idx
  ON hybrid_retrieval_document_entities (entity_id, document_id);

CREATE TABLE IF NOT EXISTS hybrid_retrieval_runs (
  id uuid PRIMARY KEY,
  report_job_id text NOT NULL,
  topic text NOT NULL,
  clean_query_input jsonb NOT NULL,
  query_profile jsonb NOT NULL,
  retriever_candidate_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_candidate_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  fallback_level integer NOT NULL DEFAULT 0,
  suspicious_entity_policy boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  retriever_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hybrid_retrieval_runs_job_idx
  ON hybrid_retrieval_runs (report_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hybrid_retrieval_candidates (
  id bigserial PRIMARY KEY,
  retrieval_run_id uuid NOT NULL REFERENCES hybrid_retrieval_runs(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  title text NOT NULL,
  retrieval_sources jsonb NOT NULL,
  ranks jsonb NOT NULL,
  scores jsonb NOT NULL,
  decision text NOT NULL,
  decision_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hybrid_retrieval_candidates_run_idx
  ON hybrid_retrieval_candidates (retrieval_run_id, id);

INSERT INTO hybrid_retrieval_entity_aliases (entity_id, canonical_name, alias, entity_type) VALUES
  ('country:us', '美国', '美国', 'country'),
  ('country:us', '美国', '美方', 'country'),
  ('country:us', '美国', '华盛顿', 'country'),
  ('country:iran', '伊朗', '伊朗', 'country'),
  ('country:iran', '伊朗', '伊方', 'country'),
  ('country:iran', '伊朗', '德黑兰', 'country'),
  ('organization:eu', '欧盟', '欧盟', 'organization'),
  ('organization:eu', '欧盟', '欧方', 'organization'),
  ('organization:eu', '欧盟', '布鲁塞尔', 'organization'),
  ('region:europe', '欧洲', '欧洲', 'region'),
  ('region:europe', '欧洲', '欧陆', 'region'),
  ('country:uk', '英国', '英国', 'country'),
  ('country:uk', '英国', '英方', 'country'),
  ('country:uk', '英国', '伦敦', 'country'),
  ('country:france', '法国', '法国', 'country'),
  ('country:france', '法国', '法方', 'country'),
  ('country:france', '法国', '巴黎', 'country'),
  ('country:germany', '德国', '德国', 'country'),
  ('country:germany', '德国', '德方', 'country'),
  ('country:germany', '德国', '柏林', 'country'),
  ('country:italy', '意大利', '意大利', 'country'),
  ('country:italy', '意大利', '意方', 'country'),
  ('country:italy', '意大利', '罗马', 'country'),
  ('country:spain', '西班牙', '西班牙', 'country'),
  ('country:spain', '西班牙', '马德里', 'country'),
  ('country:netherlands', '荷兰', '荷兰', 'country'),
  ('country:netherlands', '荷兰', '阿姆斯特丹', 'country'),
  ('country:belgium', '比利时', '比利时', 'country'),
  ('country:poland', '波兰', '波兰', 'country'),
  ('country:ukraine', '乌克兰', '乌克兰', 'country'),
  ('country:ukraine', '乌克兰', '基辅', 'country'),
  ('country:russia', '俄罗斯', '俄罗斯', 'country'),
  ('country:russia', '俄罗斯', '俄方', 'country'),
  ('country:russia', '俄罗斯', '莫斯科', 'country'),
  ('organization:nato', '北约', '北约', 'organization')
ON CONFLICT (entity_id, alias) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  entity_type = EXCLUDED.entity_type;
