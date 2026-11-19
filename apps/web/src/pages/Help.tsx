import { FaqList } from '../components/Faq';
import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';

export default function Help() {
  useMeta();
  const c = contact(useConfig());
  return (
    <>
      <PageHead title="Help and common questions">Can't find your answer? Call {c.phone} or email {c.email}.</PageHead>
      <section className="section">
        <div className="wrap prose" style={{ maxWidth: 820 }}>
          <FaqList set="general" />
        </div>
      </section>
    </>
  );
}
