export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/[×х]/g, "x")
    .replace(/м²/g, "м2")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

export function buildSearchIndex(parts: unknown[]) {
  return normalizeSearchText(parts.filter((part) => part !== undefined && part !== null).join(" "));
}

export function matchesSearchIndex(index: string, query: string) {
  const normalizedIndex = normalizeSearchText(index);
  const tokens = searchTokens(query);
  if (!tokens.length) return true;

  const words = normalizedIndex.split(" ").filter(Boolean);
  return tokens.every((token) => tokenMatches(words, normalizedIndex, token));
}

export function rankBySearchIndex<T>(
  items: T[],
  query: string,
  getIndex: (item: T) => string,
  limit = Number.POSITIVE_INFINITY,
) {
  const tokens = searchTokens(query);
  if (!tokens.length) return items.slice(0, limit);

  return items
    .map((item) => {
      const index = normalizeSearchText(getIndex(item));
      return {
        item,
        score: searchScore(index, tokens),
      };
    })
    .filter((match) => match.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map((match) => match.item);
}

export function searchScore(index: string, tokens: string[]) {
  const normalizedIndex = normalizeSearchText(index);
  const words = normalizedIndex.split(" ").filter(Boolean);

  return tokens.reduce((score, token) => {
    const wordScore = words.reduce((best, word, wordIndex) => {
      if (word === token) return Math.max(best, 120 - wordIndex);
      if (word.startsWith(token)) return Math.max(best, 95 - wordIndex);
      if (token.length >= 3 && word.includes(token)) return Math.max(best, 58 - wordIndex);
      return Math.max(best, fuzzyTokenScore(word, token));
    }, 0);

    if (!wordScore) return -1000;
    return score + wordScore + Math.max(0, 12 - token.length);
  }, 0);
}

function tokenMatches(words: string[], normalizedIndex: string, token: string) {
  if (words.some((word) => word === token || word.startsWith(token))) return true;
  if (token.length >= 3 && normalizedIndex.includes(token)) return true;
  return words.some((word) => fuzzyTokenScore(word, token) >= 30);
}

function fuzzyTokenScore(word: string, token: string) {
  if (token.length < 2 || word.length < 2) return 0;
  if (word.startsWith(token.slice(0, Math.min(3, token.length)))) return 44;

  let tokenIndex = 0;
  let gaps = 0;
  let lastMatchIndex = -1;

  for (let wordIndex = 0; wordIndex < word.length && tokenIndex < token.length; wordIndex += 1) {
    if (word[wordIndex] !== token[tokenIndex]) continue;
    if (lastMatchIndex >= 0) gaps += wordIndex - lastMatchIndex - 1;
    lastMatchIndex = wordIndex;
    tokenIndex += 1;
  }

  if (tokenIndex !== token.length) return 0;
  return Math.max(12, 42 - gaps - Math.max(0, word.length - token.length));
}
