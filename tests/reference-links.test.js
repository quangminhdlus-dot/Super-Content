import { test } from "node:test";
import assert from "node:assert/strict";
import {
  referenceLines, safeReferenceUrl, parseReferenceLinks,
  addReferenceLinks, removeReferenceLink, referenceKind, MAX_REFERENCE_LINKS,
} from "../src/reference-links.js";

test("single legacy URL and multiple newline URLs remain valid without a DB migration", () => {
  assert.deepEqual(parseReferenceLinks("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]);
  const joined = addReferenceLinks(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "example.com/article\nhttps://vimeo.com/1234",
  );
  assert.deepEqual(parseReferenceLinks(joined), [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://example.com/article",
    "https://vimeo.com/1234",
  ]);
  assert.equal(addReferenceLinks(joined, "https://example.com/article"), joined);
  assert.equal(removeReferenceLink(joined, 1).includes("example.com"), false);
  assert.equal(referenceKind("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(referenceKind("https://docs.google.com/document/d/foo"), "document");
  assert.equal(referenceKind("https://vimeo.com/123"), "video");
  assert.equal(referenceKind("https://news.example.org/story"), "link");
});

test("malicious, non-http, credentials and broken links are never clickable", () => {
  for (const input of [
    "javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd",
    "https://user:pass@example.com", "localhost", "not_a_url", "https://example.com/\n<script>",
  ])
    assert.equal(safeReferenceUrl(input), null, input);
  const original = "old value without a URL";
  const extended = addReferenceLinks(original, "https://example.com");
  assert.equal(referenceLines(extended)[0], original);
  assert.deepEqual(parseReferenceLinks(extended), ["https://example.com/"]);
  assert.equal(removeReferenceLink(extended, 0), original);
  assert.throws(() => addReferenceLinks("", "https://valid.example\njavascript:alert(1)"), /không hợp lệ/);
  assert.throws(() => removeReferenceLink("", 0), /Không tìm thấy/);
  assert.throws(() => addReferenceLinks("", Array.from({ length: MAX_REFERENCE_LINKS + 1 }, (_, i) => "https://example.com/" + i).join("\n")), /tối đa/);
});
