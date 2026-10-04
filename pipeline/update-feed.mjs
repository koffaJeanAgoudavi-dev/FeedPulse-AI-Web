import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SOURCES = JSON.parse(await readFile(resolve(ROOT, 'pipeline/sources.json'), 'utf8'));
const OUT = resolve(ROOT, 'site/feed.json');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 24);
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 14);

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function stripHtml(value = '') {
  return decode(value).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}
function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((block) => {
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?\s*>/i);
    const rawLink = linkMatch?.[1] || tag(block, 'link') || tag(block, 'guid');
    const imageMatch = block.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)["'][^>]*>/i);
    const published = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const date = new Date(published);
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceConfidence: source.confidence,
      title: tag(block, 'title'),
      description: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'),
      canonicalUrl: rawLink.trim(),
      publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      imageUrl: imageMatch?.[1] || '',
      language: source.language,
    };
  }).filter((item) => item.title && /^https?:\/\//.test(item.canonicalUrl));
}
function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi, ' ').trim();
}
function stableId(url) {
  return `feed-${createHash('sha256').update(url).digest('hex').slice(0, 14)}`;
}
function categoryFallback(text) {
  const value = text.toLowerCase();
  if (/model|gpt|llama|gemini|claude|mistral|transformer/.test(value)) return 'Modèles';
  if (/open source|github|hugging face|dataset|weights/.test(value)) return 'Open Source';
  if (/funding|revenue|investment|business|company|enterprise/.test(value)) return 'Business';
  return 'Outils';
}
function dryBriefing(item) {
  const sentences = item.description.split(/(?<=[.!?])\s+/).filter(Boolean);
  const points = [item.title, ...sentences].filter(Boolean).slice(0, 3);
  while (points.length < 3) points.push(item.title);
  return {
    en: { title: item.title, summary: sentences.slice(0, 2).join(' ').slice(0, 360) || item.title, keyPoints: points },
    fr: { title: item.title, summary: sentences.slice(0, 2).join(' ').slice(0, 360) || item.title, keyPoints: points },
    category: categoryFallback(`${item.title} ${item.description}`), confidence: 0.45, needsReview: true,
  };
}
async function generateBriefing(item) {
  if (DRY_RUN) return dryBriefing(item);
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is required. Use --dry-run for a pipeline smoke test.');
  const prompt = `You are the strict editorial engine for FeedPulse AI. Use only the source text below. Never invent facts. Return JSON only with this exact shape: {"en":{"title":"string","summary":"string","keyPoints":["string","string","string"]},"fr":{"title":"string","summary":"string","keyPoints":["string","string","string"]},"category":"Modèles|Open Source|Business|Outils","confidence":0.0,"needsReview":false}. Keep each title under 100 characters, each summary under 400 characters, exactly 3 key points per language, and preserve names, numbers and uncertainty. Set needsReview true if evidence is insufficient.\n\nSOURCE: ${item.sourceName}\nTITLE: ${item.title}\nURL: ${item.canonicalUrl}\nTEXT: ${item.description.slice(0, 7000)}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
}
function validate(item, briefing) {
  const allowed = new Set(['Modèles', 'Open Source', 'Business', 'Outils']);
  for (const lang of ['en', 'fr']) {
    if (!briefing[lang]?.title || !briefing[lang]?.summary || !Array.isArray(briefing[lang]?.keyPoints) || briefing[lang].keyPoints.length !== 3) return false;
  }
  return allowed.has(briefing.category) && /^https?:\/\//.test(item.canonicalUrl) && Number.isFinite(new Date(item.publishedAt).getTime());
}

const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const collected = [];
for (const source of SOURCES) {
  try {
    const response = await fetch(source.url, { headers: { 'user-agent': 'FeedPulseAI/1.0 RSS reader' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = parseFeed(await response.text(), source).filter((item) => new Date(item.publishedAt).getTime() >= cutoff);
    collected.push(...items);
    console.log(`${source.name}: ${items.length} items`);
  } catch (error) {
    console.warn(`${source.name}: skipped (${error.message})`);
  }
}
const unique = [...new Map(collected.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).map((item) => [item.canonicalUrl, item])).values()];
const titleSeen = new Set();
const candidates = unique.filter((item) => {
  const title = normalizeTitle(item.title);
  if (titleSeen.has(title)) return false;
  titleSeen.add(title);
  return item.description.length >= 40;
}).slice(0, MAX_ITEMS);
const published = [];
for (const item of candidates) {
  try {
    const briefing = await generateBriefing(item);
    if (!validate(item, briefing)) throw new Error('schema validation failed');
    published.push({ id: stableId(item.canonicalUrl), title: briefing.en.title, summary: briefing.en.summary, keyPoints: briefing.en.keyPoints, category: briefing.category, sourceName: item.sourceName, sourceUrl: item.canonicalUrl, publishedAt: item.publishedAt, imageUrl: item.imageUrl, translations: { en: briefing.en, fr: briefing.fr }, quality: { confidence: briefing.confidence, needsReview: briefing.needsReview } });
    console.log(`published: ${item.title}`);
  } catch (error) {
    console.warn(`rejected: ${item.title} (${error.message})`);
  }
}
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), items: published, meta: { sourcesChecked: SOURCES.length, itemsCollected: collected.length, itemsPublished: published.length, model: DRY_RUN ? 'dry-run' : MODEL } }, null, 2) + '\n');
console.log(`feed written: ${published.length} items -> ${OUT}`);
