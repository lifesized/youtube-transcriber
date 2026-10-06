import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  ENV_NAME,
  isAuthorizedRequest,
  tokensEqual,
  unauthorizedJson,
} from "./lib/local-api-auth.js";

function expectedToken(): string | null {
  const fromEnv = process.env[ENV_NAME];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return null;
}

function setTokenCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
}

export function middleware(request: NextRequest) {
  const expected = expectedToken();
  const { pathname } = request.nextUrl;

  // Page navigations: mint/refresh httpOnly cookie so same-origin web UI
  // fetches succeed without putting the token in JS, chrome.storage, or URLs.
  if (!pathname.startsWith("/api/")) {
    if (!expected) return NextResponse.next();
    const res = NextResponse.next();
    const existing = request.cookies.get(COOKIE_NAME)?.value;
    if (!existing || !tokensEqual(existing, expected)) {
      setTokenCookie(res, expected);
    }
    return res;
  }

  if (!expected) {
    return NextResponse.json(unauthorizedJson(), { status: 401 });
  }

  const authorized = isAuthorizedRequest(
    {
      authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"),
    },
    expected,
    tokensEqual
  );

  if (!authorized) {
    return NextResponse.json(unauthorizedJson(), { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
