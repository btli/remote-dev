import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-lg">Page not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The page you are looking for does not exist or has been moved.
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
