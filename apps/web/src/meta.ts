import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { contact, useConfig } from './config';
import { PRIVATE_PREFIXES, headTags, pageFor, siteUrl } from './seo';

const env = (import.meta as any).env ?? {};
/** Canonical site address: VITE_SITE_URL at build time, else the address the site is served from. */
export const SITE_URL = siteUrl(env.VITE_SITE_URL || (typeof location !== 'undefined' ? location.origin : ''));

/**
 * Page title, description, canonical link, Open Graph and structured data. Static pages take theirs from seo.ts (the same tags
 * the build writes into each page's HTML); pages with changing content pass a title/description. Private and unknown pages get noindex.
 */
export function useMeta(title?: string, description?: string, opts: { noindex?: boolean } = {}) {
  const { pathname } = useLocation();
  const c = contact(useConfig());
  useEffect(() => {
    const page = pageFor(pathname);
    const noindex = opts.noindex || !page || PRIVATE_PREFIXES.some((p) => pathname.startsWith(p));
    const html = headTags({
      title: title ?? page?.title ?? 'DingoGo', description: description ?? page?.description ?? PAGE_DEFAULT, path: pathname, noindex, page,
    }, SITE_URL, c);
    document.head.querySelectorAll('[data-seo]').forEach((el) => el.remove());
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    document.head.append(...Array.from(tpl.content.children));
  }, [pathname, title, description, opts.noindex, c.phone, c.email, c.hours]);
}
const PAGE_DEFAULT = 'Aboriginal-owned, local rideshare and same-day courier in Alice Springs (Mparntwe), going electric.';
