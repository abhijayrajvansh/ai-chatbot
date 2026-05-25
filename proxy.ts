import { type NextRequest, NextResponse } from "next/server";
import { FIREBASE_ID_TOKEN_COOKIE } from "./lib/firebase/session";
import { isLocalUiOnlyMode } from "./lib/local-mode";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isLocalUiOnlyMode) {
    return NextResponse.next();
  }

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const hasSessionCookie = Boolean(
    request.cookies.get(FIREBASE_ID_TOKEN_COOKIE)?.value
  );

  if (pathname === "/login") {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL(`${base}/`, request.url));
    }

    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const redirectUrl = encodeURIComponent(new URL(request.url).pathname);

    return NextResponse.redirect(
      new URL(`${base}/login?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
