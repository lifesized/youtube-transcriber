import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ENV_NAME,
  cookieName,
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
    name: cookieName(),
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

  // Page routes: mint/refresh the httpOnly cookie for same-origin loads and
  // top-level document navigations (the extension's and tray's Library tabs),
  // never for a cross-site subresource, iframe or fetch.
  if (!pathname.startsWith("/api/")) {
    if (!expected) return NextResponse.next();
    const res = NextResponse.next();
    const fetchMetadata = {
      site: request.headers.get("sec-fetch-site"),
      mode: request.headers.get("sec-fetch-mode"),
      dest: request.headers.get("sec-fetch-dest"),
    };
    if (shouldMintTokenCookie(fetchMetadata)) {
      const existing = request.cookies.get(cookieName())?.value;
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
      secFetchSite: request.headers.get("sec-fetch-site"),
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
