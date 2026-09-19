import { literalQuery, topicQuery, topicWords, similarTerms, words } from './intent.mjs';

const vocabReady = new WeakSet();
const MAX_QUERIES = 3;
const key = (item) => `${item.source_kind}:${item.source_id}`;

function vocabulary(database, word) {
  if (!vocabReady.has(database)) {
    // A view over the EXISTING index. No persistent table, migration or duplicated documents.
    database.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.kafedra_search_vocab USING fts5vocab(main, search_fts, 'row')");
    vocabReady.add(database);
  }
  const first = word.slice(0, 1);
  return database.all(`SELECT term FROM temp.kafedra_search_vocab
    WHERE term >= ? AND term < ? AND length(term) BETWEEN ? AND ? LIMIT 600`,
  first, String.fromCodePoint(first.codePointAt(0) + 1), Math.max(4, word.length - 3), word.length + 3).map((row) => row.term);
}

/** find() must return only authorized, hydrated, current search results under the original filters. */
export function retrieveMaterials({ database, query, find, expansions = [], limit = 80, fuzzy = true }) {
  const rows = new Map();
  const relatedQueries = [];
  const searched = new Set();
  const literal = literalQuery(query);
  const topic = topicQuery(query);
  let mode = 'exact';
  function run(text, kind, label = text) {
    const clean = literalQuery(text);
    if (!clean || searched.has(clean)) return [];
    searched.add(clean);
    const items = find(clean);
    for (const item of items) {
      const id = key(item);
      if (!rows.has(id) && rows.size < limit * 4) rows.set(id, { ...item, matched_by: kind, matched_query: label });
    }
    // Hints are supported by this caller's actual visible results, never by vocabulary alone.
    if (items.length && clean !== literal && relatedQueries.length < MAX_QUERIES
      && !relatedQueries.some((hint) => hint.query === label)) {
      relatedQueries.push({ query: label, count: items.length, kind });
    }
    return items;
  }
  run(literal, 'exact');
  if (topic && topic !== literal) {
    const found = run(topic, 'word_forms', topicWords(query).join(' '));
    if (found.length && ![...rows.values()].some((item) => item.matched_by === 'exact')) mode = 'word_forms';
  }
  if (!rows.size && fuzzy && database) {
    // Correct at most one word, retaining all the other topic terms; never fuzz IDs/dates.
    for (const word of topicWords(query).slice(0, 3)) {
      if (!/^[а-яa-z]{5,40}$/u.test(word)) continue;
      let candidates;
      try { candidates = similarTerms(word, vocabulary(database, word)); }
      catch { break; } // Optional vocabulary support must not break the ordinary search.
      for (const term of candidates) {
        const corrected = topicWords(query).map((part) => part === word ? term : part).join(' ');
        if (run(corrected, 'spelling').length) { mode = 'spelling'; break; }
      }
      if (rows.size) break;
    }
  }
  for (const expansion of expansions.slice(0, MAX_QUERIES)) {
    const clean = topicQuery(expansion);
    if (!clean || words(clean).length > 8) continue;
    run(literalQuery(expansion), 'meaning');
    if (clean !== literalQuery(expansion)) run(clean, 'meaning', literalQuery(expansion));
  }
  const all = [...rows.values()];
  const discovered = all.filter((item) => item.matched_by === 'meaning');
  const original = all.filter((item) => item.matched_by !== 'meaning');
  const mixed = [];
  for (let index = 0; index < Math.max(original.length, discovered.length); index++) {
    if (original[index]) mixed.push(original[index]);
    if (discovered[index]) mixed.push(discovered[index]);
  }
  // Reserve room for newly retrieved sources even when the original result filled the limit.
  return { items: mixed.slice(0, limit), relatedQueries, mode };
}
