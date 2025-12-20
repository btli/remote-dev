import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isApiRoute = req.nextUrl.pathname.startsWith("/api");

  if (isApiRoute) {
    return;
  }

  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
