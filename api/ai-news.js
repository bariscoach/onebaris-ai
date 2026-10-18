import { createMessage } from '../lib/model.js';

// "AI News — What's Buzzing" for the ticker, made the same way as the Daily-Digest email: what's hot in
// the last 24 hours on a few AI subreddits and AI news sites, curated by Claude into five plain-English
// items. Reddit is read through its RSS feeds, since its JSON API refuses requests from servers.
// Vercel's edge cache keeps the result for a day, so Claude runs about once a day, not on every visit.

const DAY = 24 * 60 * 60;
const FEEDS = [
  { url: 'https://www.reddit.com/r/singularity/hot/.rss', source: 'r/singularity', take: 8 },
  { url: 'https://www.reddit.com/r/artificial/hot/.rss', source: 'r/artificial', take: 8 },
  { url: 'https://www.reddit.com/r/ChatGPT/hot/.rss', source: 'r/ChatGPT', take: 6 },
  { url: 'https://the-decoder.com/feed/', source: 'The Decoder', take: 6 },
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', source: 'TechCrunch', take: 6 },
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', source: 'The Verge', take: 5 },
  { url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', source: 'MIT Technology Review', take: 5 },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const posts = await fetchCandidates();
    const items = await curate(apiKey, posts);
    if (items.length === 0) throw new Error('No AI news found');
    // Cached at the edge for a day; a stale copy is served while the next one is made.
    res.setHeader('Cache-Control', `public, s-maxage=${DAY}, stale-while-revalidate=${DAY}`);
    return res.status(200).json({ updated: new Date().toISOString(), items });
  } catch (error) {
    console.error('AI news failed:', error.message);
    // A short cache, so a failure is retried soon without hammering the sources.
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    return res.status(502).json({ error: 'AI news is unavailable right now' });
  }
}

/** Fresh items from every feed, interleaved so no single source dominates, without duplicates. */
async function fetchCandidates() {
  // Reddit rate-limits parallel requests, so its feeds go one at a time while the news sites load.
  const isReddit = feed => feed.url.includes('reddit.com');
  const sitesLoading = Promise.all(FEEDS.filter(feed => !isReddit(feed)).map(fetchFeed));
  const redditLists = [];
  for (const feed of FEEDS.filter(isReddit)) {
    if (redditLists.length) await new Promise(resolve => setTimeout(resolve, 1200));
    redditLists.push(await fetchFeed(feed));
  }
  const lists = [...redditLists, ...await sitesLoading];
  const merged = [];
  for (let i = 0; merged.length < 40 && lists.some(list => i < list.length); i++) {
    for (const list of lists) if (list[i]) merged.push(list[i]);
  }
  const seen = new Set();
  return merged.filter(p => {
    const key = p.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

/** The newest items of an RSS or Atom feed from the last day, in feed order. A small regex reader is enough here. */
async function fetchFeed({ url, source, take }) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'OneBarisAI/1.0 (news ticker)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const cutoff = Date.now() - DAY * 1000;
    const field = (item, name) => {
      const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
      return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    const plain = html => decode(decode(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return [...xml.matchAll(/<(item|entry)>([\s\S]*?)<\/\1>/g)]
      .map(([, , item]) => {
        const atomLink = item.match(/<link[^>]*href="([^"]+)"/);
        const link = decode(field(item, 'link') || (atomLink ? atomLink[1] : ''));
        const date = Date.parse(field(item, 'pubDate') || field(item, 'published') || field(item, 'updated'));
        const text = plain(field(item, 'description') || field(item, 'content') || field(item, 'summary'));
        return { title: plain(field(item, 'title')), link, date, source, text: text.slice(0, 300) };
      })
      .filter(i => i.title && i.link.startsWith('https://') && (!i.date || i.date >= cutoff))
      .slice(0, take);
  } catch (error) {
    console.error(`${source} feed failed:`, error.message);
    return [];
  }
}

function decode(text) {
  return text.replace(/&amp;/g, '&').replace(/&#8217;|&#039;|&apos;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function curate(apiKey, posts) {
  if (posts.length === 0) return [];
  const list = posts.map((p, i) =>
    `Post ${i + 1} [${p.source}]\nTitle: ${p.title}${p.text ? `\nText: ${p.text}` : ''}`
  ).join('\n\n---\n\n');

  const { response, data } = await createMessage(apiKey, {
    max_tokens: 900,
    // A short, structured task: thinking would only use up the token budget.
    thinking: { type: 'disabled' },
    messages: [{
      role: 'user',
      content: `You are curating a "What's buzzing in AI" news ticker for a personal website, read by non-technical visitors.\n\nFrom the posts below, pick the 5 most newsworthy AI updates: new model or product launches, tool releases, notable use cases, industry moves, research breakthroughs. Skip memes, personal stories, rants, politics, and low-substance posts.\n\nFor each pick, write a short headline (at most 10 words, no clickbait, no emojis) and one plain-English sentence (at most 22 words) explaining it. Return ONLY a JSON array: [{"index": <1-based post number>, "headline": "...", "summary": "..."}]\n\n${list}`,
    }],
  });
  if (!response.ok) throw new Error(`Claude answered ${response.status}`);
  const text = data.content?.find(block => block.type === 'text')?.text || '';
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  const picks = JSON.parse(json);
  return picks
    .map(({ index, headline, summary }) => {
      const post = posts[index - 1];
      if (!post || typeof headline !== 'string') return null;
      return { headline: headline.slice(0, 120), summary: String(summary || '').slice(0, 240), link: post.link, source: post.source };
    })
    .filter(Boolean)
    .slice(0, 5);
}
