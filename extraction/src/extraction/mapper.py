"""Field mapper.

Maps extracted document fields to the company-db schema (accounts, transactions, etc.).

For DRIFT cases, maps unknown columns to schema columns using fuzzy string
matching (token overlap + character similarity).  No external dependencies.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# String similarity (no external deps)
# ---------------------------------------------------------------------------

_SIMILARITY_THRESHOLD = 0.6


def _normalise(s: str) -> str:
    """Lowercase, strip, replace separators with spaces."""
    return s.strip().lower().replace("_", " ").replace("-", " ")


def _tokenise(s: str) -> set[str]:
    """Split a normalised string into tokens."""
    return set(_normalise(s).split())


def _token_overlap(a: str, b: str) -> float:
    """Jaccard similarity over word tokens."""
    ta = _tokenise(a)
    tb = _tokenise(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _char_bigrams(s: str) -> set[str]:
    """Return the set of character bigrams for a normalised string."""
    s = _normalise(s).replace(" ", "")
    if len(s) < 2:
        return {s}
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _bigram_similarity(a: str, b: str) -> float:
    """Sorensen-Dice coefficient over character bigrams."""
    ba = _char_bigrams(a)
    bb = _char_bigrams(b)
    if not ba and not bb:
        return 1.0
    if not ba or not bb:
        return 0.0
    return 2 * len(ba & bb) / (len(ba) + len(bb))


def _prefix_bonus(a: str, b: str) -> float:
    """Bonus when one normalised string is a prefix/substring of the other.

    Handles common abbreviations like "bank_bal" -> "bank_balance" or
    "emp_name" -> "employee_name" where token-level overlap is weak.
    """
    na = _normalise(a).replace(" ", "")
    nb = _normalise(b).replace(" ", "")
    if not na or not nb:
        return 0.0

    # Full prefix: "bankbal" is prefix of "bankbalance"
    if nb.startswith(na) or na.startswith(nb):
        shorter = min(len(na), len(nb))
        longer = max(len(na), len(nb))
        return shorter / longer

    # Token-level prefix: each token in shorter is a prefix of a token in longer
    ta = _normalise(a).split()
    tb = _normalise(b).split()
    if not ta or not tb:
        return 0.0

    matched = 0
    used: set[int] = set()
    for sa in ta:
        for j, sb in enumerate(tb):
            if j in used:
                continue
            if sb.startswith(sa) or sa.startswith(sb):
                matched += 1
                used.add(j)
                break

    total = max(len(ta), len(tb))
    return matched / total if total > 0 else 0.0


def similarity(a: str, b: str) -> float:
    """Combined similarity score (token overlap, bigram, and prefix bonus).

    Returns a value in [0, 1].
    """
    tok = _token_overlap(a, b)
    big = _bigram_similarity(a, b)
    pfx = _prefix_bonus(a, b)
    # Take the best two of three signals
    scores = sorted([tok, big, pfx], reverse=True)
    return round((scores[0] + scores[1]) / 2, 4)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def map_columns(
    source_columns: list[str],
    target_schema: dict[str, list[str]],
    threshold: float = _SIMILARITY_THRESHOLD,
) -> dict[str, str]:
    """Map source columns to target schema columns using fuzzy matching.

    Parameters
    ----------
    source_columns:
        Column names extracted from the document.
    target_schema:
        Schema dict with ``required`` and ``optional`` lists.
    threshold:
        Minimum similarity score to consider a mapping (default 0.6).

    Returns
    -------
    Dict mapping source column name -> target schema column name for all
    pairs that exceed the threshold.  Only includes mappings where the
    source column is **not** an exact match (i.e. was not already mapped).
    """
    all_target = list(target_schema.get("required", [])) + list(
        target_schema.get("optional", [])
    )
    target_set_lower = {t.lower() for t in all_target}

    result: dict[str, str] = {}

    for src in source_columns:
        src_lower = src.strip().lower()

        # Skip exact matches -- no mapping needed
        if src_lower in target_set_lower:
            continue

        best_score = 0.0
        best_target: str | None = None

        for tgt in all_target:
            score = similarity(src_lower, tgt.lower())
            if score > best_score:
                best_score = score
                best_target = tgt

        if best_target is not None and best_score >= threshold:
            result[src_lower] = best_target.lower()

    return result
