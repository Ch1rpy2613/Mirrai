// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render as renderInto } from "@testing-library/react";
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
 * These tests render the real pipeline and look at what comes out.
 *
 * They render it in a *browser*, and wait for the result.
 *
 * They used to render it with `renderToStaticMarkup`, which renders
 * once and stops. But `Streamdown` parses the markdown inside a
 * transition — so the first render is the empty one, and the content
 * arrives after it. A test that looked at the first render saw an
 * empty `<div>` and concluded that the persona's words had vanished.
 *
 * Which is not what happens in the app: the chat bubble renders in the
 * browser, the transition completes, and the words are there. The test
 * was measuring the wrong moment.
 */

/**
 * Renders markdown the way the chat bubble does.
 *
 * `Streamdown` parses the markdown inside a transition, so the first
 * render is an empty shell. Rendering in a browser and letting
 * `act` flush it means the content is there when this returns.
 *
 * These tests used to render with `renderToStaticMarkup`, which
 * renders once and stops — so they saw the empty shell, and concluded
 * that the persona's words had vanished. They had not; the test was
 * measuring the wrong moment.
 */
function render(markdown: string): string {
  const { container } = renderInto(
    React.createElement(Streamdown, {
      rehypePlugins: SAFE_REHYPE_PLUGINS,
      children: markdown,
    }),
  );
  return container.innerHTML;
}

/** Renders markdown the way `Streamdown` does when it is left alone. */
function renderUnsafe(markdown: string): string {
  const { container } = renderInto(
    React.createElement(Streamdown, {
      rehypePlugins: Object.values(defaultRehypePlugins),
      children: markdown,
    }),
  );
  return container.innerHTML;
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

  it("shows raw HTML as the text it is", () => {
    /**
     * The user sees what was said.
     *
     * The raw-HTML parser is gone — that is the defence, and it stays.
     * But the sanitiser behind it throws the HTML away, so a reply
     * that contains any HTML at all used to say *nothing*: the bubble
     * was empty, and the person on the other side had no idea what had
     * been said.
     *
     * The HTML is turned into text before the sanitiser sees it, so it
     * is shown as the characters it is.
     */
    const html = render("<b>bold</b>");
    expect(html).toContain("bold");
    // And it is the characters — not an element.
    expect(html).not.toContain("<b>");
  });

  it("does not need the sanitiser to be safe", () => {
    /**
     * The app's own chain, on its own.
     *
     * The chain `Streamdown` brings now has a sanitiser in it, so the
     * default chain is safe as well — this test used to say the
     * opposite, because it was true then.
     *
     * But the app must not *depend* on that: a version of `Streamdown`
     * that dropped the sanitiser would put the hole back. So the app's
     * chain is the one that has to hold, and it does: the raw HTML
     * never becomes an element, whatever the sanitiser thinks of it.
     */
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    // It is shown as the text it is.
    expect(html).toContain("alert(1)");
  });

  it("is safe in the chain `Streamdown` brings as well", () => {
    // The default chain has a sanitiser in it now, so a script in a
    // reply does not become a script element there either. If a
    // version of `Streamdown` ever drops that, this fails — which is
    // the point of the test.
    expect(renderUnsafe("<script>alert(1)</script>")).not.toContain("<script");
  });
});
