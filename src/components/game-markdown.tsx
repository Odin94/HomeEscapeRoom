import Markdown from "react-markdown";

export function GameMarkdown({
  children,
  inline = false,
}: {
  children: string;
  inline?: boolean;
}) {
  const content = (
    <Markdown
      skipHtml
      allowedElements={inline ? ["strong", "em", "code", "br"] : undefined}
      unwrapDisallowed={inline}
    >
      {children}
    </Markdown>
  );
  return inline ? (
    <span>{content}</span>
  ) : (
    <div className="game-markdown">{content}</div>
  );
}
