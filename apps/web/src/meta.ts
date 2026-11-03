import { useEffect } from 'react';

export function useMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title === 'DingoGo' ? 'DingoGo — electric rides and deliveries in Alice Springs' : `${title} | DingoGo`;
    if (description) {
      let m = document.querySelector('meta[name="description"]');
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); }
      m.setAttribute('content', description);
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    }
  }, [title, description]);
}
