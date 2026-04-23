'use strict';
const fetch = require('node-fetch');
const { load } = require('cheerio');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

module.exports = async function webSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 12000,
    });
    html = await res.text();
  } catch (e) {
    return `Search failed: ${e.message}`;
  }

  const $ = load(html);
  const out = [];
  $('.result__body').each((i, el) => {
    if (i >= 5) return false;
    const title = $(el).find('.result__title').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const href = $(el).find('.result__url').text().trim();
    if (title) out.push(`**${title}**\n${href}\n${snippet}`);
  });

  return out.length
    ? `Results for "${query}":\n\n${out.join('\n\n')}`
    : `No results for: ${query}`;
};
