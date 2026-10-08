import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  ENV_NAME,
  isAllowedLoopbackHost,
  isAuthorizedRequest,
  shouldMintTokenCookie,
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
  const host = request.headers.get("host");
  if (!isAllowedLoopbackHost(host)) {
    return new NextResponse(null, { status: 421 });
  }

  const expected = expectedToken();
  const { pathname } = request.nextUrl;

  // Pairing authenticates via Origin: chrome-extension://<id>, not the
  // loopback token — the extension does not have a token until the native
  // host is installed.
  if (pathname === "/api/native-host/pair") {
    return NextResponse.next();
  }

  // Page navigations: mint/refresh httpOnly cookie only for top-level or
  // same-origin loads so a cross-site fetch cannot collect Set-Cookie.
  if (!pathname.startsWith("/api/")) {
    if (!expected) return NextResponse.next();
    const res = NextResponse.next();
    const site = request.headers.get("sec-fetch-site");
    if (shouldMintTokenCookie(site)) {
      const existing = request.cookies.get(COOKIE_NAME)?.value;
      if (!existing || !tokensEqual(existing, expected)) {
        setTokenCookie(res, expected);
      }
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
