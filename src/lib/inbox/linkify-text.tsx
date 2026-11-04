import Linkify from 'linkify-react';

interface LinkifyTextProps {
  text: string;
  isAgent: boolean;
  className?: string;
}

/** Render message text with safe, clickable HTTP(S) and www links. */
export function LinkifyText({ text, isAgent, className }: LinkifyTextProps) {
  return (
    <Linkify
      as="span"
      className={className}
      options={{
        defaultProtocol: 'https',
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        className: isAgent
          ? 'text-primary-foreground underline underline-offset-2 hover:opacity-80'
          : 'text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
        validate: {
          url: (url) => /^https?:\/\//i.test(url) || /^www\./i.test(url),
        },
      }}
    >
      {text}
    </Linkify>
  );
}
