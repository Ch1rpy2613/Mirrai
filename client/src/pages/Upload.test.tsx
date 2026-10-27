// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The files that are on their way.
 *
 * The row's key was the file's name plus the clock — so two files with
 * the same name uploaded in the same millisecond were **one row**, and
 * the row of the first one was deleted when the second one finished:
 * the first file was left uploading for ever.
 */

const upload = vi.fn();
const refetchFiles = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    skillEngine: {
      getResearchProfile: { useQuery: () => ({ data: undefined }) },
      getJobStatus: { useQuery: () => ({ data: undefined, error: null }) },
      exportSkill: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    persona: {
      get: { useQuery: () => ({ data: { id: 1, name: "小A", analysisStatus: "ready" }, refetch: vi.fn(), isError: false }) },
      getAnalysisStatus: { useQuery: () => ({ data: { status: "ready" }, refetch: vi.fn() }) },
      triggerAnalysis: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    file: {
      list: { useQuery: () => ({ data: [], refetch: refetchFiles, isLoading: false, isError: false }) },
      upload: { useMutation: () => ({ mutateAsync: upload, isPending: false }) },
    },
    collector: {
      preview: { useQuery: () => ({ data: { total: 0 } }) },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, timezone: "Asia/Shanghai" }, isAuthenticated: true, loading: false }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1/upload", vi.fn()],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("@/components/DistillationModePicker", () => ({
  default: () => <div data-testid="mode-picker" />,
}));

import Upload from "./Upload";

/**
 * The file reader.
 *
 * The browser reads the file and hands back its bytes; the test does
 * not need a real file for that, and jsdom's reader does not fire
 * inside a test.
 */
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.result = "data:text/plain;base64,aGVsbG8=";
    setTimeout(() => this.onload?.(), 0);
  }
}

/** A file of the user's own, in the browser's own shape. */
function makeFile(name: string, type = "text/plain"): File {
  return new File(["hello"], name, { type });
}

describe("the files that are on their way", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The uploads stay on their way: a row that is finished is taken
    // off the panel.
    upload.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps two files of the same name apart", async () => {
    /**
     * The same millisecond for both files.
     *
     * That is what makes the two rows collide: the key was the name
     * plus the clock.
     */
    vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
    vi.stubGlobal("FileReader", FakeFileReader);
    render(<Upload />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Two files with the same name, chosen in the same millisecond.
    fireEvent.change(input, { target: { files: [makeFile("chat.txt")] } });
    await waitFor(() => {
      expect(screen.getAllByText("chat.txt").length).toBe(1);
    });
    fireEvent.change(input, { target: { files: [makeFile("chat.txt")] } });

    await waitFor(() => {
      expect(screen.getAllByText("chat.txt").length).toBe(2);
    });
  });

  it("shows the file's own name, not the row's key", async () => {
    vi.stubGlobal("FileReader", FakeFileReader);
    render(<Upload />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const files = [makeFile("notes.txt")];
    fireEvent.change(input, { target: { files } });

    await waitFor(() => {
      expect(screen.getAllByText("notes.txt").length).toBe(1);
    });
    // The key is not shown to the person.
    expect(screen.queryByText(/notes\.txt#/)).toBeNull();
  });
});
