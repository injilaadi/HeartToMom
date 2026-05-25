// Retrieval-Augmented Generation helper for the HeartToMom chatbot.
//
// Knowledge lives in ../../knowledge/maternal-health.md and is embedded once (offline)
// into ./embeddings.js by scripts/build-embeddings.mjs. At request time we embed the
// user's question with the same model and return the most similar chunks so the chatbot
// can ground its answer in vetted content instead of relying on the model's memory alone.
//
// Files/dirs under api/ that start with "_" are not exposed as routes by Vercel, so this
// module and the generated embeddings are importable but never served.

import { GoogleGenerativeAI } from '@google/generative-ai'

const EMBED_MODEL = 'gemini-embedding-001'

// Load the precomputed knowledge base. Done lazily and defensively so the chatbot keeps
// working (just without retrieval) before embeddings.js has been generated.
let CHUNKS = []
try {
  CHUNKS = (await import('./embeddings.js')).default ?? []
} catch {
  CHUNKS = []
}

function cosineSimilarity(a, b) {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Retrieve the most relevant knowledge-base chunks for a query.
 *
 * @param {string} query - the user's latest message.
 * @param {object} opts
 * @param {string} opts.apiKey  - Gemini API key.
 * @param {number} [opts.k=4]   - max chunks to return.
 * @param {number} [opts.minScore=0.6] - cosine-similarity floor; below this we treat the
 *                                       query as off-topic and return no context. Tuned for
 *                                       gemini-embedding-001, whose unrelated-text baseline
 *                                       sits around 0.52 while on-topic chunks score 0.61+.
 * @returns {Promise<{ context: string, chunks: Array<{heading: string, text: string, score: number}> }>}
 */
export async function retrieveContext(query, { apiKey, k = 4, minScore = 0.6 } = {}) {
  if (!query || !apiKey || CHUNKS.length === 0) {
    return { context: '', chunks: [] }
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: EMBED_MODEL })
  const res = await model.embedContent({
    content: { parts: [{ text: query }] },
    taskType: 'RETRIEVAL_QUERY',
  })
  const queryVec = res.embedding?.values
  if (!queryVec) return { context: '', chunks: [] }

  const ranked = CHUNKS
    .map((c) => ({ heading: c.heading, text: c.text, score: cosineSimilarity(queryVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .filter((c) => c.score >= minScore)
    .slice(0, k)

  const context = ranked.map((c) => `### ${c.heading}\n${c.text}`).join('\n\n')
  return { context, chunks: ranked }
}
