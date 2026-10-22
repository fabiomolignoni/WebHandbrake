/**
 * "Advanced options": the settings of a part of a rule beyond its first questions, folded away
 * (progressive disclosure). They are open when the rule uses one of them, at the start or once it
 * does (an exception typed with + in the list of sites), so that nothing in force is hidden; they
 * never fold by themselves.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import { Icon } from '../../ui/icons';

export function AdvancedOptions({
  open = false,
  children,
}: {
  /** The rule uses one of the options. */
  open?: boolean;
  children: ComponentChildren;
}) {
  const [initial] = useState(open);
  const ref = useRef<HTMLDetailsElement>(null);
  const used = useRef(open);
  useEffect(() => {
    if (open && !used.current && ref.current) ref.current.open = true;
    used.current = open;
  }, [open]);
  return (
    <details ref={ref} class="disclosure advanced" open={initial}>
      <summary>
        <Icon name="sliders" />
        {t('editor.advanced')}
      </summary>
      <div class="body stack">{children}</div>
    </details>
  );
}
