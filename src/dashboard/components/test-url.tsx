/** "Test a URL" (MAT-16): what would happen to a URL, why, and until when. */

import { useState } from 'preact/hooks';
import type { Group } from '../../engine/types';
import { t } from '../../i18n/i18n';
import type { DecisionView } from '../../shared/models';
import { call } from '../../shared/rpc';
import { Button } from '../../ui/components';
import { Explain } from '../../ui/explain';

export function TestUrl({
  draft,
  groups,
  initial = '',
}: {
  draft?: Group;
  groups?: Group[];
  initial?: string;
}) {
  const [url, setUrl] = useState(initial);
  const [result, setResult] = useState<DecisionView | null>(null);
  const [incognito, setIncognito] = useState(false);
  const run = async () => {
    let u = url.trim();
    if (!u) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `https://${u}`;
    setResult(await call('explain', { url: u, draftGroup: draft, incognito }));
  };
  return (
    <div class="stack stack-sm">
      <form
        class="row nowrap"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          class="input mono grow"
          value={url}
          placeholder="reddit.com/r/…"
          aria-label={t('test.url')}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
        />
        <Button type="submit" size="small" variant="primary">
          {t('test.run')}
        </Button>
      </form>
      <label class="check tiny">
        <input
          type="checkbox"
          checked={incognito}
          onChange={(e) => setIncognito((e.target as HTMLInputElement).checked)}
        />
        {t('test.private')}
      </label>
      {result && (
        <Explain
          d={result}
          groups={draft ? [...(groups ?? []).filter((g) => g.id !== draft.id), draft] : groups}
        />
      )}
    </div>
  );
}
