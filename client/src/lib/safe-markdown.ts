/**
 * Rendering the persona's words.
 *
 * The persona's replies are markdown, and markdown can carry raw HTML.
 * `Streamdown`'s default chain includes `rehype-raw`, which parses that
 * raw HTML into live DOM nodes — so a reply that said
 * `<script>…</script>` produced a real `<script>` element in the page.
 *
 * The session cookie is `httpOnly`, so injected script cannot read it
 * directly, but same-origin requests are authenticated automatically:
 * script on the app's own origin can call every procedure as the user
 * and read every conversation, memory and uploaded file.
 *
 * The reply text is not the app's own writing. It is whatever a model
 * produced, and a model can be led — by a message in the uploaded chat
 * log, by a third party's words in it, or by a hostile provider — into
 * emitting whatever it was asked to. So the raw-HTML parser is removed
 * from the chain: markdown that contains HTML is shown as the text it
 * is, which is what a chat bubble should do anyway.
 *
 * The rest of the chain is kept: `rehype-harden` (which strips
 * `javascript:` and `data:` URLs from links and images), `rehype-katex`
 * (which escapes what it renders), and the remark plugins.
 */
import { defaultRehypePlugins } from "streamdown";

/**
 * The type of a plugin in the chain, taken from the chain itself so this
 * module does not need `unified` as a direct dependency.
 */
type RehypePlugin = (typeof defaultRehypePlugins)[keyof typeof defaultRehypePlugins];

/**
 * A node in the tree the rehype chain works on.
 *
 * Only the two things this module needs to know about.
 */
type HastNode = {
  type: string;
  value?: string;
  children?: HastNode[];
};

/**
 * Raw HTML becomes the text it is.
 *
 * Without the raw-HTML parser the HTML in a reply is never turned into
 * elements — that is the whole defence, and it is a good one. But the
 * sanitiser that comes after throws the HTML away, so a reply that
 * contains any HTML at all said *nothing*: the bubble was empty, and
 * the person on the other side had no idea what had been said.
 *
 * So the HTML is turned into text *before* the sanitiser sees it. It
 * is then shown as the characters it is — which is what a chat bubble
 * should do — and it can never become an element, because by the time
 * anything else looks at it, it is text.
 */
function rawAsText() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type === "raw") {
          // A text node carries the characters; a raw node carried the
          // markup. The value stays; only the kind changes.
          child.type = "text";
        } else {
          walk(child);
        }
      }
    };
    walk(tree);
  };
}

/**
 * The rehype chain, without the raw-HTML parser.
 *
 * Exported so a test can assert that the raw parser really is gone —
 * and so the assertion is about the chain that is actually used, not
 * about a copy of it.
 */
export const SAFE_REHYPE_PLUGINS: RehypePlugin[] = [
  rawAsText as unknown as RehypePlugin,
  ...Object.values(defaultRehypePlugins).filter(
    (plugin) => plugin !== defaultRehypePlugins.raw,
  ),
];
