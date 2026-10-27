// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

/**
 * The app's own confirmation.
 *
 * It was the browser's own dialog (`window.confirm`) — which is not the
 * app's: the buttons say "OK" and "Cancel" in the *browser's* language,
 * not the language the person is reading the app in, and in an
 * embedded view the native dialog is not shown at all — the promise
 * never settles, and so the thing the person was asked about simply
 * never happens, with no word about why.
 */

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

/** A page that asks something. */
function Asker({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        const answer = await confirm({ description: "删掉这条消息？" });
        onAnswer(answer);
      }}
    >
      删掉
    </button>
  );
}

describe("the app's own confirmation", () => {
  it("asks in the app's language", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onAnswer={onAnswer} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText("删掉"));

    // The question is on the screen, in the app's language.
    expect(await screen.findByText("删掉这条消息？")).toBeInTheDocument();
    // And the buttons are the app's own — not the browser's "OK" and
    // "Cancel", which say it in the browser's language.
    expect(screen.getByRole("button", { name: translate("zh", "common.confirm") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("zh", "common.cancel") })).toBeInTheDocument();
  });

  it("answers yes when the person says yes", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onAnswer={onAnswer} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText("删掉"));
    await user.click(screen.getByRole("button", { name: translate("zh", "common.confirm") }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  });

  it("answers no when the person says no", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onAnswer={onAnswer} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText("删掉"));
    await user.click(screen.getByRole("button", { name: translate("zh", "common.cancel") }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it("answers no when the dialog is closed without an answer", async () => {
    /**
     * The escape key, or a click outside the dialog.
     *
     * The browser's own dialog always settles — so a person who pressed
     * the escape key was never left waiting. This one has to settle
     * too, or the thing they were asked about never happens and nothing
     * says why.
     */
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onAnswer={onAnswer} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText("删掉"));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it("is used everywhere, and the browser's own dialog is used nowhere", () => {
    /**
     * The browser's own dialog says "OK" and "Cancel" in the
     * *browser's* language — not the language the person is reading the
     * app in — and in an embedded view it is not shown at all.
     */
    const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
    const { join, relative } = require("node:path") as typeof import("node:path");
    const root = join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue;
        const full = join(dir, name);
        if (/\.(ts|tsx)$/.test(name)) files.push(full);
        else if (!name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
          try {
            if (readdirSync(full).length && !name.endsWith(".tsx") && !name.endsWith(".ts")) walk(full);
          } catch {
            // Not a directory.
          }
        }
      }
    };
    walk(root);
    for (const file of files) {
      if (file.endsWith(".test.tsx") || file.endsWith(".test.ts")) continue;
      const source = readFileSync(file, "utf-8");
      // The browser's own dialog, called by name. A mention in a
      // comment is not a call.
      const call = /window\.confirm\s*\(/;
      const found = source.match(call);
      expect(found?.[0], `${relative(root, file)} calls the browser's own dialog`).toBeUndefined();
    }
  });

  it("does not use the browser's own dialog", async () => {
    const user = userEvent.setup();
    const browserConfirm = vi.spyOn(window, "confirm");
    render(
      <ConfirmProvider>
        <Asker onAnswer={vi.fn()} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByText("删掉"));

    expect(browserConfirm).not.toHaveBeenCalled();
    browserConfirm.mockRestore();
  });
});
