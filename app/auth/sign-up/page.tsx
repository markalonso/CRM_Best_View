"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${appUrl}/auth/callback` }
    });

    if (signUpError) {
      setError(signUpError.message || "Unable to sign up");
      setLoading(false);
      return;
    }

    if (!signUpData.session) {
      setLoading(false);
      setError("Account created. Check your email to confirm, then sign in.");
      return;
    }

    router.replace("/inbox");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-2 text-2xl font-semibold">Create account</h1>
      <p className="mb-6 text-sm text-slate-600">Sign up to access CRM Best View.</p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <input className="w-full rounded border border-slate-300 px-3 py-2" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded border border-slate-300 px-3 py-2" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button disabled={loading} className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-60" type="submit">
          {loading ? "Creating..." : "Sign up"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Have an account? <Link href="/auth/sign-in" className="underline">Sign in</Link>
      </p>
    </main>
  );
}
