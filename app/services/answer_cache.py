"""Questionnaire answer cache inspired by JobBot's NLP-based answer system.

Stores previously-answered form questions and reuses answers for similar questions
using token-based similarity matching. This avoids re-answering the same types
of questions across multiple job applications.
"""
from __future__ import annotations

import json
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional


CACHE_FILE = Path("answer_cache.json")

# Common stop words to ignore during similarity matching
_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about", "between",
    "through", "after", "before", "above", "below", "and", "or", "but",
    "not", "no", "if", "then", "than", "that", "this", "these", "those",
    "it", "its", "you", "your", "we", "our", "um", "uma", "o", "os",
    "as", "de", "do", "da", "dos", "das", "em", "no", "na", "nos",
    "nas", "por", "para", "com", "sem", "e", "ou", "mas", "se",
})


def _tokenize(text: str) -> set[str]:
    """Simple tokenizer: lowercase, split on non-alpha, remove stop words."""
    tokens = set()
    for word in text.lower().split():
        clean = "".join(c for c in word if c.isalnum())
        if clean and len(clean) > 1 and clean not in _STOP_WORDS:
            tokens.add(clean)
    return tokens


def _similarity(tokens_a: set[str], tokens_b: set[str]) -> float:
    """Jaccard-like similarity between two token sets."""
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def _best_option_match(answer: str, options: list[str]) -> Optional[str]:
    """Find the closest matching option using SequenceMatcher (like JobBot's edit distance)."""
    if not options:
        return None
    best_score = 0.0
    best_option = options[0]
    answer_lower = answer.lower()
    for opt in options:
        score = SequenceMatcher(None, answer_lower, opt.lower()).ratio()
        if score > best_score:
            best_score = score
            best_option = opt
    return best_option if best_score > 0.3 else None


class AnswerCache:
    """Persistent cache for form question answers."""

    def __init__(self, cache_path: Path = CACHE_FILE):
        self.cache_path = cache_path
        self._entries: list[dict] = []
        self._load()

    def _load(self) -> None:
        if self.cache_path.exists():
            try:
                self._entries = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self._entries = []

    def _save(self) -> None:
        self.cache_path.write_text(
            json.dumps(self._entries, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def store(self, label: str, input_type: str, answer: str, options: list[str] | None = None) -> None:
        """Store a question-answer pair."""
        tokens = list(_tokenize(label))
        if not tokens:
            return

        # Update existing entry if very similar question exists
        for entry in self._entries:
            if entry["input_type"] == input_type:
                existing_tokens = set(entry["tokens"])
                if _similarity(set(tokens), existing_tokens) > 0.85:
                    entry["answer"] = answer
                    if options:
                        entry["options"] = options
                    self._save()
                    return

        self._entries.append({
            "label": label,
            "tokens": tokens,
            "input_type": input_type,
            "answer": answer,
            "options": options or [],
        })
        self._save()

    def lookup(self, label: str, input_type: str, options: list[str] | None = None, threshold: float = 0.5) -> Optional[str]:
        """Find the best matching answer for a question.

        For select/radio inputs with options, uses edit distance to find the
        closest matching option from the available choices.
        """
        query_tokens = _tokenize(label)
        if not query_tokens:
            return None

        best_score = 0.0
        best_entry = None

        for entry in self._entries:
            if entry["input_type"] != input_type:
                continue
            score = _similarity(query_tokens, set(entry["tokens"]))
            if score > best_score:
                best_score = score
                best_entry = entry

        if not best_entry or best_score < threshold:
            return None

        answer = best_entry["answer"]

        # For select/radio, find closest option match
        if options and input_type in ("select", "radio"):
            return _best_option_match(answer, options)

        return answer

    def size(self) -> int:
        return len(self._entries)
