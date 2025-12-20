import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET
  });

  const isLoggedIn = !!token;
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isApiRoute = request.nextUrl.pathname.startsWith("/api");

  if (isApiRoute) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
