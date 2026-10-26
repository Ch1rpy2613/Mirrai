import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { SAFE_REHYPE_PLUGINS } from "./safe-markdown";

/**
 * What the persona said must not be able to run.
 *
 * The persona's replies are markdown, and markdown can carry raw HTML.
 * `Streamdown`'s default rehype chain includes `rehype-raw`, which turns
 * that raw HTML into live DOM nodes — so a reply containing
 * `<script>…</script>` produced a real script element in the page.
 *
 * The session cookie is `httpOnly`, but same-origin requests are
 * authenticated automatically, so script on the app's own origin can call
 * every procedure as the user and read every conversation.
 *
 * These tests render the real pipeline and look at the HTML that comes
 * out.
 */

/** Renders markdown the way the chat bubble does. */
function render(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(Streamdown, {
      rehypePlugins: SAFE_REHYPE_PLUGINS,
      children: markdown,
    }),
  );
}

/** Renders markdown the way `Streamdown` does when it is left alone. */
function renderUnsafe(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(Streamdown, {
      rehypePlugins: Object.values(defaultRehypePlugins),
      children: markdown,
    }),
  );
}

describe("the persona's words", () => {
  it("does not run a script", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    // The text is still shown — as the text it is.
    expect(html).toContain("alert(1)");
  });

  it("does not create a frame", () => {
    const html = render('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain("<iframe");
  });

  it("does not create an object or an embed", () => {
    const html = render('<object data="x"></object><embed src="x">');
    expect(html).not.toContain("<object");
    expect(html).not.toContain("<embed");
  });

  it("does not keep an event handler", () => {
    const html = render('<div onclick="alert(1)">x</div>');
    // The markup is shown as text, so there is no element carrying the
    // handler — only the characters of it.
    expect(html).not.toMatch(/<[^>]*\son\w+\s*=/i);
  });

  it("does not make a form that could post as the user", () => {
    const html = render('<form action="/api/trpc"><input name="a"></form>');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });

  it("does not follow a javascript: link written as markdown", () => {
    // Markdown links are parsed into real anchors, so this one needed the
    // URL check as well as the removal of the raw-HTML parser.
    const html = render("[click](javascript:alert(1))");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("does not follow a javascript: image written as markdown", () => {
    const html = render("![alt](javascript:alert(1))");
    expect(html).not.toMatch(/src="javascript:/i);
  });

  it("does not follow a data: image written as markdown", () => {
    const html = render("![alt](data:text/html;base64,PHNjcmlwdD4x)");
    expect(html).not.toMatch(/src="data:text\/html/i);
  });

  it("still renders ordinary markdown", () => {
    const html = render("**bold** and _italic_ and `code`");
    expect(html).toContain("bold");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code");
  });

  it("still renders a link", () => {
    const html = render("[a link](https://example.com)");
    expect(html).toContain('href="https://example.com');
  });

  it("still renders a list", () => {
    const html = render("- one\n- two");
    expect(html).toContain("<li");
  });
});

describe("the chain that is used", () => {
  it("has no raw-HTML parser in it", () => {
    // The assertion is about the chain the app actually renders with.
    expect(SAFE_REHYPE_PLUGINS).not.toContain(defaultRehypePlugins.raw);
  });

  it("would have been vulnerable without the fix", () => {
    // If this ever stops being true, the tests above have stopped
    // proving anything.
    expect(renderUnsafe("<script>alert(1)</script>")).toContain("<script");
  });
});
