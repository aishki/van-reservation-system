const COPY = {
  role: {
    body: "This area is for Admin Support.",
    hint: "Sign in with an Admin Support account, or return to the associate portal.",
  },
  // Falls back here for any value outside the closed set below — the param
  // is presentation-only and is never trusted for an authorization decision.
  default: {
    body: "This page is not available for your account.",
    hint: "Contact your site Admin Support if you believe this is a mistake.",
  },
} as const;

type Reason = keyof typeof COPY;

// Closed-set validation: the raw search param is never interpolated into the
// page, and anything outside "role" falls back to the generic copy.
function resolveReason(value: string | string[] | undefined): Reason {
  return value === "role" ? value : "default";
}

export default async function NotAuthorizedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const copy = COPY[resolveReason(params.reason)];

  return (
    <main className="flex flex-1 items-center justify-center bg-gray-5 p-6">
      <div className="w-full max-w-lg rounded-card border border-gray-4 bg-white p-8">
        <h1 className="text-h3 font-medium text-error">Access not available</h1>
        <p className="mt-4 text-body text-gray-1">{copy.body}</p>
        <p className="mt-3 text-sm text-gray-2">{copy.hint}</p>
      </div>
    </main>
  );
}
