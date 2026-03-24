/**
 * Hybrid Search Client
 * 
 * Provides hybrid search combining:
 * - Local SQLite FTS
 * - Local pgvector
 * - Remote MemOS API
 * 
 * Uses Reciprocal Rank Fusion (RRF) to combine results.
 */

const LocalApiClient = require('./local-api-client');

const DEFAULT_RRF_K = 60;
const DEFAULT_LAMBDA = 0.7;  // Balance between vector and keyword

class HybridSearchClient {
  constructor(options = {}) {
    this.localClient = new LocalApiClient(options.local || {});
    this.remoteClient = new LocalApiClient(options.remote || {});
    this.rrfK = options.rrfK || DEFAULT_RRF_K;
    this.lambda = options.lambda || DEFAULT_LAMBDA;
    this.localEnabled = options.localEnabled !== false;
    this.remoteEnabled = options.remoteEnabled !== false;
  }

  /**
   * Perform hybrid search across local and remote sources
   * 
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<Array>} - Fused results
   */
  async search(query, options = {}) {
    const { limit = 10, owner, sessionKey, tags } = options;

    const results = {
      local: [],
      remote: [],
    };

    // Execute searches in parallel
    const promises = [];

    if (this.localEnabled) {
      promises.push(
        this._searchLocal(query, { owner, sessionKey, tags })
          .then(r => { results.local = r; })
          .catch(e => { console.error('Local search failed:', e.message); })
      );
    }

    if (this.remoteEnabled) {
      promises.push(
        this._searchRemote(query, { owner, sessionKey, tags })
          .then(r => { results.remote = r; })
          .catch(e => { console.error('Remote search failed:', e.message); })
      );
    }

    await Promise.all(promises);

    // Fuse results using RRF
    return this._fuseResults(results.local, results.remote, limit);
  }

  async _searchLocal(query, params) {
    return this.localClient.searchMemories(query, params);
  }

  async _searchRemote(query, params) {
    return this.remoteClient.searchMemories(query, params);
  }

  /**
   * Reciprocal Rank Fusion
   * 
   * RRF(d) = Σ 1 / (k + rank_i(d))
   * 
   * @param {Array} localResults - Local search results
   * @param {Array} remoteResults - Remote search results
   * @param {number} limit - Max results to return
   * @returns {Array} - Fused results
   */
  _fuseResults(localResults, remoteResults, limit) {
    const scores = new Map();

    // Score local results
    localResults.forEach((hit, index) => {
      const rank = index + 1;
      const score = 1 / (this.rrfK + rank);
      this._addScore(hit, score, 'local', scores);
    });

    // Score remote results
    remoteResults.forEach((hit, index) => {
      const rank = index + 1;
      const score = 1 / (this.rrfK + rank);
      this._addScore(hit, score, 'remote', scores);
    });

    // Sort by combined score
    const sorted = Array.from(scores.values())
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit);

    return sorted.map(r => ({
      id: r.id,
      content: r.content,
      score: r.combinedScore,
      sources: r.sources,
      metadata: r.metadata,
    }));
  }

  _addScore(hit, score, source, scores) {
    const id = hit.id || hit;
    const content = hit.content || hit;
    const metadata = hit.metadata || {};

    if (scores.has(id)) {
      const existing = scores.get(id);
      existing.combinedScore += score;
      existing.sources.push(source);
    } else {
      scores.set(id, {
        id,
        content,
        combinedScore: score,
        sources: [source],
        metadata,
      });
    }
  }

  /**
   * Search with MMR (Maximal Marginal Relevance)
   * 
   * Balances relevance with diversity.
   * 
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<Array>} - Diverse results
   */
  async searchWithMMR(query, options = {}) {
    const { limit = 10, lambda = this.lambda, ...rest } = options;

    // First get more candidates than needed
    const candidates = await this.search(query, {
      ...rest,
      limit: limit * 2,
    });

    if (candidates.length <= limit) {
      return candidates;
    }

    // MMR selection
    const selected = [];
    const remaining = [...candidates];

    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const relevance = candidate.score;

        // Calculate diversity penalty
        let maxSimilarity = 0;
        for (const selectedItem of selected) {
          const similarity = this._cosineSimilarity(
            candidate.content,
            selectedItem.content
          );
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        // MMR score: λ * relevance - (1 - λ) * maxSimilarity
        const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    return selected;
  }

  _cosineSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Apply time decay to results
   * 
   * score = score * (alpha + (1 - alpha) * 0.5^(age_days / halfLife))
   * 
   * @param {Array} results - Search results
   * @param {number} halfLife - Half-life in days (default 14)
   * @param {number} alpha - Minimum score floor (default 0.3)
   * @returns {Array} - Time-decayed results
   */
  applyTimeDecay(results, halfLife = 14, alpha = 0.3) {
    const now = Date.now();

    return results.map(result => {
      const ageMs = now - (result.metadata?.created_at || now);
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decay = Math.pow(0.5, ageDays / halfLife);
      const timeDecayedScore = result.score * (alpha + (1 - alpha) * decay);

      return {
        ...result,
        score: timeDecayedScore,
      };
    });
  }
}

module.exports = HybridSearchClient;
