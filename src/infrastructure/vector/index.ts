/**
 * Vector Storage Infrastructure
 *
 * LanceDB-based vector storage for project knowledge and semantic search.
 */

export {
  LanceKnowledgeStore,
  getKnowledgeStore,
  getGlobalKnowledgeStore,
  type KnowledgeType,
  type KnowledgeVector,
  type KnowledgeSearchResult,
  type AddKnowledgeInput,
  type SearchOptions,
} from "./LanceKnowledgeStore";
