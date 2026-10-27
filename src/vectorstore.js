// Единый интерфейс к Pinecone и ChromaDB: upsert(records) и query(vector, topK).
// record = { id, values: number[], text, source }
import "./env.js";
import { Pinecone } from "@pinecone-database/pinecone";
import { ChromaClient } from "chromadb";

const provider = (process.env.VECTOR_DB || "pinecone").toLowerCase();
const DIM = Number(process.env.EMBED_DIM || 768);

/* ---------- Pinecone ---------- */
async function pineconeStore({ createIfMissing = false } = {}) {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const name = process.env.PINECONE_INDEX || "mospolyt-ai";

  if (createIfMissing) {
    const { indexes = [] } = await pc.listIndexes();
    if (!indexes.some((i) => i.name === name)) {
      console.log(`Создаю индекс Pinecone «${name}» (dim=${DIM}, cosine)…`);
      await pc.createIndex({
        name,
        dimension: DIM,
        metric: "cosine",
        spec: { serverless: { cloud: "aws", region: "us-east-1" } },
        waitUntilReady: true,
      });
    }
  }
  const index = pc.index(name);

  return {
    async upsert(records) {
      for (let i = 0; i < records.length; i += 100) {
        await index.upsert(
          records.slice(i, i + 100).map((r) => ({
            id: r.id,
            values: r.values,
            metadata: { text: r.text, source: r.source },
          }))
        );
      }
    },
    async query(vector, topK) {
      const res = await index.query({ vector, topK, includeMetadata: true });
      return (res.matches || []).map((m) => ({
        text: m.metadata?.text || "",
        source: m.metadata?.source || "",
        score: m.score ?? 0, // cosine: больше — ближе
      }));
    },
  };
}

/* ---------- ChromaDB ---------- */
async function chromaStore() {
  const client = new ChromaClient({ path: process.env.CHROMA_URL || "http://localhost:8000" });
  const collection = await client.getOrCreateCollection({
    name: process.env.CHROMA_COLLECTION || "mospolyt",
    embeddingFunction: null, // векторы считаем сами через Gemini
    metadata: { "hnsw:space": "cosine" },
  });

  return {
    async upsert(records) {
      for (let i = 0; i < records.length; i += 100) {
        const part = records.slice(i, i + 100);
        await collection.upsert({
          ids: part.map((r) => r.id),
          embeddings: part.map((r) => r.values),
          documents: part.map((r) => r.text),
          metadatas: part.map((r) => ({ source: r.source })),
        });
      }
    },
    async query(vector, topK) {
      const res = await collection.query({ queryEmbeddings: [vector], nResults: topK });
      const docs = res.documents?.[0] || [];
      const metas = res.metadatas?.[0] || [];
      const dists = res.distances?.[0] || [];
      return docs.map((text, i) => ({
        text: text || "",
        source: metas[i]?.source || "",
        score: 1 - (dists[i] ?? 1), // cosine distance → похожесть
      }));
    },
  };
}

export async function getStore(opts) {
  if (provider === "chroma") return chromaStore();
  if (provider === "pinecone") return pineconeStore(opts);
  throw new Error(`Неизвестный VECTOR_DB: ${provider} (нужен pinecone или chroma)`);
}
export const vectorProvider = provider;
