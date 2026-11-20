"""Lee's subtitle grouping, retaining original media seconds."""
MAX_SUBTITLE_SECONDS = 3.0
MAX_SUBTITLE_CHARACTERS = 28
MAX_WORD_GAP_SECONDS = 0.6


def make_subtitle(words):
    return {
        "start": round(words[0].start, 3),
        "end": round(words[-1].end, 3),
        "text": "".join(word.word for word in words).strip(),
    }


def split_subtitles(segment):
    words = segment.words or []
    if not words:
        text = segment.text.strip()
        start, end = round(segment.start, 3), round(segment.end, 3)
        return [{"start": start, "end": end, "text": text}] if text and end > start else []
    subtitles, current_words = [], []
    for word in words:
        if current_words:
            text = "".join(item.word for item in current_words) + word.word
            if (word.end - current_words[0].start > MAX_SUBTITLE_SECONDS
                    or len(text.strip()) > MAX_SUBTITLE_CHARACTERS
                    or word.start - current_words[-1].end > MAX_WORD_GAP_SECONDS):
                subtitles.append(make_subtitle(current_words))
                current_words = []
        current_words.append(word)
        if word.word.rstrip().endswith((".", "?", "!", "。", "？", "！")):
            subtitles.append(make_subtitle(current_words))
            current_words = []
    if current_words:
        subtitles.append(make_subtitle(current_words))
    results = []
    for subtitle in subtitles:
        if not subtitle["text"]:
            continue
        if subtitle["end"] <= subtitle["start"]:
            if results:
                results[-1]["text"] += subtitle["text"]
            continue
        results.append(subtitle)
    return results
