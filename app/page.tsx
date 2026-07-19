import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <main className="flex max-w-xl flex-col items-center gap-6">
        <h1 className="text-4xl font-semibold tracking-tight">GoatbookLM</h1>
        <p className="text-muted-foreground text-balance">
          An open, self-hosted take on NotebookLM — upload sources, ask
          questions, and get grounded answers.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild data-test="landing-signup-link">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline" data-test="landing-login-link">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
