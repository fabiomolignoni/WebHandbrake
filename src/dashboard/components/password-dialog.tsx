/**
 * A new password for a rule, typed twice. The background hashes it; the dialog never
 * stores it.
 */

import { useState } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import { Button, Dialog, Field } from '../../ui/components';
import { TypingInput } from '../../ui/ticket';

/** Passwords shorter than this are refused. */
const MIN_LENGTH = 4;

export function PasswordDialog({
  title,
  help,
  onSave,
  onClose,
}: {
  title: string;
  help: string;
  onSave: (password: string) => void;
  onClose: () => void;
}) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={pw.length < MIN_LENGTH || pw !== pw2}
            onClick={() => onSave(pw)}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <p class="small">{help}</p>
        <Field label={t('access.newPassword')}>
          {(id) => (
            <TypingInput id={id} password value={pw} onInput={setPw} label={t('access.newPassword')} />
          )}
        </Field>
        <Field label={t('access.repeat')} error={pw2 && pw !== pw2 ? t('access.mismatch') : null}>
          {(id) => <TypingInput id={id} password value={pw2} onInput={setPw2} label={t('access.repeat')} />}
        </Field>
      </div>
    </Dialog>
  );
}
