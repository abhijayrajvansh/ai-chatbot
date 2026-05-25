"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/auth/session-provider";
import { toast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firebaseClientAuth } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirectUrl") || "/";
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");
  const { update: updateSession } = useSession();

  useEffect(() => {
    if (redirectUrl.startsWith("/")) {
      router.prefetch(redirectUrl);
    }
  }, [redirectUrl, router]);

  const handleAction = (formData: FormData) => {
    const nextEmail = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    setEmail(nextEmail);
    setError("");

    setIsPending(true);
    signInWithEmailAndPassword(firebaseClientAuth(), nextEmail, password)
      .then(async () => {
        await updateSession();
        router.replace(redirectUrl.startsWith("/") ? redirectUrl : "/");
        router.refresh();
      })
      .catch(() => {
        const message = "Invalid email or password.";
        setError(message);
        toast({ type: "error", description: message });
      })
      .finally(() => {
        setIsPending(false);
      });
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and password.
        </p>
      </div>

      <form action={handleAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            aria-invalid={Boolean(error)}
            autoComplete="email"
            autoFocus
            defaultValue={email}
            id="email"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              aria-invalid={Boolean(error)}
              autoComplete="current-password"
              className="pr-10"
              id="password"
              name="password"
              required
              type={showPassword ? "text" : "password"}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              {showPassword ? (
                <EyeOffIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
            </button>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <Button className="w-full" disabled={isPending} type="submit">
          {isPending ? "Logging in..." : "Login with"}
        </Button>
      </form>

    </div>
  );
}
