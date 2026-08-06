// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const apiFetchMock = vi.fn();
const toastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  ApiError: class MockApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

const { LoginForm } = await import("@/components/auth/login-form");
const { ApiError } = await import("@/lib/api-fetcher");

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderForm(variant: "requestor" | "admin" = "requestor") {
  return render(
    <Providers>
      <LoginForm variant={variant} />
    </Providers>,
  );
}

/**
 * Routes the mocked apiFetch by URL: the verify step returns `{ exists }`; the
 * login step resolves `login` or rejects `loginError`.
 */
function configureApi(opts: {
  exists?: boolean;
  login?: unknown;
  loginError?: unknown;
}) {
  const { exists = true, login, loginError } = opts;
  apiFetchMock.mockImplementation((url: string) => {
    if (url === "/api/auth/verify-domain") return Promise.resolve({ exists });
    if (url === "/api/auth/login") {
      return loginError ? Promise.reject(loginError) : Promise.resolve(login);
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

function fillDomainId(value: string) {
  for (let i = 0; i < 7; i++) {
    const box = screen.getByLabelText(`Domain ID character ${i + 1} of 7`);
    fireEvent.change(box, { target: { value: value[i] } });
  }
}

const passwordInput = () =>
  screen.getByLabelText("Password") as HTMLInputElement;

/** Step 1: enter the Domain ID and click Continue (fires the verify call). */
function continueWithId(domainId: string) {
  fillDomainId(domainId);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

/** Both steps: verify the id, wait for the reveal, then submit the password. */
async function signIn(domainId: string, password: string) {
  continueWithId(domainId);
  await waitFor(() => expect(passwordInput().disabled).toBe(false));
  fireEvent.change(passwordInput(), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  // jsdom ships no matchMedia; the form's load-in calls useReducedMotion
  // (motion/react), which reads it. Report reduced motion so the entrance is
  // dropped and the blocks render statically — these tests assert structure and
  // behaviour, not the animation.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  it("renders the sign-in heading and the verbatim body copy", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Sign in" })).not.toBeNull();
    expect(
      screen.getByText("Use the same credentials as your CGS One App account."),
    ).not.toBeNull();
  });

  it("renders the three partner logos at the top of the form", () => {
    renderForm();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("keeps the password step collapsed until the Domain ID is verified", async () => {
    configureApi({ exists: true });
    renderForm();

    // Before verifying, the first action is Continue and the password is
    // disabled (collapsed, not part of the tab/submit flow).
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeNull();
    expect(passwordInput().disabled).toBe(true);

    continueWithId("AB12345");

    await waitFor(() => expect(passwordInput().disabled).toBe(false));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/verify-domain", {
      method: "POST",
      body: JSON.stringify({ domainId: "AB12345" }),
    });
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
  });

  it("shows an inline error and does not reveal the password for an unknown Domain ID", async () => {
    configureApi({ exists: false });
    renderForm();
    continueWithId("ZZ99999");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/couldn't find/i),
    );
    expect(passwordInput().disabled).toBe(true);
    // The login endpoint is never reached for a non-existent id.
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      "/api/auth/login",
      expect.anything(),
    );
  });

  it("posts { domainId, password, portal } to /api/auth/login only after verifying", async () => {
    configureApi({
      exists: true,
      login: { user: { role: "associate" }, redirectTo: "/" },
    });
    renderForm();
    await signIn("AB12345", "hunter2");

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/login", {
        method: "POST",
        // `portal` is the variant this form was rendered with — it is what
        // stops a whitelisted Domain ID becoming an admin at /login.
        body: JSON.stringify({
          domainId: "AB12345",
          password: "hunter2",
          portal: "requestor",
        }),
      }),
    );
    // Verify ran before login.
    const urls = apiFetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["/api/auth/verify-domain", "/api/auth/login"]);
  });

  it("sends portal: admin from the admin variant", async () => {
    configureApi({
      exists: true,
      login: { user: { role: "admin_support" }, redirectTo: "/dashboard" },
    });
    renderForm("admin");
    await signIn("AB12345", "hunter2");

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          domainId: "AB12345",
          password: "hunter2",
          portal: "admin",
        }),
      }),
    );
  });

  it("redirects to the server's redirectTo on success, not a client-side guess", async () => {
    // Requestor variant, but the server sends an admin destination — the
    // redirect must follow the server, never the page the user logged in on.
    configureApi({
      exists: true,
      login: { user: { role: "admin_support" }, redirectTo: "/dashboard" },
    });
    renderForm("requestor");
    await signIn("AB12345", "hunter2");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("toasts every login error instead of navigating", async () => {
    configureApi({
      exists: true,
      loginError: new ApiError("NOT_AUTHENTICATED", "Sign-in failed.", 401),
    });
    renderForm();
    await signIn("AB12345", "hunter2");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Sign-in failed."),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("re-collapses the password step when the Domain ID is edited after verifying", async () => {
    configureApi({ exists: true });
    renderForm();
    continueWithId("AB12345");
    await waitFor(() => expect(passwordInput().disabled).toBe(false));

    // Editing any Domain ID box invalidates the prior check.
    fireEvent.change(screen.getByLabelText("Domain ID character 1 of 7"), {
      target: { value: "C" },
    });

    await waitFor(() => expect(passwordInput().disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeNull();
  });
});
