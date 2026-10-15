const LATIN: Record<string, string> = {
  æ: "ae",
  ø: "o",
  ß: "ss",
  ð: "d",
  þ: "th",
  ł: "l",
  đ: "d",
  œ: "oe",
};

/** A locale-independent search key for Latin names. */
export function foldForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[æøßðþłđœ]/g, (letter) => LATIN[letter] ?? letter);
}
