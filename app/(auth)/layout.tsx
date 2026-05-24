import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <Link
          className="mb-8 flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          href="/"
        >
          <MessageSquareIcon className="size-4" />
          Chatbot
        </Link>
        {children}
      </div>
    </div>
  );
}
