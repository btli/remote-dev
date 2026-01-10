/**
 * Embedding Service - Local vector embeddings using transformers
 *
 * Uses all-MiniLM-L6-v2 model for fast, local embeddings (384 dimensions).
 * No API calls needed - model is downloaded once (~90MB).
 */

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// FeatureExtractionPipeline returns Tensor with data property

export interface EmbeddingResult {
  vector: Float32Array;
  dimensions: number;
}

export interface BatchEmbeddingResult {
  vectors: Float32Array[];
  dimensions: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class EmbeddingService {
  private embedder: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly modelName = "Xenova/all-MiniLM-L6-v2";
  private readonly dimensions = 384;

  /**
   * Initialize the embedding model.
   * Downloads the model on first use (~90MB).
   */
  private async initialize(): Promise<void> {
    if (this.embedder) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      console.log(`[EmbeddingService] Loading model: ${this.modelName}`);
      const startTime = Date.now();

      this.embedder = (await pipeline("feature-extraction", this.modelName, {
        // Use quantized model for faster inference
        quantized: true,
      })) as FeatureExtractionPipeline;

      const elapsed = Date.now() - startTime;
      console.log(`[EmbeddingService] Model loaded in ${elapsed}ms`);
    })();

    return this.initPromise;
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    await this.initialize();

    if (!this.embedder) {
      throw new Error("Embedding model not initialized");
    }

    // Generate embedding
    const output = await this.embedder(text, {
      pooling: "mean",
      normalize: true,
    });

    // Extract the embedding vector from Tensor
    // The data property contains the raw float values
    const data = output.data as Float32Array | Float64Array | number[];
    const vector = new Float32Array(data);

    return {
      vector,
      dimensions: this.dimensions,
    };
  }

  /**
   * Generate embeddings for multiple texts in batch.
   * More efficient than calling embed() for each text.
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    await this.initialize();

    if (!this.embedder) {
      throw new Error("Embedding model not initialized");
    }

    const vectors: Float32Array[] = [];

    // Process in batches of 32 for efficiency
    const batchSize = 32;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      for (const text of batch) {
        const output = await this.embedder(text, {
          pooling: "mean",
          normalize: true,
        });
        // Extract from Tensor - data contains raw float values
        const data = output.data as Float32Array | Float64Array | number[];
        vectors.push(new Float32Array(data));
      }
    }

    return {
      vectors,
      dimensions: this.dimensions,
    };
  }

  /**
   * Calculate cosine similarity between two vectors.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same dimensions");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get the embedding dimensions.
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Check if the model is loaded.
   */
  isLoaded(): boolean {
    return this.embedder !== null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const embeddingService = new EmbeddingService();
