/**
 * EmbeddingService - Local text embeddings using transformers.js
 *
 * Uses Xenova/bge-base-en-v1.5 for high-quality embeddings of code and text.
 * Runs entirely locally via ONNX runtime - no external API calls.
 *
 * Features:
 * - 768-dimensional embeddings
 * - Optimized for code and natural language
 * - Lazy model loading (loads on first use)
 * - Batch processing support
 * - Cosine similarity utilities
 */

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

const MODEL_NAME = "Xenova/bge-base-en-v1.5";
const EMBEDDING_DIMENSIONS = 768;

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
}

export interface SimilarityResult {
  index: number;
  score: number;
  text: string;
}

/**
 * Local embedding service using transformers.js.
 * Singleton pattern ensures model is loaded only once.
 */
export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private pipeline: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;

  private constructor() {}

  /**
   * Get singleton instance.
   */
  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initialize the embedding model.
   * Called automatically on first embed() call.
   */
  private async initPipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipeline) {
      return this.pipeline;
    }

    if (this.loading) {
      return this.loading;
    }

    this.loading = pipeline("feature-extraction", MODEL_NAME, {
      // Use quantized model for faster inference
      quantized: true,
    });

    this.pipeline = await this.loading;
    this.loading = null;
    return this.pipeline;
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const pipe = await this.initPipeline();

    // BGE models recommend prefixing queries with instruction
    const processedText = text;

    const output = await pipe(processedText, {
      pooling: "mean",
      normalize: true,
    });

    // Convert to regular array
    const embedding = Array.from(output.data as Float32Array);

    return {
      embedding,
      dimensions: EMBEDDING_DIMENSIONS,
      model: MODEL_NAME,
    };
  }

  /**
   * Generate embeddings for multiple texts.
   * More efficient than calling embed() multiple times.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const pipe = await this.initPipeline();

    const results: EmbeddingResult[] = [];

    // Process in batches to avoid memory issues
    const batchSize = 32;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      for (const text of batch) {
        const output = await pipe(text, {
          pooling: "mean",
          normalize: true,
        });

        results.push({
          embedding: Array.from(output.data as Float32Array),
          dimensions: EMBEDDING_DIMENSIONS,
          model: MODEL_NAME,
        });
      }
    }

    return results;
  }

  /**
   * Compute cosine similarity between two embeddings.
   * Assumes embeddings are already normalized.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Embedding dimensions must match: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    // Since embeddings are normalized, dot product = cosine similarity
    return dotProduct;
  }

  /**
   * Find most similar texts from a corpus.
   */
  async findSimilar(
    query: string,
    corpus: string[],
    topK: number = 5
  ): Promise<SimilarityResult[]> {
    const queryEmbedding = await this.embed(query);
    const corpusEmbeddings = await this.embedBatch(corpus);

    const similarities: SimilarityResult[] = corpusEmbeddings.map((emb, index) => ({
      index,
      score: this.cosineSimilarity(queryEmbedding.embedding, emb.embedding),
      text: corpus[index],
    }));

    // Sort by similarity descending
    similarities.sort((a, b) => b.score - a.score);

    return similarities.slice(0, topK);
  }

  /**
   * Get embedding dimensions.
   */
  getDimensions(): number {
    return EMBEDDING_DIMENSIONS;
  }

  /**
   * Get model name.
   */
  getModelName(): string {
    return MODEL_NAME;
  }

  /**
   * Check if model is loaded.
   */
  isLoaded(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Preload the model (useful for startup).
   */
  async preload(): Promise<void> {
    await this.initPipeline();
  }
}

// Export singleton instance
export const embeddingService = EmbeddingService.getInstance();
