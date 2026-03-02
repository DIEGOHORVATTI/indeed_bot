/**
 * Answer cache — ported from Python answer_cache.py.
 * Uses chrome.storage.local instead of JSON file.
 * Token-based Jaccard similarity for question matching.
 */

import { CacheEntry } from '../types';

const STORAGE_KEY = 'answerCache';

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'about',
  'between',
  'through',
  'after',
  'before',
  'above',
  'below',
  'and',
  'or',
  'but',
  'not',
  'no',
  'if',
  'then',
  'than',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'you',
  'your',
  'we',
  'our',
  'um',
  'uma',
  'o',
  'os',
  'as',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'por',
  'para',
  'com',
  'sem',
  'e',
  'ou',
  'mas',
  'se'
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().split(/\s+/)) {
    const clean = word.replace(/[^a-zA-Z0-9àáâãéêíóôõúüçñ]/g, '');
    if (clean && clean.length > 1 && !STOP_WORDS.has(clean)) {
      tokens.add(clean);
    }
  }
  return tokens;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

/** Levenshtein distance ratio (replaces Python's SequenceMatcher). */
function editDistanceRatio(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return 1;
  if (m === 0 || n === 0) return 0;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return 1 - dp[m][n] / Math.max(m, n);
}

function bestOptionMatch(answer: string, options: string[]): string | null {
  if (options.length === 0) return null;
  let bestScore = 0;
  let bestOption = options[0];
  const aLower = answer.toLowerCase();

  for (const opt of options) {
    const score = editDistanceRatio(aLower, opt.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestOption = opt;
    }
  }

  return bestScore > 0.3 ? bestOption : null;
}

export class AnswerCache {
  private entries: CacheEntry[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    const data = await chrome.storage.local.get(STORAGE_KEY);
    this.entries = data[STORAGE_KEY] || [];
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: this.entries });
  }

  async store(label: string, inputType: string, answer: string, options?: string[]): Promise<void> {
    await this.load();
    const tokens = Array.from(tokenize(label));
    if (tokens.length === 0) return;

    // Update existing entry if very similar question exists
    for (const entry of this.entries) {
      if (entry.inputType === inputType) {
        const existingTokens = new Set(entry.tokens);
        if (similarity(new Set(tokens), existingTokens) > 0.85) {
          entry.answer = answer;
          if (options) entry.options = options;
          await this.save();
          return;
        }
      }
    }

    this.entries.push({
      label,
      tokens,
      inputType,
      answer,
      options: options || []
    });
    await this.save();
  }

  async lookup(
    label: string,
    inputType: string,
    options?: string[],
    threshold = 0.5
  ): Promise<string | null> {
    await this.load();
    const queryTokens = tokenize(label);
    if (queryTokens.size === 0) return null;

    let bestScore = 0;
    let bestEntry: CacheEntry | null = null;

    for (const entry of this.entries) {
      if (entry.inputType !== inputType) continue;
      const score = similarity(queryTokens, new Set(entry.tokens));
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (!bestEntry || bestScore < threshold) return null;

    const answer = bestEntry.answer;

    // For select/radio, find closest option match
    if (options && (inputType === 'select' || inputType === 'radio')) {
      return bestOptionMatch(answer, options);
    }

    return answer;
  }

  get size(): number {
    return this.entries.length;
  }
}
