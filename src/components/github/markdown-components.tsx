import Image from "next/image";
import remarkGfm from "remark-gfm";

export const REMARK_PLUGINS = [remarkGfm];

export const MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-lg font-semibold mb-2 mt-4 border-b border-border pb-1">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-semibold mb-2 mt-3 border-b border-border pb-1">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm text-foreground mb-2 leading-relaxed">{children}</p>
  ),
  code: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => {
    const isBlock = className?.includes("language-");
    return isBlock ? (
      <code className="block bg-muted rounded p-2 text-xs overflow-x-auto my-2 font-mono">
        {children}
      </code>
    ) : (
      <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-muted rounded-md p-3 overflow-x-auto my-2 text-xs">
      {children}
    </pre>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside text-sm mb-2 space-y-0.5">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside text-sm mb-2 space-y-0.5">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-sm">{children}</li>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground text-sm my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const trimmed = href?.trimStart() ?? "";
    const isSafe =
      !trimmed.includes(":") || /^(https?:|mailto:|#)/i.test(trimmed);
    if (!isSafe) return <>{children}</>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        {children}
      </a>
    );
  },
  hr: () => <hr className="border-border my-3" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-sm border border-border">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-border px-2 py-1 bg-muted text-left text-xs font-medium">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-border px-2 py-1 text-xs">{children}</td>
  ),
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => {
    const imgSrc = typeof src === "string" ? src : undefined;
    if (!imgSrc) return null;
    return (
      <Image
        src={imgSrc}
        alt={alt ?? ""}
        width={600}
        height={400}
        unoptimized
        className="max-w-full h-auto rounded-md my-2"
      />
    );
  },
  input: ({ checked }: { checked?: boolean }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled
      className="mr-1.5 align-middle"
    />
  ),
} satisfies Record<string, React.ComponentType<Record<string, unknown>>>;
