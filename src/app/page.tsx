import { auth, signOut } from "@/auth";
import { Terminal } from "@/components/terminal/Terminal";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-semibold">Remote Dev</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {session?.user?.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">
        <Terminal />
      </main>
    </div>
  );
}
