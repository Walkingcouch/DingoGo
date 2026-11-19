import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PAGES, headTags, robotsTxt, siteUrl, sitemapXml } from './src/seo';

const shared = path.resolve(__dirname, '../../packages/shared');

/**
 * Round 13: after the build, write every public page as its own HTML file with its title, description, canonical link, Open Graph
 * and structured data (crawlers and link previews don't run JavaScript), an `app.html` fallback with noindex for private and unknown
 * paths, sitemap.xml and robots.txt — then check the page-speed budget. Only for the website at the site root.
 */
const BUDGET = { entryJsGzipKb: 110, entryCssGzipKb: 20, imageKb: 120 };
function seoAndBudget(): Plugin {
  let outDir = 'dist'; let base = '/';
  return {
    name: 'dingogo-seo',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); base = c.base; },
    closeBundle() {
      if (base !== '/') return;
      const site = siteUrl(process.env.VITE_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ''));
      const shell = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const block = /<!--seo-->[\s\S]*?<!--\/seo-->/;
      if (!block.test(shell)) throw new Error('index.html is missing the <!--seo--> block');
      const withHead = (tags: string) => shell.replace(block, tags);
      const written: string[] = [];
      for (const p of PAGES) {
        const file = p.path === '/' ? 'index.html' : `${p.path.slice(1)}/index.html`;
        fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
        fs.writeFileSync(path.join(outDir, file), withHead(headTags({ title: p.title, description: p.description, path: p.path, page: p }, site)));
        written.push(p.path);
      }
      fs.writeFileSync(path.join(outDir, 'app.html'), withHead(headTags({ title: 'DingoGo', description: PAGES[0].description, path: '/', noindex: true }, site)));
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(site, new Date().toISOString().slice(0, 10)));
      fs.writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt(site));
      fs.writeFileSync(path.join(outDir, 'prerendered.json'), JSON.stringify({ site, pages: written }, null, 2));

      // Budget: the JS and CSS the first page needs, and every image we ship.
      const gz = (f: string) => zlib.gzipSync(fs.readFileSync(path.join(outDir, f))).length / 1024;
      const entryJs = [...shell.matchAll(/<script[^>]+src="\/([^"]+\.js)"/g), ...shell.matchAll(/<link rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g)].map((m) => m[1]);
      const entryCss = [...shell.matchAll(/<link rel="stylesheet"[^>]+href="\/(assets\/[^"]+\.css)"/g)].map((m) => m[1]);
      const js = entryJs.reduce((s, f) => s + gz(f), 0); const css = entryCss.reduce((s, f) => s + gz(f), 0);
      const problems: string[] = [];
      if (js > BUDGET.entryJsGzipKb) problems.push(`entry JS ${js.toFixed(1)} KB gzip > ${BUDGET.entryJsGzipKb} KB`);
      if (css > BUDGET.entryCssGzipKb) problems.push(`entry CSS ${css.toFixed(1)} KB gzip > ${BUDGET.entryCssGzipKb} KB`);
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
      for (const f of walk(outDir).filter((f) => /\.(png|jpe?g|webp|avif|gif)$/i.test(f))) {
        const kb = fs.statSync(f).size / 1024;
        if (kb > BUDGET.imageKb) problems.push(`${path.relative(outDir, f)} is ${kb.toFixed(0)} KB > ${BUDGET.imageKb} KB`);
      }
      console.log(`  seo: ${written.length} pages, sitemap, robots for ${site}; budget: entry JS ${js.toFixed(1)} KB gz, CSS ${css.toFixed(1)} KB gz`);
      if (problems.length) throw new Error(`Page-speed budget exceeded:\n  ${problems.join('\n  ')}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), seoAndBudget()],
  resolve: {
    alias: [
      { find: '@dingogo/shared/brand.css', replacement: `${shared}/src/brand.css` },
      { find: '@dingogo/shared/map', replacement: `${shared}/src/Map.tsx` },
      { find: '@dingogo/shared/assets', replacement: `${shared}/assets` },
      { find: /^@dingogo\/shared$/, replacement: `${shared}/src/index.ts` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173, fs: { allow: ['../..'] } },
});
