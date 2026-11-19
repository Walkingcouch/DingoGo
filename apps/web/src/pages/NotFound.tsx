import { Link } from 'react-router-dom';
import { PageHead } from '../Layout';
import { useMeta } from '../meta';

export default function NotFound() {
  useMeta('Page not found', 'This page could not be found.', { noindex: true });
  return (
    <>
      <PageHead title="We couldn't find that page">The link may be old, or the address mistyped.</PageHead>
      <section className="section"><div className="wrap"><Link className="dg-btn" to="/">Go to the home page</Link></div></section>
    </>
  );
}
