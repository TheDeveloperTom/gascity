// Seam stub (vk lane 0b). Owner: lane 6. Other lanes import, never edit.
import type { AnchorHTMLAttributes } from 'react';
import { openExternal } from '../lib/openExternal';

export type ExternalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target'> & {
  href: string;
};

export function ExternalLink({ href, onClick, ...rest }: ExternalLinkProps) {
  return (
    <a
      {...rest}
      href={href}
      rel="noopener noreferrer"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          e.preventDefault();
          openExternal(href);
        }
      }}
    />
  );
}
